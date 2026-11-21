//! BIP-340 Schnorr execution proofs for workspace outputs (ADR-311 D4) —
//! FU-434 Slice A. Mirrors the escrow canister's `sig.rs` construction:
//! sha256 of a domain-separated canonical message, signed/verified with the
//! `bitcoin` crate's bundled secp256k1.
//!
//! Unlike the escrow canister (which *verifies* buyer/seller Nostr
//! signatures), this canister *produces* signatures: it holds one
//! canister-level secp256k1 keypair (generated lazily from `raw_rand`, stored
//! in stable memory) and signs every output it records via `record_output`.
//! The matching x-only public key is exposed via `get_output_pubkey`, so any
//! buyer can verify execution proofs externally (e.g. with nostr-tools)
//! against the canonical message from `output_message`.
//!
//! Custody note: the private key lives in the canister's stable memory and
//! never leaves the canister. That is a deliberate simplicity trade-off for
//! the FU-431/FU-434 slices; migrating to threshold-Schnorr (the IC's native
//! chain-key signatures) is a possible later hardening.
//!
//! Pure CPU, no IC runtime and no I/O — everything here is unit-testable with
//! plain `cargo test`, exactly like the escrow's verification side.

use bitcoin::hashes::{Hash, sha256};
use bitcoin::secp256k1::{Keypair, Message, Secp256k1, SecretKey, XOnlyPublicKey, schnorr::Signature as SchnorrSignature};

use crate::types::WorkspaceError;

/// Domain-separation prefix for every output proof this canister signs — ties
/// a signature unambiguously to this canister's action-space so it can't be
/// replayed as, say, a Nostr event signature or a signature meant for a
/// different canister/protocol (mirrors the escrow canister's DOMAIN).
pub const DOMAIN: &str = "colabonate-workspace-v1";

/// Canonical message an output proof signs over. Every field that identifies
/// the output (workspace id, recording timestamp, type, URI, metadata) is
/// baked in, so a captured signature can't be replayed against a different
/// workspace or with substituted content.
pub fn output_message(workspace_id: u64, created_at: u64, output_type: &str, uri: &str, metadata: &str) -> String {
    format!("{DOMAIN}:output:{workspace_id}:{created_at}:{output_type}:{uri}:{metadata}")
}

/// Signs the canonical output message with `secret_key`, returning the raw
/// 64-byte BIP-340 Schnorr signature stored on `WorkspaceOutput::signature`.
///
/// Deterministic (`sign_schnorr_no_aux_rand`, no aux randomness): the same
/// key and message always yield the same signature, which keeps proofs
/// reproducible and tests free of an rng dependency.
pub fn sign_output(
    secret_key: &SecretKey,
    workspace_id: u64,
    created_at: u64,
    output_type: &str,
    uri: &str,
    metadata: &str,
) -> Vec<u8> {
    let secp = Secp256k1::new();
    let keypair = Keypair::from_secret_key(&secp, secret_key);
    let message = output_message(workspace_id, created_at, output_type, uri, metadata);
    let digest = sha256::Hash::hash(message.as_bytes());
    let msg = Message::from_digest(digest.to_byte_array());
    secp.sign_schnorr_no_aux_rand(&msg, &keypair).as_ref().to_vec()
}

/// X-only (BIP-340) public key for `secret_key`, hex-encoded (64 chars) — the
/// exact format `get_output_pubkey` returns and external verifiers consume.
pub fn pubkey_hex(secret_key: &SecretKey) -> String {
    let secp = Secp256k1::new();
    let keypair = Keypair::from_secret_key(&secp, secret_key);
    let (xonly, _parity) = keypair.x_only_public_key();
    xonly.serialize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Verifies `signature` (raw 64-byte BIP-340 Schnorr signature) was produced
/// by the key behind `pubkey_hex` (32-byte x-only pubkey, hex-encoded) over
/// the canonical output message. Not called by any entry point — it exists
/// for the unit tests here and as the reference implementation for future
/// buyer-side verification tooling. Errors carry a plain reason string; this
/// is tooling, not a wire-facing error path.
#[allow(dead_code)] // exercised by the tests below; kept compiled as reference tooling
pub fn verify_output_signature(
    workspace_id: u64,
    created_at: u64,
    output_type: &str,
    uri: &str,
    metadata: &str,
    signature: &[u8],
    pubkey_hex: &str,
) -> Result<(), String> {
    let message = output_message(workspace_id, created_at, output_type, uri, metadata);
    verify_message(&message, signature, pubkey_hex)
}

/// Shared verify core: sha256 of the utf-8 message, BIP-340 against the
/// x-only pubkey. Plain reason strings — callers map to their error type.
fn verify_message(message: &str, signature: &[u8], pubkey_hex: &str) -> Result<(), String> {
    let pubkey_bytes = hex_decode(pubkey_hex)?;
    let pubkey_bytes: [u8; 32] = pubkey_bytes
        .try_into()
        .map_err(|v: Vec<u8>| format!("expected 32-byte hex pubkey, got {} bytes", v.len()))?;
    let pubkey = XOnlyPublicKey::from_slice(&pubkey_bytes).map_err(|e| format!("invalid pubkey: {e}"))?;
    let sig = SchnorrSignature::from_slice(signature).map_err(|e| format!("invalid signature encoding: {e}"))?;

    let digest = sha256::Hash::hash(message.as_bytes());
    let msg = Message::from_digest(digest.to_byte_array());

    let secp = Secp256k1::verification_only();
    secp.verify_schnorr(&sig, &msg, &pubkey)
        .map_err(|_| "signature does not match".to_string())
}

/// Canonical message for a buyer-signed action (FU-434 Slice C):
/// `{DOMAIN}:{action}:{workspace_id}:{timestamp}:{param1}:{param2}...`.
///
/// Unlike the escrow canister's one-shot actions, chat/tool calls are
/// repeatable, so the escrow's "consumable at most once by the state machine"
/// argument does not apply — the timestamp is part of the signed message and
/// the monotonic replay guard in `harness.rs` is what makes a captured
/// signature unreplayable. Every parameter that identifies the action is
/// baked in, so a captured signature can't be replayed with substituted
/// content either.
pub fn action_message(action: &str, workspace_id: u64, timestamp: u64, params: &[&str]) -> String {
    let mut message = format!("{DOMAIN}:{action}:{workspace_id}:{timestamp}");
    for param in params {
        message.push(':');
        message.push_str(param);
    }
    message
}

/// Verifies a buyer-signed action against the workspace's `buyer_pubkey`
/// (the caller is anonymous for buyer-direct calls — the signature IS the
/// authorization, escrow FU-254-E pattern).
pub fn verify_buyer_action(
    action: &str,
    workspace_id: u64,
    timestamp: u64,
    params: &[&str],
    signature: &[u8],
    buyer_pubkey_hex: &str,
) -> Result<(), WorkspaceError> {
    let message = action_message(action, workspace_id, timestamp, params);
    verify_message(&message, signature, buyer_pubkey_hex).map_err(|reason| WorkspaceError::SignatureVerificationFailed {
        reason,
    })
}

/// FU-589 (ADR-349 D1): verifies a buyer-direct action against ANY of a set
/// of authorized pubkeys — the buyer plus any invited, full-parity
/// collaborators (`Workspace.authorized_signers`). Full parity by explicit
/// product decision (2026-08-30): a match against any candidate authorizes
/// the action identically, there is no partial/restricted signer. The
/// failure reason never reveals which candidate(s) exist or how many were
/// tried, only that none matched.
pub fn verify_buyer_action_multi(
    action: &str,
    workspace_id: u64,
    timestamp: u64,
    params: &[&str],
    signature: &[u8],
    candidate_pubkeys_hex: &[String],
) -> Result<(), WorkspaceError> {
    let matched = candidate_pubkeys_hex
        .iter()
        .any(|pk| verify_buyer_action(action, workspace_id, timestamp, params, signature, pk).is_ok());
    if matched {
        Ok(())
    } else {
        Err(WorkspaceError::SignatureVerificationFailed {
            reason: "signature does not match any authorized signer".to_string(),
        })
    }
}

#[allow(dead_code)] // helper of `verify_output_signature` — same reasoning
fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("odd-length hex string".to_string());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| format!("invalid hex byte at offset {i}")))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic test key from a fixed 32-byte scalar — no `rand`
    /// dependency needed since `sign_schnorr_no_aux_rand` doesn't require one
    /// either (same trick as the escrow canister's sig tests).
    fn test_key(seed_byte: u8) -> SecretKey {
        SecretKey::from_slice(&[seed_byte; 32]).unwrap()
    }

    /// Signs an arbitrary canonical message — the buyer-side mirror of the
    /// action verification (same construction the TS client performs with
    /// nostr-tools: sha256 of the utf-8 string, then BIP-340).
    fn sign_message(key: &SecretKey, message: &str) -> Vec<u8> {
        let secp = Secp256k1::new();
        let keypair = Keypair::from_secret_key(&secp, key);
        let digest = sha256::Hash::hash(message.as_bytes());
        let msg = Message::from_digest(digest.to_byte_array());
        secp.sign_schnorr_no_aux_rand(&msg, &keypair).as_ref().to_vec()
    }

    #[test]
    fn signed_output_verifies_against_own_pubkey() {
        let sk = test_key(1);
        let sig = sign_output(&sk, 7, 1_700_000_000_000_000_000, "text", "icp://ws-7/out/1.txt", "{\"mime\":\"text/plain\"}");
        assert_eq!(sig.len(), 64);
        assert!(
            verify_output_signature(
                7,
                1_700_000_000_000_000_000,
                "text",
                "icp://ws-7/out/1.txt",
                "{\"mime\":\"text/plain\"}",
                &sig,
                &pubkey_hex(&sk),
            )
            .is_ok()
        );
    }

    #[test]
    fn rejects_signature_for_wrong_workspace_id() {
        let sk = test_key(1);
        // Signed for workspace 7, replayed against workspace 8.
        let sig = sign_output(&sk, 7, 1_700_000_000_000_000_000, "text", "uri", "meta");
        assert!(verify_output_signature(8, 1_700_000_000_000_000_000, "text", "uri", "meta", &sig, &pubkey_hex(&sk)).is_err());
    }

    #[test]
    fn rejects_signature_with_substituted_uri() {
        let sk = test_key(1);
        let sig = sign_output(&sk, 7, 1_700_000_000_000_000_000, "text", "honest-uri", "meta");
        // Parameter substitution attack: same key, tampered content reference.
        assert!(verify_output_signature(7, 1_700_000_000_000_000_000, "text", "forged-uri", "meta", &sig, &pubkey_hex(&sk)).is_err());
    }

    #[test]
    fn rejects_signature_with_substituted_timestamp() {
        let sk = test_key(1);
        let sig = sign_output(&sk, 7, 1_700_000_000_000_000_000, "text", "uri", "meta");
        assert!(verify_output_signature(7, 1_700_000_000_000_000_001, "text", "uri", "meta", &sig, &pubkey_hex(&sk)).is_err());
    }

    #[test]
    fn rejects_signature_from_wrong_key() {
        let sk = test_key(1);
        let stranger = test_key(2);
        let sig = sign_output(&sk, 7, 1_700_000_000_000_000_000, "text", "uri", "meta");
        assert!(
            verify_output_signature(7, 1_700_000_000_000_000_000, "text", "uri", "meta", &sig, &pubkey_hex(&stranger)).is_err()
        );
    }

    #[test]
    fn rejects_malformed_signature_and_pubkey() {
        let sk = test_key(1);
        let sig = sign_output(&sk, 7, 1_700_000_000_000_000_000, "text", "uri", "meta");
        // Truncated signature.
        assert!(verify_output_signature(7, 1_700_000_000_000_000_000, "text", "uri", "meta", &sig[..32], &pubkey_hex(&sk)).is_err());
        // Malformed pubkey encodings.
        assert!(verify_output_signature(7, 1_700_000_000_000_000_000, "text", "uri", "meta", &sig, "deadbeef").is_err());
        assert!(verify_output_signature(7, 1_700_000_000_000_000_000, "text", "uri", "meta", &sig, "abc").is_err());
        assert!(verify_output_signature(7, 1_700_000_000_000_000_000, "text", "uri", "meta", &sig, "zz").is_err());
    }

    #[test]
    fn pubkey_hex_is_64_char_lowercase_hex() {
        let pk = pubkey_hex(&test_key(1));
        assert_eq!(pk.len(), 64);
        assert!(pk.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn output_message_matches_documented_canonical_format() {
        assert_eq!(
            output_message(7, 42, "text", "uri", "meta"),
            "colabonate-workspace-v1:output:7:42:text:uri:meta"
        );
    }

    // --- FU-434 Slice C: buyer-signed actions ---

    #[test]
    fn buyer_action_accepts_correct_signature() {
        let buyer = test_key(1);
        let message = action_message("post_message", 7, 1_000, &["hello"]);
        let sig = sign_message(&buyer, &message);
        assert!(verify_buyer_action("post_message", 7, 1_000, &["hello"], &sig, &pubkey_hex(&buyer)).is_ok());
    }

    #[test]
    fn buyer_action_rejects_wrong_key_and_tampering() {
        let buyer = test_key(1);
        let stranger = test_key(2);
        let sig = sign_message(&buyer, &action_message("post_message", 7, 1_000, &["hello"]));
        let buyer_pk = pubkey_hex(&buyer);
        // Wrong signer.
        assert!(verify_buyer_action("post_message", 7, 1_000, &["hello"], &sig, &pubkey_hex(&stranger)).is_err());
        // Tampered timestamp (replay with shifted nonce).
        assert!(verify_buyer_action("post_message", 7, 1_001, &["hello"], &sig, &buyer_pk).is_err());
        // Tampered content.
        assert!(verify_buyer_action("post_message", 7, 1_000, &["bye"], &sig, &buyer_pk).is_err());
        // Tampered action (a chat signature presented as a tool call).
        assert!(verify_buyer_action("call_tool", 7, 1_000, &["hello"], &sig, &buyer_pk).is_err());
        // Different workspace.
        assert!(verify_buyer_action("post_message", 8, 1_000, &["hello"], &sig, &buyer_pk).is_err());
    }

    // --- FU-589: multi-signer (full-parity collaborator) verification ---

    #[test]
    fn multi_accepts_the_buyer_as_the_first_candidate() {
        let buyer = test_key(1);
        let sig = sign_message(&buyer, &action_message("post_message", 7, 1_000, &["hi"]));
        let candidates = vec![pubkey_hex(&buyer)];
        assert!(verify_buyer_action_multi("post_message", 7, 1_000, &["hi"], &sig, &candidates).is_ok());
    }

    #[test]
    fn multi_accepts_an_invited_collaborator_as_a_later_candidate() {
        let buyer = test_key(1);
        let collaborator = test_key(2);
        let sig = sign_message(&collaborator, &action_message("post_message", 7, 1_000, &["hi"]));
        // Buyer listed first, collaborator second — full parity means either
        // position must authorize identically.
        let candidates = vec![pubkey_hex(&buyer), pubkey_hex(&collaborator)];
        assert!(verify_buyer_action_multi("post_message", 7, 1_000, &["hi"], &sig, &candidates).is_ok());
    }

    #[test]
    fn multi_rejects_a_signer_not_in_the_authorized_set() {
        let buyer = test_key(1);
        let collaborator = test_key(2);
        let stranger = test_key(3);
        let sig = sign_message(&stranger, &action_message("post_message", 7, 1_000, &["hi"]));
        let candidates = vec![pubkey_hex(&buyer), pubkey_hex(&collaborator)];
        assert!(matches!(
            verify_buyer_action_multi("post_message", 7, 1_000, &["hi"], &sig, &candidates),
            Err(WorkspaceError::SignatureVerificationFailed { .. })
        ));
    }

    #[test]
    fn multi_rejects_with_an_empty_candidate_set() {
        let buyer = test_key(1);
        let sig = sign_message(&buyer, &action_message("post_message", 7, 1_000, &["hi"]));
        assert!(verify_buyer_action_multi("post_message", 7, 1_000, &["hi"], &sig, &[]).is_err());
    }

    #[test]
    fn multi_still_enforces_tamper_checks_for_every_candidate() {
        let buyer = test_key(1);
        let collaborator = test_key(2);
        let sig = sign_message(&collaborator, &action_message("post_message", 7, 1_000, &["hi"]));
        let candidates = vec![pubkey_hex(&buyer), pubkey_hex(&collaborator)];
        // Tampered content: neither candidate's key can make a mismatched
        // message verify.
        assert!(verify_buyer_action_multi("post_message", 7, 1_000, &["tampered"], &sig, &candidates).is_err());
    }

    #[test]
    fn action_message_matches_documented_canonical_format() {
        assert_eq!(
            action_message("post_message", 7, 42, &["hello world"]),
            "colabonate-workspace-v1:post_message:7:42:hello world"
        );
        assert_eq!(
            action_message("approve_tool_call", 7, 42, &["3"]),
            "colabonate-workspace-v1:approve_tool_call:7:42:3"
        );
        // No params → no trailing colon.
        assert_eq!(action_message("ping", 7, 42, &[]), "colabonate-workspace-v1:ping:7:42");
    }
}
