import { describe, it, expect } from 'vitest'
import {
  computePayloadCommitment,
  verifyPayloadCommitment,
  canonicalizePayload,
  buildTicketCreatedTags,
  type CommercialPayload,
} from './index.js'

// ADR-152 Sprint 2b: Tier-1 payload_commitment end-to-end proof.
//
// Invariant: a ticket created with visibility=1 MUST carry a payload_commitment
// tag whose value is the SHA-256 of the canonical commercial payload.
// verifyPayloadCommitment(payload, tag) must return true for the original
// payload and false for any mutation, so the arbitrator can detect tampering.

const SAMPLE_PAYLOAD: CommercialPayload = {
  offerId: 'offer-abc123',
  title: 'Premium consulting service',
  quantity: 2,
  priceSats: 50000,
  shippingAddress: '123 Main St, Berlin',
}

describe('computePayloadCommitment', () => {
  it('produces a 64-char lowercase hex SHA-256', async () => {
    const commitment = await computePayloadCommitment(SAMPLE_PAYLOAD)
    expect(commitment).toMatch(/^[a-f0-9]{64}$/)
  })

  it('is deterministic for the same payload', async () => {
    const a = await computePayloadCommitment(SAMPLE_PAYLOAD)
    const b = await computePayloadCommitment(SAMPLE_PAYLOAD)
    expect(a).toBe(b)
  })

  it('is order-independent (canonical serialization)', async () => {
    const shuffled: CommercialPayload = {
      priceSats: SAMPLE_PAYLOAD.priceSats,
      offerId: SAMPLE_PAYLOAD.offerId,
      shippingAddress: SAMPLE_PAYLOAD.shippingAddress,
      title: SAMPLE_PAYLOAD.title,
      quantity: SAMPLE_PAYLOAD.quantity,
    }
    const original = await computePayloadCommitment(SAMPLE_PAYLOAD)
    const reordered = await computePayloadCommitment(shuffled)
    expect(original).toBe(reordered)
  })

  it('differs for distinct payloads', async () => {
    const c1 = await computePayloadCommitment(SAMPLE_PAYLOAD)
    const c2 = await computePayloadCommitment({ ...SAMPLE_PAYLOAD, priceSats: 99999 })
    expect(c1).not.toBe(c2)
  })
})

describe('canonicalizePayload', () => {
  it('sorts keys alphabetically and skips null/undefined', () => {
    const result = canonicalizePayload({ offerId: 'o1', title: 'T', notes: undefined })
    expect(result).toBe('offerId:"o1"|title:"T"')
  })
})

describe('verifyPayloadCommitment — Tier-1 round-trip (ADR-152)', () => {
  it('returns true when the disclosed payload matches the commitment', async () => {
    const commitment = await computePayloadCommitment(SAMPLE_PAYLOAD)
    const verified = await verifyPayloadCommitment(SAMPLE_PAYLOAD, commitment)
    expect(verified).toBe(true)
  })

  it('returns false for a tampered priceSats', async () => {
    const commitment = await computePayloadCommitment(SAMPLE_PAYLOAD)
    const tampered: CommercialPayload = { ...SAMPLE_PAYLOAD, priceSats: 1 }
    const verified = await verifyPayloadCommitment(tampered, commitment)
    expect(verified).toBe(false)
  })

  it('returns false for an injected extra field', async () => {
    const commitment = await computePayloadCommitment(SAMPLE_PAYLOAD)
    const injected: CommercialPayload = { ...SAMPLE_PAYLOAD, contactData: 'attacker@evil.com' }
    const verified = await verifyPayloadCommitment(injected, commitment)
    expect(verified).toBe(false)
  })

  it('returns false for a wrong commitment string', async () => {
    const verified = await verifyPayloadCommitment(SAMPLE_PAYLOAD, 'a'.repeat(64))
    expect(verified).toBe(false)
  })
})

describe('buildTicketCreatedTags — payload_commitment tag for Tier-1', () => {
  const baseInput = {
    id: 'ticket-t1',
    offerId: 'offer-abc123',
    buyerPubkey: 'buyer-pk',
    sellerPubkey: 'seller-pk',
    status: 'PENDING',
  }

  it('omits payload_commitment tag for Tier-0 (public) tickets', () => {
    const tags = buildTicketCreatedTags({ ...baseInput, visibility: 0 })
    const tag = tags.find(t => t[0] === 'payload_commitment')
    expect(tag).toBeUndefined()
  })

  it('includes payload_commitment tag when supplied for Tier-1', async () => {
    const commitment = await computePayloadCommitment(SAMPLE_PAYLOAD)
    const tags = buildTicketCreatedTags({ ...baseInput, visibility: 1, payloadCommitment: commitment })
    const tag = tags.find(t => t[0] === 'payload_commitment')
    expect(tag).toEqual(['payload_commitment', commitment])
  })

  it('the included commitment verifies against the original payload', async () => {
    const commitment = await computePayloadCommitment(SAMPLE_PAYLOAD)
    const tags = buildTicketCreatedTags({ ...baseInput, visibility: 1, payloadCommitment: commitment })
    const commitmentTag = tags.find(t => t[0] === 'payload_commitment')
    expect(commitmentTag).toBeDefined()
    const verified = await verifyPayloadCommitment(SAMPLE_PAYLOAD, commitmentTag![1])
    expect(verified).toBe(true)
  })

  it('visibility tag is set to "1" for Tier-1', () => {
    const tags = buildTicketCreatedTags({ ...baseInput, visibility: 1 })
    const visibilityTag = tags.find(t => t[0] === 'visibility')
    expect(visibilityTag).toEqual(['visibility', '1'])
  })
})
