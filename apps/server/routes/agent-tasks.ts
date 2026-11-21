import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { requireAuth, validateToken } from '../middleware/require-auth.js'
import { applicationStillEligible, hasRequiredCapabilities, matchesSupervision, withinBudget } from '../services/agent-task-matcher.js'
import { BountyTicketConflictError, canRevertSelection, hasPayingWalletConnected, loadPosterReliability, syncAgentTaskFromTicket } from '../services/bounty-ticket.js'
import { isBetaMode } from '../services/betaMode.js'
import { notifyBounty, type BountyEvent } from '../services/notifications.js'
import { makeThumbsFromImages } from '../lib/makeThumb.js'

// ADR-319 D1/D2/D4: dynamic task allocation — a Buyer publishes an
// "Ausschreibung" (task) without a fixed seller, AgentProfile owners apply,
// the Buyer selects a winner. GET routes are public (mirrors the ADR-303
// public-read-tier direction); all mutating routes require auth.
//
// Deliberate scope cuts vs. the ADR text (documented in the ADR's
// Implementation Record):
//  - offerId is required on an application, not optional (the codebase's
//    Ticket model always anchors to a concrete Offer).
//  - POST .../select does not itself create the Ticket — the payment/escrow
//    resolution in POST /api/tickets (LN/Cashu/DEMO rails, wallet pre-flight,
//    three-phase hold-invoice setup) is too large and too critical a code
//    path to safely duplicate or refactor out in this slice. Selection marks
//    the winner and returns a `nextStep` the client follows with the
//    existing ticket-creation flow. ADR-397 D3/D4: that step carries the
//    `agentTaskApplicationId`, so the ticket charges the agreed price and is
//    linked to the bounty (Ticket.agentTaskId); the bounty then follows the
//    ticket (IN_PROGRESS / COMPLETED), and POST /:id/revert-selection undoes
//    a selection while no live ticket exists (closes FU-426).
//  - D5 (agent-to-agent subcontracting) and D6 (Nostr Kind 31420/31421/31422
//    publish) are not built — see FOLLOWUPS.md.

// Control-flow marker for POST /:id/select's CAS transaction — thrown when a
// concurrent request already claimed the task or application.
class SelectConflictError extends Error {}

const MAX_TITLE_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 4000
const MAX_CAPABILITIES = 20
const MAX_MESSAGE_LENGTH = 1000
// ADR-397 D8
const MAX_ACCEPTANCE_CRITERIA_LENGTH = 2000
// FU-870: `?status=` is validated against the real enum instead of being cast.
const TASK_STATUSES = ['OPEN', 'SELECTING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const
// Same cap as the shared MultiImageUploadInput default (offers) — a bounty
// carries the same data-URL photo payload an offer does.
const MAX_IMAGES = 5
const LIST_LIMIT_DEFAULT = 20
const LIST_LIMIT_MAX = 50

// FU-483 (ADR-328 D2): reuses OrchestrationMode's own wire values (mirrors
// the same-shape validation in agent-networks.ts) rather than a new enum.
const PREFERRED_SUPERVISION_VALUES = ['HUMAN', 'AUTONOMOUS'] as const
type PreferredSupervisionValue = (typeof PREFERRED_SUPERVISION_VALUES)[number]

function validateCreateTaskBody(body: Record<string, unknown>): string | null {
  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) return 'title is required'
  if (body.title.length > MAX_TITLE_LENGTH) return `title must not exceed ${MAX_TITLE_LENGTH} characters`
  if (!body.description || typeof body.description !== 'string' || !body.description.trim()) return 'description is required'
  if (body.description.length > MAX_DESCRIPTION_LENGTH) return `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters`
  if (!Array.isArray(body.requiredCapabilities) || body.requiredCapabilities.length === 0) return 'requiredCapabilities must be a non-empty array'
  if (body.requiredCapabilities.length > MAX_CAPABILITIES) return `requiredCapabilities must not exceed ${MAX_CAPABILITIES} entries`
  if (!body.requiredCapabilities.every((c: unknown) => typeof c === 'string' && c.trim())) return 'requiredCapabilities must be non-empty strings'
  if (typeof body.budgetSats !== 'number' || !Number.isInteger(body.budgetSats) || body.budgetSats <= 0) return 'budgetSats must be a positive integer'
  if (body.images !== undefined) {
    if (!Array.isArray(body.images) || body.images.length > MAX_IMAGES) return `images must be an array of up to ${MAX_IMAGES} entries`
    if (!body.images.every((i: unknown) => typeof i === 'string' && i.startsWith('data:image/'))) return 'images must be data:image/ URLs'
  }
  if (body.deadline !== undefined) {
    const parsed = new Date(body.deadline as string)
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return 'deadline must be a valid future date'
  }
  if (body.preferredSupervision !== undefined && body.preferredSupervision !== null && !PREFERRED_SUPERVISION_VALUES.includes(body.preferredSupervision as PreferredSupervisionValue)) {
    return `preferredSupervision must be one of ${PREFERRED_SUPERVISION_VALUES.join(', ')}, or null`
  }
  if (body.acceptanceCriteria !== undefined && body.acceptanceCriteria !== null) {
    if (typeof body.acceptanceCriteria !== 'string') return 'acceptanceCriteria must be a string or null'
    if (body.acceptanceCriteria.length > MAX_ACCEPTANCE_CRITERIA_LENGTH) return `acceptanceCriteria must not exceed ${MAX_ACCEPTANCE_CRITERIA_LENGTH} characters`
  }
  return null
}

// Shared write shape for create + update (same field contract, ADR-397 D8/D11).
async function taskWriteData(body: Record<string, unknown>) {
  const images = Array.isArray(body.images) && body.images.length > 0 ? (body.images as string[]) : null
  const criteria = typeof body.acceptanceCriteria === 'string' ? body.acceptanceCriteria.trim() : ''
  return {
    title: (body.title as string).trim(),
    description: (body.description as string).trim(),
    requiredCapabilities: (body.requiredCapabilities as string[]).map(c => c.trim()),
    budgetSats: body.budgetSats as number,
    // Offer.images contract: native JSON array of data URLs, first entry =
    // cover. FU-870: thumbnails are derived once here for list responses.
    images: images ?? undefined,
    imageThumbs: images ? ((await makeThumbsFromImages(images)) ?? undefined) : undefined,
    deadline: body.deadline ? new Date(body.deadline as string) : null,
    acceptanceCriteria: criteria || null,
    preferredSupervision: (body.preferredSupervision as PreferredSupervisionValue | null | undefined) ?? null,
  }
}

function notifySafe(prisma: PrismaClient, event: BountyEvent, recipients: string[], task: { id: string; title: string }, message?: string, excludePubkey?: string) {
  notifyBounty(prisma, { event, recipients, taskId: task.id, bountyTitle: task.title, message, excludePubkey }).catch(err =>
    console.error(`[agent-tasks] notify ${event} failed:`, err instanceof Error ? err.message : err),
  )
}

async function resolveOptionalCaller(prisma: PrismaClient, req: Request): Promise<string | undefined> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return undefined
  const session = await validateToken(prisma, authHeader.slice(7))
  return session?.pubkey
}

const APPLICATION_INCLUDE = {
  // ADR-315 D3: isVerified + verifiedAt join the embedded select so the task
  // owner's decision view can render the Verified chip on each applicant.
  agentProfile: { select: { id: true, ownerPubkey: true, name: true, avatarUrl: true, reputationScore: true, trustScore: true, isVerified: true, verifiedAt: true } },
  offer: { select: { id: true, title: true, priceSats: true } },
} as const

export function createAgentTaskRouter(prisma: PrismaClient) {
  const router = Router()

  router.post('/', requireAuth(prisma), async (req: Request, res: Response) => {
    const creatorPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!creatorPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const error = validateCreateTaskBody(req.body)
    if (error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: error })

    try {
      // ADR-397 D2-B: a bounty is a promise to pay the winner directly, so
      // publishing needs a wallet that can pay from the app. No balance lock.
      if (!(await hasPayingWalletConnected(prisma, creatorPubkey, isBetaMode()))) {
        return res.status(422).json({
          error: 'PAYER_WALLET_REQUIRED',
          message: 'Connect a wallet that can pay (Nostr Wallet Connect, Alby, WebLN or Cashu) in Settings → Wallet before posting a bounty — you pay the winning agent directly.',
        })
      }
      const task = await prisma.agentTask.create({
        data: { creatorPubkey, ...(await taskWriteData(req.body)) },
      })
      return res.status(201).json({ task })
    } catch (err) {
      console.error('[agent-tasks] POST / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET / — public browse of open (or any status, via ?status=) tasks.
  // FU-483: ?creatorPubkey= powers "my tasks" (Manage). Filtering by creator
  // implies the caller wants their own tasks regardless of state, so the
  // OPEN-only default is dropped in that case — a creator's own ASSIGNED or
  // CANCELLED tasks shouldn't silently disappear from their own list.
  router.get('/', async (req: Request, res: Response) => {
    const creatorPubkey = typeof req.query.creatorPubkey === 'string' ? req.query.creatorPubkey : undefined
    const status = typeof req.query.status === 'string' ? req.query.status : (creatorPubkey ? undefined : 'OPEN')
    if (status && !TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `status must be one of ${TASK_STATUSES.join(', ')}` })
    }
    const capability = typeof req.query.capability === 'string' ? req.query.capability : undefined
    const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, Number(req.query.limit) || LIST_LIMIT_DEFAULT))
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const where = {
      ...(status ? { status: status as never } : {}),
      ...(capability ? { requiredCapabilities: { has: capability } } : {}),
      ...(creatorPubkey ? { creatorPubkey } : {}),
    }

    try {
      const [tasks, total] = await Promise.all([
        prisma.agentTask.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.agentTask.count({ where }),
      ])
      // FU-870: lists ship thumbnails, not the full data-URL photos (legacy
      // rows without thumbnails fall back to the originals).
      // ADR-397 D2-C: each card shows the poster's selected→paid record.
      const reliability = await loadPosterReliability(prisma, tasks.map(t => t.creatorPubkey))
      const listTasks = tasks.map(({ images, imageThumbs, ...t }) => ({
        ...t,
        images: imageThumbs ?? images,
        posterReliability: reliability.get(t.creatorPubkey) ?? null,
      }))
      return res.json({ tasks: listTasks, total, limit, offset })
    } catch (err) {
      console.error('[agent-tasks] GET / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ADR-397 D7: the caller's own applications across all bounties (MCP
  // `my_bounty_applications`). Two path segments, so no clash with GET /:id.
  router.get('/applications/mine', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      const applications = await prisma.agentTaskApplication.findMany({
        where: { agentProfile: { ownerPubkey: callerPubkey } },
        include: { ...APPLICATION_INCLUDE, task: { select: { id: true, title: true, status: true, budgetSats: true, deadline: true } } },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT_MAX,
      })
      return res.json({ applications })
    } catch (err) {
      console.error('[agent-tasks] GET /applications/mine error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /:id — public task detail. Applications are only included for the
  // task's creator (all of them) or a caller who owns one of the applying
  // AgentProfiles (their own application only) — mirrors D4 ("Buyer sieht
  // Bewerbungen"), applications are not a public bid board.
  router.get('/:id', async (req: Request, res: Response) => {
    const id = req.params.id as string
    try {
      let task = await prisma.agentTask.findUnique({ where: { id }, include: { ticket: { select: { id: true, status: true } } } })
      if (!task) return res.status(404).json({ error: 'NOT_FOUND' })

      // ADR-397 D4 safety net: the status-change sites sync the bounty, but a
      // path that moved the ticket without them (e.g. a dispute verdict) is
      // healed here on read. Idempotent and monotonic.
      if (task.ticket && (await syncAgentTaskFromTicket(prisma, task.ticket.id))) {
        task = await prisma.agentTask.findUniqueOrThrow({ where: { id }, include: { ticket: { select: { id: true, status: true } } } })
      }
      // Detail ships the full photos; the list-only thumbnails are dropped.
      const { ticket: linkedTicket, imageThumbs: _thumbs, ...taskFields } = task

      const callerPubkey = await resolveOptionalCaller(prisma, req)
      const isCreator = callerPubkey === task.creatorPubkey

      let applications: unknown[] = []
      if (isCreator) {
        applications = await prisma.agentTaskApplication.findMany({
          where: { taskId: id },
          include: APPLICATION_INCLUDE,
          orderBy: { createdAt: 'desc' },
        })
      } else if (callerPubkey) {
        applications = await prisma.agentTaskApplication.findMany({
          where: { taskId: id, agentProfile: { ownerPubkey: callerPubkey } },
          include: APPLICATION_INCLUDE,
          orderBy: { createdAt: 'desc' },
        })
      }

      // The linked ticket is shown to the poster and to the selected agent's
      // owner (they are its buyer and seller); everyone else sees null.
      const viewerIsWinner = !isCreator && Boolean(callerPubkey) &&
        (applications as Array<{ status?: string }>).some(a => a.status === 'ACCEPTED')
      const posterReliability = (await loadPosterReliability(prisma, [task.creatorPubkey])).get(task.creatorPubkey) ?? null
      return res.json({
        task: { ...taskFields, posterReliability },
        applications,
        viewerIsCreator: isCreator,
        ticket: isCreator || viewerIsWinner ? linkedTicket : null,
      })
    } catch (err) {
      console.error('[agent-tasks] GET /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  router.patch('/:id', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const id = req.params.id as string
    const { action } = req.body as { action?: string }
    if (action !== 'cancel' && action !== 'update') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'action must be "cancel" or "update"' })
    }

    try {
      const task = await prisma.agentTask.findUnique({ where: { id } })
      if (!task) return res.status(404).json({ error: 'NOT_FOUND' })
      if (task.creatorPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN' })
      if (!['OPEN', 'SELECTING'].includes(task.status)) {
        return res.status(409).json({ error: 'INVALID_STATE', message: `Task is ${task.status}, cannot be edited or cancelled` })
      }

      if (action === 'cancel') {
        const updated = await prisma.agentTask.update({ where: { id }, data: { status: 'CANCELLED' } })
        // ADR-397 D5: tell applicants whose application was still live.
        const live = await prisma.agentTaskApplication.findMany({
          where: { taskId: id, status: { in: ['PENDING', 'AWAITING_OWNER_APPROVAL'] } },
          select: { agentProfile: { select: { ownerPubkey: true } } },
        })
        notifySafe(prisma, 'cancelled', live.map(a => a.agentProfile.ownerPubkey), task)
        return res.json({ task: updated })
      }

      // action === 'update' — creator re-publishes the job while it's still
      // open to applications (Edit on the detail page). Same field contract as
      // POST / (validateCreateTaskBody) so edit and create stay in lockstep.
      const validationError = validateCreateTaskBody(req.body)
      if (validationError) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: validationError })
      }
      const updated = await prisma.agentTask.update({ where: { id }, data: await taskWriteData(req.body) })

      // FU-870: an edit can invalidate live applications (lower budget, new
      // capability, different supervision). Those are rejected and their
      // owners told, so the poster never selects an application that no
      // longer matches the bounty.
      const live = await prisma.agentTaskApplication.findMany({
        where: { taskId: id, status: { in: ['PENDING', 'AWAITING_OWNER_APPROVAL'] } },
        select: {
          id: true, proposedPriceSats: true,
          offer: { select: { priceSats: true } },
          agentProfile: { select: { ownerPubkey: true, capabilities: true, humanInLoop: true } },
        },
      })
      const invalid = live.filter(a => !applicationStillEligible(updated, {
        proposedPriceSats: a.proposedPriceSats,
        offerPriceSats: a.offer.priceSats,
        agentCapabilities: a.agentProfile.capabilities,
        agentHumanInLoop: a.agentProfile.humanInLoop,
      }))
      if (invalid.length > 0) {
        await prisma.agentTaskApplication.updateMany({
          where: { id: { in: invalid.map(a => a.id) }, status: { in: ['PENDING', 'AWAITING_OWNER_APPROVAL'] } },
          data: { status: 'REJECTED' },
        })
        notifySafe(prisma, 'no_longer_eligible', invalid.map(a => a.agentProfile.ownerPubkey), updated)
      }
      return res.json({ task: updated })
    } catch (err) {
      console.error('[agent-tasks] PATCH /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  router.post('/:id/applications', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const taskId = req.params.id as string
    const { agentProfileId, offerId, message, proposedPriceSats, proposedETA } = req.body as {
      agentProfileId?: string
      offerId?: string
      message?: string
      proposedPriceSats?: number
      proposedETA?: string
    }

    if (!agentProfileId || !offerId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'agentProfileId and offerId are required' })
    if (message !== undefined && (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `message must be a string up to ${MAX_MESSAGE_LENGTH} characters` })
    }
    if (proposedPriceSats !== undefined && (typeof proposedPriceSats !== 'number' || !Number.isInteger(proposedPriceSats) || proposedPriceSats <= 0)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'proposedPriceSats must be a positive integer' })
    }

    try {
      const task = await prisma.agentTask.findUnique({ where: { id: taskId } })
      if (!task) return res.status(404).json({ error: 'NOT_FOUND' })
      if (task.status !== 'OPEN') return res.status(409).json({ error: 'INVALID_STATE', message: `Task is ${task.status}, not accepting applications` })

      const agentProfile = await prisma.agentProfile.findUnique({ where: { id: agentProfileId } })
      if (!agentProfile) return res.status(404).json({ error: 'AGENT_PROFILE_NOT_FOUND' })
      if (agentProfile.ownerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not own this agent profile' })

      const offer = await prisma.offer.findUnique({ where: { id: offerId } })
      if (!offer || offer.agentProfileId !== agentProfileId || offer.offerType !== 'AGENT_SETUP' || offer.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'offerId must reference an active AGENT_SETUP offer belonging to this agent' })
      }

      // FU-483 (ADR-328 D2): a real, enforced filter — not a soft display hint.
      // The buyer already stated a hard preference by picking Supervision in
      // the Guide; null (no preference) never blocks.
      if (!matchesSupervision(task.preferredSupervision, agentProfile.humanInLoop)) {
        return res.status(400).json({
          error: 'SUPERVISION_MISMATCH',
          message: `This task requires a ${task.preferredSupervision === 'AUTONOMOUS' ? 'fully autonomous' : 'human-in-the-loop'} agent`,
        })
      }

      if (!hasRequiredCapabilities(task.requiredCapabilities, agentProfile.capabilities)) {
        return res.status(400).json({ error: 'CAPABILITY_MISMATCH', message: 'This agent does not have all required capabilities for this task', required: task.requiredCapabilities })
      }

      const effectivePrice = proposedPriceSats ?? offer.priceSats
      if (!withinBudget(effectivePrice, task.budgetSats)) {
        return res.status(400).json({ error: 'BUDGET_EXCEEDED', message: 'Proposed price exceeds the task budget' })
      }

      const application = await prisma.agentTaskApplication.create({
        data: {
          taskId,
          agentProfileId,
          offerId,
          message: message?.trim() || null,
          proposedPriceSats: effectivePrice,
          proposedETA: proposedETA ? new Date(proposedETA) : null,
          status: 'PENDING',
        },
        include: APPLICATION_INCLUDE,
      })
      notifySafe(prisma, 'application_received', [task.creatorPubkey], task, `${agentProfile.name} applied to "${task.title}"`)
      return res.status(201).json({ application })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') {
        return res.status(409).json({ error: 'ALREADY_APPLIED', message: 'This agent has already applied to this task' })
      }
      console.error('[agent-tasks] POST /:id/applications error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  router.patch('/:id/applications/:appId', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const appId = req.params.appId as string
    const { action } = req.body as { action?: string }
    if (action !== 'withdraw' && action !== 'confirm') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'action must be "withdraw" or "confirm"' })
    }

    try {
      const application = await prisma.agentTaskApplication.findUnique({
        where: { id: appId },
        include: { agentProfile: { select: { ownerPubkey: true } } },
      })
      if (!application || application.taskId !== req.params.id) return res.status(404).json({ error: 'NOT_FOUND' })
      if (application.agentProfile.ownerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN' })

      if (action === 'withdraw') {
        if (!['PENDING', 'AWAITING_OWNER_APPROVAL'].includes(application.status)) {
          return res.status(409).json({ error: 'INVALID_STATE', message: `Application is ${application.status}, cannot be withdrawn` })
        }
        const updated = await prisma.agentTaskApplication.update({ where: { id: appId }, data: { status: 'WITHDRAWN' }, include: APPLICATION_INCLUDE })
        return res.json({ application: updated })
      }

      // confirm
      if (application.status !== 'AWAITING_OWNER_APPROVAL') {
        return res.status(409).json({ error: 'INVALID_STATE', message: 'Only an auto-applied application awaiting approval can be confirmed' })
      }
      const updated = await prisma.agentTaskApplication.update({ where: { id: appId }, data: { status: 'PENDING' }, include: APPLICATION_INCLUDE })
      const confirmedTask = await prisma.agentTask.findUnique({ where: { id: application.taskId }, select: { id: true, title: true, creatorPubkey: true } })
      if (confirmedTask) notifySafe(prisma, 'application_received', [confirmedTask.creatorPubkey], confirmedTask)
      return res.json({ application: updated })
    } catch (err) {
      console.error('[agent-tasks] PATCH /:id/applications/:appId error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  router.post('/:id/select', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const taskId = req.params.id as string
    const { applicationId } = req.body as { applicationId?: string }
    if (!applicationId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'applicationId is required' })

    try {
      const task = await prisma.agentTask.findUnique({ where: { id: taskId } })
      if (!task) return res.status(404).json({ error: 'NOT_FOUND' })
      if (task.creatorPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN' })
      if (!['OPEN', 'SELECTING'].includes(task.status)) {
        return res.status(409).json({ error: 'INVALID_STATE', message: `Task is ${task.status}, cannot select a winner` })
      }

      const application = await prisma.agentTaskApplication.findUnique({ where: { id: applicationId } })
      if (!application || application.taskId !== taskId) return res.status(404).json({ error: 'APPLICATION_NOT_FOUND' })
      if (application.status !== 'PENDING') {
        return res.status(409).json({ error: 'INVALID_STATE', message: `Application is ${application.status}, not selectable` })
      }

      // CAS transaction: two concurrent /select calls can both pass the checks
      // above before either commits. Both writes below condition their `where`
      // on the expected prior status (same idiom as casTicketUpdate) so only
      // one request's claim actually takes — the loser gets a 409, not a
      // silent double-assignment.
      let rejectedOwners: string[] = []
      const { updatedTask, selectedApplication } = await prisma.$transaction(async (tx) => {
        const claimedTask = await tx.agentTask.updateMany({
          where: { id: taskId, status: { in: ['OPEN', 'SELECTING'] } },
          data: { status: 'ASSIGNED', selectedAgentProfileId: application.agentProfileId, selectedOfferId: application.offerId },
        })
        if (claimedTask.count === 0) throw new SelectConflictError()

        const claimedApp = await tx.agentTaskApplication.updateMany({
          where: { id: applicationId, status: 'PENDING' },
          data: { status: 'ACCEPTED' },
        })
        if (claimedApp.count === 0) throw new SelectConflictError()

        const rivals = await tx.agentTaskApplication.findMany({
          where: { taskId, status: { in: ['PENDING', 'AWAITING_OWNER_APPROVAL'] }, id: { not: applicationId } },
          select: { agentProfile: { select: { ownerPubkey: true } } },
        })
        await tx.agentTaskApplication.updateMany({
          where: { taskId, status: { in: ['PENDING', 'AWAITING_OWNER_APPROVAL'] }, id: { not: applicationId } },
          data: { status: 'REJECTED' },
        })
        rejectedOwners = rivals.map(r => r.agentProfile.ownerPubkey)

        return {
          updatedTask: await tx.agentTask.findUniqueOrThrow({ where: { id: taskId } }),
          selectedApplication: await tx.agentTaskApplication.findUniqueOrThrow({
            where: { id: applicationId },
            include: APPLICATION_INCLUDE,
          }),
        }
      })

      // ADR-397 D5: winner and the other applicants learn the outcome. The
      // winner's owner is excluded from the "rejected" list (one owner can
      // apply with several agents).
      const winnerOwner = selectedApplication.agentProfile.ownerPubkey
      notifySafe(prisma, 'selected', [winnerOwner], updatedTask, `Your agent was selected for "${updatedTask.title}". The poster now creates the ticket and pays you directly.`)
      notifySafe(prisma, 'rejected', rejectedOwners, updatedTask, undefined, winnerOwner)
      return res.json({
        task: updatedTask,
        selectedApplication,
        nextStep: { method: 'POST', path: '/api/tickets', body: { offerId: application.offerId, agentTaskApplicationId: applicationId } },
      })
    } catch (err) {
      if (err instanceof SelectConflictError) {
        return res.status(409).json({ error: 'CONFLICT', message: 'Task was already assigned by a concurrent request' })
      }
      console.error('[agent-tasks] POST /:id/select error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ADR-397 D4 (closes FU-426): undo a selection while no live ticket exists —
  // e.g. ticket creation failed (seller rail missing, launch cap, payments
  // paused) or the ticket was cancelled. The bounty goes back to SELECTING and
  // every application the selection had settled returns to PENDING.
  router.post('/:id/revert-selection', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const taskId = req.params.id as string

    try {
      const task = await prisma.agentTask.findUnique({ where: { id: taskId }, include: { ticket: { select: { id: true, status: true } } } })
      if (!task) return res.status(404).json({ error: 'NOT_FOUND' })
      if (task.creatorPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN' })
      if (!canRevertSelection(task.status, task.ticket?.status ?? null)) {
        return res.status(409).json({
          error: 'INVALID_STATE',
          message: task.ticket && task.ticket.status !== 'CANCELLED'
            ? 'A ticket for this bounty exists — cancel it before changing the winner'
            : `Task is ${task.status}, there is no selection to revert`,
        })
      }

      const updatedTask = await prisma.$transaction(async (tx) => {
        const claimed = await tx.agentTask.updateMany({
          where: { id: taskId, status: task.status },
          data: { status: 'SELECTING', selectedAgentProfileId: null, selectedOfferId: null },
        })
        if (claimed.count === 0) throw new BountyTicketConflictError()
        // Re-check under the row lock: a ticket created concurrently must win.
        const live = await tx.ticket.findFirst({ where: { agentTaskId: taskId, status: { not: 'CANCELLED' } }, select: { id: true } })
        if (live) throw new BountyTicketConflictError()
        await tx.ticket.updateMany({ where: { agentTaskId: taskId, status: 'CANCELLED' }, data: { agentTaskId: null } })
        await tx.agentTaskApplication.updateMany({
          where: { taskId, status: { in: ['ACCEPTED', 'REJECTED'] } },
          data: { status: 'PENDING' },
        })
        return tx.agentTask.findUniqueOrThrow({ where: { id: taskId } })
      })
      return res.json({ task: updatedTask })
    } catch (err) {
      if (err instanceof BountyTicketConflictError) {
        return res.status(409).json({ error: 'CONFLICT', message: 'The bounty changed concurrently — reload and try again' })
      }
      console.error('[agent-tasks] POST /:id/revert-selection error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
