import { describe, it, expect } from 'vitest'
import { buildVerifiedBadgeAttestationTags, VERIFIED_AGENT_BADGE_KIND, findTag } from './index.js'

describe('buildVerifiedBadgeAttestationTags', () => {
  it('emits a stable per-profile d tag, p/agent_profile_id/status', () => {
    const tags = buildVerifiedBadgeAttestationTags({
      agentProfileId: 'ap1',
      ownerPubkey: 'ownerpubkeyhex',
      status: 'verified',
      verifiedAt: '2026-08-21T10:00:00.000Z',
    })
    expect(findTag(tags, 'd')).toEqual(['d', 'agent-verified-ap1'])
    expect(findTag(tags, 'p')).toEqual(['p', 'ownerpubkeyhex'])
    expect(findTag(tags, 'agent_profile_id')).toEqual(['agent_profile_id', 'ap1'])
    expect(findTag(tags, 'status')).toEqual(['status', 'verified'])
    expect(findTag(tags, 'verified_at')).toEqual(['verified_at', '2026-08-21T10:00:00.000Z'])
  })

  it('the d tag stays identical across verify/unverify — same address, updated status', () => {
    const verified = buildVerifiedBadgeAttestationTags({ agentProfileId: 'ap1', ownerPubkey: 'o', status: 'verified' })
    const unverified = buildVerifiedBadgeAttestationTags({ agentProfileId: 'ap1', ownerPubkey: 'o', status: 'unverified' })
    expect(findTag(verified, 'd')).toEqual(findTag(unverified, 'd'))
    expect(findTag(unverified, 'status')).toEqual(['status', 'unverified'])
  })

  it('omits verified_at when not provided', () => {
    const tags = buildVerifiedBadgeAttestationTags({ agentProfileId: 'ap1', ownerPubkey: 'o', status: 'unverified' })
    expect(findTag(tags, 'verified_at')).toBeUndefined()
  })

  it('VERIFIED_AGENT_BADGE_KIND is the addressable Kind 31423', () => {
    expect(VERIFIED_AGENT_BADGE_KIND).toBe(31423)
  })
})
