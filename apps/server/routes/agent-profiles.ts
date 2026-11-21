import { Router, type Request, type Response } from 'express'
import type { AgentProfile, PrismaClient } from '@prisma/client'
import { normalizeCapability } from '../lib/capability-normalize.js'
import { findSimilarAgentProfiles } from '../services/agent-marketplace.js'
import { writeWithOutbox } from '../lib/outbox.js'
import { invalidateListCache } from '../middleware/cache.js'

// ADR-320 D4: permanent badge for the first 100 AgentProfiles ever created.
// A plain count()-before-insert has a race window under concurrent creates —
// accepted for V1: worst case is a badge boundary off by a handful of rows,
// not a money-moving invariant, so a stronger transactional guard isn't
// worth the complexity here.
const PIONEER_LIMIT = 100

// ADR-339 D1: newest AGENT_SETUP offer projection attached to owned roster
// entries + GET /:id responses. ARCHIVED offers are deliberately excluded —
// online/offline is a binary over ACTIVE/DRAFT, and an archived listing
// behaves like "no listing" (the profile stays visible, offline, editable).
const ROSTER_OFFER_SELECT = {
  id: true,
  status: true,
  images: true,
  imageThumbs: true,
  title: true,
  priceSats: true,
  publishedAt: true,
  agentBillingModel: true,
  agentWorkspaceTTL: true,
  categoryCode: true,
  description: true,
  // ADR-342 D2: edit-mode prefill of the wizard's canvas section.
  agentConfigMeta: true,
} as const

function rosterOfferInclude() {
  return {
    offers: {
      where: { offerType: 'AGENT_SETUP' as const, status: { in: ['ACTIVE', 'DRAFT'] } },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
      select: ROSTER_OFFER_SELECT,
    },
  }
}

/** Collapses the `offers: [newest]` include into a single `offer` field. */
function withRosterOffer<T extends { offers: unknown[] }>(row: T): Omit<T, 'offers'> & { offer: T['offers'][number] | null } {
  const { offers, ...rest } = row
  return { ...rest, offer: offers[0] ?? null }
}

// ADR-309 / FU-346: minimal AgentProfile CRUD — the prerequisite the Agent
// Creation Wizard needs (no such API existed before this; every ADR-305/306/
// 307/316/317 smoke test created AgentProfile rows by direct Prisma write).
// Scoped down from FU-346's full spec: no DELETE, no /:id/offers sub-route —
// neither has a caller yet. GET is owner-scoped only (a public directory is
// ADR-313, not this).

const MAX_CAPABILITIES = 20
const MAX_NAME_LENGTH = 80

function validateCreateBody(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) return 'name is required'
  if (body.name.length > MAX_NAME_LENGTH) return `name must not exceed ${MAX_NAME_LENGTH} characters`
  if (!Array.isArray(body.capabilities) || body.capabilities.length === 0) return 'capabilities must be a non-empty array'
  if (body.capabilities.length > MAX_CAPABILITIES) return `capabilities must not exceed ${MAX_CAPABILITIES} entries`
  if (!body.capabilities.every((c: unknown) => typeof c === 'string' && c.trim())) return 'capabilities must be non-empty strings'
  if (body.description !== undefined && typeof body.description !== 'string') return 'description must be a string'
  if (body.avatarUrl !== undefined && typeof body.avatarUrl !== 'string') return 'avatarUrl must be a string'
  if (body.tools !== undefined && !Array.isArray(body.tools)) return 'tools must be an array'
  return null
}

// ADR-320 D1: normalize + dedupe. Returns an error message if any capability
// normalizes down to nothing (e.g. "!!!") rather than silently dropping it.
function normalizeCapabilities(raw: string[]): { capabilities: string[] } | { error: string } {
  const normalized = raw.map(normalizeCapability)
  if (normalized.some(c => !c)) return { error: 'capabilities must contain letters, numbers, or hyphens' }
  return { capabilities: [...new Set(normalized)] }
}

export function createAgentProfileRouter(prisma: PrismaClient) {
  const router = Router()

  router.post('/', async (req: Request, res: Response) => {
    const ownerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!ownerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const error = validateCreateBody(req.body)
    if (error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: error })

    const normalizedResult = normalizeCapabilities(req.body.capabilities)
    if ('error' in normalizedResult) return res.status(400).json({ error: 'VALIDATION_ERROR', message: normalizedResult.error })

    const { name, description, tools, avatarUrl, isPublic, autoApply, requireHumanApproval, humanInLoop, companyId } = req.body

    // ADR-326 D10.1/D10.3 (FU-492): same companyId ownership validation as
    // POST/PATCH /api/offers — never trust a client-supplied companyId
    // without confirming it belongs to the caller.
    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId } })
      if (!company || company.ownerPubkey !== ownerPubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'companyId must reference your own company' })
      }
    }

    try {
      const existingCount = await prisma.agentProfile.count()
      const agentProfile = await prisma.agentProfile.create({
        data: {
          ownerPubkey,
          name: name.trim(),
          description: description?.trim() || null,
          capabilities: normalizedResult.capabilities,
          tools: tools ?? [],
          avatarUrl: avatarUrl || null,
          isPublic: Boolean(isPublic),
          autoApply: Boolean(autoApply),
          requireHumanApproval: requireHumanApproval !== false,
          humanInLoop: Boolean(humanInLoop),
          isPioneer: existingCount < PIONEER_LIMIT,
          companyId: companyId || null,
        },
      })
      return res.status(201).json({ agentProfile })
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'P2002') {
        return res.status(400).json({ error: 'DUPLICATE_NAME', message: 'You already have an agent profile with this name' })
      }
      console.error('[agent-profiles] POST / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET / — the caller's own agent profiles (Manage list). Not a public directory.
  router.get('/', async (req: Request, res: Response) => {
    const ownerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!ownerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    try {
      const agentProfiles = await prisma.agentProfile.findMany({
        where: { ownerPubkey, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      })
      return res.json({ agentProfiles })
    } catch (err) {
      console.error('[agent-profiles] GET / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ADR-314 D10 / FU-436: workspace-overarching "My Agents" roster — two
  // lists, both pure query-projections over existing tables (no new model,
  // per the ADR's own A6 rejection of a dedicated roster model):
  //  (a) owned: this caller's own AgentProfile rows (same query as GET /)
  //  (b) booked: distinct AgentProfile reached via this caller's AGENT_SETUP
  //      tickets, each paired with its Workspace (if one was opened) so the
  //      client can deep-link straight into the chat.
  // Must be registered before GET /:id (Express route ordering) — "roster"
  // would otherwise be swallowed as an :id param.
  router.get('/roster', async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    try {
      // ADR-339 D1: owned entries carry their newest non-archived AGENT_SETUP
      // offer (single `offer` field) so the Agent Stack can render the gallery
      // image, price and online/offline state of each setup.
      // ADR-340 D4: filter out soft-deleted profiles.
      const ownedRows = await prisma.agentProfile.findMany({
        where: { ownerPubkey: callerPubkey, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: rosterOfferInclude(),
      })
      const owned = ownedRows.map(withRosterOffer)

      // Ordered desc by updatedAt so the first ticket seen per agentProfileId
      // (in the dedupe loop below) is the most recently active one.
      const tickets = await prisma.ticket.findMany({
        where: {
          buyerPubkey: callerPubkey,
          offerType: 'AGENT_SETUP',
          offer: { agentProfileId: { not: null } },
        },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          offer: { select: { agentProfileId: true, agentProfile: true } },
          workspace: { select: { id: true, status: true, updatedAt: true } },
        },
        orderBy: { updatedAt: 'desc' },
      })

      const bookedByProfile = new Map<string, {
        // Booked entries carry the plain profile (no offer projection — the
        // offer belongs to another seller's setup, not the caller's stack).
        agentProfile: AgentProfile
        ticket: { id: string; status: string; updatedAt: Date }
        workspace: { id: string; status: string; updatedAt: Date } | null
        lastActiveAt: Date
      }>()
      for (const ticket of tickets) {
        const agentProfileId = ticket.offer?.agentProfileId
        const agentProfile = ticket.offer?.agentProfile
        if (!agentProfileId || !agentProfile) continue
        if (bookedByProfile.has(agentProfileId)) continue
        bookedByProfile.set(agentProfileId, {
          agentProfile,
          ticket: { id: ticket.id, status: ticket.status, updatedAt: ticket.updatedAt },
          workspace: ticket.workspace ? { id: ticket.workspace.id, status: ticket.workspace.status, updatedAt: ticket.workspace.updatedAt } : null,
          // FU-395 (Kind 20001 presence events) isn't built — fall back to
          // the workspace's own last activity, then the ticket's, per the
          // ADR's own documented fallback.
          lastActiveAt: ticket.workspace?.updatedAt ?? ticket.updatedAt,
        })
      }

      return res.json({ owned, booked: [...bookedByProfile.values()] })
    } catch (err) {
      console.error('[agent-profiles] GET /roster error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  router.get('/:id', async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    const id = req.params.id as string
    try {
      const agentProfileRow = await prisma.agentProfile.findUnique({
        where: { id },
        include: rosterOfferInclude(),
      })
      if (!agentProfileRow || agentProfileRow.deletedAt) return res.status(404).json({ error: 'NOT_FOUND' })
      if (!agentProfileRow.isPublic && agentProfileRow.ownerPubkey !== callerPubkey) {
        return res.status(404).json({ error: 'NOT_FOUND' })
      }
      // ADR-315 D3: verifiedByPubkey + verificationNotes are admin-only
      // (audit trail). The public read exposes isVerified + verifiedAt so the
      // badge can render, but never the auditor's identity or audit notes.
      const { verifiedByPubkey, verificationNotes, offers, ...publicProfile } = agentProfileRow
      // ADR-339 D4: sibling `offer` (newest AGENT_SETUP) prefill for the edit
      // wizard. Offers are public marketplace data — no visibility change.
      return res.json({ agentProfile: publicProfile, offer: offers[0] ?? null })
    } catch (err) {
      console.error('[agent-profiles] GET /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ADR-320 D2 — Jaccard capability overlap + shared-customer + price
  // proximity. Router is mounted behind requireAuth (see index.ts), so this
  // isn't a fully public endpoint, but any logged-in caller can view it —
  // it mirrors GET /:id's visibility rule (public profiles only, unless the
  // caller owns it).
  router.get('/:id/similar', async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    const id = req.params.id as string
    try {
      const agentProfile = await prisma.agentProfile.findUnique({ where: { id }, select: { isPublic: true, ownerPubkey: true, deletedAt: true } })
      if (!agentProfile || agentProfile.deletedAt) return res.status(404).json({ error: 'NOT_FOUND' })
      if (!agentProfile.isPublic && agentProfile.ownerPubkey !== callerPubkey) {
        return res.status(404).json({ error: 'NOT_FOUND' })
      }
      const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 6))
      const similar = await findSimilarAgentProfiles(prisma, id, limit)
      return res.json({ similar })
    } catch (err) {
      console.error('[agent-profiles] GET /:id/similar error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  router.patch('/:id', async (req: Request, res: Response) => {
    const ownerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!ownerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const id = req.params.id as string

    try {
      const existing = await prisma.agentProfile.findUnique({ where: { id } })
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })
      if (existing.deletedAt) return res.status(404).json({ error: 'NOT_FOUND' })
      if (existing.ownerPubkey !== ownerPubkey) return res.status(403).json({ error: 'FORBIDDEN' })

      const { name, description, capabilities, tools, avatarUrl, isPublic, autoApply, requireHumanApproval, humanInLoop, companyId } = req.body
      let normalizedCapabilities: string[] | undefined
      if (capabilities !== undefined) {
        const error = validateCreateBody({ ...existing, capabilities })
        if (error) return res.status(400).json({ error: 'VALIDATION_ERROR', message: error })
        const normalizedResult = normalizeCapabilities(capabilities)
        if ('error' in normalizedResult) return res.status(400).json({ error: 'VALIDATION_ERROR', message: normalizedResult.error })
        normalizedCapabilities = normalizedResult.capabilities
      }
      if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'name must be a non-empty string' })
      }
      // ADR-326 D10.1/D10.3 (FU-492): same companyId ownership validation as
      // POST above. `companyId: null` clears back to private.
      if (companyId) {
        const company = await prisma.company.findUnique({ where: { id: companyId } })
        if (!company || company.ownerPubkey !== ownerPubkey) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'companyId must reference your own company' })
        }
      }

      const agentProfile = await prisma.agentProfile.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description?.trim() || null }),
          ...(normalizedCapabilities !== undefined && { capabilities: normalizedCapabilities }),
          ...(tools !== undefined && { tools }),
          ...(avatarUrl !== undefined && { avatarUrl: avatarUrl || null }),
          ...(isPublic !== undefined && { isPublic: Boolean(isPublic) }),
          ...(autoApply !== undefined && { autoApply: Boolean(autoApply) }),
          ...(requireHumanApproval !== undefined && { requireHumanApproval: Boolean(requireHumanApproval) }),
          ...(humanInLoop !== undefined && { humanInLoop: Boolean(humanInLoop) }),
          ...(companyId !== undefined && { companyId: companyId || null }),
        },
      })
      return res.json({ agentProfile })
    } catch (err) {
      console.error('[agent-profiles] PATCH /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ADR-340 D4: soft delete an AgentProfile. Reads everywhere already filter
  // `deletedAt: null` (roster, GET /:id, /api/search, /api/offers). The
  // offers themselves are ARCHIVED via writeWithOutbox so Meilisearch
  // re-indexes them as ARCHIVED (same shape as account-deletion.ts).
  //
  // Busy-guard (409 AGENT_BUSY): cannot delete an agent that is currently
  // booked — a running agent must not vanish under an active booking. "Busy"
  // = an open workspace or an in-flight ticket. Mirrors the roster's
  // booked-set query shape (this file, GET /roster above).
  router.delete('/:id', async (req: Request, res: Response) => {
    const ownerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!ownerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const id = req.params.id as string

    try {
      const existing = await prisma.agentProfile.findUnique({
        where: { id },
        select: { id: true, ownerPubkey: true, deletedAt: true, offers: { select: { id: true, status: true } } },
      })
      if (!existing || existing.deletedAt) return res.status(404).json({ error: 'NOT_FOUND' })
      if (existing.ownerPubkey !== ownerPubkey) return res.status(403).json({ error: 'FORBIDDEN' })

      // Busy-guard: any non-terminal Workspace tied to this agent blocks delete.
      const openWorkspace = await prisma.workspace.findFirst({
        where: {
          agentProfileId: id,
          status: { in: ['PENDING_DEPLOY', 'RUNNING', 'SUSPENDED'] },
        },
        select: { id: true, status: true },
      })
      if (openWorkspace) {
        return res.status(409).json({
          error: 'AGENT_BUSY',
          message: 'Agent is currently booked in an active workspace — finish or cancel the booking before deleting.',
          workspaceId: openWorkspace.id,
          workspaceStatus: openWorkspace.status,
        })
      }

      // In-flight ticket guard (defence in depth — workspaces are the primary
      // signal, but a ticket can exist without an opened workspace, e.g. ACCEPTED
      // but not yet deployed). Treat anything not in a terminal state as busy.
      const inFlightTicket = await prisma.ticket.findFirst({
        where: {
          offer: { agentProfileId: id },
          status: { in: ['PENDING', 'INTEREST_SENT', 'ACCEPTED', 'PAID', 'IN_PROGRESS', 'DISPUTED'] },
        },
        select: { id: true, status: true },
      })
      if (inFlightTicket) {
        return res.status(409).json({
          error: 'AGENT_BUSY',
          message: 'Agent has an active ticket — close the ticket before deleting.',
          ticketId: inFlightTicket.id,
          ticketStatus: inFlightTicket.status,
        })
      }

      const liveOffers = existing.offers.filter(o => o.status !== 'ARCHIVED')

      await prisma.$transaction(async (tx) => {
        // Archive every live offer (writeWithOutbox re-indexes each as ARCHIVED).
        for (const offerRef of liveOffers) {
          await writeWithOutbox(
            tx,
            'offer',
            offerRef.id,
            'upsert',
            { status: 'ARCHIVED', reason: 'agent-deleted', agentProfileId: id },
            (offerId) => tx.offer.update({
              where: { id: offerId },
              data: {
                status: 'ARCHIVED',
                agentProfileId: null,
                publishedAt: null,
              },
            }),
          )
        }
        // Remove from any AGENT_SETUP catalogs the agent is in. The catalog row
        // itself survives (the catalog may have other members) — this is just
        // the membership cleanup the ADR calls out.
        await tx.catalogAgentMember.deleteMany({ where: { agentProfileId: id } })
        // Soft delete the profile — Ticket/Claim/TaskApplication/Network history
        // stays intact (those FKs use default onDelete, not Restrict).
        await tx.agentProfile.update({
          where: { id },
          data: { deletedAt: new Date() },
        })
      })

      await invalidateListCache('offers')
      return res.json({ success: true, archivedOffers: liveOffers.length })
    } catch (err) {
      console.error('[agent-profiles] DELETE /:id error:', err)
      if (!res.headersSent) return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
