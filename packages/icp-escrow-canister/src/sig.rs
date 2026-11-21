//! BIP-340 Schnorr signature verification for buyer/seller/DAO authorization (ADR-254 §2, §7).
//! FU-254-E; Nostr-event-shaped authorization per FU-617 (ADR-357 D3, ADR-254 amendment).
//!
//! Buyer and seller only have Nostr keys (secp256k1/BIP-340), not ICP principals — state-changing
//! calls that need their authorization (`open_dispute`, `release_milestone`, `create_trade` terms
//! binding) verify a **signed Nostr event** instead of `msg_caller`. This matters beyond taste:
//! NIP-07 extensions and NIP-46 bunkers expose only `signEvent` (NIP-01 events), never signing of
//! arbitrary digests — the previous raw-digest scheme was unsignable by every browser-identity
//! path the app supports (GAP F-4). The canister recomputes the NIP-01 event id — SHA-256 over
//! the canonical serialization `[0, pubkey, created_at, kind, tags, content]` — and verifies
//! BIP-340 over that digest; domain separation moved from an ASCII prefix into `kind` + `tags`.
//! Pure CPU verification, no IC runtime and no I/O involved — unlike `btc.rs`, everything here is
//! unit-testable with plain `cargo test`.
//!
//! One call deliberately stays on the raw-digest path: `submit_dao_verdict`, because the DAO key
//! is a governance entity's key (provisioning is FU-253-H/FU-254-G), not a browser identity that
//! needs NIP-07/46 signability.

use crate::types::{NostrAuthEvent, TradeError};
use bitcoin::hashes::{Hash, sha256};
use bitcoin::secp256k1::{Message, Secp256k1, XOnlyPublicKey, schnorr::Signature as SchnorrSignature};

/// Kind for trade-terms binding events (`create_trade`, FU-254-J terms, event-shaped since
/// FU-617). Chosen from the Colabonate 304xx block's **unallocated** tail: 30402 (offers),
/// 30404–30411 (company/tickets/dispute/credential/review — 30410/30411 are Credential/Review per
/// ADR-277 D0, dual-published to public relays), 30414/30415 (cooperation) are all taken; 30416
/// and 30417 were free and are registered for escrow here. Domain separation via a dedicated kind
/// matters because a kind that also carries a *different* protocol's meaning (credential, review)
/// would let any future surface asking a NIP-07 signer for "a credential/review event" mint a
/// canister-valid authorization. Addressable-range kind + a unique client-side `d` tag keeps each
/// signature individually addressable/citable instead of being replaced.
pub const TERMS_EVENT_KIND: u32 = 30_416;

/// Kind for state-changing action authorization events (`release_milestone`, `open_dispute`).
/// Same block, same collision rationale, same citability approach.
pub const ACTION_EVENT_KIND: u32 = 30_417;

/// DAO public key (ADR-254 §7: "Blackholed-Governance-Prinzip auch hier: eine
/// DAO-Schlüsselrotation braucht einen neuen, öffentlich verifizierbaren Canister-Build, keinen
/// Laufzeit-Admin-Call"), compile-time constant like `PLATFORM_FEE_ADDRESS`. Provisioned per build
/// target (ADR-364 D5): the `bitcoin-regtest` default stays `None` (its E2E never exercises a DAO
/// verdict against real governance), while `bitcoin-testnet`/`bitcoin-mainnet` bake the founder's
/// master key (`FOUNDATION_DAO_ADMIN_PUBKEY` — an existing BIP-340 x-only pubkey; Nostr keys are
/// secp256k1 x-only keys) as the M0 single-arbitrator bootstrap. A rotation (single → FROST
/// threshold) is a NEW build, never a runtime call.
#[cfg(any(feature = "bitcoin-testnet", feature = "bitcoin-mainnet"))]
const DAO_PUBKEY_HEX: Option<&str> = Some("96013e999b18179e88452455144b438b1e078e1fbcd1a2e7d26c3f8975b0376b");
#[cfg(not(any(feature = "bitcoin-testnet", feature = "bitcoin-mainnet")))]
const DAO_PUBKEY_HEX: Option<&str> = None;

fn hex_decode(s: &str) -> Result<Vec<u8>, TradeError> {
    if s.len() % 2 != 0 {
        return Err(TradeError::SignatureVerificationFailed {
            reason: "odd-length hex string".into(),
        });
    }
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| TradeError::SignatureVerificationFailed {
                reason: format!("invalid hex byte at offset {i}"),
            })
        })
        .collect()
}

fn hex_decode_32(s: &str) -> Result<[u8; 32], TradeError> {
    let bytes = hex_decode(s)?;
    bytes.try_into().map_err(|v: Vec<u8>| TradeError::SignatureVerificationFailed {
        reason: format!("expected 32-byte hex pubkey, got {} bytes", v.len()),
    })
}

/// JSON string escaping per RFC 8259 §7 (the exact minimal set `JSON.stringify` — and therefore
/// nostr-tools — produces for the id computation): `"` and `\` escaped, the five short control
/// escapes, everything else < 0x20 as `\u00xx`. Non-ASCII characters are passed through
/// unescaped, matching every NIP-01 implementation.
fn json_string_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// Canonical NIP-01 event serialization the event id hashes: the compact JSON array
/// `[0, "<pubkey>", <created_at>, <kind>, [[tag, value, ...], ...], "<content>"]` — no whitespace,
/// tags nested arrays, strings escaped per RFC 8259.
fn canonical_serialization(event: &NostrAuthEvent) -> String {
    let mut tags = String::from("[");
    for (i, tag) in event.tags.iter().enumerate() {
        if i > 0 {
            tags.push(',');
        }
        tags.push('[');
        for (j, item) in tag.iter().enumerate() {
            if j > 0 {
                tags.push(',');
            }
            tags.push('"');
            tags.push_str(&json_string_escape(item));
            tags.push('"');
        }
        tags.push(']');
    }
    tags.push(']');
    format!(
        "[0,\"{}\",{},{},{},\"{}\"]",
        json_string_escape(&event.pubkey),
        event.created_at,
        event.kind,
        tags,
        json_string_escape(&event.content)
    )
}

/// Recomputes the NIP-01 event id: SHA-256 over [`canonical_serialization`].
fn event_id(event: &NostrAuthEvent) -> [u8; 32] {
    sha256::Hash::hash(canonical_serialization(event).as_bytes()).to_byte_array()
}

/// Verifies a `NostrAuthEvent` is internally consistent: the claimed `id` equals the recomputed
/// NIP-01 id of the canonical field serialization, and `sig` is a valid BIP-340 signature by
/// `pubkey` over that id. Returns the verified id digest on success — callers layer kind/tag/
/// signer domain checks on top. Checking the *claimed* id (not just the signature) matters: it
/// binds the signature to exactly these field values, so no field can be swapped after signing.
fn verify_event(event: &NostrAuthEvent) -> Result<[u8; 32], TradeError> {
    let recomputed = event_id(event);
    let claimed = hex_decode_32(&event.id).map_err(|e| match e {
        TradeError::SignatureVerificationFailed { reason } => TradeError::SignatureVerificationFailed {
            reason: format!("event id: {reason}"),
        },
        other => other,
    })?;
    if recomputed != claimed {
        return Err(TradeError::SignatureVerificationFailed {
            reason: "event id does not match canonical NIP-01 serialization of its fields".into(),
        });
    }
    let pubkey_bytes = hex_decode_32(&event.pubkey)?;
    let pubkey = XOnlyPublicKey::from_slice(&pubkey_bytes).map_err(|e| TradeError::SignatureVerificationFailed {
        reason: format!("invalid pubkey: {e}"),
    })?;
    let sig = SchnorrSignature::from_slice(&event.sig).map_err(|e| TradeError::SignatureVerificationFailed {
        reason: format!("invalid signature encoding: {e}"),
    })?;
    let msg = Message::from_digest(recomputed);
    let secp = Secp256k1::verification_only();
    secp.verify_schnorr(&sig, &msg, &pubkey)
        .map_err(|_| TradeError::SignatureVerificationFailed {
            reason: "event signature does not verify".into(),
        })?;
    Ok(recomputed)
}

/// Raw-digest verification (SHA-256 over an arbitrary message) — only the DAO path still uses
/// this; all buyer/seller-facing authorization is event-based since FU-617.
fn verify_raw_digest(message: &str, signature: &[u8], pubkey_hex: &str) -> Result<(), TradeError> {
    let pubkey_bytes = hex_decode_32(pubkey_hex)?;
    let pubkey = XOnlyPublicKey::from_slice(&pubkey_bytes).map_err(|e| TradeError::SignatureVerificationFailed {
        reason: format!("invalid pubkey: {e}"),
    })?;
    let sig = SchnorrSignature::from_slice(signature).map_err(|e| TradeError::SignatureVerificationFailed {
        reason: format!("invalid signature encoding: {e}"),
    })?;
    let digest = sha256::Hash::hash(message.as_bytes());
    let msg = Message::from_digest(digest.to_byte_array());
    let secp = Secp256k1::verification_only();
    secp.verify_schnorr(&sig, &msg, &pubkey).map_err(|_| TradeError::SignatureVerificationFailed {
        reason: "signature does not match".into(),
    })
}

/// Requires the event to carry every `[name, value]` tag pair — the parameter-binding half of the
/// FU-617 domain separation (trade id, action name, milestone index travel in tags, so a
/// captured authorization can't be replayed against different parameters).
fn require_tags(event: &NostrAuthEvent, required: &[(&str, &str)]) -> Result<(), TradeError> {
    for (name, value) in required {
        let found = event.tags.iter().any(|t| t.len() >= 2 && t[0] == *name && t[1] == *value);
        if !found {
            return Err(TradeError::SignatureVerificationFailed {
                reason: format!("event is missing required tag [\"{name}\", \"{value}\"]"),
            });
        }
    }
    Ok(())
}

fn require_kind(event: &NostrAuthEvent, kind: u32) -> Result<(), TradeError> {
    if event.kind != kind {
        return Err(TradeError::SignatureVerificationFailed {
            reason: format!("event kind {} does not match expected kind {kind}", event.kind),
        });
    }
    Ok(())
}

/// `open_dispute` (ADR-254 §7): opener may be either buyer or seller — unlike the pre-FU-617
/// scheme the event carries its signer's pubkey, so this is a membership check, not a
/// try-both-then-fallback.
///
/// Replay: same rationale as before FU-617 — a dispute can only be opened once from `Funded` (see
/// `state_machine.rs`), and the trade id is bound via the `["trade", <id>]` tag; `created_at` is
/// signed-over (part of the id), giving each authorization a fresh, attacker-unchangeable
/// context. No expiry window is enforced: the canister cannot know when a relaying server
/// actually forwarded a user's event, and one-time state-machine consumption is the actual
/// replay gate.
pub fn verify_dispute_opener(
    trade_id: u64,
    buyer_pubkey_hex: &str,
    seller_pubkey_hex: &str,
    event: &NostrAuthEvent,
) -> Result<(), TradeError> {
    verify_event(event)?;
    require_kind(event, ACTION_EVENT_KIND)?;
    require_tags(event, &[("trade", &trade_id.to_string()), ("action", "open_dispute")])?;
    if event.pubkey != buyer_pubkey_hex && event.pubkey != seller_pubkey_hex {
        return Err(TradeError::SignatureVerificationFailed {
            reason: "event signer matches neither buyer nor seller pubkey".into(),
        });
    }
    Ok(())
}

/// `release_milestone` (ADR-254 §6): buyer-only. The milestone index is bound via the
/// `["i", <index>]` tag — the parameter-substitution protection the old ASCII message baked in
/// via formatting.
pub fn verify_milestone_release(
    trade_id: u64,
    milestone_index: u32,
    buyer_pubkey_hex: &str,
    event: &NostrAuthEvent,
) -> Result<(), TradeError> {
    verify_event(event)?;
    require_kind(event, ACTION_EVENT_KIND)?;
    require_tags(
        event,
        &[
            ("trade", &trade_id.to_string()),
            ("action", "release_milestone"),
            ("i", &milestone_index.to_string()),
        ],
    )?;
    if event.pubkey != buyer_pubkey_hex {
        return Err(TradeError::SignatureVerificationFailed {
            reason: "event signer is not the buyer pubkey".into(),
        });
    }
    Ok(())
}

/// `submit_dao_verdict` (ADR-254 §7): checked against the compile-time `DAO_PUBKEY_HEX`. Stays on
/// the raw-digest path — the DAO key belongs to a governance entity (FU-253-H/FU-254-G), not to a
/// browser identity that could only sign Nostr events.
pub fn verify_dao_verdict(
    trade_id: u64,
    buyer_bps: u16,
    seller_bps: u16,
    signature: &[u8],
) -> Result<(), TradeError> {
    let dao_pubkey_hex = DAO_PUBKEY_HEX.ok_or_else(|| TradeError::SignatureVerificationFailed {
        reason: "no DAO public key configured in this build".into(),
    })?;
    let message = format!("colabonate-escrow-v1:submit_dao_verdict:{trade_id}:{buyer_bps}:{seller_bps}");
    verify_raw_digest(&message, signature, dao_pubkey_hex)
}

/// Canonical message for `create_trade`'s trade-terms binding (FU-254-J). Includes every
/// economically meaningful `CreateTradeArgs` field in a fixed order — trade ID is deliberately
/// *not* part of this message (unlike the action events' `["trade", <id>]` tag) because it
/// doesn't exist yet at the point buyer/seller sign these terms over Nostr; the terms themselves
/// (particularly `expected_amount_sats` + the address pair) are what make a captured signature
/// unusable against a different trade in practice, since replaying it would require the same
/// buyer, same seller, same amount and same addresses to already coincide. Since FU-617 this
/// string travels as the **content** of the terms events, not as a digest to sign directly.
pub fn trade_terms_message(
    buyer_pubkey_hex: &str,
    seller_pubkey_hex: &str,
    buyer_refund_address: &str,
    seller_payout_address: &str,
    expected_amount_sats: u64,
    milestone_bps: &[u16],
    timeout_at: u64,
) -> String {
    format!(
        "colabonate-escrow-v1:create_trade:{buyer_pubkey_hex}:{seller_pubkey_hex}:{buyer_refund_address}:{seller_payout_address}:{expected_amount_sats}:{milestone_bps:?}:{timeout_at}"
    )
}

/// `create_trade` (FU-254-J, event-shaped since FU-617): verifies buyer and seller each signed a
/// terms event whose content is the identical canonical terms message before the canister stores
/// it or spends a cycles-costing t-ECDSA call deriving an address for it. ADR-254 §2 correctly
/// notes `create_trade` moves no funds, so this isn't a money-safety gate the way the other
/// `verify_*` calls are — but without it, the relaying server could store trade metadata (amount,
/// payout addresses, milestone split) that neither party ever actually agreed to over Nostr, with
/// no way to prove that after the fact. Returns the terms message's SHA-256 digest for storage on
/// `Trade::trade_terms_hash` — an independently recomputable audit anchor (unchanged by FU-617:
/// anyone who knows the negotiated terms recomputes `trade_terms_message(...)` + SHA-256 and
/// compares, with or without the events).
pub fn verify_trade_terms(
    buyer_pubkey_hex: &str,
    seller_pubkey_hex: &str,
    buyer_refund_address: &str,
    seller_payout_address: &str,
    expected_amount_sats: u64,
    milestone_bps: &[u16],
    timeout_at: u64,
    buyer_event: &NostrAuthEvent,
    seller_event: &NostrAuthEvent,
) -> Result<[u8; 32], TradeError> {
    let message = trade_terms_message(
        buyer_pubkey_hex,
        seller_pubkey_hex,
        buyer_refund_address,
        seller_payout_address,
        expected_amount_sats,
        milestone_bps,
        timeout_at,
    );
    for (event, party, expected_pubkey) in [
        (buyer_event, "buyer", buyer_pubkey_hex),
        (seller_event, "seller", seller_pubkey_hex),
    ] {
        verify_event(event).map_err(|e| match e {
            TradeError::SignatureVerificationFailed { reason } => TradeError::SignatureVerificationFailed {
                reason: format!("{party} terms event: {reason}"),
            },
            other => other,
        })?;
        require_kind(event, TERMS_EVENT_KIND).map_err(|e| match e {
            TradeError::SignatureVerificationFailed { reason } => TradeError::SignatureVerificationFailed {
                reason: format!("{party} terms event: {reason}"),
            },
            other => other,
        })?;
        require_tags(event, &[("action", "create_trade")])?;
        if event.pubkey != expected_pubkey {
            return Err(TradeError::SignatureVerificationFailed {
                reason: format!("{party} terms event signer is not the {party} pubkey"),
            });
        }
        if event.content != message {
            return Err(TradeError::SignatureVerificationFailed {
                reason: format!("{party} terms event content does not match the canonical terms message"),
            });
        }
    }
    Ok(sha256::Hash::hash(message.as_bytes()).to_byte_array())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::NostrAuthEvent;
    use bitcoin::secp256k1::{Keypair, SecretKey};

    /// Deterministic test keypair from a fixed 32-byte scalar — no `rand` dependency needed since
    /// `sign_schnorr_no_aux_rand` doesn't require one either.
    fn test_keypair(seed_byte: u8) -> (Keypair, String) {
        let secp = Secp256k1::new();
        let sk = SecretKey::from_slice(&[seed_byte; 32]).unwrap();
        let keypair = Keypair::from_secret_key(&secp, &sk);
        let (xonly, _parity) = keypair.x_only_public_key();
        let pubkey_hex = xonly.serialize().iter().map(|b| format!("{b:02x}")).collect::<String>();
        (keypair, pubkey_hex)
    }

    /// Builds a Nostr event, computes its NIP-01 id via [`canonical_serialization`], and signs it
    /// — i.e. exactly what a NIP-07 `signEvent` implementation does.
    fn sign_event(
        keypair: &Keypair,
        kind: u32,
        tags: Vec<Vec<String>>,
        content: &str,
        created_at: u64,
    ) -> NostrAuthEvent {
        let (xonly, _) = keypair.x_only_public_key();
        let pubkey_hex = xonly.serialize().iter().map(|b| format!("{b:02x}")).collect::<String>();
        let mut event = NostrAuthEvent {
            id: String::new(),
            pubkey: pubkey_hex,
            created_at,
            kind,
            tags,
            content: content.to_string(),
            sig: Vec::new(),
        };
        let id = event_id(&event);
        event.id = id.iter().map(|b| format!("{b:02x}")).collect();
        let secp = Secp256k1::new();
        let msg = Message::from_digest(id);
        event.sig = secp.sign_schnorr_no_aux_rand(&msg, keypair).as_ref().to_vec();
        event
    }

    /// Cross-implementation vector: this event's id as computed by nostr-tools (NIP-01 reference
    /// implementation, node) — guards against drift in our canonical serialization/escaping.
    /// Pinned identically in the TS suite (`escrow-auth-events.test.ts`).
    #[test]
    fn canonical_serialization_matches_nostr_tools_action_vector() {
        let event = NostrAuthEvent {
            id: String::new(),
            pubkey: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798".into(),
            created_at: 1_730_000_000,
            kind: ACTION_EVENT_KIND,
            tags: vec![
                vec!["trade".into(), "7".into()],
                vec!["action".into(), "release_milestone".into()],
                vec!["i".into(), "1".into()],
            ],
            content: String::new(),
            sig: Vec::new(),
        };
        let id: String = event_id(&event).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            id,
            "fcbda4d2032ddb8aa77100f1ff1bbe7d9832b5affcc83b49a131a64148a275f7"
        );
    }

    /// Cross-implementation vector for the *terms* contract (kind, `["action","create_trade"]`
    /// tag, terms message as content) — the action vector alone doesn't pin this half of the
    /// protocol. Same event + id pinned in the TS suite.
    #[test]
    fn canonical_serialization_matches_nostr_tools_terms_vector() {
        let message = trade_terms_message(
            &"aa".repeat(32),
            &"bb".repeat(32),
            "bc1qrefund",
            "bc1qpayout",
            100_000,
            &[10_000],
            1_735_689_600_000_000_000,
        );
        // Literal pin (byte-exact format contract shared with
        // `escrowTradeTermsMessage` in apps/colabonate-app — a `format!` change here without the
        // TS mirror changing silently breaks every client-built terms event, and vice versa).
        assert_eq!(
            message,
            format!(
                "colabonate-escrow-v1:create_trade:{}:{}:bc1qrefund:bc1qpayout:100000:[10000]:1735689600000000000",
                "aa".repeat(32),
                "bb".repeat(32)
            )
        );
        let event = NostrAuthEvent {
            id: String::new(),
            pubkey: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798".into(),
            created_at: 1_730_000_000,
            kind: TERMS_EVENT_KIND,
            tags: vec![vec!["action".into(), "create_trade".into()]],
            content: message,
            sig: Vec::new(),
        };
        let id: String = event_id(&event).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            id,
            "9e40dec5ad9595f8f2bb5cc3613d4c7c1c977b9b70779a9aedaa034582a43676"
        );
    }

    #[test]
    fn canonical_serialization_escapes_control_chars_like_rfc_8259() {
        let plain = NostrAuthEvent {
            id: String::new(),
            pubkey: "aa".repeat(32),
            created_at: 1,
            kind: TERMS_EVENT_KIND,
            tags: vec![],
            content: "plain".into(),
            sig: Vec::new(),
        };
        let tricky = NostrAuthEvent { content: "a\"b\\c\nd\te\u{1}f\u{8}g\u{c}h".into(), ..plain.clone() };
        assert_eq!(
            canonical_serialization(&tricky),
            format!(
                "[0,\"{}\",1,{},[],\"a\\\"b\\\\c\\nd\\te\\u0001f\\bg\\fh\"]",
                "aa".repeat(32),
                TERMS_EVENT_KIND
            )
        );
        // Different content ⇒ different id, byte-for-byte sensitivity included.
        assert_ne!(event_id(&plain), event_id(&tricky));
    }

    #[test]
    fn dispute_opener_accepts_buyer_event() {
        let (buyer_kp, buyer_pk) = test_keypair(1);
        let (_seller_kp, seller_pk) = test_keypair(2);
        let event = sign_event(
            &buyer_kp,
            ACTION_EVENT_KIND,
            vec![vec!["trade".into(), "7".into()], vec!["action".into(), "open_dispute".into()]],
            "",
            1_730_000_000,
        );
        assert!(verify_dispute_opener(7, &buyer_pk, &seller_pk, &event).is_ok());
    }

    #[test]
    fn dispute_opener_accepts_seller_event() {
        let (_buyer_kp, buyer_pk) = test_keypair(1);
        let (seller_kp, seller_pk) = test_keypair(2);
        let event = sign_event(
            &seller_kp,
            ACTION_EVENT_KIND,
            vec![vec!["trade".into(), "7".into()], vec!["action".into(), "open_dispute".into()]],
            "",
            1_730_000_000,
        );
        assert!(verify_dispute_opener(7, &buyer_pk, &seller_pk, &event).is_ok());
    }

    #[test]
    fn dispute_opener_rejects_unrelated_signer() {
        let (_buyer_kp, buyer_pk) = test_keypair(1);
        let (_seller_kp, seller_pk) = test_keypair(2);
        let (stranger_kp, _stranger_pk) = test_keypair(3);
        let event = sign_event(
            &stranger_kp,
            ACTION_EVENT_KIND,
            vec![vec!["trade".into(), "7".into()], vec!["action".into(), "open_dispute".into()]],
            "",
            1_730_000_000,
        );
        assert!(verify_dispute_opener(7, &buyer_pk, &seller_pk, &event).is_err());
    }

    #[test]
    fn dispute_opener_rejects_event_for_wrong_trade_id() {
        let (buyer_kp, buyer_pk) = test_keypair(1);
        let (_seller_kp, seller_pk) = test_keypair(2);
        // Signed for trade 7, replayed against trade 8 — the ["trade", "7"] tag won't match.
        let event = sign_event(
            &buyer_kp,
            ACTION_EVENT_KIND,
            vec![vec!["trade".into(), "7".into()], vec!["action".into(), "open_dispute".into()]],
            "",
            1_730_000_000,
        );
        let err = verify_dispute_opener(8, &buyer_pk, &seller_pk, &event).unwrap_err();
        assert!(
            matches!(err, TradeError::SignatureVerificationFailed { ref reason } if reason.contains("trade")),
            "expected missing-tag error, got {err:?}"
        );
    }

    #[test]
    fn dispute_opener_rejects_wrong_kind() {
        let (buyer_kp, buyer_pk) = test_keypair(1);
        let (_seller_kp, seller_pk) = test_keypair(2);
        // Terms kind smuggled in as a dispute authorization — kind is the domain separator.
        let event = sign_event(
            &buyer_kp,
            TERMS_EVENT_KIND,
            vec![vec!["trade".into(), "7".into()], vec!["action".into(), "open_dispute".into()]],
            "",
            1_730_000_000,
        );
        assert!(verify_dispute_opener(7, &buyer_pk, &seller_pk, &event).is_err());
    }

    #[test]
    fn dispute_opener_rejects_tampered_content() {
        let (buyer_kp, buyer_pk) = test_keypair(1);
        let (_seller_kp, seller_pk) = test_keypair(2);
        let mut event = sign_event(
            &buyer_kp,
            ACTION_EVENT_KIND,
            vec![vec!["trade".into(), "7".into()], vec!["action".into(), "open_dispute".into()]],
            "",
            1_730_000_000,
        );
        // Mutating any signed field must break the recomputed id, not just the semantics.
        event.content = "tampered".into();
        let err = verify_dispute_opener(7, &buyer_pk, &seller_pk, &event).unwrap_err();
        assert!(
            matches!(err, TradeError::SignatureVerificationFailed { ref reason } if reason.contains("does not match")),
            "expected id-mismatch error, got {err:?}"
        );
    }

    #[test]
    fn milestone_release_accepts_matching_buyer_event() {
        let (buyer_kp, buyer_pk) = test_keypair(1);
        let event = sign_event(
            &buyer_kp,
            ACTION_EVENT_KIND,
            vec![
                vec!["trade".into(), "3".into()],
                vec!["action".into(), "release_milestone".into()],
                vec!["i".into(), "1".into()],
            ],
            "",
            1_730_000_000,
        );
        assert!(verify_milestone_release(3, 1, &buyer_pk, &event).is_ok());
    }

    #[test]
    fn milestone_release_rejects_event_for_different_milestone_index() {
        let (buyer_kp, buyer_pk) = test_keypair(1);
        // Signed for milestone 0, replayed against milestone 1 — parameter substitution attack.
        let event = sign_event(
            &buyer_kp,
            ACTION_EVENT_KIND,
            vec![
                vec!["trade".into(), "3".into()],
                vec!["action".into(), "release_milestone".into()],
                vec!["i".into(), "0".into()],
            ],
            "",
            1_730_000_000,
        );
        assert!(verify_milestone_release(3, 1, &buyer_pk, &event).is_err());
    }

    #[test]
    fn milestone_release_rejects_seller_event() {
        let (_buyer_kp, buyer_pk) = test_keypair(1);
        let (seller_kp, _seller_pk) = test_keypair(2);
        let event = sign_event(
            &seller_kp,
            ACTION_EVENT_KIND,
            vec![
                vec!["trade".into(), "3".into()],
                vec!["action".into(), "release_milestone".into()],
                vec!["i".into(), "1".into()],
            ],
            "",
            1_730_000_000,
        );
        assert!(verify_milestone_release(3, 1, &buyer_pk, &event).is_err());
    }

    #[test]
    fn milestone_release_rejects_missing_index_tag() {
        let (buyer_kp, buyer_pk) = test_keypair(1);
        let event = sign_event(
            &buyer_kp,
            ACTION_EVENT_KIND,
            vec![
                vec!["trade".into(), "3".into()],
                vec!["action".into(), "release_milestone".into()],
            ],
            "",
            1_730_000_000,
        );
        assert!(verify_milestone_release(3, 1, &buyer_pk, &event).is_err());
    }

    #[test]
    fn trade_terms_accepts_matching_events_from_both_parties() {
        let (buyer_kp, buyer_pk) = test_keypair(1);
        let (seller_kp, seller_pk) = test_keypair(2);
        let message = trade_terms_message(
            &buyer_pk, &seller_pk, "bc1qbuyerrefund", "bc1qsellerpayout", 100_000, &[10_000],
            1_735_689_600_000_000_000,
        );
        let buyer_event = sign_event(&buyer_kp, TERMS_EVENT_KIND, vec![vec!["action".into(), "create_trade".into()]], &message, 1_730_000_000);
        let seller_event = sign_event(&seller_kp, TERMS_EVENT_KIND, vec![vec!["action".into(), "create_trade".into()]], &message, 1_730_000_001);
        let hash = verify_trade_terms(
            &buyer_pk, &seller_pk, "bc1qbuyerrefund", "bc1qsellerpayout", 100_000, &[10_000],
            1_735_689_600_000_000_000, &buyer_event, &seller_event,
        )
        .unwrap();
        // Audit anchor unchanged by FU-617: SHA-256 over the canonical terms message.
        assert_eq!(
            hash,
            sha256::Hash::hash(message.as_bytes()).to_byte_array()
        );
    }

    #[test]
    fn trade_terms_rejects_content_substitution() {
        let (buyer_kp, buyer_pk) = test_keypair(1);
        let (seller_kp, seller_pk) = test_keypair(2);
        // Buyer signed the real terms; seller signed different terms — server-side substitution
        // attempt, must fail on content comparison.
        let real_terms = trade_terms_message(
            &buyer_pk, &seller_pk, "bc1qbuyerrefund", "bc1qsellerpayout", 100_000, &[10_000],
            1_735_689_600_000_000_000,
        );
        let buyer_event = sign_event(&buyer_kp, TERMS_EVENT_KIND, vec![vec!["action".into(), "create_trade".into()]], &real_terms, 1_730_000_000);
        let seller_event = sign_event(&seller_kp, TERMS_EVENT_KIND, vec![vec!["action".into(), "create_trade".into()]],
            "colabonate-escrow-v1:create_trade:someone:else:bc1qevil:bc1qevil:999999:[10000]:1", 1_730_000_000);
        assert!(verify_trade_terms(
            &buyer_pk, &seller_pk, "bc1qbuyerrefund", "bc1qsellerpayout", 100_000, &[10_000],
            1_735_689_600_000_000_000, &buyer_event, &seller_event,
        )
        .is_err());
    }

    #[test]
    fn trade_terms_rejects_seller_signing_as_buyer() {
        let (_buyer_kp, buyer_pk) = test_keypair(1);
        let (seller_kp, seller_pk) = test_keypair(2);
        let message = trade_terms_message(
            &buyer_pk, &seller_pk, "bc1qbuyerrefund", "bc1qsellerpayout", 100_000, &[10_000],
            1_735_689_600_000_000_000,
        );
        // Both events signed by the seller — the "buyer" event's signer check must fail.
        let buyer_event = sign_event(&seller_kp, TERMS_EVENT_KIND, vec![vec!["action".into(), "create_trade".into()]], &message, 1_730_000_000);
        let seller_event = sign_event(&seller_kp, TERMS_EVENT_KIND, vec![vec!["action".into(), "create_trade".into()]], &message, 1_730_000_001);
        assert!(verify_trade_terms(
            &buyer_pk, &seller_pk, "bc1qbuyerrefund", "bc1qsellerpayout", 100_000, &[10_000],
            1_735_689_600_000_000_000, &buyer_event, &seller_event,
        )
        .is_err());
    }

    #[cfg(not(any(feature = "bitcoin-testnet", feature = "bitcoin-mainnet")))]
    #[test]
    fn dao_verdict_fails_honestly_when_no_dao_key_configured() {
        let (dao_kp, _dao_pk) = test_keypair(9);
        let secp = Secp256k1::new();
        let message = "colabonate-escrow-v1:submit_dao_verdict:3:5000:5000";
        let digest = sha256::Hash::hash(message.as_bytes());
        let msg = Message::from_digest(digest.to_byte_array());
        let sig = secp.sign_schnorr_no_aux_rand(&msg, &dao_kp).as_ref().to_vec();
        let err = verify_dao_verdict(3, 5_000, 5_000, &sig).unwrap_err();
        assert_eq!(
            err,
            TradeError::SignatureVerificationFailed {
                reason: "no DAO public key configured in this build".into()
            }
        );
    }

    #[cfg(any(feature = "bitcoin-testnet", feature = "bitcoin-mainnet"))]
    #[test]
    fn dao_verdict_key_is_provisioned_and_rejects_unrelated_signers() {
        // ADR-364 D5: the M0 bootstrap key is baked for testnet/mainnet. An unrelated key's
        // signature must be rejected as *invalid* — not as "no key configured" — proving the key
        // IS provisioned in these builds.
        let (unrelated_kp, _) = test_keypair(9);
        let secp = Secp256k1::new();
        let message = "colabonate-escrow-v1:submit_dao_verdict:3:5000:5000";
        let digest = sha256::Hash::hash(message.as_bytes());
        let msg = Message::from_digest(digest.to_byte_array());
        let sig = secp.sign_schnorr_no_aux_rand(&msg, &unrelated_kp).as_ref().to_vec();
        let err = verify_dao_verdict(3, 5_000, 5_000, &sig).unwrap_err();
        match err {
            TradeError::SignatureVerificationFailed { reason } => {
                assert_ne!(reason, "no DAO public key configured in this build");
            }
            other => panic!("expected SignatureVerificationFailed, got {other:?}"),
        }
    }

    #[test]
    fn hex_decode_32_rejects_wrong_length() {
        assert!(hex_decode_32("deadbeef").is_err());
    }

    #[test]
    fn hex_decode_rejects_odd_length() {
        assert!(hex_decode("abc").is_err());
    }

    #[test]
    fn hex_decode_rejects_non_hex_chars() {
        assert!(hex_decode("zz").is_err());
    }
}
