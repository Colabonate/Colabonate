// Agent review attestation — Kind 31419 (ADR-307 D4).
//
// Portable, cryptographically-signed multi-dimension review attestation for
// AGENT_SETUP tickets, published alongside (not instead of) the existing
// Kind 30024/30406 star review events. Carries the agent-specific dimensions
// so reputation is readable by any relay-connected client, not only
// Colabonate's own Review table.

export const AGENT_REVIEW_ATTESTATION_KIND = 31419

export interface AgentReviewAttestationTagInput {
  ticketId: string
  reviewerPubkey: string
  revieweePubkey: string
  accuracy?: number | null
  speed?: number | null
  reliability?: number | null
  quality?: number | null
  wouldReuse?: boolean | null
  amountSats?: number | null
}

export function buildAgentReviewAttestationTags(t: AgentReviewAttestationTagInput): string[][] {
  const tags: string[][] = [
    ['d', `agent-review-${t.ticketId}-${t.reviewerPubkey.slice(0, 8)}`],
    ['p', t.revieweePubkey],
    ['ticket', t.ticketId],
  ]
  if (t.accuracy != null) tags.push(['accuracy', String(t.accuracy)])
  if (t.speed != null) tags.push(['speed', String(t.speed)])
  if (t.reliability != null) tags.push(['reliability', String(t.reliability)])
  if (t.quality != null) tags.push(['quality', String(t.quality)])
  if (t.wouldReuse != null) tags.push(['would_reuse', t.wouldReuse ? '1' : '0'])
  if (t.amountSats != null) tags.push(['amount_sats', String(t.amountSats)])
  return tags
}
