//! Harness protocol helpers (FU-434 Slice C) — pure, no IC runtime, no I/O.
//!
//! The harness in this architecture is the canister itself: buyer-signed
//! actions (`post_message`, `call_tool`, `approve_tool_call`) arrive as
//! direct update calls, the canister verifies the buyer's BIP-340 signature
//! (`sig.rs`), guards replays here, runs the LLM/tool outcalls (`llm.rs` +
//! the management canister's `http_request`), and records signed outputs.
//!
//! What the harness deliberately is NOT (documented in the ADR record):
//! - no LLM tool-call loop: the LLM client is single-turn (system prompt +
//!   user message); parsing provider tool-call responses and feeding results
//!   back is a follow-up. Tool execution is buyer-initiated for now.
//! - the ADR-311 D6 tool names read_file/write_file/execute_command are
//!   meaningless inside a canister (no filesystem, no shell) — the executor
//!   only runs allowlisted REST tools via HTTPS outcalls.

use crate::types::WorkspaceError;

/// A signed action's timestamp may lead the IC clock by at most this much —
/// tolerance for client-clock skew, small enough that a signature pre-made
/// "for later" can't sit valid for long. Five minutes in nanoseconds.
const MAX_FUTURE_SKEW_NS: u64 = 5 * 60 * 1_000_000_000;

/// Replay guard for buyer-signed actions. Chat/tool calls are repeatable
/// actions, so the escrow's one-shot-consumption argument doesn't apply —
/// instead every signed action carries a timestamp inside the signed message
/// and must be strictly greater than the last accepted one. Monotonicity
/// makes a captured signature single-use (a second presentation can never
/// satisfy `>` with the same timestamp) and doubles as action ordering.
pub fn check_fresh_action(
    timestamp: u64,
    last_accepted: Option<u64>,
    now: u64,
) -> Result<(), WorkspaceError> {
    if let Some(last) = last_accepted {
        if timestamp <= last {
            return Err(WorkspaceError::ReplayRejected {
                reason: format!("timestamp {timestamp} is not greater than last accepted {last}"),
            });
        }
    }
    if timestamp > now.saturating_add(MAX_FUTURE_SKEW_NS) {
        return Err(WorkspaceError::ReplayRejected {
            reason: "timestamp too far in the future".to_string(),
        });
    }
    Ok(())
}

/// Whether a matched tool must be parked for buyer approval before execution.
pub struct ToolMatch {
    pub approval_required: bool,
}

/// Matches `url` against the `config.tools` allowlist. Entries are URL
/// prefixes; a leading `!` marks the tool approval-gated (parked as a pending
/// approval until the buyer signs `approve_tool_call`). Only `https://` URLs
/// are executable — plaintext HTTP out of a canister would expose request
/// bodies to the network path.
pub fn find_tool(tools: &[String], url: &str) -> Result<ToolMatch, WorkspaceError> {
    if !url.starts_with("https://") {
        return Err(WorkspaceError::ToolNotAllowed { url: url.to_string() });
    }
    for entry in tools {
        let (approval_required, prefix) = match entry.strip_prefix('!') {
            Some(prefix) => (true, prefix),
            None => (false, entry.as_str()),
        };
        if url.starts_with(prefix) {
            return Ok(ToolMatch { approval_required });
        }
    }
    Err(WorkspaceError::ToolNotAllowed { url: url.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_action_requires_strictly_increasing_timestamp() {
        // First action: any timestamp not in the future.
        assert!(check_fresh_action(1_000, None, 5_000).is_ok());
        // Strictly greater: accepted.
        assert!(check_fresh_action(1_001, Some(1_000), 5_000).is_ok());
        // Equal or lower: replayed/stale — rejected.
        assert!(matches!(check_fresh_action(1_000, Some(1_000), 5_000), Err(WorkspaceError::ReplayRejected { .. })));
        assert!(matches!(check_fresh_action(999, Some(1_000), 5_000), Err(WorkspaceError::ReplayRejected { .. })));
    }

    #[test]
    fn fresh_action_rejects_far_future_timestamps() {
        assert!(check_fresh_action(5_000 + MAX_FUTURE_SKEW_NS, None, 5_000).is_ok());
        assert!(matches!(
            check_fresh_action(5_000 + MAX_FUTURE_SKEW_NS + 1, None, 5_000),
            Err(WorkspaceError::ReplayRejected { .. })
        ));
    }

    fn tools() -> Vec<String> {
        vec![
            "https://api.example.com/".to_string(),
            "!https://danger.example.com/".to_string(),
        ]
    }

    #[test]
    fn allowlist_matches_prefixes_and_approval_marking() {
        let m = find_tool(&tools(), "https://api.example.com/v1/models").unwrap();
        assert!(!m.approval_required);
        let m = find_tool(&tools(), "https://danger.example.com/delete").unwrap();
        assert!(m.approval_required);
    }

    #[test]
    fn allowlist_rejects_unlisted_and_non_https_urls() {
        assert!(matches!(
            find_tool(&tools(), "https://evil.example.com/"),
            Err(WorkspaceError::ToolNotAllowed { .. })
        ));
        assert!(matches!(
            find_tool(&tools(), "http://api.example.com/v1/models"),
            Err(WorkspaceError::ToolNotAllowed { .. })
        ));
        // An allowlisted prefix must not be escapable by authority trickery:
        // starts_with on the full URL keeps "https://api.example.com/" from
        // matching "https://api.example.com.evil.com/".
        assert!(matches!(
            find_tool(&tools(), "https://api.example.com.evil.com/x"),
            Err(WorkspaceError::ToolNotAllowed { .. })
        ));
    }
}
