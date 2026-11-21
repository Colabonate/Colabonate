// Capability attestation — Kind 31417 (ADR-316 D2 / ADR-317 D1 CapabilityClaim).
//
// Published by a customer alongside their review, immediately after a
// COMPLETED AGENT_SETUP ticket (ADR-316 D5 Sybil resistance: ticket-bound).
// Targets the agent owner's pubkey — ADR-316 D1's own agent sub-key does not
// exist yet, so this uses the same owner-pubkey fallback ADR-306 D2 already
// established for agentConfig sealing.

export const CAPABILITY_ATTESTATION_KIND = 31417

export interface CapabilityAttestationTagInput {
  ticketId: string
  attesterPubkey: string
  ownerPubkey: string
  capabilities: string[]
}

export function buildCapabilityAttestationTags(t: CapabilityAttestationTagInput): string[][] {
  const tags: string[][] = [
    ['d', `agent-claim-${t.ticketId}-${t.attesterPubkey.slice(0, 8)}`],
    ['p', t.ownerPubkey],
    ['ticket', t.ticketId],
    ['evidence', t.ticketId],
  ]
  for (const capability of t.capabilities) tags.push(['c', capability])
  return tags
}
