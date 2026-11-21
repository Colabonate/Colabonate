/**
 * FU-450 (ADR-315 D3) — platform attestation signer for the portable
 * Verified Agent Badge (Kind 31423, `@col/nostr-schema`'s
 * `buildVerifiedBadgeAttestationTags`).
 *
 * Uses a DEDICATED server-held keypair (`AGENT_ATTESTATION_PRIVKEY` env var),
 * generated once for this purpose only — never the founder's real identity
 * (`FOUNDATION_DAO_ADMIN_PUBKEY`), whose matching private key the server
 * never holds (ADR-141: the DAO is Nostr-native, not server-custodied).
 *
 * Unlike the codebase's existing ephemeral-key publish pattern
 * (`nostr-relay.ts`, a fresh `generateSecretKey()` per event — fine for
 * offers/tickets, which don't need a recognizable signer), this key is
 * STABLE across every attestation on purpose: other Nostr clients need to
 * recognize "signed by this one pubkey" as Colabonate's own trust claim,
 * or the credential is unattributable and worthless as a portable badge.
 *
 * Unconfigured → attestations are skipped entirely (honest no-op, not a
 * fabricated fallback signer) — the `AgentProfile.isVerified` DB column and
 * admin UI badge keep working exactly as before this feature existed.
 */

import { finalizeEvent, getPublicKey, type Event, type EventTemplate } from 'nostr-tools'
import { buildVerifiedBadgeAttestationTags, VERIFIED_AGENT_BADGE_KIND } from '@col/nostr-schema'
import { nostrService } from './nostr-relay.js'

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
}

function getAttestationPrivkey(): Uint8Array | null {
  const hex = process.env.AGENT_ATTESTATION_PRIVKEY
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? hexToBytes(hex) : null
}

/** The platform attestation pubkey, or null if `AGENT_ATTESTATION_PRIVKEY` is unset. */
export function getAttestationPubkey(): string | null {
  const sk = getAttestationPrivkey()
  return sk ? getPublicKey(sk) : null
}

export interface VerifiedBadgeAttestationInput {
  agentProfileId: string
  ownerPubkey: string
  status: 'verified' | 'unverified'
  verifiedAt?: Date | null
}

/**
 * Signs and publishes a Kind 31423 attestation. Returns `false` (not an
 * error) when no attestation key is configured — callers treat this as
 * fire-and-forget, mirroring ADR-307 D4's review-attestation publish, and
 * must never let a publish failure block the admin verify/unverify response.
 */
export async function publishVerifiedBadgeAttestation(input: VerifiedBadgeAttestationInput): Promise<boolean> {
  const sk = getAttestationPrivkey()
  if (!sk) return false

  const tags = buildVerifiedBadgeAttestationTags({
    agentProfileId: input.agentProfileId,
    ownerPubkey: input.ownerPubkey,
    status: input.status,
    verifiedAt: input.verifiedAt ? input.verifiedAt.toISOString() : null,
  })

  const template: EventTemplate = {
    kind: VERIFIED_AGENT_BADGE_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: input.status === 'verified'
      ? 'Colabonate Foundation has verified this agent profile.'
      : 'Verification of this agent profile has been revoked.',
  }

  const event: Event = finalizeEvent(template, sk)
  return nostrService.publishEvent(event)
}
