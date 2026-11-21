// Verified Agent Badge attestation — Kind 31423 (ADR-315 D3 / FU-450).
//
// Unlike Kind 31417 (any customer attests with their own key) or Kind 31419
// (the reviewer attests), this is a Colabonate/Foundation-level claim —
// signed server-side by a dedicated platform attestation key (see
// apps/server/services/agent-attestation.ts), never the founder's own
// identity, so other Nostr clients can recognize "signed by this one stable
// pubkey" as Colabonate's own trust badge without calling our API.
//
// Parameterized replaceable (30000-39999 range): the `d` tag is stable per
// agent profile, so re-publishing with an updated `status` tag on
// verify/unverify keeps the address showing current truth instead of
// orphaning a stale "verified" claim on relays after a revoke.

export const VERIFIED_AGENT_BADGE_KIND = 31423

export interface VerifiedBadgeAttestationTagInput {
  agentProfileId: string
  ownerPubkey: string
  status: 'verified' | 'unverified'
  verifiedAt?: string | null // ISO string
}

export function buildVerifiedBadgeAttestationTags(t: VerifiedBadgeAttestationTagInput): string[][] {
  const tags: string[][] = [
    ['d', `agent-verified-${t.agentProfileId}`],
    ['p', t.ownerPubkey],
    ['agent_profile_id', t.agentProfileId],
    ['status', t.status],
  ]
  if (t.verifiedAt) tags.push(['verified_at', t.verifiedAt])
  return tags
}
