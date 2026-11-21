/**
 * Contract pins for the FU-617 event relay (review findings 2026-09-02):
 * 1. the app's `EscrowAuthEventWire` JSON shape round-trips through the server's
 *    `NostrAuthEventSchema` + `decodeEvent` (cross-package pin — a rename on either side
 *    fails here, not as a runtime 400),
 * 2. the handwritten IDL mirror stays honest against the checked-in
 *    `icp_escrow_canister.did` (method surface + new record fields).
 * Also pins the escrow kind registration in kind-mapping (30416/30417 — 30410/30411 are
 * Credential/Review per ADR-277 D0; a collision would break the canister's kind-based
 * domain separation).
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { NostrAuthEventSchema, decodeEvent } from './nostr-auth-event'
import { escrowCanisterIdlFactory } from '../services/escrow-canister-client'
import { NOSTR_KINDS } from '../services/kind-mapping'// Mirrors apps/colabonate-app/src/lib/escrow-auth-events.ts `EscrowAuthEventWire` — the
// exact JSON a signed-in client posts to /api/escrow-trades*.
const APP_WIRE_EVENT = {
  id: 'ab'.repeat(32),
  pubkey: 'ab'.repeat(32),
  createdAt: 1_730_000_000,
  kind: 30_417,
  tags: [['trade', '7'], ['action', 'release_milestone'], ['i', '1']],
  content: '',
  sig: 'cd'.repeat(64),
}

describe('escrow kind registration (kind-mapping ↔ canister sig.rs)', () => {
  it('escrow kinds are 30416/30417 and collide with nothing allocated', () => {
    expect(NOSTR_KINDS.ESCROW_TERMS).toBe(30_416)
    expect(NOSTR_KINDS.ESCROW_ACTION).toBe(30_417)
    // The collision that forced the renumbering (review finding 2026-09-02): 30410/30411
    // are Credential/Review (ADR-277 D0) — the escrow kinds must never fall back onto them.
    expect(NOSTR_KINDS.CREDENTIAL_NEW).toBe(30_410)
    expect(NOSTR_KINDS.REVIEW_NEW).toBe(30_411)
    const all = Object.values(NOSTR_KINDS)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('NostrAuthEventSchema ↔ app wire shape', () => {
  it('accepts and decodes an app-shaped EscrowAuthEventWire', () => {
    const parsed = NostrAuthEventSchema.safeParse(APP_WIRE_EVENT)
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new Error(parsed.error.message)
    const decoded = decodeEvent(parsed.data)
    expect(decoded.id).toBe(APP_WIRE_EVENT.id)
    expect(decoded.createdAt).toBe(APP_WIRE_EVENT.createdAt)
    expect(decoded.tags).toEqual(APP_WIRE_EVENT.tags)
    expect(decoded.sig).toEqual(new Uint8Array(64).fill(0xcd))
  })

  it('rejects a camelCase↔snake_case or hex drift', () => {
    expect(NostrAuthEventSchema.safeParse({ ...APP_WIRE_EVENT, created_at: 1 }).success).toBe(false)
    expect(NostrAuthEventSchema.safeParse({ ...APP_WIRE_EVENT, sig: 'zz'.repeat(64) }).success).toBe(false)
    expect(NostrAuthEventSchema.safeParse({ ...APP_WIRE_EVENT, id: 'ab'.repeat(31) }).success).toBe(false)
  })
})

describe('IDL mirror ↔ icp_escrow_canister.did', () => {
  const did = readFileSync(
    new URL('../../../packages/icp-escrow-canister/icp_escrow_canister.did', import.meta.url),
    'utf8',
  )

  it('.did defines NostrAuthEvent with the full wire record', () => {
    for (const field of ['id : text', 'pubkey : text', 'created_at : nat64', 'kind : nat32', 'tags : vec vec text', 'content : text', 'sig : blob']) {
      expect(did).toContain(field)
    }
    expect(did).toContain('type NostrAuthEvent = record')
  })

  it('.did wires the event args and the certified read', () => {
    expect(did).toContain('open_dispute : (nat64, NostrAuthEvent)')
    expect(did).toContain('release_milestone : (nat64, nat32, NostrAuthEvent)')
    expect(did).toContain('buyer_terms_event : NostrAuthEvent')
    expect(did).toContain('seller_terms_event : NostrAuthEvent')
    expect(did).toContain('get_trade_certified : (nat64) -> (CertifiedTradeView) query')
  })

  it('IDL factory exposes exactly the .did service method names', async () => {
    const { IDL } = await import('@icp-sdk/core/candid')
    const service = escrowCanisterIdlFactory({ IDL })
    const factoryMethods = (service as unknown as { _fields: Array<[string, unknown]> })._fields
      .map(([name]) => name)
      .sort()
    // Parse `name : (...) -> ...` lines from the .did service block.
    const didService = did.slice(did.indexOf('service : '))
    const didMethods = Array.from(didService.matchAll(/^\s{2}(\w+) : \(/gm), (m) => m[1] ?? '').sort()
    expect(factoryMethods).toEqual(didMethods)
  })
})
