import { describe, it, expect } from 'vitest'
import { buildCapabilityAttestationTags, CAPABILITY_ATTESTATION_KIND, findTag } from './index.js'

describe('buildCapabilityAttestationTags', () => {
  it('emits d/p/ticket/evidence plus one c tag per capability', () => {
    const tags = buildCapabilityAttestationTags({
      ticketId: 't1',
      attesterPubkey: 'buyerpubkeyhex',
      ownerPubkey: 'ownerpubkeyhex',
      capabilities: ['code-review', 'text-generation'],
    })
    expect(findTag(tags, 'd')).toEqual(['d', 'agent-claim-t1-buyerpub'])
    expect(findTag(tags, 'p')).toEqual(['p', 'ownerpubkeyhex'])
    expect(findTag(tags, 'ticket')).toEqual(['ticket', 't1'])
    expect(findTag(tags, 'evidence')).toEqual(['evidence', 't1'])
    expect(tags.filter(t => t[0] === 'c')).toEqual([
      ['c', 'code-review'],
      ['c', 'text-generation'],
    ])
  })

  it('emits no c tags for an agent with no declared capabilities', () => {
    const tags = buildCapabilityAttestationTags({
      ticketId: 't2', attesterPubkey: 'r', ownerPubkey: 'o', capabilities: [],
    })
    expect(tags.filter(t => t[0] === 'c')).toEqual([])
  })

  it('CAPABILITY_ATTESTATION_KIND is the addressable Kind 31417', () => {
    expect(CAPABILITY_ATTESTATION_KIND).toBe(31417)
  })
})
