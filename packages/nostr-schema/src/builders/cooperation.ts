// Cooperation event tag builders — Kind 30414 (Cooperation Proposal) + Kind 30415
// (Milestone Event), NIP-C. Single source of truth shared by the server publish path
// (publishCooperationProposal / publishMilestoneEvent) and the client signer
// (signAndPublishCooperationProposal / signAndPublishMilestone). ADR-108/113/150.

export interface CooperationProposalTagInput {
  cooperationId: string
  type: 'proposal' | 'acceptance'
  initiatorPubkey: string
  partnerPubkey: string
  title: string
  budgetSats: number
  status: string
  timeline?: string
  cooperationType?: string
  skills?: string[]
}

export function buildCooperationProposalTags(t: CooperationProposalTagInput): string[][] {
  const tags: string[][] = [
    ['d', t.cooperationId],
    ['type', t.type],
    ['cooperation', t.cooperationId],
    ['initiator', t.initiatorPubkey],
    ['partner', t.partnerPubkey],
    ['p', t.type === 'proposal' ? t.partnerPubkey : t.initiatorPubkey],
    ['title', t.title],
    ['budget', t.budgetSats.toString(), 'sats'],
    ['status', t.status],
    ['ticket_type', 'cooperation'],
  ]
  if (t.timeline) tags.push(['timeline', t.timeline])
  if (t.cooperationType) tags.push(['cooperation_type', t.cooperationType])
  if (t.skills && t.skills.length > 0) tags.push(['skills', ...t.skills])
  return tags
}

export interface MilestoneTagInput {
  cooperationId: string
  milestoneId: string
  milestoneIndex: number
  initiatorPubkey: string
  partnerPubkey: string
  title: string
  status: string
  amountSats: number
  evidence?: string
  released?: boolean
}

export function buildMilestoneTags(t: MilestoneTagInput): string[][] {
  const dTag = `${t.cooperationId}-${t.milestoneIndex}`
  const tags: string[][] = [
    ['d', dTag],
    ['cooperation', t.cooperationId],
    ['milestone', t.milestoneId],
    ['milestone_index', t.milestoneIndex.toString()],
    ['initiator', t.initiatorPubkey],
    ['partner', t.partnerPubkey],
    ['p', t.status === 'COMPLETED' ? t.initiatorPubkey : t.partnerPubkey],
    ['title', t.title],
    ['status', t.status],
    ['amount', t.amountSats.toString(), 'sats'],
  ]
  if (t.evidence) tags.push(['evidence', t.evidence])
  if (t.released !== undefined) tags.push(['released', t.released ? 'true' : 'false'])
  return tags
}
