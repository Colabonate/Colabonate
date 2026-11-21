import { Router, type Request, type Response } from 'express'
import type { PrismaClient, Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { requireAuth } from '../middleware/require-auth.js'
import { WorkspaceStatusSchema, type WorkspaceStatus } from '../lib/enums.js'
import { verifyPreimage } from '../lib/preimage.js'
import { canTransitionWorkspace } from '../services/workspace-lifecycle.js'
import {
  deployWorkspace,
  getWorkspaceCanisterClient,
  isWorkspaceRelayInSyncError,
  WorkspaceCanisterError,
} from '../services/workspace-canister-client.js'
import { resolvePlatformInvoice } from '../services/platformPaymentResolver.js'
import { isBetaMode } from '../services/betaMode.js'
import { computeMandatoryInitialFundingSats, satsToCycles, validateRechargeAmount } from '../services/workspace-recharge.js'
import { exceedsLaunchCap, launchCapErrorBody, rejectIfAboveLaunchCap, resolveLaunchMaxTxSats } from '../lib/launch-tx-cap.js'
import { validateChatMessageInput, validateSignerPubkey } from '../services/workspace-chat.js'
import { readCanvasConfig } from '../lib/canvas-config.js'
import { enqueueCanvasProvisioning, enqueueProvisioningOnPaid, requestCanvasLoginUrl } from '../services/canvas-provisioning.js'
import { enqueueCanvasLifecycleForWorkspace } from '../services/canvas-lifecycle.js'
import { syncMilestoneStatusFromSteps } from '../services/coop-milestone-progress.js'
import { seedHandoffContextIfApplicable } from '../services/coop-pipeline-handoff.js'
import { notifyAgentConfigNeeded } from '../services/notifications.js'

// ADR-311 D2/D5: workspace lifecycle API. The server owns deploy-request
// (creation from a paid AGENT_SETUP ticket), buyer completion, and TTL expiry
// (sweep in index.ts); the RUNNING flip on creation goes through the D5
// canister client (FU-432) when `ICP_WORKSPACE_CANISTER_ID` is configured.
// SUSPENDED/resume transitions are budget-driven by the canister (FU-433)
// and are therefore not exposed as routes here.
//
// All routes require auth — a workspace is buyer-scoped runtime state, not
// marketplace data, so unlike agent-tasks there is no public read tier.
//
// Deliberate scope cuts vs. the ADR text (documented in the ADR's
// Implementation Record):
//  - Creation is an explicit client call after payment (mirrors ADR-319's
//    nextStep pattern) instead of a hook inside the ticket payment flow —
//    that path is payment-critical and must not gain side effects without
//    explicit sign-off.
//  - Cycle reload (FU-433) exists as recharge + confirm below; manual
//    suspend/resume routes do NOT — those transitions are budget-driven by
//    the canister and mirror back through the recharge relay.
//  - Outputs read (D5 getOutputs) is a thin proxy. Sending a chat message
//    (ADR-314 minimal slice, POST /:id/messages) IS mirrored here as a relay
//    to the canister's buyer-signed `post_message` (FU-434 Slice C) — the
//    server never signs on the buyer's behalf, it only forwards a signature
//    the buyer already produced client-side.

const DEFAULT_WORKSPACE_TTL_SECONDS = 604800 // 7 days, mirrors Offer.agentWorkspaceTTL default
const LIST_LIMIT_DEFAULT = 20

// ADR-349 D1: pubkey format shared by the membership-invite route and the
// existing chat/config-injection routes below (senderPubkey).
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i

// The canister's `created_at` is `ic_cdk::api::time()` — nanoseconds since the
// Unix epoch, per IC convention (not seconds). Convert to a proper ISO-8601
// string here rather than shipping the raw nanosecond count as an opaque
// string — found via headless-browser validation: the client was treating it
// as seconds (`Number(createdAt) * 1000`), overflowing into an out-of-range
// Date and crashing the whole page with "Invalid time value".
function nanosToIso(ns: bigint): string {
  return new Date(Number(ns / 1_000_000n)).toISOString()
}
const LIST_LIMIT_MAX = 50

// ADR-352 D1: a Cooperation-anchored workspace has no Ticket at all, so the
// pre-ADR-352 `workspace.ticket.sellerPubkey` authorization pattern needs a
// second source — the assigned Offer's AgentProfile owner (the same identity
// that would have been the ticket's sellerPubkey in the single-ticket flow,
// since a ticket's seller is always the offer's creator/agent owner).
async function resolveWorkspaceSellerPubkey(
  prisma: PrismaClient,
  workspace: { ticketId: string | null; agentProfileId: string | null },
): Promise<string | null> {
  if (workspace.ticketId) {
    const ticket = await prisma.ticket.findUnique({ where: { id: workspace.ticketId }, select: { sellerPubkey: true } })
    return ticket?.sellerPubkey ?? null
  }
  if (workspace.agentProfileId) {
    const agentProfile = await prisma.agentProfile.findUnique({ where: { id: workspace.agentProfileId }, select: { ownerPubkey: true } })
    return agentProfile?.ownerPubkey ?? null
  }
  return null
}

// ADR-352 D1/D3: shared tail for both workspace-creation anchors (ticket and
// cooperation) — mandatory-funding resolution (verbatim reuse of the
// single-ticket flow's ADR-351 mechanism, per D3), row creation, canvas
// provisioning enqueue, and best-effort canister deploy. Extracted so this
// payment-critical sequence exists exactly once, not duplicated per anchor.
async function createFundedWorkspace(
  prisma: PrismaClient,
  data: Prisma.WorkspaceUncheckedCreateInput,
  fundingMemo: string,
  estimatedWorkspaceHours: number | null,
  agentWorkspaceTTL: number | null,
  provisionOnCreate = true,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const requiredSats = computeMandatoryInitialFundingSats(estimatedWorkspaceHours ?? 0)
  // ADR-252 D2 / FU-655: launch-phase per-transaction cap — the mandatory
  // initial funding is a real invoice against the buyer, so it is capped too.
  const launchCap = resolveLaunchMaxTxSats()
  if (launchCap !== null && exceedsLaunchCap(requiredSats, launchCap)) {
    return { status: 400, body: launchCapErrorBody(requiredSats, launchCap) }
  }
  const fundingResolution = await resolvePlatformInvoice(requiredSats, fundingMemo)
  if (!fundingResolution.ok) {
    return { status: 503, body: { error: 'PLATFORM_PAYMENT_NOT_CONFIGURED', message: 'Workspace funding is temporarily unavailable — try again shortly.' } }
  }

  const workspace = await prisma.workspace.create({ data })
  if (data.canvasProvider === 'doop-hosted' && provisionOnCreate) {
    // ADR-342 D3/A2: provisioning runs via the outbox — a doop outage must
    // not block workspace creation. ADR-370 Phase 1: provisionOnCreate=false
    // when the ticket already carries the doop-hosted binding (snapshotted at
    // purchase, auto-enqueued at PAID) — the workspace mirrors the ticket's
    // canvas instead of provisioning a second one.
    await enqueueCanvasProvisioning(prisma, workspace.id)
  }

  const mandatoryRecharge = await prisma.workspaceRecharge.create({
    data: {
      workspaceId: workspace.id,
      amountSats: requiredSats,
      rail: fundingResolution.rail,
      bolt11: fundingResolution.rail === 'LN' ? fundingResolution.invoice.bolt11 : null,
      paymentHash: fundingResolution.rail === 'LN' ? fundingResolution.invoice.paymentHash : randomBytes(32).toString('hex'),
      isMandatoryInitial: true,
    },
  })

  const deployed = workspace.agentProfileId
    ? await deployWorkspace({
        workspaceId: workspace.id,
        buyerPubkey: workspace.canisterBuyerPubkey ?? workspace.buyerPubkey,
        agentProfileId: workspace.agentProfileId,
        ttlSeconds: agentWorkspaceTTL ?? DEFAULT_WORKSPACE_TTL_SECONDS,
        billingModel: workspace.agentBillingModel ?? 'ONE_TIME',
      })
    : null

  let finalWorkspace: typeof workspace = workspace
  if (deployed && canTransitionWorkspace('PENDING_DEPLOY', 'RUNNING')) {
    finalWorkspace = await prisma.workspace.update({
      where: { id: workspace.id },
      data: { canisterId: deployed.canisterId, canisterWorkspaceId: deployed.canisterWorkspaceId, status: 'RUNNING', activatedAt: new Date() },
    })
  }

  return {
    status: 201,
    body: {
      workspace: finalWorkspace,
      mandatoryFunding: { recharge: mandatoryRecharge, invoice: fundingResolution.rail === 'LN' ? fundingResolution.invoice : null },
    },
  }
}

export function createWorkspaceRouter(prisma: PrismaClient) {
  const router = Router()

  // POST / — create a workspace from either:
  //  (a) a paid AGENT_SETUP ticket (ticketId) — the original single-ticket
  //      flow, 1:1 with the ticket (unique constraint); safe to retry.
  //  (b) a Cooperation + Offer pair (cooperationId + offerId) — ADR-352 D1:
  //      one Workspace per (Cooperation, Offer), shared by every milestone/
  //      step assigned to that Offer anywhere in the pipeline. Safe to retry
  //      (unique constraint on cooperationId+offerId).
  // Exactly one of ticketId / cooperationId must be set.
  router.post('/', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const { ticketId, cooperationId, offerId, signerPubkey } = req.body ?? {}
    if (ticketId && cooperationId) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'ticketId and cooperationId are mutually exclusive' })
    }
    if (!ticketId && !cooperationId) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'ticketId or (cooperationId + offerId) is required' })
    }
    // ADR-314: the pubkey that will authorize buyer-direct chat/tool-call
    // actions on the canister. Defaults to the caller's login pubkey below
    // (unchanged legacy behavior) when omitted — see schema comment on
    // Workspace.canisterBuyerPubkey for why this can differ from buyerPubkey.
    const signerPubkeyValidation = validateSignerPubkey(signerPubkey)
    if (!signerPubkeyValidation.ok) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: signerPubkeyValidation.message })
    }
    const canisterBuyerPubkey = signerPubkeyValidation.value ?? callerPubkey

    try {
      if (ticketId) {
        if (typeof ticketId !== 'string') return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'ticketId must be a string' })
        const ticket = await prisma.ticket.findUnique({
          where: { id: ticketId },
          include: { offer: { select: { id: true, title: true, offerType: true, agentProfileId: true, agentWorkspaceTTL: true, agentConfigMeta: true, estimatedWorkspaceHours: true } } },
        })
        if (!ticket) return res.status(404).json({ error: 'NOT_FOUND', message: 'ticket not found' })
        if (ticket.buyerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN', message: 'only the ticket buyer can create its workspace' })
        if (ticket.offerType !== 'AGENT_SETUP' || !ticket.offer) {
          return res.status(400).json({ error: 'NOT_AGENT_SETUP', message: 'workspaces require an AGENT_SETUP offer ticket' })
        }
        if (ticket.status !== 'PAID' && ticket.status !== 'IN_PROGRESS') {
          return res.status(409).json({ error: 'TICKET_NOT_PAID', message: `workspace requires a paid ticket (status is ${ticket.status})` })
        }

        const existing = await prisma.workspace.findUnique({ where: { ticketId } })
        if (existing) return res.status(409).json({ error: 'WORKSPACE_EXISTS', workspace: existing })

        // ADR-370 Phase 1 (FU-670): the ticket-anchored provisioning event is
        // normally enqueued at the first PAID transition (paymentConfirmation /
        // CASHU self-report PATCH). That hook is fire-and-forget, so re-run it
        // idempotently here BEFORE the workspace mirrors the binding — closes
        // the "hook failed → canvas never provisioned, workspace binds pending
        // forever" window. No-op for non-hosted, pending, or ready tickets.
        // DB-only (never a doop HTTP call — A2), so a transient DB failure
        // here legitimately fails workspace creation (same outage surface as
        // the funding resolution below).
        await enqueueProvisioningOnPaid(prisma, ticketId)

        // ADR-312 D6: denormalize the ticket's billing-model snapshot onto the
        // workspace (same convention as agentProfileId) — defaults to ONE_TIME
        // for pre-ADR-312 tickets that never had one set.
        const agentBillingModel = ticket.agentBillingModel ?? 'ONE_TIME'
        // ADR-342 D3/D4a (Phase B) + ADR-370 Phase 1 (FU-670): the doop-hosted
        // collaboration canvas is bound at the TICKET level since Phase 1 —
        // snapshotted at purchase, auto-provisioned at PAID. When the ticket
        // already carries that binding, the workspace MIRRORS it (canvasId +
        // provisioning status) and does NOT provision a second canvas
        // (provisionOnCreate=false — provisioning is ticket-anchored). Legacy
        // pre-Phase-1 tickets (no ticket snapshot) fall back to deriving from
        // the offer and provision workspace-anchored exactly as before.
        const ticketCanvasProvider = ticket.canvasProvider
        const offerCanvas = readCanvasConfig(ticket.offer.agentConfigMeta)
        const isHostedTicketBinding = ticketCanvasProvider === 'doop-hosted'
        const isHostedCanvas = isHostedTicketBinding || offerCanvas?.provider === 'doop-hosted'

        // FU-376 (revised 2026-08-30 — ADR-351): the Initiator (buyer) always
        // pre-funds a mandatory minimum at workspace initiation, resolved
        // BEFORE the workspace row is created so a platform misconfiguration
        // never produces an unusable, unfundable workspace.
        const result = await createFundedWorkspace(
          prisma,
          {
            ticketId,
            offerId: ticket.offer.id,
            agentProfileId: ticket.offer.agentProfileId ?? undefined,
            buyerPubkey: callerPubkey,
            canisterBuyerPubkey,
            agentBillingModel,
            ...(isHostedCanvas
              ? {
                  canvasProvider: 'doop-hosted',
                  // Phase-1 ticket binding is authoritative for buyerAccess;
                  // legacy fallback derives the D4a choice from the offer.
                  canvasBuyerAccess: isHostedTicketBinding
                    ? (ticket.canvasBuyerAccess ?? 'edit')
                    : (offerCanvas?.buyerAccess ?? 'edit'),
                  // Mirror the ticket's pinned canvasId (null = create new) and
                  // provisioning status so the workspace never double-provisions.
                  canvasId: isHostedTicketBinding ? ticket.canvasId : (offerCanvas?.canvasId ?? null),
                  canvasProvisioningStatus: isHostedTicketBinding
                    ? (ticket.canvasProvisioningStatus ?? 'pending')
                    : 'pending',
                }
              : {}),
          },
          `Workspace initial funding: ${ticketId}`,
          ticket.offer.estimatedWorkspaceHours,
          ticket.offer.agentWorkspaceTTL,
          // Legacy tickets without a ticket-level binding provision
          // workspace-anchored; Phase-1 ticket bindings never do.
          !isHostedTicketBinding,
        )
        // ADR-396 D5 (FU-852): a deployed workspace waits for the seller's
        // config injection — tell the seller instead of waiting silently.
        const created = (result.body as { workspace?: { id: string; canisterWorkspaceId: string | null } }).workspace
        if (result.status === 201 && created?.canisterWorkspaceId) {
          notifyAgentConfigNeeded(prisma, {
            workspaceId: created.id,
            ticketId,
            sellerPubkey: ticket.sellerPubkey,
            buyerPubkey: callerPubkey,
            offerTitle: ticket.offer.title,
          }).catch(err => console.error('[notify] agent config needed failed:', err))
        }
        return res.status(result.status).json(result.body)
      }

      // ADR-352 D1: cooperation-anchored creation.
      if (typeof cooperationId !== 'string' || typeof offerId !== 'string') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'offerId is required when creating a workspace from a cooperationId' })
      }
      const cooperation = await prisma.cooperation.findUnique({ where: { id: cooperationId } })
      if (!cooperation) return res.status(404).json({ error: 'NOT_FOUND', message: 'cooperation not found' })
      if (cooperation.initiatorPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'only the cooperation initiator can create its workspaces' })
      }
      if (!cooperation.isAgentOrchestration) {
        return res.status(400).json({ error: 'NOT_AGENT_ORCHESTRATION', message: 'this cooperation has no agent-orchestration pipeline' })
      }

      // D1a: the offer must actually be assigned somewhere in this
      // cooperation's pipeline (milestone-level or step-level) — proves it's
      // a real, validated agent engagement, not an arbitrary offer id.
      const isAssigned = await prisma.coopMilestone.findFirst({
        where: { cooperationId, OR: [{ assigneeOfferId: offerId }, { steps: { some: { assigneeOfferId: offerId } } }] },
        select: { id: true },
      })
      if (!isAssigned) {
        return res.status(400).json({ error: 'OFFER_NOT_ASSIGNED', message: 'this offer is not assigned to any milestone or step of this cooperation' })
      }

      const offer = await prisma.offer.findUnique({
        where: { id: offerId },
        select: { id: true, offerType: true, status: true, agentProfileId: true, agentWorkspaceTTL: true, agentConfigMeta: true, estimatedWorkspaceHours: true, agentBillingModel: true },
      })
      if (!offer || offer.offerType !== 'AGENT_SETUP') {
        return res.status(400).json({ error: 'NOT_AGENT_SETUP', message: 'workspaces require an AGENT_SETUP offer' })
      }

      const existing = await prisma.workspace.findUnique({ where: { cooperationId_offerId: { cooperationId, offerId } } })
      if (existing) return res.status(409).json({ error: 'WORKSPACE_EXISTS', workspace: existing })

      const offerCanvas = readCanvasConfig(offer.agentConfigMeta)
      const isHostedCanvas = offerCanvas?.provider === 'doop-hosted'

      // D3: cycle funding reuses computeMandatoryInitialFundingSats verbatim
      // — because the workspace is anchored to a real Offer (D1a), the same
      // estimatedWorkspaceHours-based formula the single-ticket flow already
      // uses applies unchanged. Paid once at first creation; subsequent
      // steps assigned to this same already-running workspace use the
      // existing voluntary POST /:id/recharge flow if the budget runs low.
      const result = await createFundedWorkspace(
        prisma,
        {
          cooperationId,
          offerId,
          agentProfileId: offer.agentProfileId ?? undefined,
          buyerPubkey: callerPubkey,
          canisterBuyerPubkey,
          agentBillingModel: offer.agentBillingModel ?? 'ONE_TIME',
          ...(isHostedCanvas
            ? {
                canvasProvider: 'doop-hosted',
                canvasBuyerAccess: offerCanvas?.buyerAccess ?? 'edit',
                canvasId: offerCanvas?.canvasId ?? null,
                canvasProvisioningStatus: 'pending',
              }
            : {}),
        },
        `Workspace initial funding: coop ${cooperationId} / offer ${offerId}`,
        offer.estimatedWorkspaceHours,
        offer.agentWorkspaceTTL,
      )
      return res.status(result.status).json(result.body)
    } catch (err) {
      console.error('[workspaces] POST / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET / — caller's own workspaces (as buyer), optional ?status= filter.
  router.get('/', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    let status: WorkspaceStatus | undefined
    if (typeof req.query.status === 'string') {
      const parsed = WorkspaceStatusSchema.safeParse(req.query.status)
      if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'unknown status filter' })
      status = parsed.data
    }
    const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, Number(req.query.limit) || LIST_LIMIT_DEFAULT))
    const offset = Math.max(0, Number(req.query.offset) || 0)

    try {
      const where = { buyerPubkey: callerPubkey, ...(status ? { status } : {}) }
      const [workspaces, total] = await Promise.all([
        prisma.workspace.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
        prisma.workspace.count({ where }),
      ])
      return res.json({ workspaces, total, limit, offset })
    } catch (err) {
      console.error('[workspaces] GET / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /:id — buyer, ticket seller, or an invited collaborator (ADR-349 D1).
  router.get('/:id', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id },
        include: {
          members: { where: { pubkey: callerPubkey }, select: { pubkey: true, canisterSignerPubkey: true } },
        },
      })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      // ADR-352 D1: a Cooperation-anchored workspace has no Ticket — resolve
      // the equivalent "seller" identity via the assigned Offer's AgentProfile
      // owner instead (see resolveWorkspaceSellerPubkey).
      const sellerPubkey = await resolveWorkspaceSellerPubkey(prisma, workspace)
      if (workspace.buyerPubkey !== callerPubkey && sellerPubkey !== callerPubkey && workspace.members.length === 0) {
        return res.status(403).json({ error: 'FORBIDDEN' })
      }
      // ADR-349 D1: the client previously inferred `isSeller = !isBuyer`,
      // safe only while buyer/seller were the sole two roles that could reach
      // this route. Now that an invited collaborator also can, that
      // inference would misclassify them as the seller (and show
      // seller-only UI like "Inject Config"). Compute the real role
      // server-side instead of leaking sellerPubkey for the client to
      // compare against.
      const viewerRole: 'buyer' | 'seller' | 'collaborator' =
        workspace.buyerPubkey === callerPubkey ? 'buyer' : sellerPubkey === callerPubkey ? 'seller' : 'collaborator'
      // FU-589: the device-local key this specific viewer needs to match
      // (via getWorkspaceSignerPubkey()) to actually sign buyer-direct
      // actions — canisterBuyerPubkey for the buyer, this member's own
      // registered canisterSignerPubkey for a collaborator (null until they
      // register one themselves, POST /:id/members/me/signer). A seller with
      // read-only ticket-based access (no WorkspaceMember row) never gets one.
      const viewerSignerPubkey: string | null =
        viewerRole === 'buyer' ? workspace.canisterBuyerPubkey : viewerRole === 'collaborator' ? (workspace.members[0]?.canisterSignerPubkey ?? null) : null
      const { members: _members, ...rest } = workspace
      // FU-470: surface whether the canister already has a config injected
      // so the client can hide the "Inject Config" trigger once it's done.
      // Honest false (not an error) when no canister backend is configured —
      // same convention as GET /:id/outputs.
      let hasConfig = false
      if (workspace.canisterWorkspaceId) {
        const client = await getWorkspaceCanisterClient()
        if (client) {
          const view = await client.getWorkspaceView(workspace.canisterWorkspaceId)
          hasConfig = view?.hasConfig ?? false
        }
      }
      // ADR-351: surface the mandatory-funding recharge so the client can
      // render a pay-to-activate gate without depending on the one-time
      // POST / creation response (which the client won't have on reload, or
      // after a 409 WORKSPACE_EXISTS retry). null for pre-FU-376 legacy
      // workspaces that never got one — already implicitly "funded".
      const mandatoryRecharge = await prisma.workspaceRecharge.findFirst({ where: { workspaceId: id, isMandatoryInitial: true } })
      const mandatoryFunding = mandatoryRecharge
        ? {
            id: mandatoryRecharge.id,
            amountSats: mandatoryRecharge.amountSats,
            status: mandatoryRecharge.status,
            rail: mandatoryRecharge.rail,
            bolt11: mandatoryRecharge.rail === 'LN' && mandatoryRecharge.status === 'PENDING' ? mandatoryRecharge.bolt11 : null,
          }
        : null
      // ADR-397 D6: a workspace created from a bounty ticket carries the brief
      // the agent was hired for (snapshotted on the ticket at creation).
      const bountyBrief = workspace.ticketId
        ? (await prisma.ticket.findUnique({ where: { id: workspace.ticketId }, select: { bountyBrief: true } }))?.bountyBrief ?? null
        : null
      return res.json({ workspace: { ...rest, hasConfig, mandatoryFunding, viewerRole, viewerSignerPubkey, bountyBrief } })
    } catch (err) {
      console.error('[workspaces] GET /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ADR-370 D8 (FU-674) + ADR-342 D4: workspace-keyed doop login-URL route.
  // Coop-Open-Parity: a Cooperation-anchored workspace (ADR-352, ticketId=null)
  // must open its provisioned hosted canvas exactly like a ticket workspace does
  // via ticket-canvas GET /:id/canvas-url. Access mirrors GET /:id: caller must
  // be the buyer or the resolved seller (ticket sellerPubkey, or the assigned
  // Offer's AgentProfile owner for coop workspaces — resolveWorkspaceSellerPubkey).
  // The buyer is refused when the D4a snapshot says canvasBuyerAccess === 'none'
  // (F1: doop has no view-only share link — the canvas is seller-only then).
  router.get('/:id/canvas-url', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    try {
      const workspace = await prisma.workspace.findUnique({ where: { id } })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      // ADR-352 D1: a Cooperation-anchored workspace has no Ticket — resolve the
      // equivalent "seller" identity via the assigned Offer's AgentProfile owner
      // instead (same resolver + gate as GET /:id, so no auth drift).
      const sellerPubkey = await resolveWorkspaceSellerPubkey(prisma, workspace)
      if (workspace.buyerPubkey !== callerPubkey && sellerPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'FORBIDDEN' })
      }
      if (workspace.canvasProvider !== 'doop-hosted') {
        return res.status(409).json({ error: 'NO_HOSTED_CANVAS', message: 'this workspace has no Colabonate-hosted canvas' })
      }
      if (workspace.canvasProvisioningStatus !== 'ready' || !workspace.canvasId) {
        return res.status(409).json({
          error: 'CANVAS_NOT_READY',
          status: workspace.canvasProvisioningStatus ?? 'pending',
          message: 'the canvas is not provisioned yet',
        })
      }
      // D4a/F1: buyer access is the creator's choice, snapshotted at
      // provisioning time (same rule as ticket-canvas).
      if (workspace.buyerPubkey === callerPubkey && workspace.canvasBuyerAccess === 'none') {
        return res.status(403).json({ error: 'CANVAS_PRIVATE', message: 'the canvas for this workspace is private' })
      }

      const callerName = (await prisma.user.findUnique({ where: { pubkey: callerPubkey }, select: { name: true } }))?.name
      const url = await requestCanvasLoginUrl({ pubkey: callerPubkey, displayName: callerName ?? undefined }, workspace.canvasId)
      return res.json({ url })
    } catch (err) {
      console.error('[workspace-canvas] GET canvas-url error:', err instanceof Error ? err.message : err)
      return res.status(502).json({ error: 'CANVAS_SERVICE_ERROR', message: 'the canvas service could not issue a login URL — try again' })
    }
  })

  // GET /:id/output-key — buyer, ticket seller, or an invited collaborator
  // (ADR-349 D1). Proxies the canister's ensure_output_key (FU-434 Slice B):
  // the x-only pubkey the owner must NIP-44-seal the agent config to before
  // POST /:id/inject-config. Not a secret (it's a public key) — same
  // read-scope as GET /:id itself.
  router.get('/:id/output-key', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id },
        include: {
          members: { where: { pubkey: callerPubkey }, select: { pubkey: true } },
        },
      })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      const sellerPubkey = await resolveWorkspaceSellerPubkey(prisma, workspace)
      if (workspace.buyerPubkey !== callerPubkey && sellerPubkey !== callerPubkey && workspace.members.length === 0) {
        return res.status(403).json({ error: 'FORBIDDEN' })
      }
      const client = await getWorkspaceCanisterClient()
      if (!client) return res.status(409).json({ error: 'NO_CANISTER', message: 'no canister backend configured' })
      const outputPubkey = await client.ensureOutputKey()
      return res.json({ outputPubkey })
    } catch (err) {
      console.error('[workspaces] GET /:id/output-key error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /:id/outputs — buyer, ticket seller, or an invited collaborator
  // (ADR-349 D1). Canister-direct data (D5 get_outputs) proxied read-only;
  // returns an empty list (not an error) when no canister backend is
  // configured or the workspace never deployed one, matching the
  // honest-empty-state convention used elsewhere in this router (no
  // fabricated success). bigint fields serialize as strings.
  router.get('/:id/outputs', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id },
        include: {
          members: { where: { pubkey: callerPubkey }, select: { pubkey: true } },
        },
      })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      const sellerPubkey = await resolveWorkspaceSellerPubkey(prisma, workspace)
      if (workspace.buyerPubkey !== callerPubkey && sellerPubkey !== callerPubkey && workspace.members.length === 0) {
        return res.status(403).json({ error: 'FORBIDDEN' })
      }
      if (!workspace.canisterWorkspaceId) return res.json({ outputs: [] })

      const client = await getWorkspaceCanisterClient()
      if (!client) return res.json({ outputs: [] })

      const outputs = await client.getOutputs(workspace.canisterWorkspaceId)
      return res.json({
        outputs: outputs.map(o => ({
          outputType: o.outputType,
          uri: o.uri,
          metadata: o.metadata,
          createdAt: nanosToIso(o.createdAt),
          signature: o.signature ? Buffer.from(o.signature).toString('hex') : null,
        })),
      })
    } catch (err) {
      console.error('[workspaces] GET /:id/outputs error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /:id/members — buyer, ticket seller, or an invited collaborator
  // (same read-scope as GET /:id). Server/DB-only slice of ADR-349 D1 — a
  // member row grants read access only; chat/tool-call write access stays
  // buyer-signed-only until FU-589 (canister multi-signer support) ships.
  router.get('/:id/members', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id },
        include: {
          members: { where: { pubkey: callerPubkey }, select: { pubkey: true } },
        },
      })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      const sellerPubkey = await resolveWorkspaceSellerPubkey(prisma, workspace)
      if (workspace.buyerPubkey !== callerPubkey && sellerPubkey !== callerPubkey && workspace.members.length === 0) {
        return res.status(403).json({ error: 'FORBIDDEN' })
      }
      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId: id },
        orderBy: { createdAt: 'asc' },
        include: { member: { select: { pubkey: true, name: true, picture: true } } },
      })
      return res.json({ members })
    } catch (err) {
      console.error('[workspaces] GET /:id/members error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/members — Owner-only (buyer). Invites a third-party pubkey
  // (e.g. the Agent-Setup provider, ADR-349's original trigger) as a
  // read-scoped collaborator. Requires an existing User row (the FK target)
  // and rejects the buyer inviting themselves. Auto-accepted — only the
  // Owner can create the row, so there's no invite-token/accept step to
  // build until real demand for a decline flow shows up.
  router.post('/:id/members', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const { pubkey } = req.body ?? {}
    if (typeof pubkey !== 'string' || !HEX_PUBKEY_RE.test(pubkey)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'pubkey must be a 64-char hex pubkey' })
    }
    const normalizedPubkey = pubkey.toLowerCase()

    try {
      const workspace = await prisma.workspace.findUnique({ where: { id } })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      if (workspace.buyerPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'only the buyer can invite collaborators' })
      }
      if (normalizedPubkey === workspace.buyerPubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'the buyer is already the workspace owner' })
      }
      const targetUser = await prisma.user.findUnique({ where: { pubkey: normalizedPubkey } })
      if (!targetUser) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'no user exists for this pubkey' })

      const member = await prisma.workspaceMember.create({
        data: { workspaceId: id, pubkey: normalizedPubkey, invitedBy: callerPubkey },
        include: { member: { select: { pubkey: true, name: true, picture: true } } },
      })
      return res.status(201).json({ member })
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
        return res.status(409).json({ error: 'ALREADY_MEMBER', message: 'this pubkey is already a collaborator' })
      }
      console.error('[workspaces] POST /:id/members error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/members/me/signer — FU-589 self-service: an existing
  // collaborator registers their own device-local, locally-signable key
  // (mirrors POST /'s buyer `signerPubkey` — the inviting buyer cannot know
  // this key, it's generated client-side per-device only when the
  // collaborator's own browser first visits, see lib/workspaceChat.ts).
  // Grants full write parity with the buyer once relayed to the canister.
  // Re-registering (e.g. a new device) overwrites the stored key and
  // additively authorizes the new one — an old device's key is not
  // proactively revoked here, only via the Owner's explicit DELETE below.
  router.post('/:id/members/me/signer', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const { signerPubkey } = req.body ?? {}
    if (typeof signerPubkey !== 'string' || !HEX_PUBKEY_RE.test(signerPubkey)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'signerPubkey must be a 64-char hex pubkey' })
    }
    const normalizedSignerPubkey = signerPubkey.toLowerCase()

    try {
      const workspace = await prisma.workspace.findUnique({ where: { id } })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_pubkey: { workspaceId: id, pubkey: callerPubkey } },
      })
      if (!member) return res.status(403).json({ error: 'FORBIDDEN', message: 'only an invited collaborator can register a signer' })

      await prisma.workspaceMember.update({
        where: { id: member.id },
        data: { canisterSignerPubkey: normalizedSignerPubkey },
      })

      // Best-effort relay (safe direction — a failure just means "not yet
      // grantable", same "canister mirrors, server is authoritative"
      // precedent as completeWorkspace). Re-registering retries it.
      if (workspace.canisterWorkspaceId) {
        try {
          const client = await getWorkspaceCanisterClient()
          if (client) await client.addAuthorizedSigner(workspace.canisterWorkspaceId, normalizedSignerPubkey)
        } catch (err) {
          console.error(
            `[workspaces] add_authorized_signer relay failed for ${id}/${callerPubkey} — collaborator saved, canister may drift:`,
            err instanceof Error ? err.message : err,
          )
        }
      }
      return res.json({ signerPubkey: normalizedSignerPubkey })
    } catch (err) {
      console.error('[workspaces] POST /:id/members/me/signer error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // DELETE /:id/members/:pubkey — Owner-only (buyer). Revokes a
  // collaborator's read access AND any write parity they'd registered
  // (FU-589). Deliberately relay-then-commit — the opposite ordering from
  // every other relay in this file, which commits the DB first: a failed
  // canister-side revoke would leave a "removed" collaborator still able to
  // write, which is the unsafe direction. So the WorkspaceMember row (and
  // thus the read-access grant too) is only deleted once the canister
  // confirms the signer is gone — a relay failure returns 502 and the exact
  // same request can be retried, since the member row is still there.
  router.delete('/:id/members/:pubkey', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const targetPubkey = (req.params.pubkey as string).toLowerCase()
    try {
      const workspace = await prisma.workspace.findUnique({ where: { id } })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      if (workspace.buyerPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'only the buyer can remove collaborators' })
      }
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_pubkey: { workspaceId: id, pubkey: targetPubkey } },
      })
      if (!member) return res.status(404).json({ error: 'NOT_FOUND', message: 'this pubkey is not a collaborator' })

      if (member.canisterSignerPubkey && workspace.canisterWorkspaceId) {
        try {
          const client = await getWorkspaceCanisterClient()
          if (client) await client.removeAuthorizedSigner(workspace.canisterWorkspaceId, member.canisterSignerPubkey)
        } catch (err) {
          console.error(
            `[workspaces] remove_authorized_signer relay failed for ${id}/${targetPubkey} — collaborator NOT removed, retry the request:`,
            err instanceof Error ? err.message : err,
          )
          return res.status(502).json({ error: 'SIGNER_REVOKE_FAILED', message: 'could not revoke canister write access — retry' })
        }
      }

      await prisma.workspaceMember.delete({ where: { id: member.id } })
      return res.status(204).send()
    } catch (err) {
      console.error('[workspaces] DELETE /:id/members/:pubkey error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/messages — ADR-314 minimal chat slice: relay a buyer-signed
  // chat message to the canister's `post_message` (FU-434 Slice C). The
  // buyer signs client-side over `colabonate-workspace-v1:post_message:
  // {canisterWorkspaceId}:{timestamp}:{content}` with the key matching
  // `Workspace.canisterBuyerPubkey` — the server relays the signature
  // unmodified and never signs on the buyer's behalf. The canister records
  // both the user message and the agent's reply as chat-typed outputs
  // (visible via GET /:id/outputs); this route returns just the reply.
  router.post('/:id/messages', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const validation = validateChatMessageInput(req.body)
    if (!validation.ok) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: validation.message })
    }

    try {
      // FU-589: full parity — an invited collaborator (with a registered
      // signer) can chat too, not just the buyer. This is a coarse
      // "allowed to attempt" gate; the canister's own signature check
      // (against buyer_pubkey ∪ authorized_signers) is the actual
      // cryptographic authorization — a stranger who slips past this gate
      // still can't forge a valid signature.
      const workspace = await prisma.workspace.findUnique({
        where: { id },
        include: { members: { where: { pubkey: callerPubkey }, select: { pubkey: true } } },
      })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      if (workspace.buyerPubkey !== callerPubkey && workspace.members.length === 0) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'only the buyer or an invited collaborator can chat in this workspace' })
      }
      if (workspace.status !== 'RUNNING') {
        return res.status(409).json({ error: 'WORKSPACE_NOT_RUNNING', message: `workspace must be RUNNING to chat (is ${workspace.status})` })
      }
      // FU-376 (revised 2026-08-29): no free/subsidized starting budget — the
      // mandatory initial-funding recharge created at workspace initiation
      // must be PAID before any chat usage. Mirrors the pattern of every
      // other "must be settled first" gate in this codebase (e.g. F-D4-01).
      const mandatoryRecharge = await prisma.workspaceRecharge.findFirst({ where: { workspaceId: workspace.id, isMandatoryInitial: true } })
      if (mandatoryRecharge && mandatoryRecharge.status !== 'PAID') {
        return res.status(402).json({
          error: 'INITIAL_FUNDING_REQUIRED',
          message: 'Pay the mandatory initial funding before using this workspace.',
          rechargeId: mandatoryRecharge.id,
        })
      }
      if (!workspace.canisterWorkspaceId) {
        return res.status(409).json({ error: 'NO_CANISTER', message: 'workspace has no canister backend' })
      }

      const client = await getWorkspaceCanisterClient()
      if (!client) return res.status(409).json({ error: 'NO_CANISTER', message: 'no canister backend configured' })

      const { content, timestamp, signature } = validation.value
      const output = await client.postMessage(workspace.canisterWorkspaceId, content, timestamp, signature)
      return res.status(201).json({
        output: {
          outputType: output.outputType,
          uri: output.uri,
          metadata: output.metadata,
          createdAt: nanosToIso(output.createdAt),
          signature: output.signature ? Buffer.from(output.signature).toString('hex') : null,
        },
      })
    } catch (err) {
      if (err instanceof WorkspaceCanisterError) {
        if ('SignatureVerificationFailed' in err.canisterError) {
          return res.status(401).json({ error: 'SIGNATURE_INVALID', message: 'buyer signature verification failed' })
        }
        if ('ReplayRejected' in err.canisterError) {
          return res.status(409).json({ error: 'REPLAY_REJECTED', message: 'timestamp is not fresh — resend with a new signature' })
        }
        if ('ConfigNotInjected' in err.canisterError) {
          return res.status(409).json({ error: 'CONFIG_NOT_INJECTED', message: 'the agent owner has not configured this workspace yet' })
        }
        if ('Unauthorized' in err.canisterError) {
          return res.status(403).json({ error: 'FORBIDDEN' })
        }
        if ('InvalidTransition' in err.canisterError) {
          return res.status(409).json({ error: 'WORKSPACE_NOT_RUNNING' })
        }
        if ('OutcallFailed' in err.canisterError || 'ProviderError' in err.canisterError) {
          return res.status(502).json({ error: 'LLM_PROVIDER_ERROR', message: 'the agent provider call failed — try again' })
        }
      }
      console.error('[workspaces] POST /:id/messages error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/complete — buyer confirms completion (D2). Read-only retention
  // window starts now: expiresAt = now + Offer.agentWorkspaceTTL.
  router.post('/:id/complete', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id },
        include: { offer: { select: { agentWorkspaceTTL: true } } },
      })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      if (workspace.buyerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN', message: 'only the buyer can confirm completion' })

      const from = workspace.status as WorkspaceStatus
      if (!canTransitionWorkspace(from, 'COMPLETED')) {
        return res.status(409).json({ error: 'INVALID_TRANSITION', message: `cannot complete a ${from} workspace` })
      }

      const now = new Date()
      const ttlSeconds = workspace.offer.agentWorkspaceTTL ?? DEFAULT_WORKSPACE_TTL_SECONDS
      const completed = await prisma.workspace.update({
        where: { id: workspace.id },
        data: { status: 'COMPLETED', completedAt: now, expiresAt: new Date(now.getTime() + ttlSeconds * 1000) },
      })

      // D5 relay (FU-435): mirror the completion into the canister. The
      // server row is the buyer-facing commit, so a relay failure logs and
      // drifts instead of failing the request; in-sync rejections (canister
      // already Completed) are no-ops.
      if (completed.canisterWorkspaceId) {
        try {
          const client = await getWorkspaceCanisterClient()
          if (client) await client.completeWorkspace(completed.canisterWorkspaceId)
        } catch (err) {
          if (!isWorkspaceRelayInSyncError(err)) {
            console.error(
              `[workspaces] canister complete relay failed for ${id} — row is COMPLETED, canister may drift:`,
              err instanceof Error ? err.message : err,
            )
          }
        }
      }

      // ADR-353/ADR-370 D7 (G4): a Cooperation-anchored workspace (ADR-352) has
      // no Ticket — the ticket-level lifecycle hooks never fire for it, so its
      // doop-hosted canvas is locked here on workspace completion. Ticket-bound
      // workspaces are deliberately NOT locked here: the ticket's own terminal
      // transition (PATCH) is the authoritative lock moment for them.
      if (completed.cooperationId && completed.canvasProvider === 'doop-hosted' && completed.canvasId) {
        enqueueCanvasLifecycleForWorkspace(prisma, id, completed.canvasId).catch((err) =>
          console.error('[canvas-lifecycle] enqueue on coop workspace complete failed:', err instanceof Error ? err.message : err),
        )
      }
      return res.json({ workspace: completed })
    } catch (err) {
      console.error('[workspaces] POST /:id/complete error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/steps/:stepId/complete — ADR-352 D4 (closes FU-514): buyer marks
  // one CoopMilestoneStep of a Cooperation-anchored workspace as COMPLETED.
  // Tracked independently of the workspace's own lifecycle/status — one
  // workspace can host multiple steps (possibly across several milestones)
  // over its lifetime, so completing a step must NOT flip the workspace to
  // COMPLETED (that stays POST /:id/complete, buyer-triggered separately once
  // the whole engagement with this agent is done). Idempotent: completing an
  // already-COMPLETED step is a no-op 200.
  //
  // FU-605 (user-confirmed 2026-08-30): the owning CoopMilestone's own
  // IN_PROGRESS/COMPLETED status is derived here, from the buyer's own
  // confirmation — a pure-agent milestone has no human partner to satisfy the
  // existing PATCH /api/cooperations/:id/milestones/:mid route's `isPartner`
  // gate, so without this the STEPS_INCOMPLETE guard there would gate a door
  // nobody could ever open. The final fund-release (ACCEPTED) stays a fully
  // separate, unmodified, initiator-only action on that same PATCH route —
  // this never moves money, it only makes COMPLETED reachable.
  router.post('/:id/steps/:stepId/complete', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const stepId = req.params.stepId as string
    try {
      const workspace = await prisma.workspace.findUnique({ where: { id } })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      if (workspace.buyerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN', message: 'only the buyer can confirm step completion' })
      if (!workspace.cooperationId) {
        return res.status(400).json({ error: 'NOT_COOPERATION_WORKSPACE', message: 'this workspace has no pipeline steps to complete' })
      }

      const step = await prisma.coopMilestoneStep.findUnique({
        where: { id: stepId },
        include: { milestone: { select: { id: true, cooperationId: true } } },
      })
      if (!step || step.milestone.cooperationId !== workspace.cooperationId || step.assigneeOfferId !== workspace.offerId) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'step not found for this workspace' })
      }

      const updated = step.status === 'COMPLETED' ? step : await prisma.coopMilestoneStep.update({ where: { id: stepId }, data: { status: 'COMPLETED' } })
      await syncMilestoneStatusFromSteps(prisma, step.milestone.id, callerPubkey)
      return res.json({ step: updated })
    } catch (err) {
      console.error('[workspaces] POST /:id/steps/:stepId/complete error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/inject-config — FU-434 Slice B (FU-353): the agent owner (ticket
  // seller) injects the unsealed agent config into the canister, NIP-44
  // encrypted to the canister's own pubkey. The server relays the ciphertext
  // and never sees the plaintext. One-time per workspace (canister-enforced).
  router.post('/:id/inject-config', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const { senderPubkey, ciphertext } = req.body ?? {}
    if (typeof senderPubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(senderPubkey)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'senderPubkey must be a 64-char hex pubkey' })
    }
    if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'ciphertext is required' })
    }

    try {
      const workspace = await prisma.workspace.findUnique({ where: { id } })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      const sellerPubkey = await resolveWorkspaceSellerPubkey(prisma, workspace)
      if (sellerPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'only the agent owner can inject the config' })
      }
      if (workspace.status !== 'RUNNING') {
        return res.status(409).json({ error: 'INVALID_TRANSITION', message: `cannot inject config into a ${workspace.status} workspace` })
      }
      if (!workspace.canisterWorkspaceId) {
        return res.status(409).json({ error: 'NO_CANISTER', message: 'workspace has no canister backend' })
      }

      const client = await getWorkspaceCanisterClient()
      if (!client) return res.status(409).json({ error: 'NO_CANISTER', message: 'no canister backend configured' })
      // Never log senderPubkey/ciphertext payload contents beyond metadata (FU-195-C).
      await client.injectConfig(workspace.canisterWorkspaceId, senderPubkey, ciphertext)

      // ADR-352 D1 (FU-607): config is now ready — the earliest point at
      // which this workspace can actually embed anything. Best-effort,
      // never blocks the response: carries the immediately preceding
      // pipeline step's final output into this workspace's context index
      // when it's assigned to a different Offer (a real agent boundary).
      await seedHandoffContextIfApplicable(prisma, workspace)

      return res.json({ ok: true })
    } catch (err) {
      if (err instanceof WorkspaceCanisterError && 'ConfigAlreadyInjected' in err.canisterError) {
        return res.status(409).json({ error: 'CONFIG_ALREADY_INJECTED' })
      }
      if (err instanceof WorkspaceCanisterError && 'InvalidArgs' in err.canisterError) {
        return res.status(400).json({ error: 'INVALID_CONFIG', message: 'canister rejected the config payload' })
      }
      console.error('[workspaces] POST /:id/inject-config error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/recharge — FU-433 (ADR-311 D3), redirected to the platform
  // wallet by ADR-351: buyer reloads the workspace's cycle budget by paying
  // COLABONATE directly (resolvePlatformInvoice) — this money funds real ICP
  // cycle consumption on a canister Colabonate operates, it was never the
  // seller's. LN rail returns the platform's invoice for the buyer to pay;
  // DEMO rail (beta only) confirms without a preimage.
  // Gated to RUNNING/SUSPENDED: those are the only states the canister's
  // apply_topup accepts, and a PENDING_DEPLOY top-up would be fake state in
  // base mode (no canister to mirror into).
  router.post('/:id/recharge', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const amountSats = validateRechargeAmount(req.body?.amountSats)
    if (amountSats === null) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'amountSats must be a positive integer (max 100000000)' })
    }
    // ADR-252 D2 / FU-655: launch-phase per-transaction cap.
    if (rejectIfAboveLaunchCap(res, amountSats)) return

    try {
      const workspace = await prisma.workspace.findUnique({ where: { id } })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      if (workspace.buyerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN', message: 'only the buyer can recharge a workspace' })
      if (workspace.status !== 'RUNNING' && workspace.status !== 'SUSPENDED') {
        return res.status(409).json({ error: 'INVALID_TRANSITION', message: `cannot recharge a ${workspace.status} workspace` })
      }

      const resolution = await resolvePlatformInvoice(amountSats, `Workspace recharge: ${workspace.id}`)
      if (!resolution.ok) {
        return res.status(503).json({ error: 'PLATFORM_PAYMENT_NOT_CONFIGURED', message: 'Workspace funding is temporarily unavailable — try again shortly.' })
      }

      // DEMO rail: no real invoice exists — a synthetic hash keeps the row's
      // paymentHash unique so a re-request creates a fresh record (mirrors
      // the ticket DEMO branch, ADR-255 D2).
      const recharge = await prisma.workspaceRecharge.create({
        data: {
          workspaceId: workspace.id,
          amountSats,
          rail: resolution.rail,
          bolt11: resolution.rail === 'LN' ? resolution.invoice.bolt11 : null,
          paymentHash: resolution.rail === 'LN' ? resolution.invoice.paymentHash : randomBytes(32).toString('hex'),
        },
      })

      return res.status(201).json({
        recharge,
        invoice: resolution.rail === 'LN' ? resolution.invoice : null,
      })
    } catch (err) {
      console.error('[workspaces] POST /:id/recharge error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/recharge/:rechargeId/confirm — FU-433: payment confirmation.
  // LN rail: the buyer reports the preimage from paying the platform's own
  // invoice (ADR-351) — same self-verifying proof as tickets'
  // confirm-direct-payment, ADR-253. DEMO rail: beta-mode simulated payment,
  // no preimage.
  //
  // Idempotent + convergent: confirming an already-PAID recharge never
  // double-credits; the canister `add_cycles` relay runs exactly once
  // (relayedAt) and is retried on re-confirm after a relay failure. Order
  // follows the FU-435 precedence: the server row is the buyer-facing money
  // commit, the canister is the mirror — so a relay failure returns 502 with
  // the payment already credited instead of rolling the money back.
  router.post('/:id/recharge/:rechargeId/confirm', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const rechargeId = req.params.rechargeId as string
    try {
      const workspace = await prisma.workspace.findUnique({ where: { id } })
      if (!workspace) return res.status(404).json({ error: 'NOT_FOUND', message: 'workspace not found' })
      if (workspace.buyerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN', message: 'only the buyer can confirm a recharge' })
      const recharge = await prisma.workspaceRecharge.findUnique({ where: { id: rechargeId } })
      if (!recharge || recharge.workspaceId !== workspace.id) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'recharge not found' })
      }

      let credited = recharge
      if (recharge.status === 'PENDING') {
        if (recharge.rail === 'LN') {
          const { preimage } = req.body as { preimage?: string }
          if (!preimage || !verifyPreimage(preimage, recharge.paymentHash)) {
            return res.status(400).json({ error: 'PREIMAGE_MISMATCH' })
          }
        } else if (!isBetaMode()) {
          // Defense in depth: resolvePlatformInvoice only issues DEMO in
          // beta — a DEMO row in non-beta must never confirm.
          return res.status(403).json({ error: 'DEMO_RAIL_DISABLED', message: 'demo rail is only available in beta mode' })
        }

        // Money commit: mark PAID and credit the budget in one transaction.
        // Null budget is treated as 0 (no prior top-up).
        const [paid] = await prisma.$transaction([
          prisma.workspaceRecharge.update({
            where: { id: recharge.id },
            data: { status: 'PAID', paidAt: new Date() },
          }),
          prisma.workspace.update({
            where: { id: workspace.id },
            data: { cycleBudgetSats: (workspace.cycleBudgetSats ?? 0) + recharge.amountSats },
          }),
        ])
        credited = paid
      }

      // Canister relay (exactly once per recharge, retried after failure).
      let currentWorkspace = await prisma.workspace.findUnique({ where: { id: workspace.id } })
      if (workspace.canisterWorkspaceId && !credited.relayedAt) {
        try {
          const client = await getWorkspaceCanisterClient()
          if (client) {
            const status = await client.addCycles(workspace.canisterWorkspaceId, satsToCycles(credited.amountSats))
            // Mirror the canister's authoritative RUNNING/SUSPENDED verdict
            // back into the server row (apply_topup resumes a suspended
            // workspace iff the new budget covers the consumption).
            const nextStatus = status.state
            await prisma.$transaction([
              prisma.workspaceRecharge.update({ where: { id: credited.id }, data: { relayedAt: new Date() } }),
              ...(nextStatus !== workspace.status && canTransitionWorkspace(workspace.status as WorkspaceStatus, nextStatus)
                ? [prisma.workspace.update({ where: { id: workspace.id }, data: { status: nextStatus } })]
                : []),
            ])
            currentWorkspace = await prisma.workspace.findUnique({ where: { id: workspace.id } })
            credited = { ...credited, relayedAt: new Date() }
          }
        } catch (err) {
          // Payment is already committed — a relay failure drifts the
          // canister mirror, not the money. Re-confirm retries the relay.
          console.error(
            `[workspaces] add_cycles relay failed for recharge ${credited.id} — payment credited, canister may drift:`,
            err instanceof Error ? err.message : err,
          )
          return res.status(502).json({ error: 'RECHARGE_RELAY_FAILED', message: 'payment credited; canister top-up failed — retry the confirm' })
        }
      }

      return res.json({ recharge: credited, workspace: currentWorkspace })
    } catch (err) {
      console.error('[workspaces] POST /:id/recharge/:rechargeId/confirm error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
