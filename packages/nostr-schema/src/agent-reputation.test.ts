import { describe, it, expect } from 'vitest'
import { buildAgentReviewAttestationTags, AGENT_REVIEW_ATTESTATION_KIND, findTag } from './index.js'

describe('buildAgentReviewAttestationTags', () => {
  it('emits d/p/ticket plus only the dimensions provided', () => {
    const tags = buildAgentReviewAttestationTags({
      ticketId: 't1',
      reviewerPubkey: 'buyerpubkeyhex',
      revieweePubkey: 'sellerpubkeyhex',
      accuracy: 5,
      speed: 4,
      amountSats: 5000,
    })
    expect(findTag(tags, 'd')).toEqual(['d', 'agent-review-t1-buyerpub'])
    expect(findTag(tags, 'p')).toEqual(['p', 'sellerpubkeyhex'])
    expect(findTag(tags, 'ticket')).toEqual(['ticket', 't1'])
    expect(findTag(tags, 'accuracy')).toEqual(['accuracy', '5'])
    expect(findTag(tags, 'speed')).toEqual(['speed', '4'])
    expect(findTag(tags, 'amount_sats')).toEqual(['amount_sats', '5000'])
    expect(findTag(tags, 'reliability')).toBeUndefined()
    expect(findTag(tags, 'quality')).toBeUndefined()
    expect(findTag(tags, 'would_reuse')).toBeUndefined()
  })

  it('emits would_reuse as 1/0, not a boolean', () => {
    const yes = buildAgentReviewAttestationTags({ ticketId: 't2', reviewerPubkey: 'r', revieweePubkey: 's', wouldReuse: true })
    const no = buildAgentReviewAttestationTags({ ticketId: 't3', reviewerPubkey: 'r', revieweePubkey: 's', wouldReuse: false })
    expect(findTag(yes, 'would_reuse')).toEqual(['would_reuse', '1'])
    expect(findTag(no, 'would_reuse')).toEqual(['would_reuse', '0'])
  })

  it('emits no dimension tags when nothing was rated', () => {
    const tags = buildAgentReviewAttestationTags({ ticketId: 't4', reviewerPubkey: 'r', revieweePubkey: 's' })
    expect(tags).toEqual([
      ['d', 'agent-review-t4-r'],
      ['p', 's'],
      ['ticket', 't4'],
    ])
  })

  it('AGENT_REVIEW_ATTESTATION_KIND is the addressable Kind 31419', () => {
    expect(AGENT_REVIEW_ATTESTATION_KIND).toBe(31419)
  })
})
