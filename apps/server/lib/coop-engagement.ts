// ADR-386 — server-authoritative "unengaged" predicate for the full-form edit
// gate. A Cooperation / COOP network is safe to re-edit through the complete
// Coop-Guide form only while no counterparty, money or progress exists. These
// pure helpers take the row shapes the list/detail endpoints already load (plus
// the `_count` / relation probes added for exactly this purpose) so the gate is
// computed in one place and can be re-checked inside the write transaction.

export interface CoopMilestoneEngagementShape {
  partnerPubkey?: string | null
  status?: string | null
  evidence?: string | null
  lightningInvoice?: string | null
  paymentHash?: string | null
  steps?: Array<{ status?: string | null }> | null
  applications?: unknown[] | null
  messages?: unknown[] | null
  _count?: { applications?: number; messages?: number } | null
}

export interface CooperationEngagementShape {
  status?: string | null
  isAgentOrchestration?: boolean | null
  partnerPubkey?: string | null
  escrowStatus?: string | null
  lightningInvoice?: string | null
  paymentHash?: string | null
  nostrAcceptId?: string | null
  milestones?: CoopMilestoneEngagementShape[] | null
  milestoneApplications?: unknown[] | null
  escrowTrade?: unknown
  _count?: { milestoneApplications?: number; tickets?: number; workspaces?: number } | null
}

export interface OfferEngagementShape {
  status?: string | null
  offerType?: string | null
  members?: unknown[] | null
  _count?: { members?: number; tickets?: number } | null
}

function hasMilestoneEngagement(m: CoopMilestoneEngagementShape): boolean {
  if (m.partnerPubkey) return true
  if ((m.status ?? 'PENDING').toUpperCase() !== 'PENDING') return true
  if (m.evidence) return true
  if (m.lightningInvoice || m.paymentHash) return true
  const appCount = m._count?.applications ?? m.applications?.length ?? 0
  if (appCount > 0) return true
  const msgCount = m._count?.messages ?? m.messages?.length ?? 0
  if (msgCount > 0) return true
  // ADR-386 D7: any pipeline step row means an agent-orchestration artifact is
  // attached (human milestones create none). Excluded outright so the
  // full-form milestone replace can never silently drop authored steps.
  if (Array.isArray(m.steps) && m.steps.length > 0) return true
  return false
}

/**
 * True only for a published (OPEN), non-agent Cooperation that nobody has
 * touched: no partner, no application of any status, no milestone progress,
 * no chat, no escrow/money, no ticket/workspace/trade. DRAFT is outside this
 * gate (ADR-296's own resume path already covers it).
 */
export function cooperationCanFullEdit(c: CooperationEngagementShape): boolean {
  if ((c.status ?? '').toUpperCase() !== 'OPEN') return false
  if (c.isAgentOrchestration) return false
  if (c.partnerPubkey) return false
  if (c.escrowStatus || c.lightningInvoice || c.paymentHash || c.nostrAcceptId) return false
  if (c.escrowTrade) return false
  if ((c._count?.milestoneApplications ?? c.milestoneApplications?.length ?? 0) > 0) return false
  if ((c._count?.tickets ?? 0) > 0) return false
  if ((c._count?.workspaces ?? 0) > 0) return false
  for (const m of c.milestones ?? []) {
    if (hasMilestoneEngagement(m)) return false
  }
  return true
}

/**
 * True only for a published (ACTIVE) COOP network with no member of any status
 * and no ticket. DRAFT offers stay on the existing resume path.
 */
export function offerCanFullEdit(o: OfferEngagementShape): boolean {
  if ((o.offerType ?? '').toUpperCase() !== 'COOP') return false
  if ((o.status ?? '').toUpperCase() !== 'ACTIVE') return false
  if ((o._count?.members ?? o.members?.length ?? 0) > 0) return false
  if ((o._count?.tickets ?? 0) > 0) return false
  return true
}
