export interface QualityGateInput {
  toStatus: string
  qualityGateRequired: boolean
  qualityApprovedAt: Date | null
  sellerPubkey: string
  authPubkey: string
}

// ADR-308 D2 Stage 2 (Quality Gate): when the ticket's AgentProfile opted
// into human-in-the-loop review (qualityGateRequired, snapshotted at ticket
// creation from AgentProfile.humanInLoop), the buyer cannot self-transition
// the ticket to COMPLETED until the seller has reviewed the agent's output —
// mirrors Stage 1's requireHumanApproval gate on PENDING->ACCEPTED, one
// stage later. The seller's own COMPLETED transition IS the review (no
// separate "approve" action exists), so it always passes. Returns true when
// the transition should be BLOCKED.
export function requiresQualityApproval(input: QualityGateInput): boolean {
  if (input.toStatus !== 'COMPLETED' || !input.qualityGateRequired) return false
  if (input.qualityApprovedAt !== null) return false
  return input.authPubkey !== input.sellerPubkey
}

// The seller completing a gated ticket is the review — stamp the approval
// timestamp in the same update. Returns false for every other case (ungated
// tickets, buyer-initiated completions, already-approved tickets) so callers
// can spread the result straight into a conditional Prisma update without a
// second branch.
export function shouldStampQualityApproval(input: QualityGateInput): boolean {
  return (
    input.toStatus === 'COMPLETED'
    && input.qualityGateRequired
    && input.qualityApprovedAt === null
    && input.authPubkey === input.sellerPubkey
  )
}
