import { describe, it, expect } from 'vitest'
import { buildTicketStatusTags } from './nostr-relay.js'
import { toEscrowState } from '../routes/escrow.js'

// Verifies the NIP-115 checkout-layer additions (ADR-149): payment-agnostic `payment` tag
// and the public 4-state `escrow_status` projection. The consume path
// (nostr-ticket-listener) reads only ticket/d/status, so these tags are purely additive.

function findTag(tags: string[][], name: string): string[] | undefined {
  return tags.find(t => t[0] === name)
}

describe('toEscrowState — 10 internal states project onto 4 public states', () => {
  it('collapses all funds-locked phases to HELD', () => {
    for (const s of [
      'INITIATED',
      'PHASE_1_PENDING',
      'RESERVED',
      'PHASE_2_PENDING',
      'DELIVERY_STARTED',
      'PHASE_3_PENDING',
      'DELIVERY_CONFIRMED',
    ]) {
      expect(toEscrowState(s)).toBe('HELD')
    }
  })

  it('maps terminal states', () => {
    expect(toEscrowState('RELEASED')).toBe('RELEASED')
    expect(toEscrowState('CANCELLED')).toBe('REFUNDED')
    expect(toEscrowState('DISPUTED')).toBe('DISPUTED')
  })

  it('returns null for unknown/absent status', () => {
    expect(toEscrowState(undefined)).toBeNull()
    expect(toEscrowState(null)).toBeNull()
    expect(toEscrowState('NONSENSE')).toBeNull()
  })
})

describe('buildTicketStatusTags — payment-agnostic tag', () => {
  const base = {
    id: 't1',
    status: 'COMPLETED',
    buyerPubkey: 'buyer',
    sellerPubkey: 'seller',
  }

  it('omits payment tag when no proof (preimage) present', () => {
    const tags = buildTicketStatusTags({ ...base, invoice: 'lnbc1...' })
    expect(findTag(tags, 'payment')).toBeUndefined()
  })

  it('defaults to lightning and carries the preimage as proof', () => {
    const tags = buildTicketStatusTags({ ...base, preimage: 'deadbeef', amountSats: 21000 })
    expect(findTag(tags, 'payment')).toEqual(['payment', 'lightning', 'deadbeef', '21000', 'sat'])
  })

  it('uses an explicit payment type when given', () => {
    const tags = buildTicketStatusTags({
      ...base,
      preimage: 'token123',
      paymentType: 'cashu',
      amountSats: 5000,
    })
    expect(findTag(tags, 'payment')).toEqual(['payment', 'cashu', 'token123', '5000', 'sat'])
  })

  it('emits proof-only form when amount is unknown', () => {
    const tags = buildTicketStatusTags({ ...base, preimage: 'abc' })
    expect(findTag(tags, 'payment')).toEqual(['payment', 'lightning', 'abc'])
  })

  it('keeps legacy invoice/preimage tags additively', () => {
    const tags = buildTicketStatusTags({ ...base, invoice: 'lnbc1...', preimage: 'abc' })
    expect(findTag(tags, 'invoice')).toEqual(['invoice', 'lnbc1...'])
    expect(findTag(tags, 'preimage')).toEqual(['preimage', 'abc'])
  })
})

describe('buildTicketStatusTags — escrow_status projection tag', () => {
  const base = {
    id: 't1',
    status: 'IN_PROGRESS',
    buyerPubkey: 'buyer',
    sellerPubkey: 'seller',
  }

  it('emits the 4-state projection when an internal escrow status is present', () => {
    const tags = buildTicketStatusTags({ ...base, escrowStatus: 'PHASE_2_PENDING' })
    expect(findTag(tags, 'escrow_status')).toEqual(['escrow_status', 'HELD'])
  })

  it('omits escrow_status when none is set', () => {
    const tags = buildTicketStatusTags(base)
    expect(findTag(tags, 'escrow_status')).toBeUndefined()
  })
})
