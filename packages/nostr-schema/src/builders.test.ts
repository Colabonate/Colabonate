import { describe, it, expect } from 'vitest'
import {
  buildTicketCreatedTags,
  buildTicketStatusTags,
  buildCooperationProposalTags,
  buildMilestoneTags,
  validateTicketCreated,
  validateTicketStatus,
  validateCooperationProposal,
  validateMilestone,
  findTag,
  toMarketSpecStatus,
  fromMarketSpecStatus,
  buildMarketSpecOrderTags,
  buildMarketSpecReceiptTags,
  shouldCoEmit,
  buildProductListingTags,
  formatVariantLabel,
  normalizeGammaTag,
  normalizeGammaTags,
} from './index.js'

describe('buildTicketCreatedTags', () => {
  it('emits the legacy + market-spec vocabulary tags', () => {
    const tags = buildTicketCreatedTags({
      id: 't1', offerId: 'o1', buyerPubkey: 'buyer', sellerPubkey: 'seller', status: 'PENDING',
    })
    expect(findTag(tags, 'd')).toEqual(['d', 't1'])
    expect(findTag(tags, 'a')).toEqual(['a', '30402:seller:o1'])
    expect(findTag(tags, 'item')).toEqual(['item', '30402:seller:o1', '1'])
    expect(findTag(tags, 'order')).toEqual(['order', 't1'])
  })
})

describe('buildTicketStatusTags', () => {
  const base = { id: 't1', status: 'COMPLETED', buyerPubkey: 'buyer', sellerPubkey: 'seller' }

  it('omits payment tag when no proof present', () => {
    expect(findTag(buildTicketStatusTags({ ...base, invoice: 'lnbc1...' }), 'payment')).toBeUndefined()
  })
  it('emits the NIP-115 payment tuple with amount when proof present', () => {
    const tags = buildTicketStatusTags({ ...base, preimage: 'deadbeef', amountSats: 21000 })
    expect(findTag(tags, 'payment')).toEqual(['payment', 'lightning', 'deadbeef', '21000', 'sat'])
  })
  it('projects internal escrow status to the 4 public states', () => {
    const tags = buildTicketStatusTags({ ...base, escrowStatus: 'PHASE_2_PENDING' })
    expect(findTag(tags, 'escrow_status')).toEqual(['escrow_status', 'HELD'])
  })
})

describe('cooperation builders', () => {
  it('buildCooperationProposalTags emits NIP-C tags', () => {
    const tags = buildCooperationProposalTags({
      cooperationId: 'c1', type: 'proposal', initiatorPubkey: 'init', partnerPubkey: 'part',
      title: 'Build', budgetSats: 5000, status: 'OPEN',
    })
    expect(findTag(tags, 'd')).toEqual(['d', 'c1'])
    expect(findTag(tags, 'budget')).toEqual(['budget', '5000', 'sats'])
    expect(findTag(tags, 'p')).toEqual(['p', 'part'])
  })
  it('buildMilestoneTags composes the milestone d tag', () => {
    const tags = buildMilestoneTags({
      cooperationId: 'c1', milestoneId: 'm1', milestoneIndex: 2, initiatorPubkey: 'init',
      partnerPubkey: 'part', title: 'Phase', status: 'COMPLETED', amountSats: 1000,
    })
    expect(findTag(tags, 'd')).toEqual(['d', 'c1-2'])
    expect(findTag(tags, 'p')).toEqual(['p', 'init'])
  })
})

describe('validators', () => {
  it('accepts a well-formed ticket created event and rejects a missing required tag', () => {
    const tags = buildTicketCreatedTags({ id: 't1', offerId: 'o1', buyerPubkey: 'b', sellerPubkey: 's', status: 'PENDING' })
    expect(validateTicketCreated({ kind: 30407, content: '', tags }).success).toBe(true)
    expect(validateTicketCreated({ kind: 30407, content: '', tags: [['d', 't1']] }).success).toBe(false)
  })
  it('accepts a well-formed ticket status event', () => {
    const tags = buildTicketStatusTags({ id: 't1', status: 'PAID', buyerPubkey: 'b', sellerPubkey: 's' })
    expect(validateTicketStatus({ kind: 30408, content: '', tags }).success).toBe(true)
  })
  it('accepts well-formed cooperation events', () => {
    const coopTags = buildCooperationProposalTags({ cooperationId: 'c1', type: 'proposal', initiatorPubkey: 'i', partnerPubkey: 'p', title: 'T', budgetSats: 1, status: 'OPEN' })
    expect(validateCooperationProposal({ kind: 30414, content: '', tags: coopTags }).success).toBe(true)
    const msTags = buildMilestoneTags({ cooperationId: 'c1', milestoneId: 'm1', milestoneIndex: 1, initiatorPubkey: 'i', partnerPubkey: 'p', title: 'T', status: 'COMPLETED', amountSats: 1 })
    expect(validateMilestone({ kind: 30415, content: '', tags: msTags }).success).toBe(true)
  })
})

describe('status-vocabulary-bridge (ADR-153)', () => {
  describe('toMarketSpecStatus', () => {
    it('maps mappable statuses to lowercase', () => {
      expect(toMarketSpecStatus('PENDING')).toBe('pending')
      expect(toMarketSpecStatus('ACCEPTED')).toBe('confirmed')
      expect(toMarketSpecStatus('IN_PROGRESS')).toBe('processing')
      expect(toMarketSpecStatus('COMPLETED')).toBe('completed')
      expect(toMarketSpecStatus('CANCELLED')).toBe('cancelled')
    })
    it('maps PAID to processing (documented approximation)', () => {
      expect(toMarketSpecStatus('PAID')).toBe('processing')
    })
    it('returns null for Colabonate-only statuses', () => {
      expect(toMarketSpecStatus('DISPUTED')).toBeNull()
      expect(toMarketSpecStatus('ARBITRATION_WON')).toBeNull()
      expect(toMarketSpecStatus('ARBITRATION_LOST')).toBeNull()
      expect(toMarketSpecStatus('INTEREST_SENT')).toBeNull()
    })
    it('returns null for unknown strings', () => {
      expect(toMarketSpecStatus('UNKNOWN')).toBeNull()
    })
  })

  describe('fromMarketSpecStatus', () => {
    it('maps all market-spec statuses to UPPERCASE canonical', () => {
      expect(fromMarketSpecStatus('pending')).toBe('PENDING')
      expect(fromMarketSpecStatus('confirmed')).toBe('ACCEPTED')
      expect(fromMarketSpecStatus('processing')).toBe('IN_PROGRESS')
      expect(fromMarketSpecStatus('completed')).toBe('COMPLETED')
      expect(fromMarketSpecStatus('cancelled')).toBe('CANCELLED')
    })
    it('returns null for unknown strings', () => {
      expect(fromMarketSpecStatus('disputed')).toBeNull()
      expect(fromMarketSpecStatus('foo')).toBeNull()
    })
  })
})

describe('market-spec co-emission builders (ADR-154)', () => {
  describe('buildMarketSpecOrderTags', () => {
    it('builds Kind 16 order tags with lowercase status', () => {
      const tags = buildMarketSpecOrderTags({
        ticketId: 't1', status: 'PENDING',
        sellerPubkey: 'seller', buyerPubkey: 'buyer',
        offerId: 'o1',
      })
      expect(tags).not.toBeNull()
      expect(findTag(tags!, 'order')).toEqual(['order', 't1'])
      expect(findTag(tags!, 'status')).toEqual(['status', 'pending'])
      expect(findTag(tags!, 'a')).toEqual(['a', '30402:seller:o1'])
      expect(findTag(tags!, 'item')).toEqual(['item', '30402:seller:o1', '1'])
      expect(findTag(tags!, 'p')).toEqual(['p', 'seller'])
    })

    it('returns null for unmappable status (e.g. DISPUTED)', () => {
      const tags = buildMarketSpecOrderTags({
        ticketId: 't1', status: 'DISPUTED',
        sellerPubkey: 'seller', buyerPubkey: 'buyer',
      })
      expect(tags).toBeNull()
    })

    it('omits a/item tags when no offerId', () => {
      const tags = buildMarketSpecOrderTags({
        ticketId: 't1', status: 'COMPLETED',
        sellerPubkey: 'seller', buyerPubkey: 'buyer',
      })
      expect(tags).not.toBeNull()
      expect(findTag(tags!, 'a')).toBeUndefined()
      expect(findTag(tags!, 'item')).toBeUndefined()
    })

    it('includes amount tag when amountSats provided', () => {
      const tags = buildMarketSpecOrderTags({
        ticketId: 't1', status: 'ACCEPTED',
        sellerPubkey: 'seller', buyerPubkey: 'buyer',
        amountSats: 21000,
      })
      expect(tags).not.toBeNull()
      expect(findTag(tags!, 'amount')).toEqual(['amount', '21000', 'sat'])
    })
  })

  describe('buildMarketSpecReceiptTags', () => {
    it('builds Kind 17 receipt tags with payment proof', () => {
      const tags = buildMarketSpecReceiptTags({
        ticketId: 't1', sellerPubkey: 'seller', buyerPubkey: 'buyer',
        proof: 'deadbeef', amountSats: 5000,
      })
      expect(findTag(tags, 'order')).toEqual(['order', 't1'])
      expect(findTag(tags, 'payment')).toEqual(['payment', 'lightning', 'deadbeef'])
      expect(findTag(tags, 'amount')).toEqual(['amount', '5000', 'sat'])
      expect(findTag(tags, 'subject')).toEqual(['subject', 'order-payment'])
    })
  })

  describe('shouldCoEmit', () => {
    it('returns false for Tier 0 (public)', () => {
      expect(shouldCoEmit(0)).toBe(false)
    })
    it('returns false for undefined', () => {
      expect(shouldCoEmit(undefined)).toBe(false)
    })
    it('returns true for Tier 1 (PRIVATE_PAYLOAD)', () => {
      expect(shouldCoEmit(1)).toBe(true)
    })
    it('returns true for Tier 2 (CONFIDENTIAL)', () => {
      expect(shouldCoEmit(2)).toBe(true)
    })
  })

  describe('ADR-270 product variants & formatVariantLabel', () => {
    it('formats variant label from values record', () => {
      expect(formatVariantLabel({ Size: 'M', Colour: 'Blue' })).toBe('Size: M · Colour: Blue')
      expect(formatVariantLabel(null)).toBe('')
      expect(formatVariantLabel({})).toBe('')
    })

    it('buildProductListingTags emits specs for variantValues and parent ref', () => {
      const tags = buildProductListingTags({
        d: 'child-sku-1',
        title: 'T-Shirt - M / Blue',
        price: '25000',
        currency: 'SAT',
        type: 'variation',
        physicalType: 'physical',
        parentRef: { pubkey: 'sellerpk', d: 'parent-tshirt' },
        variantValues: { Size: 'M', Colour: 'Blue' },
      })
      expect(findTag(tags, 'd')).toEqual(['d', 'child-sku-1'])
      expect(findTag(tags, 'a')).toEqual(['a', '30402:sellerpk:parent-tshirt'])
      expect(findTag(tags, 'type')).toEqual(['type', 'variation', 'physical'])
      expect(tags.filter(t => t[0] === 'spec')).toEqual([
        ['spec', 'Size', 'M'],
        ['spec', 'Colour', 'Blue'],
      ])
    })
  })
})

// ADR-277 D3
describe('normalizeGammaTag', () => {
  it('lowercases, trims, strips a leading #, and collapses inner whitespace to -', () => {
    expect(normalizeGammaTag('  #Electronics  ')).toBe('electronics')
    expect(normalizeGammaTag('Home  Garden')).toBe('home-garden')
    expect(normalizeGammaTag('#Second Hand')).toBe('second-hand')
  })

  it('returns an empty string for empty/whitespace-only input', () => {
    expect(normalizeGammaTag('   ')).toBe('')
    expect(normalizeGammaTag('')).toBe('')
    expect(normalizeGammaTag('#')).toBe('')
  })
})

describe('normalizeGammaTags', () => {
  it('normalizes, dedupes, and drops empties', () => {
    expect(normalizeGammaTags(['Electronics', '#electronics', ' ', 'Home Garden'])).toEqual([
      'electronics',
      'home-garden',
    ])
  })

  it('returns an empty array for an empty input', () => {
    expect(normalizeGammaTags([])).toEqual([])
  })
})
