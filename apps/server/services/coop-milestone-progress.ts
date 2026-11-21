import type { PrismaClient } from '@prisma/client'

// ADR-352 (closes FU-605): a pure-agent-orchestration CoopMilestone has no
// human partner, so the pre-existing PATCH /api/cooperations/:id/milestones/:mid
// route's `isPartner` authorization gate can never be satisfied for it — the
// milestone's IN_PROGRESS/COMPLETED transitions would otherwise be permanently
// unreachable, and ADR-352 D4's own `STEPS_INCOMPLETE` guard would gate a door
// nobody could ever walk through.
//
// Decision (user-confirmed, 2026-08-30, out of three options): the milestone's
// status is derived server-side from its own CoopMilestoneStep rows, driven
// exclusively by the buyer-triggered POST /api/workspaces/:id/steps/:stepId/complete
// route (ADR-352 D4) — the same buyer confirmation the ADR already built, just
// carried one level up. This function NEVER touches money: the final release
// (`ACCEPTED`, via the existing PATCH route, initiator-only) stays a fully
// separate, explicit, unmodified action. The existing PATCH route's `isPartner`
// gate for ordinary human-partner milestones is completely untouched — this
// only ever runs from the one route that already proves the caller is the
// workspace's buyer and the step genuinely belongs to that workspace's
// (cooperationId, offerId) pair.
//
// Deliberately conservative about *when* it fires: only from PENDING or
// IN_PROGRESS (never DISPUTED/COMPLETED/ACCEPTED — a milestone under dispute
// or already finalized must never be silently nudged by an unrelated step
// completion). Always visits IN_PROGRESS first, even when every step is
// already done in the very first call (a single-step milestone) — no
// "shortcut straight to COMPLETED" path, so the milestone's message timeline
// always reads STARTED-then-COMPLETED, exactly like a human-driven one.

export function areAllStepsCompleted(stepStatuses: string[]): boolean {
  return stepStatuses.length > 0 && stepStatuses.every(s => s === 'COMPLETED')
}

// Re-reads the milestone + its steps fresh (never trusts a caller-supplied
// snapshot) and applies at most two sequential transitions in one call, each
// paired with a CoopMilestoneMessage entry mirroring the human flow's
// STARTED/COMPLETED actions (authorPubkey = the buyer who triggered the
// underlying step completion) so the milestone's timeline stays legible
// regardless of which path drove the transition.
export async function syncMilestoneStatusFromSteps(
  prisma: PrismaClient,
  milestoneId: string,
  callerPubkey: string,
): Promise<void> {
  const milestone = await prisma.coopMilestone.findUnique({
    where: { id: milestoneId },
    include: { steps: { select: { status: true } } },
  })
  if (!milestone) return
  if (milestone.status !== 'PENDING' && milestone.status !== 'IN_PROGRESS') return

  let currentStatus = milestone.status
  const allCompleted = areAllStepsCompleted(milestone.steps.map(s => s.status))

  if (currentStatus === 'PENDING') {
    await prisma.$transaction([
      prisma.coopMilestone.update({ where: { id: milestoneId }, data: { status: 'IN_PROGRESS' } }),
      prisma.coopMilestoneMessage.create({
        data: { milestoneId, authorPubkey: callerPubkey, action: 'STARTED', message: 'Auto-derived from agent pipeline step progress (ADR-352 D4).' },
      }),
    ])
    currentStatus = 'IN_PROGRESS'
  }

  if (currentStatus === 'IN_PROGRESS' && allCompleted) {
    await prisma.$transaction([
      prisma.coopMilestone.update({ where: { id: milestoneId }, data: { status: 'COMPLETED', completedAt: new Date() } }),
      prisma.coopMilestoneMessage.create({
        data: { milestoneId, authorPubkey: callerPubkey, action: 'COMPLETED', message: 'All pipeline steps completed (ADR-352 D4).' },
      }),
    ])
  }
}
