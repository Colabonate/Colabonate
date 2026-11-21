// scripts/escrow-dao-verdict-sign.ts — Offline M0 DAO-verdict signer (ADR-364 D5).
//
// Produces the raw-digest BIP-340 Schnorr signature the escrow canister's `submit_dao_verdict`
// verifies against `sig::DAO_PUBKEY_HEX`. A DAO verdict is NOT a Nostr event — it is a schnorr
// signature over the canonical message below, exactly what `verify_dao_verdict` checks on-chain
// (see packages/icp-escrow-canister/src/sig.rs).
//
// Usage:
//   ESCROW_DAO_NSEC=<64-hex nsec> npx tsx scripts/escrow-dao-verdict-sign.ts <trade_id> <buyer_bps> <seller_bps>
//
// The nsec is read from the environment ONLY and is never written to stdout or any log. The
// signature is printed as hex, ready for `submit_dao_verdict`'s `dao_signature` blob.

import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

// ADR-364 D5: the M0 bootstrap DAO key (FOUNDATION_DAO_ADMIN_PUBKEY). Compared against the key
// derived from the provided nsec as a loud safety check — the signer must be the same key the
// canister bakes, otherwise the verdict would be rejected on-chain.
const EXPECTED_DAO_PUBKEY = '96013e999b18179e88452455144b438b1e078e1fbcd1a2e7d26c3f8975b0376b'

function main(): void {
  const [tradeIdRaw, buyerBpsRaw, sellerBpsRaw] = process.argv.slice(2)
  const tradeId = Number(tradeIdRaw)
  const buyerBps = Number(buyerBpsRaw)
  const sellerBps = Number(sellerBpsRaw)
  const nsec = process.env.ESCROW_DAO_NSEC ?? ''

  if (!Number.isInteger(tradeId) || tradeId < 0) {
    console.error('usage: ESCROW_DAO_NSEC=<nsec> npx tsx scripts/escrow-dao-verdict-sign.ts <trade_id> <buyer_bps> <seller_bps>')
    process.exit(1)
  }
  if (!Number.isInteger(buyerBps) || buyerBps < 0 || buyerBps > 10_000 || !Number.isInteger(sellerBps) || sellerBps < 0 || sellerBps > 10_000) {
    console.error('buyer_bps and seller_bps must be 0..10000')
    process.exit(1)
  }
  if (buyerBps + sellerBps !== 10_000) {
    console.error('buyer_bps + seller_bps must equal 10000')
    process.exit(1)
  }
  if (!/^[0-9a-fA-F]{64}$/.test(nsec)) {
    console.error('ESCROW_DAO_NSEC must be a 64-char hex secret (never commit or log it)')
    process.exit(1)
  }

  const message = `colabonate-escrow-v1:submit_dao_verdict:${tradeId}:${buyerBps}:${sellerBps}`
  const digest = sha256(new TextEncoder().encode(message))
  const seckey = hexToBytes(nsec)
  const pubkey = schnorr.getPublicKey(seckey)
  const signature = schnorr.sign(digest, seckey)

  if (bytesToHex(pubkey).toLowerCase() !== EXPECTED_DAO_PUBKEY) {
    console.warn(`WARNING: signing key ${bytesToHex(pubkey)} != baked DAO key ${EXPECTED_DAO_PUBKEY} — the canister will reject this verdict.`)
  }

  console.log(`message:    ${message}`)
  console.log(`signer:     ${bytesToHex(pubkey)}`)
  console.log(`signature:  ${bytesToHex(signature)}`)
}

main()
