import type { PrismaClient } from '@prisma/client'
import { normalizeCapability } from '../lib/capability-normalize.js'
import { notifyBounty } from './notifications.js'

// ADR-319 D3 (auto-apply) + D1 (deadline expiry). Runs on a periodic tick,
// mirroring runEscrowTimeoutTick/runAppealFinalizerTick in index.ts. Shared
// predicates are also used by the manual-apply route (agent-tasks.ts) so
// auto- and manual applications are held to the same eligibility rules.

// Normalized at compare time (not at task-write time) so this stays correct
// regardless of how requiredCapabilities was stored — matches the same
// normalizeCapability() already applied to AgentProfile.capabilities on
// write (agent-profiles.ts), preventing "Code Review" vs "code-review" from
// silently failing to match.
export function hasRequiredCapabilities(required: string[], capabilities: string[]): boolean {
  const normalizedCaps = new Set(capabilities.map(normalizeCapability))
  return required.every(c => normalizedCaps.has(normalizeCapability(c)))
}

export function withinBudget(priceSats: number, budgetSats: number): boolean {
  return priceSats <= budgetSats
}

// FU-483 (ADR-328 D2): a bounty's supervision preference is a hard filter;
// null = no preference. `humanInLoop=false` means the agent runs autonomously.
export function matchesSupervision(preferred: string | null, humanInLoop: boolean): boolean {
  if (!preferred) return true
  return (preferred === 'AUTONOMOUS') === !humanInLoop
}

// ADR-397 / FU-870: is a live application still valid after the bounty was
// edited? Same three rules as applying (capabilities, budget, supervision).
export function applicationStillEligible(
  task: { requiredCapabilities: string[]; budgetSats: number; preferredSupervision: string | null },
  application: { proposedPriceSats: number | null; offerPriceSats: number; agentCapabilities: string[]; agentHumanInLoop: boolean },
): boolean {
  return hasRequiredCapabilities(task.requiredCapabilities, application.agentCapabilities) &&
    withinBudget(application.proposedPriceSats ?? application.offerPriceSats, task.budgetSats) &&
    matchesSupervision(task.preferredSupervision, application.agentHumanInLoop)
}

function notifyTickSafe(p: Promise<void>, what: string) {
  p.catch(err => console.error(`[AgentTaskMatcher] notify ${what} failed:`, err instanceof Error ? err.message : err))
}

export interface AgentTaskMatcherResult {
  applied: number
  expired: number
}

export async function runAgentTaskMatcherTick(prisma: PrismaClient): Promise<AgentTaskMatcherResult> {
  // ADR-397 D5: load the expiring bounties first so poster and live
  // applicants can be told; the CAS updateMany below is what actually expires.
  const expiring = await prisma.agentTask.findMany({
    where: { status: { in: ['OPEN', 'SELECTING'] }, deadline: { lt: new Date() } },
    select: {
      id: true, title: true, creatorPubkey: true,
      applications: { where: { status: { in: ['PENDING', 'AWAITING_OWNER_APPROVAL'] } }, select: { agentProfile: { select: { ownerPubkey: true } } } },
    },
  })
  const expired = await prisma.agentTask.updateMany({
    where: { id: { in: expiring.map(t => t.id) }, status: { in: ['OPEN', 'SELECTING'] } },
    data: { status: 'EXPIRED' },
  })
  for (const t of expiring) {
    notifyTickSafe(notifyBounty(prisma, {
      event: 'expired',
      recipients: [t.creatorPubkey, ...t.applications.map(a => a.agentProfile.ownerPubkey)],
      taskId: t.id,
      bountyTitle: t.title,
    }), 'expired')
  }

  const openTasks = await prisma.agentTask.findMany({
    where: { status: 'OPEN' },
    select: { id: true, title: true, creatorPubkey: true, requiredCapabilities: true, budgetSats: true, preferredSupervision: true },
  })
  if (openTasks.length === 0) return { applied: 0, expired: expired.count }

  const autoApplyProfiles = await prisma.agentProfile.findMany({
    where: { autoApply: true, isPublic: true },
    select: {
      id: true,
      ownerPubkey: true,
      capabilities: true,
      requireHumanApproval: true,
      humanInLoop: true,
      offers: { where: { offerType: 'AGENT_SETUP', status: 'ACTIVE' }, select: { id: true, priceSats: true } },
    },
  })
  if (autoApplyProfiles.length === 0) return { applied: 0, expired: expired.count }

  // Pre-fetch already-applied (taskId, agentProfileId) pairs once instead of
  // relying on a P2002 catch per pair — on a steady-state tick, most pairs
  // were already applied on a prior run, so this turns what used to be a
  // failed unique-constraint insert attempt into a free in-memory skip.
  const existingApps = await prisma.agentTaskApplication.findMany({
    where: {
      taskId: { in: openTasks.map(t => t.id) },
      agentProfileId: { in: autoApplyProfiles.map(p => p.id) },
    },
    select: { taskId: true, agentProfileId: true },
  })
  const alreadyApplied = new Set(existingApps.map(a => `${a.taskId}:${a.agentProfileId}`))

  let applied = 0
  for (const task of openTasks) {
    for (const profile of autoApplyProfiles) {
      if (alreadyApplied.has(`${task.id}:${profile.id}`)) continue
      if (!hasRequiredCapabilities(task.requiredCapabilities, profile.capabilities)) continue
      // FU-483: same SUPERVISION_MISMATCH constraint as the manual-apply
      // route — auto-apply must not bypass a buyer's stated preference.
      if (!matchesSupervision(task.preferredSupervision, profile.humanInLoop)) continue
      const offer = profile.offers.find(o => withinBudget(o.priceSats, task.budgetSats))
      if (!offer) continue

      try {
        await prisma.agentTaskApplication.create({
          data: {
            taskId: task.id,
            agentProfileId: profile.id,
            offerId: offer.id,
            proposedPriceSats: offer.priceSats,
            // D3 point 5: an owner-approval gate — the application is created
            // but not selectable until the owner confirms it via PATCH
            // .../confirm. ADR-397 D5: the owner is notified to do so.
            status: profile.requireHumanApproval ? 'AWAITING_OWNER_APPROVAL' : 'PENDING',
          },
        })
        applied++
        notifyTickSafe(notifyBounty(prisma, profile.requireHumanApproval
          ? { event: 'awaiting_owner_approval', recipients: [profile.ownerPubkey], taskId: task.id, bountyTitle: task.title }
          : { event: 'application_received', recipients: [task.creatorPubkey], taskId: task.id, bountyTitle: task.title }), 'auto-apply')
      } catch (err: unknown) {
        // P2002 = unique(taskId, agentProfileId) — already applied to this
        // task on a prior tick; not an error, just skip.
        if ((err as { code?: string })?.code !== 'P2002') {
          console.error('[AgentTaskMatcher] failed to create application:', err)
        }
      }
    }
  }

  return { applied, expired: expired.count }
}
