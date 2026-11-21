//! NIP-44 v2 decrypt-only implementation (FU-434 Slice B / FU-353) — the
//! receiving half of the one-time encrypted config-injection channel.
//!
//! The workspace owner seals their `WorkspaceConfig` JSON client-side to the
//! canister's public key (from `ensure_output_key`), the Colabonate server
//! relays the ciphertext via `inject_config` and never sees the plaintext —
//! the same relay philosophy as the escrow canister. The canister is the only
//! party that can open the payload.
//!
//! One keypair, two uses: the canister-held secp256k1 key in stable memory
//! (Slice A's BIP-340 output signing) doubles as this channel's ECDH target.
//! That is a deliberate custody choice — one secret to protect, one pubkey to
//! publish — documented in the crate header.
//!
//! Wire format (NIP-44 v2): base64 of
//! `version(0x02) || nonce(32) || ciphertext || mac(32)` where
//! - conversation_key = HKDF-extract(salt="nip44-v2", ikm=ecdh_x),
//!   ecdh_x = x-coordinate of secp256k1 ECDH(canister_secret, sender_pubkey),
//!   the sender's x-only pubkey lifted with even parity (BIP-340 convention);
//! - message keys = HKDF-expand(conversation_key, info=nonce, L=76)
//!   → chacha_key(32) ‖ chacha_nonce(12) ‖ hmac_key(32);
//! - mac = HMAC-SHA256(hmac_key, nonce ‖ ciphertext), constant-time verified;
//! - ciphertext = ChaCha20(12-byte nonce) over the padded plaintext:
//!   `u16be plaintext_len ‖ plaintext ‖ zero-padding` up to calc_padded_len.
//!
//! Pure CPU, no IC runtime — unit-testable with plain `cargo test`. Validated
//! against the official NIP-44 v2 test vectors (sha256
//! 269ed0f6…ce25040, the checksum pinned in NIP-44 §"Tests and code").
//!
//! Key-material discipline (FU-195-C): error strings name the failed check,
//! never the bytes involved.

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use bitcoin::secp256k1::ecdh::shared_secret_point;
use bitcoin::secp256k1::{Parity, PublicKey, SecretKey, XOnlyPublicKey};
use chacha20::ChaCha20;
use chacha20::cipher::{KeyIvInit, StreamCipher};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;

const VERSION: u8 = 0x02;
const NONCE_LEN: usize = 32;
const MAC_LEN: usize = 32;
/// version(1) + nonce(32) + shortest padded ciphertext(32) + mac(32).
const MIN_PAYLOAD_LEN: usize = 1 + NONCE_LEN + 32 + MAC_LEN;
/// Padded plaintext is u16-prefixed, so 2 + 65535 is the hard ceiling.
const MAX_PADDED_LEN: usize = 2 + u16::MAX as usize;

/// Decrypts a NIP-44 v2 `payload` (base64) addressed to `secret_key` by
/// `sender_pubkey_hex` (x-only hex, 64 chars), returning the plaintext bytes.
pub fn decrypt(payload: &str, secret_key: &SecretKey, sender_pubkey_hex: &str) -> Result<Vec<u8>, String> {
    let raw = BASE64
        .decode(payload)
        .map_err(|_| "payload is not valid base64".to_string())?;
    if raw.len() < MIN_PAYLOAD_LEN {
        return Err(format!("payload too short: {} bytes", raw.len()));
    }
    if raw[0] != VERSION {
        return Err(format!("unknown payload version {:#04x}", raw[0]));
    }
    let (nonce, rest) = raw[1..].split_at(NONCE_LEN);
    let (ciphertext, mac) = rest.split_at(rest.len() - MAC_LEN);
    if ciphertext.len() > MAX_PADDED_LEN {
        return Err(format!("ciphertext too long: {} bytes", ciphertext.len()));
    }

    let sender_xonly_bytes = hex_decode_32(sender_pubkey_hex)?;
    let sender_xonly =
        XOnlyPublicKey::from_slice(&sender_xonly_bytes).map_err(|_| "invalid sender pubkey".to_string())?;
    let conversation_key = conversation_key(secret_key, &sender_xonly);
    let (chacha_key, chacha_nonce, hmac_key) = message_keys(&conversation_key, nonce);

    // MAC before decrypt — constant-time comparison via the hmac crate.
    Hmac::<Sha256>::new_from_slice(&hmac_key)
        .expect("HMAC accepts any key length")
        .chain_update(nonce)
        .chain_update(ciphertext)
        .verify_slice(mac)
        .map_err(|_| "mac mismatch".to_string())?;

    let mut padded = ciphertext.to_vec();
    ChaCha20::new((&chacha_key).into(), (&chacha_nonce).into()).apply_keystream(&mut padded);
    unpad(&padded)
}

/// conversation_key = HKDF-extract(salt="nip44-v2", ikm=ecdh_x). Uses
/// `shared_secret_point` (raw uncompressed point, x ‖ y) rather than
/// `SharedSecret::new` — the latter applies libsecp256k1's default sha256
/// hash over the point, which is NOT the NIP-44 construction.
fn conversation_key(secret_key: &SecretKey, sender_xonly: &XOnlyPublicKey) -> [u8; 32] {
    let sender_full = PublicKey::from_x_only_public_key(*sender_xonly, Parity::Even);
    let point = shared_secret_point(&sender_full, secret_key);
    // HKDF-extract only — the PRK itself IS the conversation key.
    let (prk, _) = Hkdf::<Sha256>::extract(Some(b"nip44-v2"), &point[..32]);
    let mut out = [0u8; 32];
    out.copy_from_slice(&prk);
    out
}

/// HKDF-expand(conversation_key, info=nonce, L=76) → chacha_key ‖
/// chacha_nonce ‖ hmac_key.
fn message_keys(conversation_key: &[u8; 32], nonce: &[u8]) -> ([u8; 32], [u8; 12], [u8; 32]) {
    let mut okm = [0u8; 76];
    Hkdf::<Sha256>::from_prk(conversation_key)
        .expect("a 32-byte key is a valid HKDF PRK")
        .expand(nonce, &mut okm)
        .expect("76 bytes is a valid HKDF output length");
    let mut chacha_key = [0u8; 32];
    let mut chacha_nonce = [0u8; 12];
    let mut hmac_key = [0u8; 32];
    chacha_key.copy_from_slice(&okm[..32]);
    chacha_nonce.copy_from_slice(&okm[32..44]);
    hmac_key.copy_from_slice(&okm[44..76]);
    (chacha_key, chacha_nonce, hmac_key)
}

/// NIP-44 v2 unpadding: `u16be len ‖ plaintext ‖ zeros` where the buffer
/// length must be exactly `2 + calc_padded_len(len)`.
fn unpad(padded: &[u8]) -> Result<Vec<u8>, String> {
    if padded.len() < 2 + 1 {
        return Err("padded plaintext too short".to_string());
    }
    let len = u16::from_be_bytes([padded[0], padded[1]]) as usize;
    if len == 0 {
        return Err("zero-length plaintext".to_string());
    }
    if padded.len() != 2 + calc_padded_len(len) {
        return Err("padded length does not match length prefix".to_string());
    }
    if padded[2 + len..].iter().any(|&b| b != 0) {
        return Err("non-zero padding bytes".to_string());
    }
    Ok(padded[2..2 + len].to_vec())
}

/// NIP-44 v2 padded-length schedule (spec §"Padding").
fn calc_padded_len(len: usize) -> usize {
    if len <= 32 {
        return 32;
    }
    let next_power = 1 << ((len - 1).ilog2() + 1);
    let chunk = if next_power <= 256 { 32 } else { next_power / 8 };
    chunk * ((len - 1) / chunk + 1)
}

fn hex_decode_32(s: &str) -> Result<[u8; 32], String> {
    if s.len() != 64 {
        return Err(format!("expected 64-char hex pubkey, got {} chars", s.len()));
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|_| "invalid hex in pubkey".to_string())?;
    }
    Ok(out)
}

/// Test-only NIP-44 v2 encrypt — the mirror of `decrypt`, so roundtrip and
/// tamper tests (here and in `lib.rs`) can build payloads without an
/// external tool.
#[cfg(test)]
pub(crate) fn encrypt_for_test(plaintext: &[u8], secret_key: &SecretKey, recipient_xonly: &XOnlyPublicKey, nonce: &[u8; 32]) -> String {
    let conversation_key = conversation_key(secret_key, recipient_xonly);
    let (chacha_key, chacha_nonce, hmac_key) = message_keys(&conversation_key, nonce);
    let mut padded = Vec::with_capacity(2 + calc_padded_len(plaintext.len()));
    padded.extend_from_slice(&(plaintext.len() as u16).to_be_bytes());
    padded.extend_from_slice(plaintext);
    padded.resize(2 + calc_padded_len(plaintext.len()), 0);
    let mut ciphertext = padded;
    ChaCha20::new((&chacha_key).into(), (&chacha_nonce).into()).apply_keystream(&mut ciphertext);
    let mac = Hmac::<Sha256>::new_from_slice(&hmac_key)
        .expect("HMAC accepts any key length")
        .chain_update(nonce)
        .chain_update(&ciphertext)
        .finalize()
        .into_bytes();
    let mut payload = Vec::with_capacity(1 + 32 + ciphertext.len() + 32);
    payload.push(VERSION);
    payload.extend_from_slice(nonce);
    payload.extend_from_slice(&ciphertext);
    payload.extend_from_slice(&mac);
    BASE64.encode(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::secp256k1::{Keypair, Secp256k1};

    fn secret_key(hex: &str) -> SecretKey {
        let bytes = hex_decode_32(hex).unwrap();
        SecretKey::from_slice(&bytes).unwrap()
    }

    fn xonly_hex_of(secret_key: &SecretKey) -> String {
        let secp = Secp256k1::new();
        let keypair = Keypair::from_secret_key(&secp, secret_key);
        let (xonly, _parity) = keypair.x_only_public_key();
        xonly.serialize().iter().map(|b| format!("{b:02x}")).collect()
    }

    /// Official NIP-44 v2 vectors (nip44.vectors.json, sha256
    /// 269ed0f69e4c192512cc779e78c555090cebc7c785b609e338a62afc3ce25040 —
    /// the checksum pinned in NIP-44 §"Tests and code"), group
    /// `valid.encrypt_decrypt`, entries 0, 1 and 2. Decrypt with sec2 as the
    /// recipient; the sender pubkey is pub1, derived from sec1 in-test.
    struct Vector {
        sec1: &'static str,
        sec2: &'static str,
        conversation_key: &'static str,
        payload: &'static str,
        plaintext: &'static str,
    }

    const VECTORS: [Vector; 3] = [
        Vector {
            sec1: "0000000000000000000000000000000000000000000000000000000000000001",
            sec2: "0000000000000000000000000000000000000000000000000000000000000002",
            conversation_key: "c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d",
            payload: "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb",
            plaintext: "a",
        },
        Vector {
            sec1: "0000000000000000000000000000000000000000000000000000000000000002",
            sec2: "0000000000000000000000000000000000000000000000000000000000000001",
            conversation_key: "c41c775356fd92eadc63ff5a0dc1da211b268cbea22316767095b2871ea1412d",
            payload: "AvAAAAAAAAAAAAAAAAAAAPAAAAAAAAAAAAAAAAAAAAAPSKSK6is9ngkX2+cSq85Th16oRTISAOfhStnixqZziKMDvB0QQzgFZdjLTPicCJaV8nDITO+QfaQ61+KbWQIOO2Yj",
            // U+1F355 U+1FAC3 — exercises the multi-byte utf-8 path.
            plaintext: "\u{1f355}\u{1fac3}",
        },
        Vector {
            sec1: "5c0c523f52a5b6fad39ed2403092df8cebc36318b39383bca6c00808626fab3a",
            sec2: "4b22aa260e4acb7021e32f38a6cdf4b673c6a277755bfce287e370c924dc936d",
            conversation_key: "3e2b52a63be47d34fe0a80e34e73d436d6963bc8f39827f327057a9986c20a45",
            payload: "ArY1I2xC2yDwIbuNHN/1ynXdGgzHLqdCrXUPMwELJPc7s7JqlCMJBAIIjfkpHReBPXeoMCyuClwgbT419jUWU1PwaNl4FEQYKCDKVJz+97Mp3K+Q2YGa77B6gpxB/lr1QgoqpDf7wDVrDmOqGoiPjWDqy8KzLueKDcm9BVP8xeTJIxs=",
            plaintext: "\u{8868}\u{30dd}\u{3042}A\u{9dd7}\u{152}\u{e9}\u{ff22}\u{900d}\u{dc}\u{df}\u{aa}\u{105}\u{f1}\u{4e02}\u{3400}\u{20000}",
        },
    ];

    #[test]
    fn official_vectors_decrypt_to_known_plaintexts() {
        for v in &VECTORS {
            let recipient = secret_key(v.sec2);
            let sender_pub = xonly_hex_of(&secret_key(v.sec1));
            // The ECDH half must land on the vector's conversation_key too.
            let sender_xonly = XOnlyPublicKey::from_slice(&hex_decode_32(&sender_pub).unwrap()).unwrap();
            assert_eq!(
                conversation_key(&recipient, &sender_xonly).iter().map(|b| format!("{b:02x}")).collect::<String>(),
                v.conversation_key
            );
            let plaintext = decrypt(v.payload, &recipient, &sender_pub).unwrap();
            assert_eq!(String::from_utf8(plaintext).unwrap(), v.plaintext);
        }
    }

    #[test]
    fn rejects_mac_mismatch() {
        let v = &VECTORS[0];
        let mut raw = BASE64.decode(v.payload).unwrap();
        // Flip one ciphertext bit — the MAC no longer matches.
        raw[40] ^= 0x01;
        let payload = BASE64.encode(raw);
        let err = decrypt(&payload, &secret_key(v.sec2), &xonly_hex_of(&secret_key(v.sec1))).unwrap_err();
        assert_eq!(err, "mac mismatch");
    }

    #[test]
    fn rejects_decryption_with_wrong_key() {
        let v = &VECTORS[0];
        let wrong_recipient = secret_key("0000000000000000000000000000000000000000000000000000000000000003");
        assert!(decrypt(v.payload, &wrong_recipient, &xonly_hex_of(&secret_key(v.sec1))).is_err());
    }

    #[test]
    fn rejects_garbage_and_truncated_payloads() {
        let v = &VECTORS[0];
        let recipient = secret_key(v.sec2);
        let sender_pub = xonly_hex_of(&secret_key(v.sec1));
        // Not base64 at all.
        assert!(decrypt("!!! not base64 !!!", &recipient, &sender_pub).is_err());
        // Valid base64, but shorter than the minimum wire length.
        let raw = BASE64.decode(v.payload).unwrap();
        assert!(decrypt(&BASE64.encode(&raw[..raw.len() / 2]), &recipient, &sender_pub).is_err());
        // Wrong version byte (NIP-44 invalid vector "unknown encryption version").
        let mut bad_version = raw.clone();
        bad_version[0] = 0x03;
        let err = decrypt(&BASE64.encode(bad_version), &recipient, &sender_pub).unwrap_err();
        assert!(err.contains("version"), "{err}");
    }

    #[test]
    fn rejects_malformed_pubkeys() {
        let v = &VECTORS[0];
        let recipient = secret_key(v.sec2);
        assert!(decrypt(v.payload, &recipient, "deadbeef").is_err());
        assert!(decrypt(v.payload, &recipient, "zz").is_err());
    }

    #[test]
    fn unpad_rejects_bad_padding() {
        // Non-zero padding byte.
        let mut padded = vec![0, 3, b'a', b'b', b'c'];
        padded.resize(2 + 32, 0);
        padded[10] = 1;
        assert!(unpad(&padded).is_err());
        // Length prefix contradicts buffer length.
        let mut padded = vec![0, 3, b'a', b'b', b'c'];
        padded.resize(2 + 64, 0);
        assert!(unpad(&padded).is_err());
        // Zero-length plaintext is invalid per spec.
        assert!(unpad(&[0, 0]).is_err());
        // Too short to even hold a one-byte plaintext.
        assert!(unpad(&[0, 1]).is_err());
    }

    #[test]
    fn calc_padded_len_matches_spec_boundaries() {
        assert_eq!(calc_padded_len(1), 32);
        assert_eq!(calc_padded_len(32), 32);
        assert_eq!(calc_padded_len(33), 64);
        assert_eq!(calc_padded_len(100), 128);
        assert_eq!(calc_padded_len(256), 256);
        assert_eq!(calc_padded_len(257), 320);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let secp = Secp256k1::new();
        let sender = secret_key("1111111111111111111111111111111111111111111111111111111111111111");
        let recipient = secret_key("2222222222222222222222222222222222222222222222222222222222222222");
        let recipient_pub = Keypair::from_secret_key(&secp, &recipient).x_only_public_key().0;
        let nonce = [42u8; 32];
        // Short (min padding bucket) and long (multi-chunk) plaintexts.
        for plaintext in [b"{}".as_slice(), &vec![b'x'; 1000]] {
            let payload = encrypt_for_test(plaintext, &sender, &recipient_pub, &nonce);
            assert_eq!(decrypt(&payload, &recipient, &xonly_hex_of(&sender)).unwrap(), plaintext);
        }
    }
}
