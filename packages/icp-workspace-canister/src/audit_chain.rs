//! Workspace-wide hash-chain audit log (ADR-322 D5 — a scoped slice of an
//! otherwise-superseded ADR, see the "Implementation Reality Check" section
//! in `docs/decisions/322-workspace-data-architecture-nostr-native-event-model.md`
//! for why only D5 is built here, not the Nostr-relay/WebSocket D1/D2/D6/D7
//! premise). Every event recorded through `record_signed_output` in `lib.rs`
//! (chat turns, tool-call results, tool approvals, server outputs) is linked
//! into a SHA-256 hash chain: `chain_hash = SHA-256(event_bytes || prev_hash)`.
//! Altering or reordering any past event breaks the chain from that point
//! onward — verifiable by anyone who recomputes it from the stored outputs
//! (see `lib.rs::verify_audit_chain`), not just the canister itself.
//!
//! Pure CPU, no IC runtime — unit-testable with plain `cargo test`, same
//! pattern as `sig.rs`/`billing.rs`.

use bitcoin::hashes::{sha256, Hash};

/// Domain-separation prefix, distinct from `sig::DOMAIN` — a chain link and an
/// output signature are different constructions over related but distinct
/// byte strings, and mixing the domains would make cross-purpose replay
/// attacks (chain hash reused where a signature was expected) marginally
/// easier to overlook in review.
pub const CHAIN_DOMAIN: &str = "colabonate-workspace-audit-v1";

/// Genesis link — seeds the chain from this specific workspace's
/// `external_id`, so two workspaces whose first event happens to be
/// byte-identical still diverge from hash zero (no cross-workspace chain
/// collisions).
pub fn genesis_hash(external_id: &str) -> Vec<u8> {
    sha256::Hash::hash(format!("{CHAIN_DOMAIN}:genesis:{external_id}").as_bytes())
        .to_byte_array()
        .to_vec()
}

/// One link: `SHA-256(event_bytes || prev_hash)`. `event_bytes` is expected to
/// be the same canonical event identity `sig.rs` already signs
/// (`sig::output_message`) — reusing it means a tampered event breaks both
/// the BIP-340 signature and the chain, not just one.
pub fn chain_link(prev_hash: &[u8], event_bytes: &[u8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(event_bytes.len() + prev_hash.len());
    buf.extend_from_slice(event_bytes);
    buf.extend_from_slice(prev_hash);
    sha256::Hash::hash(&buf).to_byte_array().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn genesis_hash_is_32_bytes_and_differs_by_external_id() {
        let a = genesis_hash("workspace-a");
        let b = genesis_hash("workspace-b");
        assert_eq!(a.len(), 32);
        assert_eq!(b.len(), 32);
        assert_ne!(a, b);
    }

    #[test]
    fn genesis_hash_is_deterministic() {
        assert_eq!(genesis_hash("same-id"), genesis_hash("same-id"));
    }

    #[test]
    fn chain_link_is_deterministic() {
        let prev = genesis_hash("ws-1");
        assert_eq!(chain_link(&prev, b"event-1"), chain_link(&prev, b"event-1"));
    }

    #[test]
    fn chain_link_differs_by_prev_hash() {
        let event = b"event-1";
        let prev_a = genesis_hash("ws-a");
        let prev_b = genesis_hash("ws-b");
        assert_ne!(chain_link(&prev_a, event), chain_link(&prev_b, event));
    }

    #[test]
    fn chain_link_differs_by_event_bytes_tamper_detection() {
        let prev = genesis_hash("ws-1");
        let honest = chain_link(&prev, b"colabonate-workspace-v1:output:1:42:chat:inline:chat:{\"role\":\"user\"}");
        let tampered = chain_link(&prev, b"colabonate-workspace-v1:output:1:42:chat:inline:chat:{\"role\":\"admin\"}");
        assert_ne!(honest, tampered);
    }

    /// Simulates a 3-event chain, then confirms tampering with the *middle*
    /// event's recorded bytes breaks recomputation from that link onward —
    /// exactly the "manipulation of an event breaks the chain" property
    /// ADR-322 D5 describes, exercised without any IC runtime.
    #[test]
    fn tampering_with_a_past_event_breaks_the_chain_from_that_point_on() {
        let genesis = genesis_hash("ws-1");
        let e1 = b"event-1".to_vec();
        let e2_honest = b"event-2-honest".to_vec();
        let e2_tampered = b"event-2-tampered".to_vec();
        let e3 = b"event-3".to_vec();

        let h1 = chain_link(&genesis, &e1);
        let h2_honest = chain_link(&h1, &e2_honest);
        let h3_honest = chain_link(&h2_honest, &e3);

        // Recompute the chain as if e2 had been silently rewritten in storage.
        let h2_tampered = chain_link(&h1, &e2_tampered);
        let h3_after_tamper = chain_link(&h2_tampered, &e3);

        assert_ne!(h2_honest, h2_tampered);
        assert_ne!(h3_honest, h3_after_tamper);
    }

    #[test]
    fn reordering_two_events_changes_the_final_hash() {
        let genesis = genesis_hash("ws-1");
        let a = b"event-a".to_vec();
        let b = b"event-b".to_vec();

        let forward = chain_link(&chain_link(&genesis, &a), &b);
        let swapped = chain_link(&chain_link(&genesis, &b), &a);

        assert_ne!(forward, swapped);
    }
}
