//! t-ECDSA Bitcoin address derivation + native UTXO funding detection (ADR-254 §3, §4). FU-254-C.
//!
//! Everything here does real IC management-canister / Bitcoin-canister I/O — unlike
//! `state_machine.rs`, none of it is unit-testable without a live replica (see README "Full local
//! deploy + live smoke test").

use crate::types::{Trade, TradeError};
use bitcoin::{
    Address as BtcAddress, Amount, CompressedPublicKey, EcdsaSighashType, KnownHrp,
    OutPoint as BtcOutPoint, ScriptBuf, Sequence, Transaction, TxIn, TxOut, Txid as BtcTxid,
    Witness,
    absolute::LockTime,
    ecdsa::Signature as BtcEcdsaSignature,
    hashes::Hash,
    secp256k1,
    sighash::SighashCache,
    transaction::Version,
};
use ic_cdk_bitcoin_canister::{
    GetCurrentFeePercentilesRequest, GetUtxosRequest, Network as BtcNetwork, NetworkInRequest,
    SendTransactionRequest, Utxo, UtxosFilterInRequest, bitcoin_get_current_fee_percentiles,
    bitcoin_get_utxos, bitcoin_send_transaction,
};
use ic_cdk_management_canister::{
    EcdsaCurve, EcdsaKeyId, EcdsaPublicKeyArgs, SignWithEcdsaArgs, ecdsa_public_key, sign_with_ecdsa,
};
use std::str::FromStr;

/// Deployment target (ADR-364 D2 build matrix): the t-ECDSA key name, the IC Bitcoin-API network
/// selector, the rust-bitcoin address HRP, and the rust-bitcoin network are kept in lock-step as
/// ONE compile-time target per cargo feature — never a runtime parameter. `bitcoin-regtest` is the
/// default; `bitcoin-testnet`/`bitcoin-mainnet` are separate, mutually-exclusive builds (see the
/// compile_error guard in lib.rs), each with its own reproducible-build + attestation proof
/// (ADR-364 D6). ADR-254 §3 sketched `dfx_test_key`/regtest locally, but `dfx 0.32`'s local backend
/// (PocketIC) seeds only a single local test key named `key_1` for every algorithm, so the regtest
/// target uses `key_1` — a build-time finding, not what ADR-254 originally sketched.
#[cfg(feature = "bitcoin-regtest")]
const ECDSA_KEY_NAME: &str = "key_1";
#[cfg(feature = "bitcoin-testnet")]
const ECDSA_KEY_NAME: &str = "test_key_1";
#[cfg(feature = "bitcoin-mainnet")]
const ECDSA_KEY_NAME: &str = "key_1";

#[cfg(feature = "bitcoin-regtest")]
const BITCOIN_NETWORK: BtcNetwork = BtcNetwork::Regtest;
#[cfg(feature = "bitcoin-testnet")]
const BITCOIN_NETWORK: BtcNetwork = BtcNetwork::Testnet;
#[cfg(feature = "bitcoin-mainnet")]
const BITCOIN_NETWORK: BtcNetwork = BtcNetwork::Mainnet;

#[cfg(feature = "bitcoin-regtest")]
const KNOWN_HRP: KnownHrp = KnownHrp::Regtest;
#[cfg(feature = "bitcoin-testnet")]
const KNOWN_HRP: KnownHrp = KnownHrp::Testnets;
#[cfg(feature = "bitcoin-mainnet")]
const KNOWN_HRP: KnownHrp = KnownHrp::Mainnet;

#[cfg(feature = "bitcoin-regtest")]
const RUST_NETWORK: bitcoin::Network = bitcoin::Network::Regtest;
#[cfg(feature = "bitcoin-testnet")]
const RUST_NETWORK: bitcoin::Network = bitcoin::Network::Testnet4;
#[cfg(feature = "bitcoin-mainnet")]
const RUST_NETWORK: bitcoin::Network = bitcoin::Network::Bitcoin;

/// Confirmation depth required before funding counts as confirmed. ADR-254 §4 fixes this at 1 for
/// the Testnet/Regtest E2E stage explicitly — the real pilot value is a FU-253-H security-gate
/// measurement (reorg risk vs. UX latency), not decided here.
const MIN_CONFIRMATIONS: u32 = 1;

fn key_id() -> EcdsaKeyId {
    EcdsaKeyId {
        curve: EcdsaCurve::Secp256k1,
        name: ECDSA_KEY_NAME.to_string(),
    }
}

/// Derives the trade's t-ECDSA public key (ADR-254 §3): one canister-wide key, one derivation path
/// per trade (`[trade_id_be_bytes]`). Not persisted on `Trade` — re-derived on demand (at trade
/// creation for the address, and again at payout time for the signing witness) rather than adding
/// a redundant field to the Candid-facing `Trade` struct; the extra `ecdsa_public_key` round-trip
/// is cheap and t-ECDSA derivation is deterministic, so this never produces a different key.
async fn derive_trade_pubkey(trade_id: u64) -> Result<CompressedPublicKey, TradeError> {
    let result = ecdsa_public_key(&EcdsaPublicKeyArgs {
        canister_id: None,
        derivation_path: vec![trade_id.to_be_bytes().to_vec()],
        key_id: key_id(),
    })
    .await
    .map_err(|e| TradeError::BitcoinApiError {
        reason: format!("ecdsa_public_key: {e}"),
    })?;

    CompressedPublicKey::from_slice(&result.public_key).map_err(|e| TradeError::BitcoinApiError {
        reason: format!("invalid ECDSA public key: {e}"),
    })
}

/// Derives the trade's P2WPKH Bitcoin address via t-ECDSA (ADR-254 §3): one derivation path per
/// trade so on-chain funding can be attributed to exactly one trade — no address pooling.
pub async fn derive_trade_address(trade_id: u64) -> Result<String, TradeError> {
    let compressed = derive_trade_pubkey(trade_id).await?;
    Ok(BtcAddress::p2wpkh(&compressed, KNOWN_HRP).to_string())
}

/// Queries confirmed UTXOs at `address` (ADR-254 §4: native `bitcoin_get_utxos`, no oracle).
/// Returns the raw UTXO set (persisted by the caller as `Trade::funded_utxos` once funding is
/// confirmed — FU-254-D's payout transaction needs exactly these as its inputs) alongside their
/// satoshi sum.
pub async fn confirmed_utxos(address: &str) -> Result<(Vec<Utxo>, u64), TradeError> {
    let response = bitcoin_get_utxos(&GetUtxosRequest {
        address: address.to_string(),
        network: NetworkInRequest::from(BITCOIN_NETWORK),
        filter: Some(UtxosFilterInRequest::MinConfirmations(MIN_CONFIRMATIONS)),
    })
    .await
    .map_err(|e| TradeError::BitcoinApiError {
        reason: format!("bitcoin_get_utxos: {e}"),
    })?;

    let total: u64 = response.utxos.iter().map(|u| u.value).sum();
    Ok((response.utxos, total))
}

/// Conservative flat fallback fee rate (sat/vB) for when the Bitcoin canister has no mempool
/// fee-percentile history yet — always true on a freshly started regtest node. Not a market
/// estimate, just enough to get a transaction to confirm in a near-empty regtest mempool.
const FALLBACK_SAT_PER_VBYTE: u64 = 2;

/// Current fee rate in sat/vbyte (ADR-254 doesn't fix a fee-market strategy for FU-254-D, so this
/// takes the median of `bitcoin_get_current_fee_percentiles`, falling back to a flat rate when the
/// node has no history — e.g. a just-started regtest node with an empty mempool).
async fn current_fee_rate_sat_per_vbyte() -> Result<u64, TradeError> {
    let percentiles = bitcoin_get_current_fee_percentiles(&GetCurrentFeePercentilesRequest {
        network: NetworkInRequest::from(BITCOIN_NETWORK),
    })
    .await
    .map_err(|e| TradeError::BitcoinApiError {
        reason: format!("bitcoin_get_current_fee_percentiles: {e}"),
    })?;

    if percentiles.is_empty() {
        return Ok(FALLBACK_SAT_PER_VBYTE);
    }
    // Percentiles are millisatoshi/vbyte, sorted ascending; take the median.
    let median_millisat = percentiles[percentiles.len() / 2];
    Ok((median_millisat / 1000).max(1))
}

fn parse_output_address(addr: &str, sats: u64) -> Result<TxOut, TradeError> {
    let unchecked = BtcAddress::from_str(addr).map_err(|e| TradeError::BitcoinApiError {
        reason: format!("bad output address {addr}: {e}"),
    })?;
    let checked = unchecked
        .require_network(RUST_NETWORK)
        .map_err(|e| TradeError::BitcoinApiError {
            reason: format!("wrong-network output address {addr}: {e}"),
        })?;
    Ok(TxOut {
        value: Amount::from_sat(sats),
        script_pubkey: checked.script_pubkey(),
    })
}

/// Shared transaction machinery for every payout path (ADR-254 §5/§6): spends every UTXO in
/// `trade.funded_utxos` as inputs, signs each with the trade's t-ECDSA key, broadcasts, and
/// returns the fully-signed `Transaction` (callers extract the txid — display order for a
/// user-facing string, internal byte order for synthesizing a new UTXO record). Does **not**
/// validate the payout invariant itself — callers must do that with whichever invariant applies to
/// their case (`validate_payout_outputs` for terminal payouts, `validate_partial_release_outputs`
/// for a non-final milestone release) *before* calling this, since by the time outputs reach here
/// they're just `TxOut`s with no address-provenance information left to check.
async fn build_sign_broadcast(trade: &Trade, tx_outputs: Vec<TxOut>) -> Result<Transaction, TradeError> {
    if trade.funded_utxos.is_empty() {
        return Err(TradeError::BitcoinApiError {
            reason: "no funded UTXOs to spend".into(),
        });
    }

    let compressed_pubkey = derive_trade_pubkey(trade.id).await?;
    let spend_script = BtcAddress::p2wpkh(&compressed_pubkey, KNOWN_HRP).script_pubkey();

    let tx_inputs: Vec<TxIn> = trade
        .funded_utxos
        .iter()
        .map(|utxo| {
            let txid_bytes: [u8; 32] = utxo
                .outpoint
                .txid
                .as_ref()
                .try_into()
                .expect("ic_btc_interface::Txid is always 32 bytes");
            TxIn {
                previous_output: BtcOutPoint {
                    txid: BtcTxid::from_byte_array(txid_bytes),
                    vout: utxo.outpoint.vout,
                },
                script_sig: ScriptBuf::new(),
                sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
                witness: Witness::new(),
            }
        })
        .collect();

    let mut unsigned_tx = Transaction {
        version: Version::TWO,
        lock_time: LockTime::ZERO,
        input: tx_inputs,
        output: tx_outputs,
    };

    let mut witnesses = Vec::with_capacity(trade.funded_utxos.len());
    for (i, utxo) in trade.funded_utxos.iter().enumerate() {
        let sighash = {
            let mut cache = SighashCache::new(&unsigned_tx);
            cache
                .p2wpkh_signature_hash(i, &spend_script, Amount::from_sat(utxo.value), EcdsaSighashType::All)
                .map_err(|e| TradeError::BitcoinApiError {
                    reason: format!("sighash for input {i}: {e}"),
                })?
        };

        let sig_result = sign_with_ecdsa(&SignWithEcdsaArgs {
            message_hash: sighash.to_byte_array().to_vec(),
            derivation_path: vec![trade.id.to_be_bytes().to_vec()],
            key_id: key_id(),
        })
        .await
        .map_err(|e| TradeError::BitcoinApiError {
            reason: format!("sign_with_ecdsa for input {i}: {e}"),
        })?;

        let compact_sig = secp256k1::ecdsa::Signature::from_compact(&sig_result.signature)
            .map_err(|e| TradeError::BitcoinApiError {
                reason: format!("invalid t-ECDSA signature for input {i}: {e}"),
            })?;
        let btc_sig = BtcEcdsaSignature::sighash_all(compact_sig);
        witnesses.push(Witness::p2wpkh(&btc_sig, &compressed_pubkey.0));
    }
    for (i, witness) in witnesses.into_iter().enumerate() {
        unsigned_tx.input[i].witness = witness;
    }

    let raw_tx = bitcoin::consensus::encode::serialize(&unsigned_tx);

    bitcoin_send_transaction(&SendTransactionRequest {
        transaction: raw_tx,
        network: NetworkInRequest::from(BITCOIN_NETWORK),
    })
    .await
    .map_err(|e| TradeError::BitcoinApiError {
        reason: format!("bitcoin_send_transaction: {e}"),
    })?;

    Ok(unsigned_tx)
}

/// Signs and broadcasts a full-drain **terminal** payout transaction (ADR-254 §5/§6): spends every
/// UTXO in `trade.funded_utxos` into `outputs`. Every caller of this function (timeout refund, a
/// single/final milestone release, a DAO verdict) is a full-drain case — there is no change output
/// back to the trade's own escrow address, so `outputs` must already sum to exactly
/// `total_input - fee` (see `state_machine::split_payout`, which callers use to compute them).
///
/// Re-validates the strict payout invariant (ADR-254 §5: outputs may only go to the trade's
/// buyer-refund/seller-payout/fee addresses — the trade's own escrow address is never legal here,
/// unlike `sign_and_broadcast_partial_milestone_payout`) immediately before signing — defense in
/// depth, even though `outputs` here is always constructed by this crate's own code, never external
/// input.
///
/// Returns the broadcast transaction's txid (hex, display byte order) on success.
pub async fn sign_and_broadcast_payout(
    trade: &Trade,
    outputs: &[(String, u64)],
) -> Result<String, TradeError> {
    let addresses: Vec<String> = outputs.iter().map(|(addr, _)| addr.clone()).collect();
    crate::state_machine::validate_payout_outputs(trade, &addresses)?;

    let tx_outputs = outputs
        .iter()
        .map(|(addr, sats)| parse_output_address(addr, *sats))
        .collect::<Result<Vec<TxOut>, TradeError>>()?;

    let tx = build_sign_broadcast(trade, tx_outputs).await?;
    Ok(tx.compute_txid().to_string())
}

/// Signs and broadcasts a NON-final milestone release (FU-254-H, ADR-254 §5/§6 gap): two outputs —
/// the milestone's contractual share to `trade.seller_payout_address`, and a change output of the
/// unreleased remainder back to the trade's OWN escrow address (`trade.btc_address`), funding the
/// milestones still to come. Validated against `validate_partial_release_outputs` (permits the
/// trade's own address in addition to buyer/seller/fee — the one case where that's legal).
///
/// Unlike `sign_and_broadcast_payout`, also returns the synthesized change `Utxo` — the caller
/// (`lib.rs`) must persist it as the trade's new `funded_utxos` (the old ones were just spent as
/// this transaction's inputs) so the *next* milestone release has something to spend without first
/// waiting on a `bitcoin_get_utxos` round trip to observe our own broadcast.
///
/// **Trust note:** the returned UTXO's `height` is a synthesized `0` — "unobserved", not "just
/// confirmed". The canister trusts its own just-broadcast, zero-confirmation transaction to chain
/// the next milestone. A reorg or a stuck mempool entry could strand later milestones on a UTXO
/// that never actually confirms. This is the same class of risk `MIN_CONFIRMATIONS` already accepts
/// for *initial* funding at the pilot stage (ADR-254 §4) — arguably tighter here, since it trusts
/// the canister's own unconfirmed transaction rather than a third party's confirmed one. Flagged
/// for FU-253-H's security gate to examine explicitly (e.g. requiring the caller to `check_funding`
/// before releasing the *next* milestone), not resolved unilaterally in this follow-up.
pub async fn sign_and_broadcast_partial_milestone_payout(
    trade: &Trade,
    seller_amount: u64,
    change_amount: u64,
) -> Result<(String, Utxo), TradeError> {
    let outputs = vec![
        (trade.seller_payout_address.clone(), seller_amount),
        (trade.btc_address.clone(), change_amount),
    ];
    let addresses: Vec<String> = outputs.iter().map(|(a, _)| a.clone()).collect();
    crate::state_machine::validate_partial_release_outputs(trade, &addresses)?;

    let tx_outputs = outputs
        .iter()
        .map(|(addr, sats)| parse_output_address(addr, *sats))
        .collect::<Result<Vec<TxOut>, TradeError>>()?;
    // Change is always the last output, at index len - 1 (outputs.len() == 2 here, but this stays
    // correct even if a future PLATFORM_FEE_ADDRESS output is inserted before it).
    let change_vout = (tx_outputs.len() - 1) as u32;

    let tx = build_sign_broadcast(trade, tx_outputs).await?;
    let txid_display = tx.compute_txid().to_string();

    let change_utxo = Utxo {
        outpoint: ic_cdk_bitcoin_canister::OutPoint {
            txid: tx.compute_txid().to_byte_array().into(),
            vout: change_vout,
        },
        value: change_amount,
        height: 0,
    };

    Ok((txid_display, change_utxo))
}

/// Fee rate + estimated fee for a payout spending `trade.funded_utxos` into `num_outputs` outputs.
/// Exposed so `lib.rs` entrypoints can compute `split_payout`'s `fee_sats` argument before calling
/// `sign_and_broadcast_payout`.
pub async fn estimate_fee_for_payout(trade: &Trade, num_outputs: usize) -> Result<u64, TradeError> {
    let sat_per_vbyte = current_fee_rate_sat_per_vbyte().await?;
    Ok(crate::state_machine::estimate_payout_fee(
        trade.funded_utxos.len(),
        num_outputs,
        sat_per_vbyte,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ADR-364 D2: the deployment target is selected by exactly one cargo feature. Each branch is
    /// cfg-gated, so only the active target's assertions compile and run.
    #[test]
    fn deploy_target_matches_selected_feature() {
        #[cfg(feature = "bitcoin-regtest")]
        {
            assert_eq!(ECDSA_KEY_NAME, "key_1");
            assert_eq!(RUST_NETWORK, bitcoin::Network::Regtest);
        }
        #[cfg(feature = "bitcoin-testnet")]
        {
            assert_eq!(ECDSA_KEY_NAME, "test_key_1");
            assert_eq!(RUST_NETWORK, bitcoin::Network::Testnet4);
        }
        #[cfg(feature = "bitcoin-mainnet")]
        {
            assert_eq!(ECDSA_KEY_NAME, "key_1");
            assert_eq!(RUST_NETWORK, bitcoin::Network::Bitcoin);
        }
    }
}
