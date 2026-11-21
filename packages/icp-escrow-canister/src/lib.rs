//! ICP escrow canister — Stufe 2/3 of ADR-253, detail design in
//! docs/decisions/254-icp-escrow-canister-detail-design.md.
//!
//! This crate currently implements FU-254-A (skeleton), FU-254-B (state machine + Candid
//! interface + pure-logic unit tests), FU-254-C (t-ECDSA P2WPKH address derivation + native UTXO
//! funding detection, `src/btc.rs`), FU-254-D (payout transaction signing/broadcast, also
//! `src/btc.rs`), FU-254-E (BIP-340 Schnorr signature verification, `src/sig.rs`), FU-254-H
//! (non-final milestone releases — the ADR-254 §5/§6 change-output gap found while building
//! FU-254-D), FU-254-I (stable-memory persistence) and FU-254-J (signed trade-terms hash at
//! `create_trade`). FU-617 re-shaped all buyer/seller authorization onto signed Nostr events
//! (NIP-07/NIP-46-signable, ADR-357 D3) and FU-619 added consensus-certified trade reads
//! (`get_trade_certified`). `claim_timeout_refund`, `open_dispute`, and every `release_milestone`
//! case (final *and* non-final) are fully wired end-to-end. One thing still returns a typed,
//! honest error rather than a silent no-op or a faked success:
//! - `submit_dao_verdict` verifies signatures correctly; `sig::DAO_PUBKEY_HEX` is `None` in the
//!   default `bitcoin-regtest` build (ADR-364 D5 provisions the founder's master key as the M0
//!   bootstrap in the `bitcoin-testnet`/`bitcoin-mainnet` variants).

// Build matrix (ADR-364 D2): exactly one Bitcoin deployment target per build. `bitcoin-regtest`
// is the default; `bitcoin-testnet`/`bitcoin-mainnet` are opted into with
// `--no-default-features --features bitcoin-testnet`.
#[cfg(all(feature = "bitcoin-regtest", feature = "bitcoin-testnet"))]
compile_error!("bitcoin-regtest and bitcoin-testnet are mutually exclusive (ADR-364 D2)");
#[cfg(all(feature = "bitcoin-regtest", feature = "bitcoin-mainnet"))]
compile_error!("bitcoin-regtest and bitcoin-mainnet are mutually exclusive (ADR-364 D2)");
#[cfg(all(feature = "bitcoin-testnet", feature = "bitcoin-mainnet"))]
compile_error!("bitcoin-testnet and bitcoin-mainnet are mutually exclusive (ADR-364 D2)");

mod btc;
mod sig;
mod state_machine;
mod types;

use candid::Principal;
use ic_certified_map::{AsHashTree, RbTree};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell};
use std::cell::RefCell;

pub use types::{CertifiedTradeView, CreateTradeArgs, Milestone, NostrAuthEvent, Trade, TradeError, TradeState};

type Memory = VirtualMemory<DefaultMemoryImpl>;

// Stable-memory-backed trade store (FU-254-I). Replaces the earlier `thread_local! BTreeMap`,
// which lost every trade on `dfx canister install --mode upgrade` — acceptable for the very first
// skeleton (FU-254-B), not acceptable once `check_funding`/payouts move real UTXOs (FU-254-C
// onward), and explicitly named as a pre-mainnet blocker in ADR-254's Consequences section.
// `MemoryId::new(0)`/`new(1)` are permanent, upgrade-stable slot assignments — never renumber an
// existing ID once a canister has real trades in stable memory, only append new ones.
thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static TRADES: RefCell<StableBTreeMap<u64, Trade, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))))
    );

    static NEXT_TRADE_ID: RefCell<StableCell<u64, Memory>> = RefCell::new(
        StableCell::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1))), 0)
    );
}

// ── Consensus-certified trade reads (FU-619, ADR-362 GAP F-5) ──
//
// `get_trade` is a `#[query]` — single-replica, no consensus — so the Bitcoin funding address it
// hands a buyer carried no subnet-backed guarantee before FU-619. This Merkle tree
// (`ic-certified-map::RbTree`) mirrors every trade's funding-critical fields; its root hash is
// pushed into the subnet's certified state (`certified_data_set`) on every mutation, so
// `get_trade_certified` can hand out a subnet-signed certificate plus a per-key Merkle witness
// that any client verifies against the NNS/IC root key — independent of this replica, this
// canister's honesty, and the relaying server.
//
// Heap state (rebuilt chunk-wise after upgrades, see `CERT_REBUILD_CURSOR`): the tree itself.
// Stable state (survives upgrades): the trades it is rebuilt from.

/// Trades re-certified per rebuild chunk. Post-upgrade rebuild must stay bounded: `post_upgrade`
/// runs as a single message under the instruction limit, and a trapping `post_upgrade` fails the
/// whole upgrade — an unbounded rebuild would brick upgrades once trade counts reach the
/// 10⁵–10⁶ range. Small states finish synchronously inside `post_upgrade` (one chunk covers
/// them); larger ones continue on heartbeats.
const CERT_REBUILD_CHUNK: usize = 2_048;

thread_local! {
    static CERT_TREE: RefCell<RbTree<Vec<u8>, Vec<u8>>> = RefCell::new(RbTree::new());

    /// Certification-rebuild progress: `None` = idle/complete, `Some(next_id)` = the next trade
    /// id (inclusive) not yet re-inserted into `CERT_TREE`. Heap state by design — an upgrade
    /// mid-rebuild wipes it and the next `post_upgrade` restarts from zero (correct, merely
    /// repeated work).
    static CERT_REBUILD_CURSOR: RefCell<Option<u64>> = const { RefCell::new(None) };
}

/// Tree key for a trade: 8-byte big-endian id (`u64::to_be_bytes`), lexicographically consistent
/// with numeric ordering.
fn cert_key(trade_id: u64) -> Vec<u8> {
    trade_id.to_be_bytes().to_vec()
}

/// The leaf payload a client verifies: the funding-critical fields in a fixed canonical order.
/// Binds exactly what REQ-FLOW-05 demands consensus for — *which* address a buyer must send to,
/// *how much*, and *which* state the trade is in — while staying trivially recomputable
/// off-chain (no Candid re-encoding needed: plain UTF-8 string comparison after `lookup_path`).
fn certification_payload(trade: &Trade) -> Vec<u8> {
    format!(
        "colabonate-escrow-cert-v1|{}|{}|{}|{}",
        trade.id,
        trade.btc_address,
        trade.expected_amount_sats,
        state_cert_name(&trade.state)
    )
    .into_bytes()
}

fn state_cert_name(state: &TradeState) -> String {
    match state {
        TradeState::PendingFunding => "PendingFunding".into(),
        TradeState::Funded => "Funded".into(),
        TradeState::Released => "Released".into(),
        TradeState::Refunded => "Refunded".into(),
        TradeState::Disputed => "Disputed".into(),
        TradeState::DisputeSettled { buyer_bps, seller_bps } =>
            format!("DisputeSettled:{buyer_bps}:{seller_bps}"),
    }
}

/// (Re-)inserts a trade's payload into the certification tree and pushes the new root hash into
/// certified data. Called after every trade mutation — a stale root would make every certified
/// read fail verification, loudly, which is exactly the failure mode we want.
fn certify_trade(trade: &Trade) {
    CERT_TREE.with(|tree| {
        let mut tree = tree.borrow_mut();
        tree.insert(cert_key(trade.id), certification_payload(trade));
        ic_cdk::api::certified_data_set(&tree.root_hash());
    });
}

/// Processes at most [`CERT_REBUILD_CHUNK`] trades starting at `CERT_REBUILD_CURSOR`, publishes
/// the (possibly partial) root as certified data, and advances the cursor. The partial root is
/// monotone-safe: certified reads served between chunks are consistent with the tree they were
/// served from; trades not yet re-inserted verify as honest proofs of absence.
fn process_certification_rebuild_chunk() {
    CERT_REBUILD_CURSOR.with(|cursor| {
        let Some(next) = *cursor.borrow() else { return };
        let mut processed = 0usize;
        let mut last = next;
        CERT_TREE.with(|tree| {
            let mut tree = tree.borrow_mut();
            TRADES.with(|trades| {
                for entry in trades
                    .borrow()
                    .range((std::ops::Bound::Included(next), std::ops::Bound::Unbounded))
                {
                    if processed >= CERT_REBUILD_CHUNK {
                        break;
                    }
                    let trade = entry.value();
                    tree.insert(cert_key(trade.id), certification_payload(&trade));
                    last = trade.id;
                    processed += 1;
                }
            });
            ic_cdk::api::certified_data_set(&tree.root_hash());
        });
        let mut cursor = cursor.borrow_mut();
        if processed < CERT_REBUILD_CHUNK {
            *cursor = None;
        } else {
            *cursor = Some(last.saturating_add(1));
        }
    });
}

/// Starts the chunked rebuild (idempotent): resets the cursor, processes the first chunk
/// synchronously — small states complete right here — and leaves the heartbeat to continue.
fn start_certification_rebuild() {
    CERT_REBUILD_CURSOR.with(|c| *c.borrow_mut() = Some(0));
    process_certification_rebuild_chunk();
}

/// Continues an in-flight certification rebuild, one bounded chunk per heartbeat. Idle cost is a
/// single `Option` check — heartbeat registration is the price of upgrade-safe chunking without a
/// timer dependency (ic-cdk 0.20 ships no timers module).
#[ic_cdk::heartbeat]
fn continue_certification_rebuild_heartbeat() {
    if CERT_REBUILD_CURSOR.with(|c| c.borrow().is_some()) {
        process_certification_rebuild_chunk();
    }
}

fn with_trade<R>(id: u64, f: impl FnOnce(&Trade) -> Result<R, TradeError>) -> Result<R, TradeError> {
    TRADES.with(|t| {
        let trade = t.borrow().get(&id).ok_or(TradeError::NotFound)?;
        f(&trade)
    })
}

/// Reads, mutates, and writes back a trade in one step — the `StableBTreeMap` equivalent of the
/// old `trades.get_mut(&id)` pattern, which stable structures deliberately don't support (values
/// are deserialized on read, so there's no in-place reference to mutate; every change has to be an
/// explicit `insert` of the whole updated value). No-ops silently if `id` doesn't exist, matching
/// every call site's existing `if let Some(trade) = ...` shape. Re-certifies after the write
/// (FU-619): every mutation keeps the certified root in lock-step with stable state.
fn update_trade(id: u64, f: impl FnOnce(&mut Trade)) {
    TRADES.with(|t| {
        let mut trades = t.borrow_mut();
        if let Some(mut trade) = trades.get(&id) {
            f(&mut trade);
            trades.insert(id, trade.clone());
            certify_trade(&trade);
        }
    });
}

/// Like [`update_trade`] but does NOT touch the certification tree — for the
/// optimistic pre-broadcast claims in the payout paths (`release_milestone` /
/// `claim_timeout_refund` / `submit_dao_verdict`), which flip the state to a
/// terminal value *before* the on-chain payout is signed/broadcast and roll
/// back on failure. Publishing such a flip into certified data would let
/// `get_trade_certified` hand out a consensus-signed "Released/Refunded" leaf
/// for a payout that never happened (or is still in flight), and the leaf
/// would remain replayable for the certificate freshness window after a
/// rollback (review fix 2026-09-02). The certified leaf is advanced to the
/// terminal state only by [`recertify_trade`] once the broadcast succeeded.
fn mutate_trade_uncertified(id: u64, f: impl FnOnce(&mut Trade)) {
    TRADES.with(|t| {
        let mut trades = t.borrow_mut();
        if let Some(mut trade) = trades.get(&id) {
            f(&mut trade);
            trades.insert(id, trade.clone());
        }
    });
}

/// Re-publishes a trade's current leaf + root into certified data. Called after
/// a payout broadcast succeeds so the certified state advances to the terminal
/// value exactly when the on-chain commit is real.
fn recertify_trade(id: u64) {
    TRADES.with(|t| {
        if let Some(trade) = t.borrow().get(&id) {
            certify_trade(&trade);
        }
    });
}

/// Server-authenticated call (ADR-254 §2): the Colabonate backend relays trade terms that both
/// parties already agreed to over Nostr (mirrors the existing kind:16/17 offer/accept flow).
/// `create_trade` itself moves no funds, but as of FU-254-J it no longer takes the server's word
/// for the terms unconditionally: `args.buyer_terms_event`/`seller_terms_event` must be real
/// signed Nostr events from `args.buyer_pubkey`/`seller_pubkey` whose content is the canonical
/// terms payload (`sig::verify_trade_terms`, event-shaped since FU-617/ADR-357 D3) — binding what
/// the canister stores to what both parties actually signed over Nostr, not just what the server
/// relayed.
#[ic_cdk::update]
async fn create_trade(args: CreateTradeArgs) -> Result<u64, TradeError> {
    assert!(
        state_machine::fee_config_is_consistent(),
        "PLATFORM_FEE_BPS/PLATFORM_FEE_ADDRESS drifted out of lock-step — fix before any build ships"
    );
    // Validate before burning a trade ID or making the (cycles-costing) t-ECDSA call.
    state_machine::validate_milestone_bps(&args.milestone_bps)?;
    let trade_terms_hash = sig::verify_trade_terms(
        &args.buyer_pubkey,
        &args.seller_pubkey,
        &args.buyer_refund_address,
        &args.seller_payout_address,
        args.expected_amount_sats,
        &args.milestone_bps,
        args.timeout_at,
        &args.buyer_terms_event,
        &args.seller_terms_event,
    )?;
    let id = NEXT_TRADE_ID.with(|n| {
        let mut n = n.borrow_mut();
        let id = *n.get();
        n.set(id + 1);
        id
    });
    // Real t-ECDSA P2WPKH address, derivation_path = [trade_id.to_be_bytes()] (ADR-254 §3,
    // FU-254-C). If this fails the trade is simply never inserted — `id` is burned, no other
    // state changes.
    let btc_address = btc::derive_trade_address(id).await?;
    let trade = state_machine::new_trade(id, args, btc_address, trade_terms_hash, ic_cdk::api::time())?;
    TRADES.with(|t| t.borrow_mut().insert(id, trade.clone()));
    certify_trade(&trade);
    Ok(id)
}

/// Fills the certification tree and establishes certified data from the (empty) stable store at
/// first install, so `get_trade_certified`'s certificate is valid from genesis — proofs of
/// absence included (FU-619). One chunk covers the empty store synchronously.
#[ic_cdk::init]
fn init() {
    start_certification_rebuild();
}

/// Heap state (the certification tree) and certified data are both lost/cleared on upgrade;
/// stable `TRADES` survives. Re-derive chunk-wise (see `CERT_REBUILD_CHUNK`): the first chunk
/// runs synchronously here, remaining chunks on heartbeats (FU-619).
#[ic_cdk::post_upgrade]
fn post_upgrade() {
    start_certification_rebuild();
}

#[ic_cdk::query]
fn get_trade(trade_id: u64) -> Option<Trade> {
    TRADES.with(|t| t.borrow().get(&trade_id))
}

/// Consensus-certified trade read (FU-619, ADR-362 GAP F-5): same trade data as `get_trade`, plus
/// the subnet's data certificate and a CBOR-encoded Merkle witness for this trade's key. A client
/// verifies the certificate against the IC root key, walks the witness to the leaf, and compares
/// the leaf bytes against `certification_payload(...)` recomputed from the trade fields it was
/// shown — proving the funding-critical fields came from consensus state, not from a single
/// (possibly faulty/malicious) replica or the relaying server. For a non-existent trade the
/// witness is a proof of absence that reconstructs to the certified root with no leaf under the
/// key. `certificate` is `None` only in non-query contexts (or before the first
/// `certified_data_set`, which `init`/`post_upgrade` pre-empt). Right after an upgrade, trades
/// beyond `CERT_REBUILD_CURSOR` briefly verify as absence until the chunked rebuild catches up —
/// an honest degraded window, never a wrong positive.
#[ic_cdk::query]
fn get_trade_certified(trade_id: u64) -> CertifiedTradeView {
    let certificate = ic_cdk::api::data_certificate();
    let witness = CERT_TREE.with(|tree| {
        let tree = tree.borrow();
        let mut buf = Vec::new();
        ciborium::into_writer(&tree.witness(&cert_key(trade_id)), &mut buf)
            .expect("HashTree witness is always CBOR-serializable");
        buf
    });
    CertifiedTradeView {
        trade: TRADES.with(|t| t.borrow().get(&trade_id)),
        certificate,
        witness,
    }
}

/// Funding detection (ADR-254 §4, FU-254-C): queries native `bitcoin_get_utxos` for the trade's
/// address and compares the confirmed sum against `expected_amount_sats`. The confirmation-depth
/// *value* itself (currently 1, see `btc::MIN_CONFIRMATIONS`) remains a FU-253-H security-gate
/// decision, not resolved here.
#[ic_cdk::update]
async fn check_funding(trade_id: u64) -> Result<TradeState, TradeError> {
    // Validates the transition would even be legal (trade exists, still PendingFunding) before
    // spending cycles on the real UTXO query. Discards the `Ok` value — that's only applied below
    // once the on-chain balance actually clears `expected_amount_sats`.
    let (address, expected_amount_sats) = with_trade(trade_id, |trade| {
        state_machine::transition_on_funding_confirmed(&trade.state)?;
        Ok((trade.btc_address.clone(), trade.expected_amount_sats))
    })?;

    let (utxos, balance_sats) = btc::confirmed_utxos(&address).await?;
    if !state_machine::funding_is_sufficient(balance_sats, expected_amount_sats) {
        return Ok(TradeState::PendingFunding);
    }

    // Re-validate after the inter-canister await: another update call could have changed this
    // trade's state (e.g. a dispute is impossible pre-Funded, but re-checking costs nothing and
    // keeps this call's own transition legality proof independent of what happened during the
    // await).
    let new_state = with_trade(trade_id, |trade| {
        state_machine::transition_on_funding_confirmed(&trade.state)
    })?;
    update_trade(trade_id, |trade| {
        trade.state = new_state.clone();
        trade.funded_at = Some(ic_cdk::api::time());
        trade.funded_utxos = utxos;
    });
    Ok(new_state)
}

/// Buyer-authorized milestone release (ADR-254 §2, §6, §7 signature verification — FU-254-E;
/// Nostr-event-based since FU-617/ADR-357 D3). Verifies `buyer_event` against
/// `trade.buyer_pubkey` (`sig::verify_milestone_release`: kind 30417, `[["trade", id],
/// ["action", "release_milestone"], ["i", index]]` tags) before touching state. Both cases now
/// fully execute (FU-254-H closes the previous non-final gap):
///
/// - **Final milestone:** full-drain payout to `seller_payout_address` (`btc::sign_and_broadcast_payout`,
///   FU-254-D) — trade ends, `state -> Released`.
/// - **Non-final milestone** (multi-milestone trades only): two-output payout — the milestone's
///   fixed contractual share to the seller, a change output back to the trade's own escrow address
///   for the milestones still to come (`btc::sign_and_broadcast_partial_milestone_payout`,
///   FU-254-H). `state` stays `Funded`; `funded_utxos` is replaced with the synthesized change UTXO
///   so the next milestone has something to spend.
///
/// Both branches use the same optimistic-lock pattern as `claim_timeout_refund`: the milestone is
/// marked `released` (and, for the final case, `state` flipped) *before* the signing/broadcast
/// await, so a concurrent second call for the same index sees it already claimed and fails at
/// `state_machine::release_milestone`'s ordering check instead of racing to double-spend the same
/// UTXO(s). Rolled back on payout failure so a failed attempt can be retried.
#[ic_cdk::update]
async fn release_milestone(
    trade_id: u64,
    milestone_index: u32,
    buyer_event: NostrAuthEvent,
) -> Result<TradeState, TradeError> {
    let trade = with_trade(trade_id, |trade| Ok(trade.clone()))?;
    sig::verify_milestone_release(trade_id, milestone_index, &trade.buyer_pubkey, &buyer_event)?;

    let (is_final, _new_state) = state_machine::release_milestone(&trade, milestone_index as usize)?;
    let idx = milestone_index as usize;

    if is_final {
        // Optimistic claim WITHOUT certification: `Released` is not consensus
        // truth until the payout broadcast below succeeds — certifying it here
        // would let certified reads attest a payout that is still in flight or
        // never happens (review fix 2026-09-02).
        mutate_trade_uncertified(trade_id, |t| {
            t.milestones[idx].released = true;
            t.state = TradeState::Released;
        });

        let payout = async {
            let total_input: u64 = trade.funded_utxos.iter().map(|u| u.value).sum();
            let fee = btc::estimate_fee_for_payout(&trade, 1).await?;
            let amounts = state_machine::split_payout(total_input, fee, &[10_000])?;
            btc::sign_and_broadcast_payout(&trade, &[(trade.seller_payout_address.clone(), amounts[0])]).await
        }
        .await;

        return match payout {
            Ok(_txid) => {
                recertify_trade(trade_id);
                Ok(TradeState::Released)
            }
            Err(e) => {
                // Tree still holds the pre-claim `Funded` leaf (never certified
                // the optimistic flip), so rolling stable state back without a
                // recertify keeps certified data consistent.
                mutate_trade_uncertified(trade_id, |t| {
                    t.milestones[idx].released = false;
                    t.state = TradeState::Funded;
                });
                Err(e)
            }
        };
    }

    // Non-final milestone (FU-254-H): claim the index optimistically, state stays Funded.
    update_trade(trade_id, |t| {
        t.milestones[idx].released = true;
    });

    let payout = async {
        let total_input: u64 = trade.funded_utxos.iter().map(|u| u.value).sum();
        let fee = btc::estimate_fee_for_payout(&trade, 2).await?;
        let (seller_amount, change_amount) = state_machine::split_milestone_payout(
            trade.expected_amount_sats,
            trade.milestones[idx].pct_bps,
            total_input,
            fee,
        )?;
        btc::sign_and_broadcast_partial_milestone_payout(&trade, seller_amount, change_amount).await
    }
    .await;

    match payout {
        Ok((_txid, change_utxo)) => {
            update_trade(trade_id, |t| {
                t.funded_utxos = vec![change_utxo];
            });
            Ok(TradeState::Funded)
        }
        Err(e) => {
            update_trade(trade_id, |t| {
                t.milestones[idx].released = false;
            });
            Err(e)
        }
    }
}

/// Buyer- or seller-authorized dispute open (FU-254-E; event-based since FU-617). Verifies
/// `opener_event` — the signer must be `trade.buyer_pubkey` or `trade.seller_pubkey`
/// (`sig::verify_dispute_opener` checks the event's own `pubkey` field against both) before
/// applying the state-transition legality check.
#[ic_cdk::update]
fn open_dispute(trade_id: u64, opener_event: NostrAuthEvent) -> Result<TradeState, TradeError> {
    let trade = with_trade(trade_id, |trade| Ok(trade.clone()))?;
    sig::verify_dispute_opener(trade_id, &trade.buyer_pubkey, &trade.seller_pubkey, &opener_event)?;

    let new_state = with_trade(trade_id, |trade| state_machine::open_dispute(&trade.state))?;
    update_trade(trade_id, |trade| {
        trade.state = new_state.clone();
    });
    Ok(new_state)
}

/// DAO-verdict-authorized dispute resolution (FU-254-E). Verifies `dao_signature` against the
/// compile-time `sig::DAO_PUBKEY_HEX` before applying the verdict. That constant is `None` in this
/// build (governance key provisioning belongs with FU-254-G, not invented here), so this honestly
/// reports "no DAO public key configured" rather than silently accepting any signature — the
/// verification *machinery* (verdict-application logic, split-payout signing, FU-254-D) is complete
/// and tested; only the actual key material is missing.
#[ic_cdk::update]
async fn submit_dao_verdict(
    trade_id: u64,
    buyer_bps: u16,
    seller_bps: u16,
    dao_signature: Vec<u8>,
) -> Result<TradeState, TradeError> {
    let trade = with_trade(trade_id, |trade| Ok(trade.clone()))?;
    sig::verify_dao_verdict(trade_id, buyer_bps, seller_bps, &dao_signature)?;

    let new_state = state_machine::apply_dao_verdict(&trade.state, buyer_bps, seller_bps)?;

    // Optimistic claim without certification (review fix 2026-09-02): the
    // terminal `DisputeSettled` split is only consensus truth once the payout
    // broadcast below succeeds; the certified leaf advances via `recertify_trade`.
    mutate_trade_uncertified(trade_id, |t| {
        t.state = new_state.clone();
    });

    let payout = async {
        let total_input: u64 = trade.funded_utxos.iter().map(|u| u.value).sum();
        // Fee is estimated for the worst case (both sides nonzero); a 100/0 verdict ends up with
        // one fewer real output than assumed here, so this slightly overpays fee in that case —
        // simpler than a second fee-estimation round trip, never wrong, never a shortfall.
        let fee = btc::estimate_fee_for_payout(&trade, 2).await?;
        let amounts = state_machine::split_payout(total_input, fee, &[buyer_bps, seller_bps])?;
        let mut outputs = Vec::new();
        if amounts[0] > 0 {
            outputs.push((trade.buyer_refund_address.clone(), amounts[0]));
        }
        if amounts[1] > 0 {
            outputs.push((trade.seller_payout_address.clone(), amounts[1]));
        }
        btc::sign_and_broadcast_payout(&trade, &outputs).await
    }
    .await;

    match payout {
        Ok(_txid) => {
            recertify_trade(trade_id);
            Ok(new_state)
        }
        Err(e) => {
            mutate_trade_uncertified(trade_id, |t| {
                t.state = trade.state.clone();
            });
            Err(e)
        }
    }
}

/// Permissionless timeout-refund claim (ADR-254 §8) — fully wired end-to-end (FU-254-D): no
/// signature to verify, so unlike `release_milestone`/`submit_dao_verdict` there is no FU-254-E
/// blocker here. Sweeps the trade's entire `funded_utxos` to `buyer_refund_address` minus the
/// estimated miner fee.
///
/// The trade is optimistically flipped to `Refunded` *before* the signing/broadcast await so a
/// second concurrent `claim_timeout_refund` call on the same trade sees a non-`Funded` state at its
/// own eligibility check and fails fast, instead of both calls racing to sign competing
/// transactions that spend the same UTXOs. Rolled back to `Funded` if the payout itself fails, so a
/// failed attempt can be retried rather than stranding the trade.
#[ic_cdk::update]
async fn claim_timeout_refund(trade_id: u64) -> Result<TradeState, TradeError> {
    let trade = with_trade(trade_id, |trade| {
        state_machine::can_claim_timeout(trade, ic_cdk::api::time())?;
        Ok(trade.clone())
    })?;

    // Optimistic flip to `Refunded` WITHOUT certification (review fix 2026-09-02):
    // the refund is not consensus truth until the payout broadcast succeeds —
    // the certified leaf advances via `recertify_trade` in the success arm and
    // simply stays `Funded` (its pre-claim value) on rollback.
    mutate_trade_uncertified(trade_id, |t| {
        t.state = TradeState::Refunded;
    });

    let payout = async {
        let total_input: u64 = trade.funded_utxos.iter().map(|u| u.value).sum();
        let fee = btc::estimate_fee_for_payout(&trade, 1).await?;
        let amounts = state_machine::split_payout(total_input, fee, &[10_000])?;
        btc::sign_and_broadcast_payout(&trade, &[(trade.buyer_refund_address.clone(), amounts[0])]).await
    }
    .await;

    match payout {
        Ok(_txid) => {
            recertify_trade(trade_id);
            Ok(TradeState::Refunded)
        }
        Err(e) => {
            mutate_trade_uncertified(trade_id, |t| {
                t.state = TradeState::Funded;
            });
            Err(e)
        }
    }
}

#[ic_cdk::query]
fn whoami() -> Principal {
    ic_cdk::api::msg_caller()
}

ic_cdk::export_candid!();

#[cfg(test)]
mod cert_tests {
    use super::*;
    use ic_certified_map::HashTree;

    fn test_trade(id: u64, state: TradeState) -> Trade {
        Trade {
            id,
            btc_address: format!("bc1qtest{id}"),
            buyer_pubkey: "01".repeat(32),
            seller_pubkey: "02".repeat(32),
            buyer_refund_address: "bc1qrefund".into(),
            seller_payout_address: "bc1qpayout".into(),
            expected_amount_sats: 100_000,
            milestones: vec![Milestone { pct_bps: 10_000, released: false }],
            state,
            timeout_at: 1,
            created_at: 1,
            funded_at: None,
            funded_utxos: vec![],
            trade_terms_hash: [0; 32],
        }
    }

    #[test]
    fn certification_payload_is_canonical_and_state_sensitive() {
        let trade = test_trade(7, TradeState::PendingFunding);
        assert_eq!(
            String::from_utf8(certification_payload(&trade)).unwrap(),
            "colabonate-escrow-cert-v1|7|bc1qtest7|100000|PendingFunding"
        );
        let settled = test_trade(7, TradeState::DisputeSettled { buyer_bps: 4_000, seller_bps: 6_000 });
        assert_eq!(
            String::from_utf8(certification_payload(&settled)).unwrap(),
            "colabonate-escrow-cert-v1|7|bc1qtest7|100000|DisputeSettled:4000:6000"
        );
        // A mutated funding address must change the certified payload — the whole point of FU-619.
        let mut hijacked = test_trade(7, TradeState::PendingFunding);
        hijacked.btc_address = "bc1qattacker".into();
        assert_ne!(certification_payload(&hijacked), certification_payload(&trade));
    }

    #[test]
    fn witness_reconstructs_root_and_looks_up_leaf() {
        let mut tree: RbTree<Vec<u8>, Vec<u8>> = RbTree::new();
        let t1 = test_trade(1, TradeState::PendingFunding);
        let t2 = test_trade(2, TradeState::Funded);
        tree.insert(cert_key(1), certification_payload(&t1));
        tree.insert(cert_key(2), certification_payload(&t2));

        for (id, trade) in [(1u64, &t1), (2u64, &t2)] {
            let witness = tree.witness(&cert_key(id));
            // The witness proves membership: it reconstructs to the certified root hash.
            assert_eq!(witness.reconstruct(), tree.root_hash());
            // And the tree lookup returns exactly the payload the client recomputes.
            assert_eq!(tree.get(&cert_key(id)), Some(&certification_payload(trade)));
        }
    }

    #[test]
    fn absent_key_witness_is_proof_of_absence() {
        let mut tree: RbTree<Vec<u8>, Vec<u8>> = RbTree::new();
        let trade = test_trade(1, TradeState::PendingFunding);
        tree.insert(cert_key(1), certification_payload(&trade));
        // Witness for a key that was never inserted still reconstructs the root — the client
        // verifies the certificate and finds no leaf under its path.
        let witness = tree.witness(&cert_key(99));
        assert_eq!(witness.reconstruct(), tree.root_hash());
        assert_eq!(tree.get(&cert_key(99)), None);
        // And the other trade's payload must not leak into the absence proof.
        let payload = certification_payload(&trade);
        fn contains_subslice(haystack: &[u8], needle: &[u8]) -> bool {
            haystack.windows(needle.len()).any(|w| w == needle)
        }
        let mut buf = Vec::new();
        ciborium::into_writer(&witness, &mut buf).expect("witness serializes");
        assert!(!contains_subslice(&buf, &payload));
    }

    #[test]
    fn witness_serializes_to_spec_cbor_without_self_describe_tag() {
        let mut tree: RbTree<Vec<u8>, Vec<u8>> = RbTree::new();
        let trade = test_trade(1, TradeState::PendingFunding);
        tree.insert(cert_key(1), certification_payload(&trade));
        let witness = tree.witness(&cert_key(1));

        // `get_trade_certified` serializes the witness with ciborium — plain serde CBOR, no
        // self-describe tag (0xd9 d9 f7), matching what the IC interface spec hash-tree encoding
        // and @dfinity/certificate-verification's decoder expect. A single-entry witness
        // serializes as a Fork variant (CBOR array starting 0x82/0x83) whose leaf carries the
        // certification payload verbatim.
        let mut buf = Vec::new();
        ciborium::into_writer(&witness, &mut buf).expect("witness serializes");
        assert_ne!(buf[0], 0xd9, "no self-describe tag may prefix the witness");
        assert!(buf[0] == 0x82 || buf[0] == 0x83, "witness CBOR must be a variant array, got 0x{:02x}", buf[0]);
        let payload = certification_payload(&trade);
        assert!(
            buf.windows(payload.len()).any(|w| w == payload),
            "witness leaf bytes must carry the certification payload"
        );
    }

    /// Cross-implementation fixture for the TS client (`icp-verification.test.ts`): a fixed
    /// two-trade tree, witness + root hash for trade 7, both pinned as hex. The TS test decodes
    /// the witness CBOR, reconstructs the root, walks the 8-byte big-endian key, and compares
    /// the leaf — exercising exactly `verifyCertifiedTrade`'s witness half against canister-side
    /// bytes (the BLS certificate half needs a real replica and stays SDK-verified).
    #[test]
    fn cert_witness_fixture_vector() {
        let t7 = test_trade(7, TradeState::Funded);
        let t8 = test_trade(8, TradeState::PendingFunding);
        let mut tree: RbTree<Vec<u8>, Vec<u8>> = RbTree::new();
        tree.insert(cert_key(7), certification_payload(&t7));
        tree.insert(cert_key(8), certification_payload(&t8));

        let witness = tree.witness(&cert_key(7));
        let mut buf = Vec::new();
        ciborium::into_writer(&witness, &mut buf).expect("witness serializes");
        let witness_hex: String = buf.iter().map(|b| format!("{b:02x}")).collect();
        let root_hex: String = tree.root_hash().iter().map(|b| format!("{b:02x}")).collect();
        println!("WITNESS_HEX={witness_hex}");
        println!("ROOT_HEX={root_hex}");
        println!(
            "PAYLOAD_7={}",
            String::from_utf8(certification_payload(&t7)).unwrap()
        );
        // Membership is self-consistent…
        assert_eq!(witness.reconstruct(), tree.root_hash());
        // …and the pinned bytes are stable: any change to tree layout, CBOR encoding, payload
        // format, or key encoding breaks the TS client fixture in the same commit.
        assert_eq!(
            witness_hex,
            "8301830248000000000000000782035833636f6c61626f6e6174652d657363726f772d636572742d76317c377c6263317174657374377c3130303030307c46756e646564820458209d71fe1c4e5e09b15b0dc7e6307e3af34e8556a536f4601f265080d264f4570e"
        );
        assert_eq!(root_hex, "0387e18e73f15e012108f3bf9368ee94e4aa1c1920b521b6c9512f01893f8d8c");
    }
}
