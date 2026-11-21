/**
 * NIP-P (Phase 5 §5.2) — Zod schema validation for every private-commerce
 * envelope. Each example is lifted directly from the spec
 * (docs/nip-publications/NIP-P-private-commerce.md) so a spec change that
 * breaks the wire format fails this test.
 */
import { describe, it, expect } from 'vitest'
import {
  PrivateOfferEnvelopeSchema,
  PrivateCooperationEnvelopeSchema,
  PrivateMilestoneEnvelopeSchema,
  PrivateVerdictEnvelopeSchema,
  PrivateCounterEnvelopeSchema,
  PrivateMessageEnvelopeSchema,
  PrivateCommerceEnvelopeSchema,
} from '../lib/enums'

const PK = '0'.repeat(64)

describe('NIP-P PrivateOfferEnvelope', () => {
  it('accepts a spec-shaped offer', () => {
    const env = {
      type: 'offer', offerId: 'offer-abc', title: 'Brand identity', priceSats: 50000,
      creatorPubkey: PK, timestamp: 1715000000,
    }
    expect(PrivateOfferEnvelopeSchema.parse(env).priceSats).toBe(50000)
  })
  it('rejects non-positive price + bad pubkey', () => {
    expect(() => PrivateOfferEnvelopeSchema.parse({ type: 'offer', offerId: 'x', title: 't', priceSats: 0, creatorPubkey: 'nothex', timestamp: 1 })).toThrow()
  })
})

describe('NIP-P PrivateCooperationEnvelope', () => {
  it('accepts a proposal carrying the NIP-C tag set', () => {
    const env = {
      type: 'cooperation_proposal', subType: 'proposal', cooperationId: 'coop-xyz',
      title: 'Landing page', budgetSats: 250000, initiatorPubkey: PK, partnerPubkey: PK,
      nip_c: { kind: 30414, tags: [['d', 'coop-xyz']], content: '' }, timestamp: 1,
    }
    expect(PrivateCooperationEnvelopeSchema.parse(env).subType).toBe('proposal')
  })
  it('rejects an invalid subType', () => {
    expect(() => PrivateCooperationEnvelopeSchema.parse({
      type: 'cooperation_proposal', subType: 'bogus', cooperationId: 'c', title: 't',
      budgetSats: 1, initiatorPubkey: PK, partnerPubkey: PK, nip_c: { kind: 30414, tags: [], content: '' }, timestamp: 1,
    })).toThrow()
  })
})

describe('NIP-P PrivateMilestoneEnvelope', () => {
  it('requires the colabonate-milestone marker', () => {
    const env = {
      type: 'milestone', t: 'colabonate-milestone', cooperationId: 'c', milestoneId: 'm',
      milestoneIndex: 0, status: 'COMPLETED', amountSats: 1000, released: false,
      nip_c: { kind: 30415, tags: [], content: '' }, timestamp: 1,
    }
    expect(PrivateMilestoneEnvelopeSchema.parse(env).status).toBe('COMPLETED')
  })
  it('rejects a wrong marker', () => {
    expect(() => PrivateMilestoneEnvelopeSchema.parse({ ...{
      type: 'milestone', t: 'something-else', cooperationId: 'c', milestoneId: 'm',
      milestoneIndex: 0, status: 'COMPLETED', amountSats: 1000, released: false,
      nip_c: { kind: 30415, tags: [], content: '' }, timestamp: 1,
    } })).toThrow()
  })
})

describe('NIP-P PrivateVerdictEnvelope', () => {
  it('accepts the three valid outcomes', () => {
    for (const outcome of ['RELEASE', 'CANCEL', 'SPLIT'] as const) {
      const env = { type: 'verdict', ticketId: 't', outcome, reasoning: 'r', arbiterPubkey: PK, verdictNostrEventId: 'evt', timestamp: 1 }
      expect(PrivateVerdictEnvelopeSchema.parse(env).outcome).toBe(outcome)
    }
  })
  it('rejects an unknown outcome', () => {
    expect(() => PrivateVerdictEnvelopeSchema.parse({ type: 'verdict', ticketId: 't', outcome: 'REFUND', reasoning: 'r', arbiterPubkey: PK, verdictNostrEventId: 'e', timestamp: 1 })).toThrow()
  })
})

describe('NIP-P PrivateCounter + PrivateMessage', () => {
  it('counter requires positive counterPriceSats', () => {
    expect(PrivateCounterEnvelopeSchema.parse({ type: 'counter', offerId: 'o', counterPriceSats: 45000 }).counterPriceSats).toBe(45000)
    expect(() => PrivateCounterEnvelopeSchema.parse({ type: 'counter', offerId: 'o', counterPriceSats: 0 })).toThrow()
  })
  it('message requires a non-empty body', () => {
    expect(PrivateMessageEnvelopeSchema.parse({ type: 'message', message: 'hi' }).message).toBe('hi')
    expect(() => PrivateMessageEnvelopeSchema.parse({ type: 'message', message: '' })).toThrow()
  })
})

describe('NIP-P discriminated union', () => {
  it('routes by type field', () => {
    const offer = { type: 'offer', offerId: 'o', title: 't', priceSats: 1, creatorPubkey: PK, timestamp: 1 }
    const verdict = { type: 'verdict', ticketId: 't', outcome: 'RELEASE', reasoning: 'r', arbiterPubkey: PK, verdictNostrEventId: 'e', timestamp: 1 }
    expect((PrivateCommerceEnvelopeSchema.parse(offer) as { type: string }).type).toBe('offer')
    expect((PrivateCommerceEnvelopeSchema.parse(verdict) as { type: string }).type).toBe('verdict')
  })
  it('rejects an unknown discriminator', () => {
    expect(() => PrivateCommerceEnvelopeSchema.parse({ type: 'invoice', foo: 1 })).toThrow()
  })
})
