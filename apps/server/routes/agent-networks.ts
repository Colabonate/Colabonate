import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { requireAuth, validateToken } from '../middleware/require-auth.js'

// ADR-328 D3/D4 (FU-484): Agent Network CRUD — a durable, ownable, joinable
// collective of AgentProfiles. GET routes are public (browse tier mirrors
// ADR-303 / agent-tasks); all mutating routes require auth. Owner-gated
// write surface per ADR-328: only the founder edits network settings and
// approves closed-network join requests.
//
// Deviation from the ADR-328 D3 schema block (documented in the ADR's
// Implementation Record): closed-network join approval needs a persisted
// request, so this slice ships AgentNetworkJoinRequest alongside the two
// mandated models. companyId (FU-495 / ADR-326 D10.7) is accepted +
// ownership-validated on create/update, mirroring the same pattern already
// used for AgentProfile.companyId (agent-profiles.ts) and Offer.companyId
// (apps/server/index.ts).

const MAX_NAME_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_MESSAGE_LENGTH = 1000
const MAX_MEMBERS = 50
const LIST_LIMIT_DEFAULT = 20
const LIST_LIMIT_MAX = 50

const ORCHESTRATION_MODES = ['HUMAN', 'AUTONOMOUS'] as const
const MEMBER_ROLES = ['MEMBER', 'LEAD'] as const

type OrchestrationModeValue = (typeof ORCHESTRATION_MODES)[number]
type MemberRoleValue = (typeof MEMBER_ROLES)[number]

const MEMBER_PROFILE_SELECT = {
  id: true,
  ownerPubkey: true,
  name: true,
  avatarUrl: true,
  capabilities: true,
  reputationScore: true,
  trustScore: true,
  isVerified: true,
} as const

function validateNetworkFields(body: Record<string, unknown>): string | null {
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return 'name must be a non-empty string'
    if (body.name.length > MAX_NAME_LENGTH) return `name must not exceed ${MAX_NAME_LENGTH} characters`
  }
  if (body.description !== undefined && typeof body.description !== 'string') return 'description must be a string'
  if (body.description !== undefined && body.description.length > MAX_DESCRIPTION_LENGTH) {
    return `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters`
  }
  if (body.orchestrationMode !== undefined && !ORCHESTRATION_MODES.includes(body.orchestrationMode as OrchestrationModeValue)) {
    return `orchestrationMode must be one of ${ORCHESTRATION_MODES.join(', ')}`
  }
  if (body.openMembership !== undefined && typeof body.openMembership !== 'boolean') return 'openMembership must be a boolean'
  if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean') return 'isPublic must be a boolean'
  return null
}

// ADR-328 D3: V1 reputation = simple average of member AgentProfile
// reputationScore (null members skipped; whole network null until at least
// one member has a score).
async function recomputeNetworkReputation(prisma: PrismaClient, networkId: string): Promise<void> {
  const members = await prisma.agentNetworkMember.findMany({
    where: { networkId },
    select: { agentProfile: { select: { reputationScore: true } } },
  })
  const scores = members
    .map(m => m.agentProfile.reputationScore)
    .filter((s): s is number => s !== null)
  await prisma.agentNetwork.update({
    where: { id: networkId },
    data: { reputationScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null },
  })
}

export function createAgentNetworkRouter(prisma: PrismaClient) {
  const router = Router()

  router.post('/', requireAuth(prisma), async (req: Request, res: Response) => {
    const ownerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!ownerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const { name, description, orchestrationMode, openMembership, isPublic, memberAgentProfileIds, companyId } = req.body as Record<string, unknown>
    const fieldError = validateNetworkFields(req.body as Record<string, unknown>)
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'name is required' })
    }
    if (fieldError) return res.status(400).json({ error: 'VALIDATION_ERROR', message: fieldError })
    // ADR-326 D10.7 (FU-495): same companyId ownership validation as
    // AgentProfile/Offer — never trust a client-supplied companyId without
    // confirming it belongs to the caller.
    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId as string } })
      if (!company || company.ownerPubkey !== ownerPubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'companyId must reference your own company' })
      }
    }
    if (memberAgentProfileIds !== undefined) {
      if (!Array.isArray(memberAgentProfileIds) || !memberAgentProfileIds.every((id: unknown) => typeof id === 'string')) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'memberAgentProfileIds must be an array of agent profile ids' })
      }
      if (new Set(memberAgentProfileIds).size !== memberAgentProfileIds.length) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'memberAgentProfileIds must not contain duplicates' })
      }
      if (memberAgentProfileIds.length > MAX_MEMBERS) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: `a network can hold at most ${MAX_MEMBERS} members` })
      }
    }

    try {
      const seedIds = [...new Set(memberAgentProfileIds as string[] | undefined ?? [])]
      if (seedIds.length > 0) {
        const owned = await prisma.agentProfile.count({ where: { id: { in: seedIds }, ownerPubkey } })
        if (owned !== seedIds.length) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'memberAgentProfileIds must reference agent profiles you own (invites are added after creation)' })
        }
      }

      const network = await prisma.agentNetwork.create({
        data: {
          ownerPubkey,
          name: (name as string).trim(),
          description: typeof description === 'string' && description.trim() ? description.trim() : null,
          orchestrationMode: (orchestrationMode as OrchestrationModeValue) ?? 'HUMAN',
          openMembership: Boolean(openMembership),
          isPublic: Boolean(isPublic),
          companyId: (companyId as string) || null,
          ...(seedIds.length > 0 && {
            members: {
              create: seedIds.map(agentProfileId => ({ agentProfileId })),
            },
          }),
        },
        include: { members: { include: { agentProfile: { select: MEMBER_PROFILE_SELECT } } } },
      })
      if (seedIds.length > 0) {
        await recomputeNetworkReputation(prisma, network.id)
        const refreshed = await prisma.agentNetwork.findUnique({
          where: { id: network.id },
          include: { members: { include: { agentProfile: { select: MEMBER_PROFILE_SELECT } } } },
        })
        return res.status(201).json({ network: refreshed })
      }
      return res.status(201).json({ network })
    } catch (err) {
      console.error('[agent-networks] POST / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET / — public browse of discoverable networks (ADR-328 D4 Network/Find).
  // Capability filter matches any member profile's capabilities (coverage).
  // ADR-367 D8/D9 (closes FU-651): optional ?ownerPubkey=/?companyId= narrows this to one
  // entity's own networks for a profile page — safe to add with zero new privacy surface,
  // since the route was already gated to isPublic:true networks for every other caller too.
  router.get('/', async (req: Request, res: Response) => {
    const openOnly = req.query.open === '1' || req.query.open === 'true'
    const capability = typeof req.query.capability === 'string' ? req.query.capability : undefined
    const ownerPubkey = typeof req.query.ownerPubkey === 'string' ? req.query.ownerPubkey : undefined
    const companyId = typeof req.query.companyId === 'string' ? req.query.companyId : undefined
    const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, Number(req.query.limit) || LIST_LIMIT_DEFAULT))
    const offset = Math.max(0, Number(req.query.offset) || 0)

    const where = {
      isPublic: true,
      ...(openOnly ? { openMembership: true } : {}),
      ...(capability ? { members: { some: { agentProfile: { capabilities: { has: capability } } } } } : {}),
      ...(ownerPubkey ? { ownerPubkey } : {}),
      ...(companyId ? { companyId } : {}),
    }

    try {
      const [networks, total] = await Promise.all([
        prisma.agentNetwork.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            members: { select: { agentProfile: { select: { capabilities: true, reputationScore: true } } } },
          },
        }),
        prisma.agentNetwork.count({ where }),
      ])
      const items = networks.map(({ members, ...network }) => ({
        ...network,
        memberCount: members.length,
        capabilities: [...new Set(members.flatMap(m => m.agentProfile.capabilities))],
      }))
      return res.json({ networks: items, total, limit, offset })
    } catch (err) {
      console.error('[agent-networks] GET / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /mine — the caller's own networks incl. non-public ones (manage list).
  // Registered before GET /:id so "mine" is never swallowed as an id param.
  router.get('/mine', requireAuth(prisma), async (req: Request, res: Response) => {
    const ownerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!ownerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    try {
      const networks = await prisma.agentNetwork.findMany({
        where: { ownerPubkey },
        orderBy: { createdAt: 'desc' },
        include: {
          members: { include: { agentProfile: { select: MEMBER_PROFILE_SELECT } } },
          joinRequests: { where: { status: 'PENDING' }, include: { agentProfile: { select: MEMBER_PROFILE_SELECT } } },
        },
      })
      return res.json({ networks })
    } catch (err) {
      console.error('[agent-networks] GET /mine error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /:id — public networks are readable by anyone; non-public ones only
  // by their owner (404 otherwise, so existence of a private network never
  // leaks). Join requests are owner-only.
  router.get('/:id', async (req: Request, res: Response) => {
    const id = req.params.id as string
    try {
      const network = await prisma.agentNetwork.findUnique({
        where: { id },
        include: { members: { include: { agentProfile: { select: MEMBER_PROFILE_SELECT } } } },
      })
      if (!network) return res.status(404).json({ error: 'NOT_FOUND' })

      const authHeader = req.headers.authorization
      let isOwner = false
      if (authHeader?.startsWith('Bearer ')) {
        const session = await validateToken(prisma, authHeader.slice(7))
        isOwner = !!session && session.pubkey === network.ownerPubkey
      }
      if (!network.isPublic && !isOwner) return res.status(404).json({ error: 'NOT_FOUND' })

      if (isOwner) {
        const joinRequests = await prisma.agentNetworkJoinRequest.findMany({
          where: { networkId: id },
          include: { agentProfile: { select: MEMBER_PROFILE_SELECT } },
          orderBy: { createdAt: 'desc' },
        })
        return res.json({ network: { ...network, joinRequests }, viewerIsOwner: true })
      }
      return res.json({ network, viewerIsOwner: false })
    } catch (err) {
      console.error('[agent-networks] GET /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  router.patch('/:id', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const id = req.params.id as string

    const fieldError = validateNetworkFields(req.body as Record<string, unknown>)
    if (fieldError) return res.status(400).json({ error: 'VALIDATION_ERROR', message: fieldError })

    const { name, description, orchestrationMode, openMembership, isPublic, companyId } = req.body as Record<string, unknown>

    // ADR-326 D10.7 (FU-495): same companyId ownership validation as create.
    // `companyId: null` clears back to independent.
    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId as string } })
      if (!company || company.ownerPubkey !== callerPubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'companyId must reference your own company' })
      }
    }

    try {
      const existing = await prisma.agentNetwork.findUnique({ where: { id } })
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })
      if (existing.ownerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN' })

      const network = await prisma.agentNetwork.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: (name as string).trim() }),
          ...(description !== undefined && { description: (description as string).trim() || null }),
          ...(orchestrationMode !== undefined && { orchestrationMode: orchestrationMode as OrchestrationModeValue }),
          ...(openMembership !== undefined && { openMembership: Boolean(openMembership) }),
          ...(isPublic !== undefined && { isPublic: Boolean(isPublic) }),
          ...(companyId !== undefined && { companyId: (companyId as string) || null }),
        },
        include: { members: { include: { agentProfile: { select: MEMBER_PROFILE_SELECT } } } },
      })
      return res.json({ network })
    } catch (err) {
      console.error('[agent-networks] PATCH /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/members — two legal paths per ADR-328 D3:
  //  (a) the network owner adds any agent (invite / closed-network approval),
  //  (b) an agent's own owner joins directly — only when openMembership.
  router.post('/:id/members', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const id = req.params.id as string
    const { agentProfileId, role } = req.body as { agentProfileId?: string; role?: string }

    if (!agentProfileId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'agentProfileId is required' })
    if (role !== undefined && !MEMBER_ROLES.includes(role as MemberRoleValue)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `role must be one of ${MEMBER_ROLES.join(', ')}` })
    }

    try {
      const network = await prisma.agentNetwork.findUnique({ where: { id } })
      if (!network) return res.status(404).json({ error: 'NOT_FOUND' })
      const isNetworkOwner = network.ownerPubkey === callerPubkey

      const agentProfile = await prisma.agentProfile.findUnique({ where: { id: agentProfileId } })
      if (!agentProfile) return res.status(404).json({ error: 'AGENT_PROFILE_NOT_FOUND' })
      const isAgentOwner = agentProfile.ownerPubkey === callerPubkey

      if (!isNetworkOwner && !isAgentOwner) return res.status(403).json({ error: 'FORBIDDEN' })
      if (!isNetworkOwner && isAgentOwner && !network.openMembership) {
        return res.status(403).json({ error: 'MEMBERSHIP_CLOSED', message: 'This network is approval-only — submit a join request instead' })
      }
      // Setting LEAD is an owner decision; a self-joining agent owner joins as MEMBER.
      const effectiveRole = isNetworkOwner ? ((role as MemberRoleValue) ?? 'MEMBER') : 'MEMBER'

      const memberCount = await prisma.agentNetworkMember.count({ where: { networkId: id } })
      if (memberCount >= MAX_MEMBERS) {
        return res.status(409).json({ error: 'MEMBER_LIMIT_REACHED', message: `This network already holds the maximum of ${MAX_MEMBERS} members` })
      }

      const member = await prisma.agentNetworkMember.create({
        data: { networkId: id, agentProfileId, role: effectiveRole },
        include: { agentProfile: { select: MEMBER_PROFILE_SELECT } },
      })
      await recomputeNetworkReputation(prisma, id)
      return res.status(201).json({ member })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') {
        return res.status(409).json({ error: 'ALREADY_MEMBER', message: 'This agent is already a member of this network' })
      }
      console.error('[agent-networks] POST /:id/members error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // PATCH /:id/members/:agentProfileId — owner-gated role set (MEMBER/LEAD).
  router.patch('/:id/members/:agentProfileId', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const id = req.params.id as string
    const agentProfileId = req.params.agentProfileId as string
    const { role } = req.body as { role?: string }

    if (!role || !MEMBER_ROLES.includes(role as MemberRoleValue)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `role must be one of ${MEMBER_ROLES.join(', ')}` })
    }

    try {
      const network = await prisma.agentNetwork.findUnique({ where: { id } })
      if (!network) return res.status(404).json({ error: 'NOT_FOUND' })
      if (network.ownerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN' })

      const member = await prisma.agentNetworkMember.update({
        where: { networkId_agentProfileId: { networkId: id, agentProfileId } },
        data: { role: role as MemberRoleValue },
        include: { agentProfile: { select: MEMBER_PROFILE_SELECT } },
      })
      return res.json({ member })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2025') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'This agent is not a member of this network' })
      }
      console.error('[agent-networks] PATCH /:id/members/:agentProfileId error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // DELETE /:id/members/:agentProfileId — network owner or the member
  // agent's own owner (leave).
  router.delete('/:id/members/:agentProfileId', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const id = req.params.id as string
    const agentProfileId = req.params.agentProfileId as string

    try {
      const network = await prisma.agentNetwork.findUnique({ where: { id } })
      if (!network) return res.status(404).json({ error: 'NOT_FOUND' })

      const member = await prisma.agentNetworkMember.findUnique({
        where: { networkId_agentProfileId: { networkId: id, agentProfileId } },
        include: { agentProfile: { select: { ownerPubkey: true } } },
      })
      if (!member) return res.status(404).json({ error: 'NOT_FOUND', message: 'This agent is not a member of this network' })

      const isNetworkOwner = network.ownerPubkey === callerPubkey
      const isAgentOwner = member.agentProfile.ownerPubkey === callerPubkey
      if (!isNetworkOwner && !isAgentOwner) return res.status(403).json({ error: 'FORBIDDEN' })

      await prisma.agentNetworkMember.delete({ where: { networkId_agentProfileId: { networkId: id, agentProfileId } } })
      await recomputeNetworkReputation(prisma, id)
      return res.json({ removed: true })
    } catch (err) {
      console.error('[agent-networks] DELETE /:id/members/:agentProfileId error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /:id/join-requests — an agent's owner asks to join a closed,
  // discoverable network. Open networks are joined directly via members.
  router.post('/:id/join-requests', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const id = req.params.id as string
    const { agentProfileId, message } = req.body as { agentProfileId?: string; message?: string }

    if (!agentProfileId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'agentProfileId is required' })
    if (message !== undefined && (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `message must be a string up to ${MAX_MESSAGE_LENGTH} characters` })
    }

    try {
      const network = await prisma.agentNetwork.findUnique({ where: { id } })
      if (!network || !network.isPublic) return res.status(404).json({ error: 'NOT_FOUND' })
      if (network.ownerPubkey === callerPubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Network owners add members directly' })
      }
      if (network.openMembership) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'This network is open — join directly via members' })
      }

      const agentProfile = await prisma.agentProfile.findUnique({ where: { id: agentProfileId } })
      if (!agentProfile) return res.status(404).json({ error: 'AGENT_PROFILE_NOT_FOUND' })
      if (agentProfile.ownerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not own this agent profile' })

      const alreadyMember = await prisma.agentNetworkMember.findUnique({
        where: { networkId_agentProfileId: { networkId: id, agentProfileId } },
      })
      if (alreadyMember) return res.status(409).json({ error: 'ALREADY_MEMBER', message: 'This agent is already a member of this network' })

      const pending = await prisma.agentNetworkJoinRequest.findFirst({
        where: { networkId: id, agentProfileId, status: 'PENDING' },
      })
      if (pending) return res.status(409).json({ error: 'ALREADY_REQUESTED', message: 'A join request for this agent is already pending' })

      const joinRequest = await prisma.agentNetworkJoinRequest.create({
        data: { networkId: id, agentProfileId, message: message?.trim() || null },
        include: { agentProfile: { select: MEMBER_PROFILE_SELECT } },
      })
      return res.status(201).json({ joinRequest })
    } catch (err) {
      console.error('[agent-networks] POST /:id/join-requests error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // PATCH /:id/join-requests/:requestId — owner-gated approve/reject for
  // closed networks. Approve atomically flips the request and creates the
  // member row, then the aggregate reputation recomputes.
  router.patch('/:id/join-requests/:requestId', requireAuth(prisma), async (req: Request, res: Response) => {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
    const id = req.params.id as string
    const requestId = req.params.requestId as string
    const { action } = req.body as { action?: string }

    if (action !== 'approve' && action !== 'reject') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'action must be "approve" or "reject"' })
    }

    try {
      const network = await prisma.agentNetwork.findUnique({ where: { id } })
      if (!network) return res.status(404).json({ error: 'NOT_FOUND' })
      if (network.ownerPubkey !== callerPubkey) return res.status(403).json({ error: 'FORBIDDEN' })

      const joinRequest = await prisma.agentNetworkJoinRequest.findUnique({ where: { id: requestId } })
      if (!joinRequest || joinRequest.networkId !== id) return res.status(404).json({ error: 'NOT_FOUND', message: 'No such join request on this network' })
      if (joinRequest.status !== 'PENDING') {
        return res.status(409).json({ error: 'INVALID_STATE', message: `Join request is already ${joinRequest.status.toLowerCase()}` })
      }

      if (action === 'reject') {
        const rejected = await prisma.agentNetworkJoinRequest.update({
          where: { id: requestId },
          data: { status: 'REJECTED', decidedAt: new Date() },
          include: { agentProfile: { select: MEMBER_PROFILE_SELECT } },
        })
        return res.json({ joinRequest: rejected })
      }

      const memberCount = await prisma.agentNetworkMember.count({ where: { networkId: id } })
      if (memberCount >= MAX_MEMBERS) {
        return res.status(409).json({ error: 'MEMBER_LIMIT_REACHED', message: `This network already holds the maximum of ${MAX_MEMBERS} members` })
      }

      const member = await prisma.$transaction(async tx => {
        const approved = await tx.agentNetworkJoinRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', decidedAt: new Date() },
        })
        return tx.agentNetworkMember.create({
          data: { networkId: id, agentProfileId: approved.agentProfileId },
          include: { agentProfile: { select: MEMBER_PROFILE_SELECT } },
        })
      })
      await recomputeNetworkReputation(prisma, id)
      return res.json({ member })
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') {
        return res.status(409).json({ error: 'ALREADY_MEMBER', message: 'This agent is already a member of this network' })
      }
      console.error('[agent-networks] PATCH /:id/join-requests/:requestId error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
