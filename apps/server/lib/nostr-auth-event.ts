/**
 * NostrAuthEvent wire validation (FU-617, ADR-357 D3) — shared between the escrow-trade
 * routes and tests so the app's `EscrowAuthEventWire` shape (camelCase, hex `sig`) and this
 * zod schema are pinned together by a round-trip test instead of failing only at runtime 400.
 */

import { z } from 'zod'

export const HEX_PUBKEY = z.string().regex(/^[0-9a-f]{64}$/i, 'expected 64-char hex pubkey')
export const HEX_SIG = z.string().regex(/^[0-9a-f]{128}$/i, 'expected 128-char hex signature (64-byte BIP-340)')

// FU-617 (ADR-357 D3): authorization payloads are signed Nostr events — the only shape
// NIP-07/NIP-46 signers can produce. `sig` arrives as hex from the client and is decoded
// to bytes before the canister relay; the canister recomputes the NIP-01 event id and
// verifies BIP-340 over it. Kind/tags are domain separation — not validated here beyond
// shape, the canister is the verifier (single source of truth). `.strict()`: a snake_case
// field sneaking in from the app's wire shape (camelCase) must fail here, not pass silently
// stripped (the cross-package pin test depends on it).
export const NostrAuthEventSchema = z.object({
  id: HEX_PUBKEY, // event id: 32-byte hex (same shape as a pubkey)
  pubkey: HEX_PUBKEY,
  createdAt: z.number().int().nonnegative(),
  kind: z.number().int().nonnegative(),
  tags: z.array(z.array(z.string().min(1)).min(1)).max(32),
  content: z.string().max(8192),
  sig: HEX_SIG,
}).strict()

export type NostrAuthEventJson = z.infer<typeof NostrAuthEventSchema>

export function decodeHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

/** Route-level JSON event → server event (sig hex → bytes). */
export function decodeEvent(event: NostrAuthEventJson): import('../services/escrow-canister-client.js').EscrowNostrAuthEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.createdAt,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: decodeHex(event.sig),
  }
}
