//! Pure workspace-lifecycle state machine — no IC runtime, no I/O.
//! Testable with plain `cargo test`, same pattern as the escrow canister's
//! `state_machine.rs` (ADR-254 §12).
//!
//! Transition map (ADR-311 D2), identical to the server-side map in
//! `apps/server/services/workspace-lifecycle.ts`:
//!
//!   PendingDeploy -> Running -> Suspended -> Completed -> Expired
//!                      ^          │
//!                      └──────────┘ (resume via cycle top-up — billing.rs)
//!
//! Budget-driven transitions (Running <-> Suspended) live in `billing.rs`,
//! not here — they are functions of the cycle numbers, not just the state.

use crate::types::{WorkspaceError, WorkspaceState};

/// The full legal transition set, including the budget-driven ones
/// `billing.rs` applies. Self-transitions are never legal.
pub fn can_transition(from: &WorkspaceState, to: &WorkspaceState) -> bool {
    use WorkspaceState::*;
    matches!(
        (from, to),
        (PendingDeploy, Running)
            | (Running, Suspended)
            | (Running, Completed)
            | (Suspended, Running)
            | (Suspended, Completed)
            | (Completed, Expired)
    )
}

fn transition(from: &WorkspaceState, to: WorkspaceState, action: &str) -> Result<WorkspaceState, WorkspaceError> {
    if can_transition(from, &to) {
        Ok(to)
    } else {
        Err(WorkspaceError::InvalidTransition {
            from: from.clone(),
            action: action.to_string(),
        })
    }
}

/// `PendingDeploy -> Running` once the canister-side deployment has finished
/// and the agent is ready to accept work. Requires the source to be exactly
/// `PendingDeploy` — `Suspended -> Running` is also a legal edge in the map,
/// but that's the budget resume (`billing::apply_topup`), not a start.
pub fn transition_on_start(state: &WorkspaceState) -> Result<WorkspaceState, WorkspaceError> {
    if !matches!(state, WorkspaceState::PendingDeploy) {
        return Err(WorkspaceError::InvalidTransition {
            from: state.clone(),
            action: "start".to_string(),
        });
    }
    Ok(WorkspaceState::Running)
}

/// `Running|Suspended -> Completed` on buyer confirmation. Suspended is a
/// legal source on purpose: a buyer whose workspace ran out of budget must be
/// able to confirm completion (or walk away) without topping up cycles first.
pub fn transition_on_complete(state: &WorkspaceState) -> Result<WorkspaceState, WorkspaceError> {
    transition(state, WorkspaceState::Completed, "complete")
}

/// `Completed -> Expired`, gated on the retention window having elapsed
/// (`expires_at`, stamped at completion from `ttl_seconds`). Permissionless —
/// like the escrow canister's `claim_timeout_refund`, no signature to verify,
/// the time check is the whole guard.
pub fn transition_on_expire(
    state: &WorkspaceState,
    expires_at: Option<u64>,
    now: u64,
) -> Result<WorkspaceState, WorkspaceError> {
    if let WorkspaceState::Completed = state {
        let expires_at = expires_at.unwrap_or(0);
        if now < expires_at {
            return Err(WorkspaceError::NotExpired { expires_at, now });
        }
    }
    transition(state, WorkspaceState::Expired, "expire")
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [WorkspaceState; 5] = [
        WorkspaceState::PendingDeploy,
        WorkspaceState::Running,
        WorkspaceState::Suspended,
        WorkspaceState::Completed,
        WorkspaceState::Expired,
    ];

    const LEGAL: [(WorkspaceState, WorkspaceState); 6] = [
        (WorkspaceState::PendingDeploy, WorkspaceState::Running),
        (WorkspaceState::Running, WorkspaceState::Suspended),
        (WorkspaceState::Running, WorkspaceState::Completed),
        (WorkspaceState::Suspended, WorkspaceState::Running),
        (WorkspaceState::Suspended, WorkspaceState::Completed),
        (WorkspaceState::Completed, WorkspaceState::Expired),
    ];

    #[test]
    fn transition_map_is_exactly_the_adr_311_set() {
        for from in &ALL {
            for to in &ALL {
                let expected = LEGAL.iter().any(|(f, t)| f == from && t == to);
                assert_eq!(
                    can_transition(from, to),
                    expected,
                    "{from:?} -> {to:?}"
                );
            }
        }
    }

    #[test]
    fn start_only_from_pending_deploy() {
        assert_eq!(
            transition_on_start(&WorkspaceState::PendingDeploy).unwrap(),
            WorkspaceState::Running
        );
        for state in &ALL[1..] {
            assert!(transition_on_start(state).is_err(), "{state:?}");
        }
    }

    #[test]
    fn complete_from_running_and_suspended_only() {
        assert_eq!(
            transition_on_complete(&WorkspaceState::Running).unwrap(),
            WorkspaceState::Completed
        );
        assert_eq!(
            transition_on_complete(&WorkspaceState::Suspended).unwrap(),
            WorkspaceState::Completed
        );
        for state in [
            WorkspaceState::PendingDeploy,
            WorkspaceState::Completed,
            WorkspaceState::Expired,
        ] {
            assert!(transition_on_complete(&state).is_err(), "{state:?}");
        }
    }

    #[test]
    fn expire_is_time_gated() {
        let completed = WorkspaceState::Completed;
        // Before the retention window: refused.
        assert!(matches!(
            transition_on_expire(&completed, Some(1_000), 999),
            Err(WorkspaceError::NotExpired { .. })
        ));
        // At and after the boundary: allowed.
        assert_eq!(
            transition_on_expire(&completed, Some(1_000), 1_000).unwrap(),
            WorkspaceState::Expired
        );
        assert_eq!(
            transition_on_expire(&completed, Some(1_000), 2_000).unwrap(),
            WorkspaceState::Expired
        );
        // Only Completed can expire.
        assert!(transition_on_expire(&WorkspaceState::Running, None, u64::MAX).is_err());
        assert!(transition_on_expire(&WorkspaceState::Expired, None, u64::MAX).is_err());
    }
}
