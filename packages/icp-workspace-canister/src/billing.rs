//! Pure cycle-budget accounting (ADR-311 D3) — no IC runtime, no I/O.
//!
//! The canister meters consumption in cycles: the harness records usage via
//! `record_cycle_usage` after every metered action (LLM call, tool call,
//! storage write — what counts as metered is the harness's decision, FU-434),
//! and the workspace suspends itself once the budget the buyer paid for is
//! exhausted. The buyer reloads via an LN invoice on the server; the server
//! then relays `add_cycles`, which tops the budget up and resumes a suspended
//! workspace. Sats↔cycles conversion happens server-side at reload time —
//! the canister only ever sees cycle numbers, never money.

use crate::types::{WorkspaceError, WorkspaceState};

/// ADR-312 D1: the four billing models a seller can offer. Only "PER_TOKEN"
/// changes cycle-booking behavior today (`lib.rs::post_message`); the other
/// three keep booking the real outcall infra cost — see the module doc on
/// `token_cost_cycles` below for why.
pub const KNOWN_BILLING_MODELS: [&str; 4] = ["ONE_TIME", "PER_HOUR", "PER_TOKEN", "SUBSCRIPTION"];

/// Rejects a `create_workspace` call whose `billing_model` isn't one of the
/// four ADR-312 D1 values — pure, so `cargo test` covers it without the IC
/// runtime the caller (`create_workspace`) needs for everything else.
pub fn validate_billing_model(billing_model: &str) -> Result<(), WorkspaceError> {
    if KNOWN_BILLING_MODELS.contains(&billing_model) {
        Ok(())
    } else {
        Err(WorkspaceError::InvalidArgs {
            reason: format!("unknown billing_model {billing_model:?} — expected one of {KNOWN_BILLING_MODELS:?}"),
        })
    }
}

/// ADR-312 D4 (PER_TOKEN): documented placeholder pricing — a flat rate
/// applied to every provider/model alike, not the ADR-sketched
/// per-provider/per-model table. Same placeholder-policy precedent as
/// `CYCLES_PER_SAT` in `workspace-recharge.ts` (FU-433): a real per-model
/// table needs real LLM-provider pricing data this repo has no source for
/// yet, and a fabricated multi-row table would invent false precision rather
/// than honest approximation. Revisit before mainnet (tracked alongside the
/// existing CYCLES_PER_SAT revisit note).
const CYCLES_PER_1K_TOKENS: u128 = 50_000_000;

/// Cycles to book for one LLM call's token usage under PER_TOKEN billing.
/// Pure integer math (floor division) — a call using fewer than 1000 tokens
/// still books a proportional, non-zero amount rather than rounding to 0
/// only when `total_tokens` is genuinely 0.
pub fn token_cost_cycles(total_tokens: u64) -> u128 {
    (total_tokens as u128 * CYCLES_PER_1K_TOKENS) / 1000
}

/// Remaining budget, saturating at 0 (a workspace that overshot its budget in
/// the same call that suspended it reports 0, never a wrapped-around u128).
pub fn remaining_cycles(cycle_budget: u128, cycles_used: u128) -> u128 {
    cycle_budget.saturating_sub(cycles_used)
}

/// Records `amount` cycles of consumption. Only legal from `Running` — usage
/// implies the agent executed something, and a suspended/completed workspace
/// executes nothing. Returns the new `cycles_used` and the resulting state:
/// reaching or exceeding the budget flips `Running -> Suspended`.
pub fn apply_usage(
    state: &WorkspaceState,
    cycle_budget: u128,
    cycles_used: u128,
    amount: u128,
) -> Result<(u128, WorkspaceState), WorkspaceError> {
    if !matches!(state, WorkspaceState::Running) {
        return Err(WorkspaceError::InvalidTransition {
            from: state.clone(),
            action: "record_cycle_usage".to_string(),
        });
    }
    let new_used = cycles_used.saturating_add(amount);
    let new_state = if new_used >= cycle_budget {
        WorkspaceState::Suspended
    } else {
        WorkspaceState::Running
    };
    Ok((new_used, new_state))
}

/// Tops the budget up by `amount`. Legal from `Running` and `Suspended` (the
/// two states a buyer can meaningfully reload). A `Suspended` workspace
/// resumes to `Running` iff the new budget exceeds what's already consumed;
/// topping up by less than the overshoot keeps it suspended, honestly.
pub fn apply_topup(
    state: &WorkspaceState,
    cycle_budget: u128,
    cycles_used: u128,
    amount: u128,
) -> Result<(u128, WorkspaceState), WorkspaceError> {
    if !matches!(state, WorkspaceState::Running | WorkspaceState::Suspended) {
        return Err(WorkspaceError::InvalidTransition {
            from: state.clone(),
            action: "add_cycles".to_string(),
        });
    }
    let new_budget = cycle_budget.saturating_add(amount);
    let new_state = if matches!(state, WorkspaceState::Suspended) && cycles_used < new_budget {
        WorkspaceState::Running
    } else {
        state.clone()
    };
    Ok((new_budget, new_state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remaining_saturates_at_zero() {
        assert_eq!(remaining_cycles(100, 40), 60);
        assert_eq!(remaining_cycles(100, 100), 0);
        assert_eq!(remaining_cycles(100, 150), 0);
    }

    #[test]
    fn usage_under_budget_stays_running() {
        let (used, state) = apply_usage(&WorkspaceState::Running, 100, 40, 59).unwrap();
        assert_eq!(used, 99);
        assert_eq!(state, WorkspaceState::Running);
    }

    #[test]
    fn usage_reaching_budget_exactly_suspends() {
        let (used, state) = apply_usage(&WorkspaceState::Running, 100, 40, 60).unwrap();
        assert_eq!(used, 100);
        assert_eq!(state, WorkspaceState::Suspended);
    }

    #[test]
    fn usage_overshooting_budget_suspends_and_keeps_full_amount() {
        // The overshoot is recorded in full — the work was done and must be
        // paid for; the next top-up has to cover it to resume.
        let (used, state) = apply_usage(&WorkspaceState::Running, 100, 90, 50).unwrap();
        assert_eq!(used, 140);
        assert_eq!(state, WorkspaceState::Suspended);
    }

    #[test]
    fn usage_illegal_from_non_running_states() {
        for state in [
            WorkspaceState::PendingDeploy,
            WorkspaceState::Suspended,
            WorkspaceState::Completed,
            WorkspaceState::Expired,
        ] {
            assert!(apply_usage(&state, 100, 0, 1).is_err(), "{state:?}");
        }
    }

    #[test]
    fn topup_resumes_suspended_when_budget_covers_usage() {
        let (budget, state) = apply_topup(&WorkspaceState::Suspended, 100, 140, 50).unwrap();
        assert_eq!(budget, 150);
        assert_eq!(state, WorkspaceState::Running);
    }

    #[test]
    fn topup_short_of_overshoot_stays_suspended() {
        let (budget, state) = apply_topup(&WorkspaceState::Suspended, 100, 140, 30).unwrap();
        assert_eq!(budget, 130);
        assert_eq!(state, WorkspaceState::Suspended);
    }

    #[test]
    fn topup_on_running_stays_running() {
        let (budget, state) = apply_topup(&WorkspaceState::Running, 100, 40, 200).unwrap();
        assert_eq!(budget, 300);
        assert_eq!(state, WorkspaceState::Running);
    }

    #[test]
    fn topup_illegal_from_terminal_and_pre_start_states() {
        for state in [
            WorkspaceState::PendingDeploy,
            WorkspaceState::Completed,
            WorkspaceState::Expired,
        ] {
            assert!(apply_topup(&state, 100, 0, 1).is_err(), "{state:?}");
        }
    }

    #[test]
    fn validate_billing_model_accepts_all_four_known_values() {
        for m in KNOWN_BILLING_MODELS {
            assert!(validate_billing_model(m).is_ok(), "{m}");
        }
    }

    #[test]
    fn validate_billing_model_rejects_unknown_and_case_mismatch() {
        for bad in ["one_time", "PERTOKEN", "", "FLAT_RATE"] {
            match validate_billing_model(bad) {
                Err(WorkspaceError::InvalidArgs { .. }) => {}
                other => panic!("expected InvalidArgs for {bad:?}, got {other:?}"),
            }
        }
    }

    #[test]
    fn token_cost_cycles_scales_linearly() {
        assert_eq!(token_cost_cycles(0), 0);
        assert_eq!(token_cost_cycles(1000), CYCLES_PER_1K_TOKENS);
        assert_eq!(token_cost_cycles(2000), CYCLES_PER_1K_TOKENS * 2);
    }

    #[test]
    fn token_cost_cycles_prorates_sub_1k_amounts_without_zeroing() {
        // 500 tokens is half of 1000 — floor division must not round this to 0.
        assert_eq!(token_cost_cycles(500), CYCLES_PER_1K_TOKENS / 2);
        // A handful of tokens still books a small non-zero amount.
        assert!(token_cost_cycles(10) > 0);
    }
}
