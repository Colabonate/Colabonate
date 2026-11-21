//! Candid-facing data types. See docs/decisions/254-icp-escrow-canister-detail-design.md §1, §10.

use candid::CandidType;
use ic_cdk_bitcoin_canister::Utxo;
use ic_stable_structures::storable::{Bound, Storable};
use serde::Deserialize;
use std::borrow::Cow;

/// Trade lifecycle. Extends ADR-253's `Funded -> Released|Refunded|Disputed` with an explicit
/// `PendingFunding` pre-state (ADR-254 §1) and a `DisputeSettled` terminal state for DAO verdicts
/// that split funds between buyer and seller rather than awarding 100% to one side — a case
/// ADR-253/254's two-terminal-state sketch didn't cover, found while implementing §7.
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum TradeState {
    PendingFunding,
    Funded,
    Released,
    Refunded,
    Disputed,
    DisputeSettled { buyer_bps: u16, seller_bps: u16 },
}

#[derive(CandidType, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct Milestone {
    pub pct_bps: u16,
    pub released: bool,
}

#[derive(CandidType, Deserialize, Debug, Clone)]
pub struct Trade {
    pub id: u64,
    /// Bitcoin P2WPKH address derived via t-ECDSA for this trade (ADR-254 §3, FU-254-C).
    pub btc_address: String,
    pub buyer_pubkey: String,
    pub seller_pubkey: String,
    pub buyer_refund_address: String,
    pub seller_payout_address: String,
    pub expected_amount_sats: u64,
    pub milestones: Vec<Milestone>,
    pub state: TradeState,
    /// Nanoseconds since epoch after which `claim_timeout_refund` becomes callable.
    pub timeout_at: u64,
    pub created_at: u64,
    pub funded_at: Option<u64>,
    /// UTXO set observed at `check_funding` time (ADR-254 §4: "UTXO-Set + funded_at werden
    /// persistiert"). Empty until funded. FU-254-D's payout transaction spends exactly these.
    pub funded_utxos: Vec<Utxo>,
    /// SHA-256 hash of the canonical trade-terms payload (amount, addresses, milestone schedule),
    /// double-signed by buyer and seller at `create_trade` time (`sig::verify_trade_terms`,
    /// FU-254-J). Binds the canister's stored metadata to the terms both parties actually
    /// negotiated over Nostr — the server relays the signed payload but cannot fabricate terms
    /// neither party signed. Anyone who knows the negotiated terms can recompute
    /// `sig::trade_terms_message(...)` + SHA-256 and confirm it matches this field, independent of
    /// trusting the server's relay.
    pub trade_terms_hash: [u8; 32],
}

/// Trades are stored in `ic-stable-structures::StableBTreeMap` (FU-254-I) so they survive canister
/// upgrades — the previous `thread_local! BTreeMap` lost all state on every `dfx deploy --upgrade`.
/// Encoding reuses the existing Candid derive (`CandidType`/`Deserialize`) rather than inventing a
/// second wire format; `Trade` has no fixed max size (`Vec<Milestone>`/`Vec<Utxo>` grow with
/// milestone count / UTXO fragmentation), so `Bound::Unbounded` is the correct — not just
/// convenient — choice here.
impl Storable for Trade {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(candid::encode_one(self).expect("Trade must always be Candid-encodable"))
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).expect("stable memory must only ever contain Trade-encoded bytes")
    }

    fn into_bytes(self) -> Vec<u8> {
        candid::encode_one(&self).expect("Trade must always be Candid-encodable")
    }

    const BOUND: Bound = Bound::Unbounded;
}

/// NIP-01 Nostr event carrying an escrow authorization (FU-617, ADR-357 D3). The canister
/// recomputes the event id from the canonical serialization `[0, pubkey, created_at, kind, tags,
/// content]` and verifies the BIP-340 signature over it, so the event is exactly the artifact a
/// NIP-07 extension or NIP-46 bunker produces via `signEvent` — no signer can be asked for a
/// digest-only signature. Field names/types mirror the wire event; `sig` is the raw 64-byte
/// signature over `id`.
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq)]
pub struct NostrAuthEvent {
    /// 64-char lowercase hex SHA-256 of the canonical NIP-01 serialization.
    pub id: String,
    /// 64-char lowercase hex x-only (BIP-340) signer pubkey.
    pub pubkey: String,
    /// Seconds since Unix epoch (NIP-01). Signed-over via the id; supplies the per-signature
    /// uniqueness/replay context.
    pub created_at: u64,
    /// Application kind — domain separation lives here and in `tags` (ADR-357 D3), not in an
    /// ASCII message prefix.
    pub kind: u32,
    pub tags: Vec<Vec<String>>,
    /// For trade-terms events this is the canonical terms message (`sig::trade_terms_message`);
    /// action events carry an empty content.
    pub content: String,
    /// Raw 64-byte BIP-340 Schnorr signature over `id` (the event id is already a SHA-256
    /// digest, so it maps 1:1 onto a secp256k1 `Message`).
    pub sig: Vec<u8>,
}

#[derive(CandidType, Deserialize, Debug, Clone, PartialEq)]
pub struct CreateTradeArgs {
    pub buyer_pubkey: String,
    pub seller_pubkey: String,
    pub buyer_refund_address: String,
    pub seller_payout_address: String,
    pub expected_amount_sats: u64,
    /// Milestone split in basis points, must sum to 10_000. `[10_000]` = single 100% release.
    pub milestone_bps: Vec<u16>,
    pub timeout_at: u64,
    /// Nostr event from `buyer_pubkey` whose content is `sig::trade_terms_message(...)` for
    /// these exact args (FU-254-J terms binding, event-shaped since FU-617). Verified before any
    /// trade ID is burned or t-ECDSA call made — see `sig::verify_trade_terms`.
    pub buyer_terms_event: NostrAuthEvent,
    /// Same as `buyer_terms_event`, from `seller_pubkey`.
    pub seller_terms_event: NostrAuthEvent,
}

/// Certified read response for `get_trade_certified` (FU-619): the trade plus the subnet-signed
/// certificate and the CBOR Merkle witness proving this exact trade's funding-critical fields
/// (`certification_payload` in `lib.rs`) are part of the canister's consensus-certified state.
/// No `PartialEq` — `Trade` isn't `PartialEq` (its Candid `Utxo` isn't), and nothing needs it.
#[derive(CandidType, Deserialize, Debug, Clone)]
pub struct CertifiedTradeView {
    pub trade: Option<Trade>,
    /// Raw subnet certificate over the canister's certified state tree (queries only; `None`
    /// outside query context or before the first `certified_data_set`).
    pub certificate: Option<Vec<u8>>,
    /// CBOR-encoded `HashTree` witness for this trade's 8-byte big-endian id key.
    pub witness: Vec<u8>,
}

#[derive(CandidType, Deserialize, Debug, Clone, PartialEq)]
pub enum TradeError {
    NotFound,
    InvalidTransition { from: TradeState, action: String },
    EmptyMilestones,
    MilestoneBpsMismatch { sum: u32 },
    MilestoneIndexOutOfRange,
    MilestoneAlreadyReleased,
    MilestoneOutOfOrder,
    PayoutInvariantViolation,
    TimeoutNotReached,
    VerdictBpsMismatch { sum: u32 },
    /// t-ECDSA/Bitcoin management-canister call failed or returned malformed data (FU-254-C/D).
    BitcoinApiError { reason: String },
    /// Estimated miner fee exceeds the trade's total funded UTXO value — the payout can't cover its
    /// own broadcast cost (FU-254-D).
    FeeExceedsInput { fee_sats: u64, total_input_sats: u64 },
    /// BIP-340 Schnorr signature failed to verify against the expected pubkey, or was malformed
    /// (FU-254-E).
    SignatureVerificationFailed { reason: String },
    /// Feature is designed (ADR-254) but not yet implemented — names the follow-up that closes it.
    NotImplemented { pending_followup: String },
}
