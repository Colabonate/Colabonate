/**
 * agent-attestation.ts unit tests — FU-450 (ADR-315 D3).
 *
 * Covers the honest-no-op-when-unconfigured behavior and the signed-event
 * shape when a test attestation key is configured. Publishing itself goes
 * through `nostrService.publishEvent()` (already covered by
 * `nostr-relay-publish-offer.test.ts`'s mocking pattern) — mocked here the
 * same way, not a live relay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools'
import { nostrService } from './nostr-relay.js'
import { getAttestationPubkey, publishVerifiedBadgeAttestation } from './agent-attestation.js'

const TEST_SK = generateSecretKey()
const TEST_SK_HEX = Array.from(TEST_SK).map(b => b.toString(16).padStart(2, '0')).join('')
const TEST_PUBKEY = getPublicKey(TEST_SK)

describe('agent-attestation (FU-450)', () => {
  let publishSpy: ReturnType<typeof vi.spyOn>
  const originalEnv = process.env.AGENT_ATTESTATION_PRIVKEY

  beforeEach(() => {
    publishSpy = vi.spyOn(nostrService.getPool(), 'publish').mockReturnValue([Promise.resolve(true)] as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalEnv === undefined) delete process.env.AGENT_ATTESTATION_PRIVKEY
    else process.env.AGENT_ATTESTATION_PRIVKEY = originalEnv
  })

  it('returns false and never publishes when the attestation key is unconfigured', async () => {
    delete process.env.AGENT_ATTESTATION_PRIVKEY
    expect(getAttestationPubkey()).toBeNull()
    const published = await publishVerifiedBadgeAttestation({
      agentProfileId: 'ap1', ownerPubkey: 'o'.repeat(64), status: 'verified',
    })
    expect(published).toBe(false)
    expect(publishSpy).not.toHaveBeenCalled()
  })

  it('signs and publishes a valid Kind 31423 event when configured', async () => {
    process.env.AGENT_ATTESTATION_PRIVKEY = TEST_SK_HEX
    expect(getAttestationPubkey()).toBe(TEST_PUBKEY)

    const published = await publishVerifiedBadgeAttestation({
      agentProfileId: 'ap1', ownerPubkey: 'o'.repeat(64), status: 'verified', verifiedAt: new Date('2026-08-21T10:00:00.000Z'),
    })
    expect(published).toBe(true)
    expect(publishSpy).toHaveBeenCalledTimes(1)

    const publishedEvent = publishSpy.mock.calls[0][1]
    expect(publishedEvent.kind).toBe(31423)
    expect(publishedEvent.pubkey).toBe(TEST_PUBKEY)
    expect(verifyEvent(publishedEvent)).toBe(true)
    expect(publishedEvent.tags).toContainEqual(['d', 'agent-verified-ap1'])
    expect(publishedEvent.tags).toContainEqual(['status', 'verified'])
  })

  it('every attestation is signed by the SAME stable pubkey, not a fresh key per event', async () => {
    process.env.AGENT_ATTESTATION_PRIVKEY = TEST_SK_HEX
    await publishVerifiedBadgeAttestation({ agentProfileId: 'ap1', ownerPubkey: 'o'.repeat(64), status: 'verified' })
    await publishVerifiedBadgeAttestation({ agentProfileId: 'ap2', ownerPubkey: 'p'.repeat(64), status: 'unverified' })
    const [first, second] = publishSpy.mock.calls.map((c: unknown[]) => c[1] as { pubkey: string })
    expect(first.pubkey).toBe(second.pubkey)
    expect(first.pubkey).toBe(TEST_PUBKEY)
  })

  it('rejects a malformed env value the same as unconfigured', async () => {
    process.env.AGENT_ATTESTATION_PRIVKEY = 'not-a-valid-hex-key'
    expect(getAttestationPubkey()).toBeNull()
    const published = await publishVerifiedBadgeAttestation({ agentProfileId: 'ap1', ownerPubkey: 'o'.repeat(64), status: 'verified' })
    expect(published).toBe(false)
  })
})
