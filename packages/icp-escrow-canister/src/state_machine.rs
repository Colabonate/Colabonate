//! Pure trade-state-machine logic — no IC runtime, no crypto, no Bitcoin I/O.
//! Testable with plain `cargo test` per docs/decisions/254-icp-escrow-canister-detail-design.md §12
//! ("Unit-Tests: reine State-Machine-Logik ... ohne IC-Runtime").
//!
//! What this module deliberately does NOT do (see ADR-254 for the owning follow-up):
//! - derive real Bitcoin addresses or query UTXOs (FU-254-C)
//! - sign or broadcast Bitcoin transactions (FU-254-D)
//! - verify Nostr/DAO signatures (FU-254-E)
//! Those steps call into this module's pure decisions once built, not the other way around.

use crate::types::{CreateTradeArgs, Milestone, Trade, TradeError, TradeState};

/// Platform fee rate, in basis points. Compile-time constant per ADR-254 §5 — never a runtime
/// parameter or admin call. Pilot value is 0 (no platform fee) until FU-253-H's economics gate
/// measures a rate; changing this requires a new, publicly reproducible-build-verifiable canister
/// version, not a call.
pub const PLATFORM_FEE_BPS: u16 = 0;

/// Fee recipient address, compile-time constant alongside `PLATFORM_FEE_BPS`. Kept in lock-step
/// with the fee rate: an enforced invariant (`fee_config_is_consistent`, tested below) requires an
/// address here whenever the rate is non-zero.
pub const PLATFORM_FEE_ADDRESS: Option<&str> = None;

/// Enforces that a non-zero fee rate is never shipped without a fee address to receive it, and
/// vice versa. Checked in tests; also cheap enough to call from `create_trade` at canister init.
pub fn fee_config_is_consistent() -> bool {
    (PLATFORM_FEE_BPS == 0) == PLATFORM_FEE_ADDRESS.is_none()
}

/// Validates a milestone basis-point schedule: non-empty, sums to exactly 10_000.
pub fn validate_milestone_bps(milestone_bps: &[u16]) -> Result<(), TradeError> {
    if milestone_bps.is_empty() {
        return Err(TradeError::EmptyMilestones);
    }
    let sum: u32 = milestone_bps.iter().map(|&b| b as u32).sum();
    if sum != 10_000 {
        return Err(TradeError::MilestoneBpsMismatch { sum });
    }
    Ok(())
}

/// Builds a new `Trade` in `PendingFunding` state from validated creation args.
/// `btc_address` is a caller-supplied placeholder until FU-254-C derives a real one (ADR-254 §3).
/// `trade_terms_hash` is the caller's already-verified `sig::verify_trade_terms` output (FU-254-J)
/// — this function does not re-verify signatures, it only records the resulting hash.
pub fn new_trade(
    id: u64,
    args: CreateTradeArgs,
    btc_address: String,
    trade_terms_hash: [u8; 32],
    created_at: u64,
) -> Result<Trade, TradeError> {
    validate_milestone_bps(&args.milestone_bps)?;
    let milestones = args
        .milestone_bps
        .into_iter()
        .map(|pct_bps| Milestone {
            pct_bps,
            released: false,
        })
        .collect();
    Ok(Trade {
        id,
        btc_address,
        buyer_pubkey: args.buyer_pubkey,
        seller_pubkey: args.seller_pubkey,
        buyer_refund_address: args.buyer_refund_address,
        seller_payout_address: args.seller_payout_address,
        expected_amount_sats: args.expected_amount_sats,
        milestones,
        state: TradeState::PendingFunding,
        timeout_at: args.timeout_at,
        created_at,
        funded_at: None,
        funded_utxos: Vec::new(),
        trade_terms_hash,
    })
}

/// `PendingFunding -> Funded` once observed on-chain funding is confirmed. The *observation*
/// itself (native UTXO query, confirmation-depth check) is FU-254-C; this function only encodes
/// the resulting state transition.
pub fn transition_on_funding_confirmed(state: &TradeState) -> Result<TradeState, TradeError> {
    match state {
        TradeState::PendingFunding => Ok(TradeState::Funded),
        other => Err(TradeError::InvalidTransition {
            from: other.clone(),
            action: "check_funding".into(),
        }),
    }
}

/// Whether an observed UTXO sum meets a trade's expected funding amount (ADR-254 §4: "Summe der
/// gefundenen UTXOs ≥ erwarteter Betrag"). Pure comparison — the actual UTXO query is FU-254-C's
/// `btc::confirmed_utxos`.
pub fn funding_is_sufficient(balance_sats: u64, expected_amount_sats: u64) -> bool {
    balance_sats >= expected_amount_sats
}

/// Index of the next unreleased milestone, if any.
pub fn next_milestone_index(trade: &Trade) -> Option<usize> {
    trade.milestones.iter().position(|m| !m.released)
}

/// Validates + computes the outcome of releasing milestone `index`. Milestones release strictly
/// in order (matches the 25/50/25 sequencing ADR-253 describes — a later milestone implies the
/// earlier ones were already delivered/confirmed). Returns `(is_final_milestone, new_state)`;
/// does not mutate `trade` — the caller applies `milestones[index].released = true` and the
/// returned state.
pub fn release_milestone(trade: &Trade, index: usize) -> Result<(bool, TradeState), TradeError> {
    if trade.state != TradeState::Funded {
        return Err(TradeError::InvalidTransition {
            from: trade.state.clone(),
            action: "release_milestone".into(),
        });
    }
    let expected_next = next_milestone_index(trade).ok_or(TradeError::MilestoneAlreadyReleased)?;
    if index >= trade.milestones.len() {
        return Err(TradeError::MilestoneIndexOutOfRange);
    }
    if index != expected_next {
        return Err(TradeError::MilestoneOutOfOrder);
    }
    let is_final = trade
        .milestones
        .iter()
        .enumerate()
        .all(|(i, m)| i == index || m.released);
    Ok((
        is_final,
        if is_final {
            TradeState::Released
        } else {
            TradeState::Funded
        },
    ))
}

/// `Funded -> Disputed`. Authorization (buyer/seller Nostr signature) is FU-254-E's job; this
/// function only encodes which *states* a dispute may be opened from.
pub fn open_dispute(state: &TradeState) -> Result<TradeState, TradeError> {
    match state {
        TradeState::Funded => Ok(TradeState::Disputed),
        other => Err(TradeError::InvalidTransition {
            from: other.clone(),
            action: "open_dispute".into(),
        }),
    }
}

/// Applies a DAO verdict from `Disputed`. `buyer_bps + seller_bps` must equal 10_000.
/// A 100%-to-one-side verdict resolves to the existing `Refunded`/`Released` terminal states;
/// a split resolves to `DisputeSettled` (see `TradeState` doc comment for why that variant exists).
/// DAO-signature verification itself is FU-254-E.
pub fn apply_dao_verdict(
    state: &TradeState,
    buyer_bps: u16,
    seller_bps: u16,
) -> Result<TradeState, TradeError> {
    if *state != TradeState::Disputed {
        return Err(TradeError::InvalidTransition {
            from: state.clone(),
            action: "submit_dao_verdict".into(),
        });
    }
    let sum = buyer_bps as u32 + seller_bps as u32;
    if sum != 10_000 {
        return Err(TradeError::VerdictBpsMismatch { sum });
    }
    Ok(match (buyer_bps, seller_bps) {
        (10_000, 0) => TradeState::Refunded,
        (0, 10_000) => TradeState::Released,
        _ => TradeState::DisputeSettled {
            buyer_bps,
            seller_bps,
        },
    })
}

/// Permissionless timeout-refund eligibility check. Deliberately does NOT special-case an open
/// `Disputed` trade past its timeout — per ADR-254 §7 that interaction (a bad-faith dispute
/// opened right before timeout, blocking refund indefinitely) is an open risk explicitly deferred
/// to FU-253-H's security gate, not resolved here.
pub fn can_claim_timeout(trade: &Trade, now_ns: u64) -> Result<(), TradeError> {
    if trade.state != TradeState::Funded {
        return Err(TradeError::InvalidTransition {
            from: trade.state.clone(),
            action: "claim_timeout_refund".into(),
        });
    }
    if now_ns < trade.timeout_at {
        return Err(TradeError::TimeoutNotReached);
    }
    Ok(())
}

/// Estimated virtual size (vbytes) of a native-SegWit (P2WPKH-in/P2WPKH-out) payout transaction.
/// Standard flat per-input/per-output estimates (~68 vB/input, ~31 vB/output, ~11 vB overhead) —
/// used only to size the miner fee before signing, so it must not depend on the actual (as yet
/// unknown) signature bytes. FU-254-D.
pub fn estimate_payout_vsize(num_inputs: usize, num_outputs: usize) -> u64 {
    11 + (num_inputs as u64 * 68) + (num_outputs as u64 * 31)
}

/// Miner fee in sats for a payout with `num_inputs`/`num_outputs` at `sat_per_vbyte`. FU-254-D.
pub fn estimate_payout_fee(num_inputs: usize, num_outputs: usize, sat_per_vbyte: u64) -> u64 {
    estimate_payout_vsize(num_inputs, num_outputs) * sat_per_vbyte
}

/// Splits `total_input_sats - fee_sats` across recipients weighted by `shares_bps` (ADR-254 §5/§6
/// full-drain payouts: timeout refund `[10_000]`, a single/final milestone release `[10_000]`, a
/// DAO verdict `[buyer_bps, seller_bps]`). The last recipient absorbs the integer-division rounding
/// remainder so the outputs always sum to exactly `total_input_sats - fee_sats`, never more.
///
/// `shares_bps` summing to 10_000 is a precondition enforced by every call site before this point
/// (`validate_milestone_bps` at trade creation, `apply_dao_verdict`'s own sum check) — asserted
/// here as a real (non-debug) invariant check, matching `fee_config_is_consistent`'s precedent,
/// because this function sits directly on the money-movement path.
pub fn split_payout(total_input_sats: u64, fee_sats: u64, shares_bps: &[u16]) -> Result<Vec<u64>, TradeError> {
    assert_eq!(
        shares_bps.iter().map(|&b| b as u32).sum::<u32>(),
        10_000,
        "split_payout: shares_bps must sum to 10_000 — caller bug, not user input"
    );
    let net = total_input_sats
        .checked_sub(fee_sats)
        .ok_or(TradeError::FeeExceedsInput { fee_sats, total_input_sats })?;
    let mut amounts = Vec::with_capacity(shares_bps.len());
    let mut allocated: u64 = 0;
    for &bps in &shares_bps[..shares_bps.len() - 1] {
        let amount = (net as u128 * bps as u128 / 10_000) as u64;
        allocated += amount;
        amounts.push(amount);
    }
    amounts.push(net - allocated);
    Ok(amounts)
}

/// Payout invariant (ADR-254 §5): every output of a signed payout transaction must go to the
/// trade's buyer-refund address, its seller-payout address, or the compile-time platform fee
/// address — never anywhere else. Pure check; called from `btc::sign_and_broadcast_payout`
/// (FU-254-D) immediately before signing, as defense in depth. Used for every *terminal* payout
/// (timeout refund, final milestone release, DAO verdict) — never loosened for those.
pub fn validate_payout_outputs(trade: &Trade, output_addresses: &[String]) -> Result<(), TradeError> {
    for addr in output_addresses {
        let is_buyer = addr == &trade.buyer_refund_address;
        let is_seller = addr == &trade.seller_payout_address;
        let is_fee = PLATFORM_FEE_ADDRESS.is_some_and(|fee_addr| addr == fee_addr);
        if !(is_buyer || is_seller || is_fee) {
            return Err(TradeError::PayoutInvariantViolation);
        }
    }
    Ok(())
}

/// Payout-output invariant for a NON-final milestone release only (FU-254-H, closes the gap found
/// while building FU-254-D). Bitcoin UTXOs can't be partially spent: releasing milestone `i` of
/// N>1 must spend the entire current UTXO and route the still-unreleased remainder somewhere
/// on-chain. The only sound "somewhere" is the trade's own escrow address — so this permits it as
/// a fourth legal output, strictly in addition to buyer/seller/fee, and strictly only for this one
/// non-terminal case. `validate_payout_outputs` (used for every terminal payout) is intentionally
/// left unchanged — a change-to-escrow output would defeat the point of a payout that's supposed
/// to end the trade.
pub fn validate_partial_release_outputs(trade: &Trade, output_addresses: &[String]) -> Result<(), TradeError> {
    for addr in output_addresses {
        let is_buyer = addr == &trade.buyer_refund_address;
        let is_seller = addr == &trade.seller_payout_address;
        let is_escrow_change = addr == &trade.btc_address;
        let is_fee = PLATFORM_FEE_ADDRESS.is_some_and(|fee_addr| addr == fee_addr);
        if !(is_buyer || is_seller || is_escrow_change || is_fee) {
            return Err(TradeError::PayoutInvariantViolation);
        }
    }
    Ok(())
}

/// Computes a non-final milestone's payout split (FU-254-H). The seller receives exactly their
/// fixed contractual share of the trade's *original* funded total (`total_original_sats` — pass
/// `trade.expected_amount_sats`, fixed at creation, never the shrinking current UTXO balance) —
/// so an earlier milestone's on-chain fee never eats into a *later* milestone's contractual amount.
/// The fee for *this* release, and any not-yet-allocated remainder, both stay in the change output
/// (`current_input_sats - seller_amount - fee_sats`) — i.e. later milestones (and the final
/// full-drain release, which sweeps whatever change remains via `split_payout`) absorb this
/// transaction's own fee, not the seller receiving it now.
pub fn split_milestone_payout(
    total_original_sats: u64,
    milestone_pct_bps: u16,
    current_input_sats: u64,
    fee_sats: u64,
) -> Result<(u64, u64), TradeError> {
    let seller_amount = (total_original_sats as u128 * milestone_pct_bps as u128 / 10_000) as u64;
    let change_amount = current_input_sats
        .checked_sub(seller_amount)
        .and_then(|v| v.checked_sub(fee_sats))
        .ok_or(TradeError::FeeExceedsInput {
            fee_sats,
            total_input_sats: current_input_sats,
        })?;
    Ok((seller_amount, change_amount))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_args() -> CreateTradeArgs {
        CreateTradeArgs {
            buyer_pubkey: "buyer-nostr-hex".into(),
            seller_pubkey: "seller-nostr-hex".into(),
            buyer_refund_address: "bcrt1qbuyer".into(),
            seller_payout_address: "bcrt1qseller".into(),
            expected_amount_sats: 150_000,
            milestone_bps: vec![10_000],
            timeout_at: 1_000_000_000,
            // Pure state-machine tests exercise `new_trade` directly, bypassing
            // `sig::verify_trade_terms` — placeholder events are fine here since this module
            // never checks them (that's FU-254-J/FU-617 `sig.rs` test coverage, not this
            // module's).
            buyer_terms_event: crate::types::NostrAuthEvent {
                id: String::new(),
                pubkey: "buyer-nostr-hex".into(),
                created_at: 0,
                kind: 0,
                tags: vec![],
                content: String::new(),
                sig: Vec::new(),
            },
            seller_terms_event: crate::types::NostrAuthEvent {
                id: String::new(),
                pubkey: "seller-nostr-hex".into(),
                created_at: 0,
                kind: 0,
                tags: vec![],
                content: String::new(),
                sig: Vec::new(),
            },
        }
    }

    #[test]
    fn fee_config_stays_consistent() {
        assert!(fee_config_is_consistent(), "PLATFORM_FEE_BPS and PLATFORM_FEE_ADDRESS must be set/unset together");
        assert_eq!(PLATFORM_FEE_BPS, 0, "pilot ships with zero platform fee (FU-253-H measures economics first)");
    }

    #[test]
    fn validate_milestone_bps_accepts_single_100_percent() {
        assert!(validate_milestone_bps(&[10_000]).is_ok());
    }

    #[test]
    fn validate_milestone_bps_accepts_25_50_25() {
        assert!(validate_milestone_bps(&[2_500, 5_000, 2_500]).is_ok());
    }

    #[test]
    fn validate_milestone_bps_rejects_empty() {
        assert_eq!(validate_milestone_bps(&[]), Err(TradeError::EmptyMilestones));
    }

    #[test]
    fn validate_milestone_bps_rejects_wrong_sum() {
        assert_eq!(
            validate_milestone_bps(&[3_000, 3_000]),
            Err(TradeError::MilestoneBpsMismatch { sum: 6_000 })
        );
    }

    #[test]
    fn new_trade_starts_pending_funding() {
        let trade = new_trade(1, sample_args(), "PENDING-ECDSA-1".into(), [0u8; 32], 42).unwrap();
        assert_eq!(trade.state, TradeState::PendingFunding);
        assert_eq!(trade.milestones.len(), 1);
        assert!(!trade.milestones[0].released);
        assert!(trade.funded_at.is_none());
    }

    #[test]
    fn new_trade_rejects_bad_milestones() {
        let mut args = sample_args();
        args.milestone_bps = vec![5_000];
        assert_eq!(
            new_trade(1, args, "addr".into(), [0u8; 32], 0).unwrap_err(),
            TradeError::MilestoneBpsMismatch { sum: 5_000 }
        );
    }

    #[test]
    fn funding_is_sufficient_compares_against_expected_amount() {
        assert!(funding_is_sufficient(150_000, 150_000));
        assert!(funding_is_sufficient(150_001, 150_000));
        assert!(!funding_is_sufficient(149_999, 150_000));
    }

    #[test]
    fn funding_confirms_from_pending_only() {
        assert_eq!(
            transition_on_funding_confirmed(&TradeState::PendingFunding),
            Ok(TradeState::Funded)
        );
        assert!(transition_on_funding_confirmed(&TradeState::Funded).is_err());
        assert!(transition_on_funding_confirmed(&TradeState::Released).is_err());
    }

    #[test]
    fn single_milestone_release_is_final() {
        let trade = new_trade(1, sample_args(), "addr".into(), [0u8; 32], 0)
            .map(|mut t| {
                t.state = TradeState::Funded;
                t
            })
            .unwrap();
        let (is_final, new_state) = release_milestone(&trade, 0).unwrap();
        assert!(is_final);
        assert_eq!(new_state, TradeState::Released);
    }

    #[test]
    fn three_milestones_release_in_order() {
        let mut args = sample_args();
        args.milestone_bps = vec![2_500, 5_000, 2_500];
        let mut trade = new_trade(1, args, "addr".into(), [0u8; 32], 0).unwrap();
        trade.state = TradeState::Funded;

        let (is_final, state) = release_milestone(&trade, 0).unwrap();
        assert!(!is_final);
        assert_eq!(state, TradeState::Funded);
        trade.milestones[0].released = true;

        // out-of-order attempt is rejected
        assert_eq!(release_milestone(&trade, 2), Err(TradeError::MilestoneOutOfOrder));

        let (is_final, state) = release_milestone(&trade, 1).unwrap();
        assert!(!is_final);
        assert_eq!(state, TradeState::Funded);
        trade.milestones[1].released = true;

        let (is_final, state) = release_milestone(&trade, 2).unwrap();
        assert!(is_final);
        assert_eq!(state, TradeState::Released);
    }

    #[test]
    fn release_milestone_requires_funded_state() {
        let trade = new_trade(1, sample_args(), "addr".into(), [0u8; 32], 0).unwrap();
        assert_eq!(
            release_milestone(&trade, 0),
            Err(TradeError::InvalidTransition {
                from: TradeState::PendingFunding,
                action: "release_milestone".into()
            })
        );
    }

    #[test]
    fn dispute_opens_only_from_funded() {
        assert_eq!(open_dispute(&TradeState::Funded), Ok(TradeState::Disputed));
        assert!(open_dispute(&TradeState::PendingFunding).is_err());
        assert!(open_dispute(&TradeState::Disputed).is_err());
    }

    #[test]
    fn dao_verdict_full_buyer_refunds() {
        assert_eq!(
            apply_dao_verdict(&TradeState::Disputed, 10_000, 0),
            Ok(TradeState::Refunded)
        );
    }

    #[test]
    fn dao_verdict_full_seller_releases() {
        assert_eq!(
            apply_dao_verdict(&TradeState::Disputed, 0, 10_000),
            Ok(TradeState::Released)
        );
    }

    #[test]
    fn dao_verdict_split_settles_partially() {
        assert_eq!(
            apply_dao_verdict(&TradeState::Disputed, 3_000, 7_000),
            Ok(TradeState::DisputeSettled {
                buyer_bps: 3_000,
                seller_bps: 7_000
            })
        );
    }

    #[test]
    fn dao_verdict_rejects_bad_sum() {
        assert_eq!(
            apply_dao_verdict(&TradeState::Disputed, 3_000, 3_000),
            Err(TradeError::VerdictBpsMismatch { sum: 6_000 })
        );
    }

    #[test]
    fn dao_verdict_requires_disputed_state() {
        assert!(apply_dao_verdict(&TradeState::Funded, 10_000, 0).is_err());
    }

    #[test]
    fn timeout_requires_funded_and_elapsed() {
        let mut trade = new_trade(1, sample_args(), "addr".into(), [0u8; 32], 0).unwrap();
        trade.state = TradeState::Funded;
        trade.timeout_at = 1_000;

        assert_eq!(can_claim_timeout(&trade, 500), Err(TradeError::TimeoutNotReached));
        assert!(can_claim_timeout(&trade, 1_000).is_ok());
        assert!(can_claim_timeout(&trade, 2_000).is_ok());

        trade.state = TradeState::Disputed;
        assert!(
            can_claim_timeout(&trade, 2_000).is_err(),
            "disputed trades cannot be timeout-refunded (open risk, see ADR-254 §7)"
        );
    }

    #[test]
    fn estimate_payout_fee_scales_with_inputs_and_outputs() {
        assert_eq!(estimate_payout_vsize(1, 1), 11 + 68 + 31);
        assert_eq!(estimate_payout_vsize(2, 1), 11 + 136 + 31);
        assert_eq!(estimate_payout_fee(1, 1, 5), (11 + 68 + 31) * 5);
    }

    #[test]
    fn split_payout_full_amount_single_recipient() {
        assert_eq!(split_payout(150_000, 1_000, &[10_000]), Ok(vec![149_000]));
    }

    #[test]
    fn split_payout_two_way_with_rounding_remainder_on_last() {
        // net = 99, 33% -> 32 (floor), remainder 67 goes to the last recipient.
        assert_eq!(split_payout(100, 1, &[3_333, 6_667]), Ok(vec![32, 67]));
    }

    #[test]
    fn split_payout_three_way_25_50_25() {
        assert_eq!(
            split_payout(200_000, 0, &[2_500, 5_000, 2_500]),
            Ok(vec![50_000, 100_000, 50_000])
        );
    }

    #[test]
    fn split_payout_rejects_fee_exceeding_input() {
        assert_eq!(
            split_payout(500, 1_000, &[10_000]),
            Err(TradeError::FeeExceedsInput {
                fee_sats: 1_000,
                total_input_sats: 500
            })
        );
    }

    #[test]
    #[should_panic(expected = "must sum to 10_000")]
    fn split_payout_panics_on_caller_bug_bad_bps_sum() {
        let _ = split_payout(1_000, 0, &[5_000]);
    }

    #[test]
    fn payout_outputs_must_be_buyer_or_seller() {
        let trade = new_trade(1, sample_args(), "addr".into(), [0u8; 32], 0).unwrap();
        assert!(validate_payout_outputs(&trade, &["bcrt1qbuyer".into()]).is_ok());
        assert!(validate_payout_outputs(&trade, &["bcrt1qseller".into()]).is_ok());
        assert!(validate_payout_outputs(
            &trade,
            &["bcrt1qbuyer".into(), "bcrt1qseller".into()]
        )
        .is_ok());
        assert_eq!(
            validate_payout_outputs(&trade, &["bcrt1qattacker".into()]),
            Err(TradeError::PayoutInvariantViolation)
        );
    }

    #[test]
    fn payout_outputs_reject_fee_address_when_none_configured() {
        // PLATFORM_FEE_ADDRESS is None in the pilot build — no address should validate as "fee".
        let trade = new_trade(1, sample_args(), "addr".into(), [0u8; 32], 0).unwrap();
        assert_eq!(
            validate_payout_outputs(&trade, &["any-third-address".into()]),
            Err(TradeError::PayoutInvariantViolation)
        );
    }

    #[test]
    fn strict_payout_outputs_reject_the_trades_own_escrow_address() {
        // The trade's own address must NEVER be a legal output for a terminal payout — only
        // `validate_partial_release_outputs` may permit it, and only for non-final milestones.
        let trade = new_trade(1, sample_args(), "addr".into(), [0u8; 32], 0).unwrap();
        assert_eq!(
            validate_payout_outputs(&trade, &["addr".into()]),
            Err(TradeError::PayoutInvariantViolation)
        );
    }

    #[test]
    fn partial_release_outputs_accept_buyer_seller_and_own_escrow_address() {
        let trade = new_trade(1, sample_args(), "addr".into(), [0u8; 32], 0).unwrap();
        assert!(validate_partial_release_outputs(&trade, &["bcrt1qseller".into(), "addr".into()]).is_ok());
        assert!(validate_partial_release_outputs(&trade, &["bcrt1qbuyer".into()]).is_ok());
    }

    #[test]
    fn partial_release_outputs_still_reject_third_addresses() {
        let trade = new_trade(1, sample_args(), "addr".into(), [0u8; 32], 0).unwrap();
        assert_eq!(
            validate_partial_release_outputs(&trade, &["bcrt1qattacker".into()]),
            Err(TradeError::PayoutInvariantViolation)
        );
    }

    #[test]
    fn split_milestone_payout_gives_seller_fixed_original_share() {
        // 25% of a 150_000-sat original total = 37_500, regardless of what the current UTXO
        // balance is (it may already be smaller due to a prior milestone's own fee deduction).
        let (seller_amount, change) = split_milestone_payout(150_000, 2_500, 148_000, 300).unwrap();
        assert_eq!(seller_amount, 37_500);
        assert_eq!(change, 148_000 - 37_500 - 300);
    }

    #[test]
    fn split_milestone_payout_rejects_fee_and_share_exceeding_current_balance() {
        assert_eq!(
            split_milestone_payout(150_000, 2_500, 30_000, 300),
            Err(TradeError::FeeExceedsInput {
                fee_sats: 300,
                total_input_sats: 30_000
            })
        );
    }

    #[test]
    fn three_milestone_payouts_sum_to_original_total_minus_fees() {
        // 25/50/25 of 150_000 = 37_500 / 75_000 / 37_500. Simulates the full chain: two partial
        // releases (each leaving a change output back to escrow, each paying its own fee out of
        // that change), then the final milestone does a full-drain `split_payout([10_000])` of
        // whatever change remains — proving the two payout paths compose correctly.
        let total = 150_000u64;
        let fee = 300u64;

        let (m0_seller, change_after_0) = split_milestone_payout(total, 2_500, total, fee).unwrap();
        assert_eq!(m0_seller, 37_500);
        assert_eq!(change_after_0, 150_000 - 37_500 - 300);

        let (m1_seller, change_after_1) =
            split_milestone_payout(total, 5_000, change_after_0, fee).unwrap();
        assert_eq!(m1_seller, 75_000);
        assert_eq!(change_after_1, change_after_0 - 75_000 - 300);

        // Final milestone: full drain of whatever's left, via the existing terminal-payout helper.
        let final_amounts = split_payout(change_after_1, fee, &[10_000]).unwrap();
        let m2_seller = final_amounts[0];

        assert_eq!(m0_seller + m1_seller + m2_seller, total - 3 * fee);
    }
}
