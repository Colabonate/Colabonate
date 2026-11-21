import { Router, type Response } from 'express'
import type { AppRequest } from '../types/express.js'
import { createHash } from 'node:crypto'
import type { PrismaClient, Prisma } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js'
import {
  type IVotingPowerStrategy,
  type IProposalValidationStrategy,
  type IGovernanceResolutionStrategy,
  createColPointsVotingStrategy,
  createIdentityWeightedStrategy,
  createColPointsThresholdValidation,
  createIdentityLevelValidation,
  createSimpleQuorumGovernance,
} from '../services/strategies/index.js'
import {
  composeDaoProposal,
  composeDaoVote,
  composeDaoProposalOutcome,
  composeCodexUpdateEvent,
  composeDaoCreationEvent,
} from '../services/dao-nostr.js'
import {
  CODEX_DEFAULTS,
  isValidProposalType,
  isPhase4Type,
  getEffectiveGovernance,
  validateExecutionPayload,
  validateCodexSections,
} from '../services/proposal-type-config.js'
import { notifyArbitrators } from '../services/email-notifier.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { requireFoundationAdminBySession } from '../middleware/require-admin.js'

const FOUNDATION_DAO_ID = 'colabonate-foundation'

export function createDaoVotingRouter(prisma: PrismaClient, _payments: PaymentProvider) {
  const router = Router()
  const auth = requireAuth(prisma)

  async function getVotingStrategies(daoId: string): Promise<IVotingPowerStrategy[]> {
    const govConfig = await prisma.daoGovernanceConfig.findUnique({ where: { daoId } })
    if (!govConfig) return []

    const strategyTypes = JSON.parse(govConfig.votingStrategies) as string[]
    const strategies: IVotingPowerStrategy[] = []

    for (const type of strategyTypes) {
      switch (type) {
        case 'colpoints':
          strategies.push(createColPointsVotingStrategy(prisma))
          break
        case 'identity_weighted':
          strategies.push(createIdentityWeightedStrategy(prisma))
          break
      }
    }

    return strategies
  }

  async function getValidationStrategy(daoId: string): Promise<IProposalValidationStrategy | null> {
    const govConfig = await prisma.daoGovernanceConfig.findUnique({ where: { daoId } })
    if (!govConfig) return null

    switch (govConfig.proposalValidationStrategy) {
      case 'colpoints_threshold':
        return createColPointsThresholdValidation(prisma)
      case 'identity_level':
        return createIdentityLevelValidation(prisma)
      default:
        return null
    }
  }

  function getResolutionStrategy(): IGovernanceResolutionStrategy {
    return createSimpleQuorumGovernance()
  }

  async function getTypeOverride(daoId: string, proposalType: string) {
    return prisma.daoGovernanceTypeOverride.findUnique({
      where: { daoId_proposalType: { daoId, proposalType: proposalType as 'NORMAL_DECISION' | 'CODEX_AMENDMENT' | 'TREASURY_SPENDING' | 'SANCTION' | 'PROTOCOL_UPGRADE' | 'NEW_DAO_CREATION' } },
    })
  }

  async function resolveLazyCommentPeriod(proposal: {
    id: string
    daoId: string
    title: string
    status: string
    proposalType: string
    commentPeriodEnd: Date | null
  }) {
    if (
      proposal.status === 'COMMENT_PERIOD' &&
      proposal.commentPeriodEnd &&
      new Date() >= proposal.commentPeriodEnd
    ) {
      const votingPeriod = CODEX_DEFAULTS[proposal.proposalType]?.votingPeriodSeconds ?? 7 * 86400
      const now = new Date()
      const updated = await prisma.daoProposal.update({
        where: { id: proposal.id },
        data: {
          status: 'ACTIVE',
          votingStart: now,
          votingEnd: new Date(now.getTime() + votingPeriod * 1000),
          snapshotTimestamp: Math.floor(now.getTime() / 1000),
        },
        include: { votes: true },
      })
      console.log(`[DAO] Lazy transition: COMMENT_PERIOD → ACTIVE for proposal ${proposal.id}`)

      setImmediate(() => {
        notifyArbitrators(prisma, proposal.daoId, {
          type: 'proposal_voting_started',
          proposalId: proposal.id,
          daoId: proposal.daoId,
          title: proposal.title,
        }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
      })

      return updated
    }
    return null
  }

  // ── GET /daos/:id/proposals ──────────────────────────────────────────
  router.get('/daos/:id/proposals', async (req: AppRequest, res: Response) => {
    try {
      const { id } = req.params
      const { status, proposalType } = req.query

      const where: Record<string, unknown> = { daoId: id }
      if (status) where.status = status as string
      if (proposalType) where.proposalType = proposalType as string

      const proposals = await prisma.daoProposal.findMany({
        where,
        include: {
          votes: true,
          dao: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      res.json({ proposals })
    } catch (error) {
      console.error('Failed to fetch proposals:', error)
      res.status(500).json({ error: 'Failed to fetch proposals' })
    }
  })

  // ── PATCH /daos/:id/proposals/:pid (update draft) ───────────────────
  router.patch('/daos/:id/proposals/:pid', auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id: daoId, pid: proposalId } = req.params
      const callerPubkey = req.authPubkey!
      const {
        title,
        content,
        proposalType: rawProposalType,
        executionPayload,
      } = req.body as {
        title?: string
        content?: string
        proposalType?: string
        executionPayload?: Record<string, unknown>
      }

      const proposal = await prisma.daoProposal.findUnique({
        where: { id: proposalId, daoId },
      })

      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' })
      }

      if (proposal.status !== 'DRAFT') {
        return res.status(409).json({ error: 'Only DRAFT proposals can be updated' })
      }

      if (proposal.authorPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'Only the proposal author can update' })
      }

      const proposalType = rawProposalType ?? proposal.proposalType ?? 'NORMAL_DECISION'

      if (!isValidProposalType(proposalType)) {
        return res.status(400).json({ error: `Invalid proposal type: ${proposalType}` })
      }

      const parsedPayload = executionPayload ?? (proposal.executionPayload as Record<string, unknown> | null) ?? {}
      if (executionPayload !== undefined) {
        const payloadValidation = validateExecutionPayload(proposalType, parsedPayload)
        if (!payloadValidation.valid) {
          return res.status(422).json({ error: 'Invalid executionPayload', details: payloadValidation.errors })
        }
      }

      const updated = await prisma.daoProposal.update({
        where: { id: proposalId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(content !== undefined ? { content } : {}),
          ...(rawProposalType !== undefined ? { proposalType: proposalType as 'NORMAL_DECISION' } : {}),
          ...(executionPayload !== undefined ? { executionPayload: parsedPayload as Prisma.InputJsonValue } : {}),
        },
        include: { votes: true },
      })

      console.log(`[DAO] Updated draft proposal ${proposalId} (type=${proposalType})`)
      res.json({ proposal: updated })
    } catch (error) {
      console.error('Failed to update draft proposal:', error)
      res.status(500).json({ error: 'Failed to update draft proposal' })
    }
  })

  // ── PATCH /daos/:id/proposals/:pid/cancel ────────────────────────────
  router.patch('/daos/:id/proposals/:pid/cancel', auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id: daoId, pid: proposalId } = req.params
      const callerPubkey = req.authPubkey!

      const proposal = await prisma.daoProposal.findUnique({
        where: { id: proposalId, daoId },
      })

      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' })
      }

      if (proposal.authorPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'Only the proposal author can cancel' })
      }

      if (!['DRAFT', 'COMMENT_PERIOD', 'ACTIVE'].includes(proposal.status)) {
        return res.status(409).json({ error: `Cannot cancel proposal with status ${proposal.status}` })
      }

      const updated = await prisma.daoProposal.update({
        where: { id: proposalId },
        data: { status: 'CANCELLED' as const },
        include: { votes: true },
      })

      console.log(`[DAO] Cancelled proposal ${proposalId} (was ${proposal.status})`)

      setImmediate(() => {
        notifyArbitrators(prisma, daoId, {
          type: 'proposal_cancelled' as 'proposal_passed',
          proposalId: proposal.id,
          daoId,
          title: proposal.title,
        }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
      })

      res.json({ proposal: updated })
    } catch (error) {
      console.error('Failed to cancel proposal:', error)
      res.status(500).json({ error: 'Failed to cancel proposal' })
    }
  })

  // ── GET /daos/:id/proposals/:pid ─────────────────────────────────────
  router.get('/daos/:id/proposals/:pid', async (req: AppRequest, res: Response) => {
    try {
      const { id, pid } = req.params

      const proposal = await prisma.daoProposal.findUnique({
        where: { id: pid, daoId: id },
        include: {
          votes: true,
          comments: { orderBy: { createdAt: 'asc' } },
          dao: { include: { governanceConfig: true } },
        },
      })

      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' })
      }

      const lazyUpdated = await resolveLazyCommentPeriod(proposal)
      const result = lazyUpdated ?? proposal

      res.json({ proposal: result })
    } catch (error) {
      console.error('Failed to fetch proposal:', error)
      res.status(500).json({ error: 'Failed to fetch proposal' })
    }
  })

  // ── POST /daos/:id/proposals ─────────────────────────────────────────
  router.post('/daos/:id/proposals', auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id: daoId } = req.params
      const {
        title,
        content,
        executionStrategy,
        executionPayload,
        proposalType: rawProposalType,
        status: requestedStatus,
      } = req.body as {
        title?: string
        content?: string
        executionStrategy?: string
        executionPayload?: string | Record<string, unknown>
        proposalType?: string
        status?: 'DRAFT' | 'ACTIVE'
      }

      const callerPubkey = req.authPubkey!

      if (!title || !content) {
        return res.status(400).json({ error: 'title and content are required' })
      }

      const proposalType = rawProposalType ?? 'NORMAL_DECISION'

      if (!isValidProposalType(proposalType)) {
        if (isPhase4Type(proposalType)) {
          return res.status(422).json({ error: `Proposal type ${proposalType} is not yet available (Phase 4)` })
        }
        return res.status(400).json({ error: `Invalid proposal type: ${proposalType}` })
      }

      const parsedPayload = typeof executionPayload === 'string'
        ? (() => { try { return JSON.parse(executionPayload) } catch { return {} } })()
        : (executionPayload ?? {})

      const payloadValidation = validateExecutionPayload(proposalType, parsedPayload)
      if (!payloadValidation.valid) {
        return res.status(422).json({ error: 'Invalid executionPayload', details: payloadValidation.errors })
      }

      const isDraft = requestedStatus === 'DRAFT'
      const initialStatus = isDraft ? 'DRAFT' : 'ACTIVE'

      const govConfig = await prisma.daoGovernanceConfig.findUnique({ where: { daoId } })
      if (!govConfig) {
        return res.status(400).json({ error: 'DAO governance not configured' })
      }

      if (!isDraft) {
        const validationStrategy = await getValidationStrategy(daoId)
        if (validationStrategy) {
          const validation = await validationStrategy.validate({
            authorPubkey: callerPubkey,
            entityType: 'governance',
            strategyParams: govConfig.votingStrategies,
          })
          if (!validation.valid) {
            return res.status(403).json({ error: validation.reason })
          }
        }
      }

      const typeOverride = await getTypeOverride(daoId, proposalType)
      const effectiveGov = getEffectiveGovernance(proposalType, typeOverride)

      const proposalId = `proposal-${Date.now()}-${daoId.slice(0, 8)}`

      let votingStart: Date | null = null
      let votingEnd: Date | null = null
      let snapshotTimestamp: number | null = null
      let commentPeriodEnd: Date | null = null
      let nostrTemplate: ReturnType<typeof composeDaoProposal> | undefined
      let finalStatus = initialStatus

      if (!isDraft) {
        const now = new Date()

        if (effectiveGov.hasCommentPeriod) {
          finalStatus = 'COMMENT_PERIOD'
          commentPeriodEnd = new Date(now.getTime() + effectiveGov.commentPeriodSeconds * 1000)
        } else {
          finalStatus = 'ACTIVE'
          votingStart = now
          votingEnd = new Date(now.getTime() + effectiveGov.votingPeriodSeconds * 1000)
          snapshotTimestamp = Math.floor(now.getTime() / 1000)
        }

        nostrTemplate = composeDaoProposal(
          daoId,
          callerPubkey,
          proposalId,
          title,
          content,
          executionStrategy ?? 'simple',
          parsedPayload,
          votingStart ? Math.floor(votingStart.getTime() / 1000) : null,
          votingEnd ? Math.floor(votingEnd.getTime() / 1000) : null,
          snapshotTimestamp,
          proposalType
        )
      }

      const proposal = await prisma.daoProposal.create({
        data: {
          daoId,
          authorPubkey: callerPubkey,
          nostrEventId: proposalId,
          title,
          content,
          executionStrategy: executionStrategy ?? 'simple',
          executionPayload: parsedPayload,
          proposalType: proposalType as 'NORMAL_DECISION',
          votingStart,
          votingEnd,
          snapshotTimestamp,
          commentPeriodEnd,
          status: finalStatus as 'DRAFT',
        },
        include: { votes: true },
      })

      console.log(`[DAO] Created ${isDraft ? 'draft ' : ''}proposal ${proposalId} (type=${proposalType}) for DAO ${daoId}`)

      if (!isDraft && finalStatus === 'ACTIVE') {
        setImmediate(() => {
          notifyArbitrators(prisma, FOUNDATION_DAO_ID, {
            type: 'proposal_voting_started',
            proposalId: proposal.id,
            daoId,
            title,
          }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
        })
      }

      if (!isDraft && finalStatus === 'COMMENT_PERIOD') {
        setImmediate(() => {
          notifyArbitrators(prisma, daoId, {
            type: 'proposal_comment_period',
            proposalId: proposal.id,
            daoId,
            title,
          }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
        })
      }

      res.status(201).json({ proposal, nostrTemplate })
    } catch (error) {
      console.error('Failed to create proposal:', error)
      res.status(500).json({ error: 'Failed to create proposal' })
    }
  })

  // ── PATCH /daos/:id/proposals/:pid/publish ───────────────────────────
  router.patch('/daos/:id/proposals/:pid/publish', auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id: daoId, pid: proposalId } = req.params
      const callerPubkey = req.authPubkey!

      const proposal = await prisma.daoProposal.findUnique({
        where: { id: proposalId, daoId },
      })

      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' })
      }

      if (proposal.status !== 'DRAFT') {
        return res.status(409).json({ error: `Cannot publish proposal with status ${proposal.status}` })
      }

      if (proposal.authorPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'Only the proposal author can publish' })
      }

      const govConfig = await prisma.daoGovernanceConfig.findUnique({ where: { daoId } })
      if (!govConfig) {
        return res.status(400).json({ error: 'DAO governance not configured' })
      }

      const validationStrategy = await getValidationStrategy(daoId)
      if (validationStrategy) {
        const validation = await validationStrategy.validate({
          authorPubkey: callerPubkey,
          entityType: 'governance',
          strategyParams: govConfig.votingStrategies,
        })
        if (!validation.valid) {
          return res.status(403).json({ error: validation.reason })
        }
      }

      const proposalType = proposal.proposalType ?? 'NORMAL_DECISION'
      const typeOverride = await getTypeOverride(daoId, proposalType)
      const effectiveGov = getEffectiveGovernance(proposalType, typeOverride)

      const now = new Date()
      let finalStatus: string
      let votingStart: Date | null = null
      let votingEnd: Date | null = null
      let snapshotTimestamp: number | null = null
      let commentPeriodEnd: Date | null = null

      if (effectiveGov.hasCommentPeriod) {
        finalStatus = 'COMMENT_PERIOD'
        commentPeriodEnd = new Date(now.getTime() + effectiveGov.commentPeriodSeconds * 1000)
      } else {
        finalStatus = 'ACTIVE'
        votingStart = now
        votingEnd = new Date(now.getTime() + effectiveGov.votingPeriodSeconds * 1000)
        snapshotTimestamp = Math.floor(now.getTime() / 1000)
      }

      const nostrTemplate = composeDaoProposal(
        daoId,
        callerPubkey,
        proposalId,
        proposal.title,
        proposal.content,
        proposal.executionStrategy,
        proposal.executionPayload as Record<string, unknown> | null,
        votingStart ? Math.floor(votingStart.getTime() / 1000) : null,
        votingEnd ? Math.floor(votingEnd.getTime() / 1000) : null,
        snapshotTimestamp,
        proposalType
      )

      const updated = await prisma.daoProposal.update({
        where: { id: proposalId },
        data: {
          status: finalStatus as 'ACTIVE',
          votingStart,
          votingEnd,
          snapshotTimestamp,
          commentPeriodEnd,
        },
        include: { votes: true },
      })

      console.log(`[DAO] Published proposal ${proposalId} → ${finalStatus} for DAO ${daoId}`)

      if (finalStatus === 'ACTIVE') {
        setImmediate(() => {
          notifyArbitrators(prisma, FOUNDATION_DAO_ID, {
            type: 'proposal_voting_started',
            proposalId: updated.id,
            daoId,
            title: proposal.title,
          }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
        })
      }

      if (finalStatus === 'COMMENT_PERIOD') {
        setImmediate(() => {
          notifyArbitrators(prisma, daoId, {
            type: 'proposal_comment_period',
            proposalId: updated.id,
            daoId,
            title: proposal.title,
          }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
        })
      }

      res.json({ proposal: updated, nostrTemplate })
    } catch (error) {
      console.error('Failed to publish proposal:', error)
      res.status(500).json({ error: 'Failed to publish proposal' })
    }
  })

  // ── POST /daos/:id/proposals/:pid/vote ───────────────────────────────
  router.post('/daos/:id/proposals/:pid/vote', auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id: daoId, pid: proposalId } = req.params
      const { choice } = req.body as {
        choice?: 'FOR' | 'AGAINST' | 'ABSTAIN'
      }

      const callerPubkey = req.authPubkey!

      if (!choice) {
        return res.status(400).json({ error: 'choice is required' })
      }

      if (!['FOR', 'AGAINST', 'ABSTAIN'].includes(choice)) {
        return res.status(400).json({ error: 'choice must be FOR, AGAINST, or ABSTAIN' })
      }

      let proposal = await prisma.daoProposal.findUnique({
        where: { id: proposalId, daoId },
        include: { votes: true, dao: { include: { governanceConfig: true } } },
      })

      if (!proposal) {
        return res.status(404).json({ error: 'Proposal not found' })
      }

      const lazyUpdated = await resolveLazyCommentPeriod(proposal)
      if (lazyUpdated) {
        proposal = lazyUpdated as typeof proposal
      }

      if (proposal.status === 'COMMENT_PERIOD') {
        return res.status(409).json({ error: 'Voting has not opened yet — proposal is in comment period' })
      }

      if (proposal.status !== 'ACTIVE') {
        return res.status(409).json({ error: `Cannot vote on proposal with status ${proposal.status}` })
      }

      if (proposal.votingEnd && new Date() > proposal.votingEnd) {
        return res.status(409).json({ error: 'Voting period has ended' })
      }

      const existingVote = proposal.votes.find(v => v.voterPubkey === callerPubkey)
      if (existingVote) {
        return res.status(409).json({ error: 'Already voted on this proposal' })
      }

      const govConfig = proposal.dao.governanceConfig
      if (!govConfig) {
        return res.status(500).json({ error: 'DAO governance not configured' })
      }

      const strategies = await getVotingStrategies(daoId)
      let totalVotingPower = 0
      let primaryStrategy = 'colpoints'

      for (const strategy of strategies) {
        const vp = await strategy.calculate({
          voterPubkey: callerPubkey,
          daoId,
          snapshotTimestamp: proposal.snapshotTimestamp ?? Math.floor(Date.now() / 1000),
          strategyParams: '{}',
        })
        if (vp > 0) {
          totalVotingPower = vp
          primaryStrategy = strategy.type
          break
        }
      }

      const voteId = `vote-${Date.now()}-${proposalId.slice(0, 8)}`

      const nostrTemplate = composeDaoVote(
        proposal.nostrEventId,
        callerPubkey,
        choice,
        totalVotingPower,
        primaryStrategy
      )

      const vote = await prisma.daoVote.create({
        data: {
          proposalId,
          voterPubkey: callerPubkey,
          nostrEventId: voteId,
          choice,
          votingPower: totalVotingPower,
          strategyUsed: primaryStrategy,
        },
      })

      console.log(`[DAO] Vote ${voteId} cast on proposal ${proposalId} by ${callerPubkey}: ${choice} (${totalVotingPower} VP)`)

      const updatedProposal = await prisma.daoProposal.findUnique({
        where: { id: proposalId },
        include: { votes: true, dao: { include: { governanceConfig: true } } },
      })

      if (!updatedProposal) {
        return res.status(500).json({ error: 'Failed to fetch updated proposal' })
      }

      const votesFor = updatedProposal.votes.filter(v => v.choice === 'FOR').reduce((sum, v) => sum + v.votingPower, 0)
      const votesAgainst = updatedProposal.votes.filter(v => v.choice === 'AGAINST').reduce((sum, v) => sum + v.votingPower, 0)
      const votesAbstain = updatedProposal.votes.filter(v => v.choice === 'ABSTAIN').reduce((sum, v) => sum + v.votingPower, 0)

      const resolutionStrategy = getResolutionStrategy()
      const newStatus = resolutionStrategy.getStatus({
        votes: { votesFor, votesAgainst, votesAbstain },
        params: {
          quorumThreshold: govConfig.quorumThreshold,
          votingDelaySeconds: govConfig.votingDelaySeconds,
        },
        votingEnd: proposal.votingEnd ? Math.floor(proposal.votingEnd.getTime() / 1000) : undefined,
        currentTimestamp: Math.floor(Date.now() / 1000),
      })

      if (newStatus !== updatedProposal.status) {
        let updated = await prisma.daoProposal.update({
          where: { id: proposalId },
          data: { status: newStatus },
          include: { votes: true },
        })

        if (newStatus === 'PASSED' || newStatus === 'REJECTED') {
          const outcome = newStatus === 'PASSED' ? 'PASSED' : 'REJECTED'

          const outcomeTemplate = composeDaoProposalOutcome(
            proposal.nostrEventId,
            proposal.authorPubkey,
            outcome,
            votesFor,
            votesAgainst,
            votesAbstain
          )

          if (newStatus === 'PASSED' && proposal.proposalType === 'CODEX_AMENDMENT') {
            const payload = proposal.executionPayload as Record<string, unknown> | null
            if (payload?.newCodexHash && payload?.newCodexVersion) {
              const dao = await prisma.dao.findUnique({ where: { id: daoId } })
              if (dao) {
                const oldCodexHash = dao.codexHash
                await prisma.dao.update({
                  where: { id: daoId },
                  data: {
                    codexHash: payload.newCodexHash as string,
                    codexVersion: payload.newCodexVersion as string,
                  },
                })

                const codexUpdateTemplate = composeCodexUpdateEvent(
                  daoId,
                  proposal.authorPubkey,
                  oldCodexHash,
                  payload.newCodexHash as string,
                  payload.newCodexVersion as string,
                  (payload.codexUrl as string) ?? dao.codexUrl,
                  proposal.nostrEventId
                )

                updated = await prisma.daoProposal.update({
                  where: { id: proposalId },
                  data: { status: 'EXECUTED' },
                  include: { votes: true },
                })

                console.log(`[DAO] Codex hash updated for DAO ${daoId}: ${oldCodexHash.slice(0, 12)}… → ${String(payload.newCodexHash).slice(0, 12)}…`)

                setImmediate(() => {
                  notifyArbitrators(prisma, daoId, {
                    type: 'proposal_executed',
                    proposalId: proposal.id,
                    daoId,
                    title: proposal.title,
                    codexHash: payload.newCodexHash as string,
                  }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
                })

                res.json({ vote, proposal: updated, nostrTemplate, outcomeTemplate, codexUpdateTemplate })
                return
              }
            }
          }

          setImmediate(() => {
            const notifyEvent = newStatus === 'PASSED'
              ? { type: 'proposal_passed' as const, proposalId: proposal.id, daoId, title: proposal.title }
              : { type: 'proposal_rejected' as const, proposalId: proposal.id, daoId, title: proposal.title }

            notifyArbitrators(prisma, FOUNDATION_DAO_ID, notifyEvent)
              .catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
          })

          console.log(`[DAO] Proposal ${proposalId} ${outcome}: FOR=${votesFor} AGAINST=${votesAgainst} ABSTAIN=${votesAbstain}`)

          res.json({ vote, proposal: updated, nostrTemplate, outcomeTemplate })
          return
        }
      }

      res.json({ vote, proposal: updatedProposal, nostrTemplate })
    } catch (error) {
      console.error('Failed to cast vote:', error)
      res.status(500).json({ error: 'Failed to cast vote' })
    }
  })

  // ── GET /daos/:id/governance-config ──────────────────────────────────
  router.get('/daos/:id/governance-config', async (req: AppRequest, res: Response) => {
    try {
      const { id } = req.params

      const config = await prisma.daoGovernanceConfig.findUnique({
        where: { daoId: id },
      })

      if (!config) {
        return res.status(404).json({ error: 'Governance config not found' })
      }

      const overrides = await prisma.daoGovernanceTypeOverride.findMany({
        where: { daoId: id },
      })

      res.json({ config, overrides, codexDefaults: CODEX_DEFAULTS })
    } catch (error) {
      console.error('Failed to fetch governance config:', error)
      res.status(500).json({ error: 'Failed to fetch governance config' })
    }
  })

  // ── PATCH /daos/:id/governance-config ────────────────────────────────
  router.patch('/daos/:id/governance-config', auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id: daoId } = req.params
      const { config: configUpdates, overrides: overrideUpdates } = req.body as {
        config?: {
          proposalValidationStrategy?: string
          votingStrategies?: string
          minVotingPeriodSeconds?: number
          maxVotingPeriodSeconds?: number
        }
        overrides?: Array<{
          proposalType: string
          quorumPercent: number
          majorityPercent: number
          votingPeriodSeconds: number
        }>
      }

      const existing = await prisma.daoGovernanceConfig.findUnique({ where: { daoId } })
      if (!existing) {
        return res.status(404).json({ error: 'Governance config not found' })
      }

      if (configUpdates) {
        await prisma.daoGovernanceConfig.update({
          where: { daoId },
          data: {
            ...(configUpdates.proposalValidationStrategy !== undefined ? { proposalValidationStrategy: configUpdates.proposalValidationStrategy } : {}),
            ...(configUpdates.votingStrategies !== undefined ? { votingStrategies: configUpdates.votingStrategies } : {}),
            ...(configUpdates.minVotingPeriodSeconds !== undefined ? { minVotingPeriodSeconds: configUpdates.minVotingPeriodSeconds } : {}),
            ...(configUpdates.maxVotingPeriodSeconds !== undefined ? { maxVotingPeriodSeconds: configUpdates.maxVotingPeriodSeconds } : {}),
          },
        })
      }

      if (overrideUpdates && Array.isArray(overrideUpdates)) {
        for (const o of overrideUpdates) {
          const codexDefault = CODEX_DEFAULTS[o.proposalType]
          if (!codexDefault) {
            return res.status(422).json({ error: `Unknown proposal type: ${o.proposalType}` })
          }
          if (o.quorumPercent < codexDefault.quorumPercent) {
            return res.status(422).json({ error: `quorumPercent for ${o.proposalType} must be ≥ ${codexDefault.quorumPercent} (looser_than_codex_default)` })
          }
          if (o.majorityPercent < codexDefault.majorityPercent) {
            return res.status(422).json({ error: `majorityPercent for ${o.proposalType} must be ≥ ${codexDefault.majorityPercent} (looser_than_codex_default)` })
          }
          if (o.votingPeriodSeconds < codexDefault.votingPeriodSeconds) {
            return res.status(422).json({ error: `votingPeriodSeconds for ${o.proposalType} must be ≥ ${codexDefault.votingPeriodSeconds} (looser_than_codex_default)` })
          }

          await prisma.daoGovernanceTypeOverride.upsert({
            where: { daoId_proposalType: { daoId, proposalType: o.proposalType as 'NORMAL_DECISION' } },
            create: {
              daoId,
              proposalType: o.proposalType as 'NORMAL_DECISION',
              quorumPercent: o.quorumPercent,
              majorityPercent: o.majorityPercent,
              votingPeriodSeconds: o.votingPeriodSeconds,
            },
            update: {
              quorumPercent: o.quorumPercent,
              majorityPercent: o.majorityPercent,
              votingPeriodSeconds: o.votingPeriodSeconds,
            },
          })
        }
      }

      const config = await prisma.daoGovernanceConfig.findUnique({ where: { daoId } })
      const overrides = await prisma.daoGovernanceTypeOverride.findMany({ where: { daoId } })

      res.json({ config, overrides })
    } catch (error) {
      console.error('Failed to update governance config:', error)
      res.status(500).json({ error: 'Failed to update governance config' })
    }
  })

  // ── GET /daos/:id/codex-settings ─────────────────────────────────────
  router.get('/daos/:id/codex-settings', async (req: AppRequest, res: Response) => {
    try {
      const { id } = req.params

      const dao = await prisma.dao.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          codexHash: true,
          codexVersion: true,
          codexUrl: true,
          updatedAt: true,
        },
      })

      if (!dao) {
        return res.status(404).json({ error: 'DAO not found' })
      }

      const amendmentProposals = await prisma.daoProposal.findMany({
        where: {
          daoId: id,
          proposalType: 'CODEX_AMENDMENT',
          status: { in: ['PASSED', 'EXECUTED'] },
        },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          executionPayload: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      res.json({
        codexSettings: {
          ...dao,
          lastAmendmentDate: amendmentProposals[0]?.createdAt ?? null,
          amendmentHistory: amendmentProposals.map(p => ({
            id: p.id,
            title: p.title,
            status: p.status,
            date: p.createdAt,
            payload: p.executionPayload,
          })),
        },
      })
    } catch (error) {
      console.error('Failed to fetch codex settings:', error)
      res.status(500).json({ error: 'Failed to fetch codex settings' })
    }
  })

  // ── POST /daos/validate-codex ────────────────────────────────────────
  router.post('/daos/validate-codex', createRateLimiter({ windowMs: 60 * 1000, max: 10 }), async (req: AppRequest, res: Response) => {
    try {
      const { codexBody } = req.body as { codexBody?: string }

      if (!codexBody || typeof codexBody !== 'string') {
        return res.status(400).json({ error: 'codexBody is required' })
      }

      if (codexBody.length > 100_000) {
        return res.status(400).json({ error: 'codexBody exceeds maximum size (100KB)' })
      }

      const result = validateCodexSections(codexBody)
      res.json(result)
    } catch (error) {
      console.error('Failed to validate codex:', error)
      res.status(500).json({ error: 'Failed to validate codex' })
    }
  })

  // ── POST /daos (Community DAO Creation) ──────────────────────────────
  router.post('/daos', auth, requireFoundationAdminBySession(prisma), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        name,
        codexBody,
        codexUrl,
        codexVersion,
        codexHash: clientCodexHash,
        founders,
        coSignatures,
        governanceConfig,
        // ADR-200: profile & location fields
        description,
        purpose,
        daoType,
        membershipType,
        focusAreas,
        language,
        website,
        country,
        region,
        city,
        isOnlineOnly,
        images,
      } = req.body as {
        name?: string
        codexBody?: string
        codexUrl?: string
        codexVersion?: string
        codexHash?: string
        founders?: string[]
        coSignatures?: Array<{ pubkey: string; event: string }>
        governanceConfig?: {
          proposalValidationStrategy: string
          votingStrategies: string
          minVotingPeriodSeconds: number
          maxVotingPeriodSeconds: number
        }
        description?: string
        purpose?: string
        daoType?: string
        membershipType?: string
        focusAreas?: string
        language?: string
        website?: string
        country?: string
        region?: string
        city?: string
        isOnlineOnly?: boolean
        images?: string[]
      }

      const initiatorPubkey = req.authPubkey!

      if (!name || !codexBody || !codexUrl || !codexVersion) {
        return res.status(400).json({ error: 'name, codexBody, codexUrl, and codexVersion are required' })
      }

      const initiator = await prisma.user.findUnique({
        where: { pubkey: initiatorPubkey },
        select: { identityLevel: true },
      })
      if (!initiator || initiator.identityLevel < 2) {
        return res.status(403).json({ error: 'Initiator must have Identity Level ≥ 2' })
      }

      if (!founders || !Array.isArray(founders) || founders.length < 5) {
        return res.status(400).json({ error: 'At least 5 founders are required' })
      }

      if (!founders.includes(initiatorPubkey)) {
        return res.status(400).json({ error: 'Initiator must be included in founders list' })
      }

      if (!coSignatures || !Array.isArray(coSignatures)) {
        return res.status(400).json({ error: 'coSignatures are required' })
      }

      const nonInitiatorFounders = founders.filter(f => f !== initiatorPubkey)
      if (coSignatures.length < nonInitiatorFounders.length) {
        return res.status(400).json({ error: `All ${nonInitiatorFounders.length} non-initiator founders must provide co-signatures` })
      }

      const coSigPubkeys = new Set(coSignatures.map(s => s.pubkey))
      for (const f of nonInitiatorFounders) {
        if (!coSigPubkeys.has(f)) {
          return res.status(422).json({ error: `Missing co-signature for founder ${f.slice(0, 12)}...` })
        }
      }

      for (const sig of coSignatures) {
        try {
          const parsed = JSON.parse(sig.event)
          if (!parsed.kind || parsed.kind !== 30021 || !parsed.pubkey || !parsed.content) {
            return res.status(422).json({ error: `Invalid co-signature event format for ${sig.pubkey.slice(0, 12)}...` })
          }
          if (parsed.pubkey !== sig.pubkey) {
            return res.status(422).json({ error: `Co-signature pubkey mismatch for ${sig.pubkey.slice(0, 12)}...` })
          }
        } catch {
          return res.status(422).json({ error: `Malformed co-signature event for ${sig.pubkey.slice(0, 12)}...` })
        }
      }

      const serverCodexHash = createHash('sha256').update(codexBody, 'utf8').digest('hex')
      if (clientCodexHash && clientCodexHash !== serverCodexHash) {
        return res.status(422).json({ error: 'codexHash mismatch — client-supplied hash does not match server-computed hash' })
      }

      const codexValidation = validateCodexSections(codexBody)
      if (!codexValidation.valid) {
        return res.status(422).json({ error: 'Codex validation failed', missingSections: codexValidation.missingSections })
      }

      const daoId = `community-${Date.now()}-${initiatorPubkey.slice(0, 8)}`

      const dao = await prisma.dao.create({
        data: {
          id: daoId,
          name,
          codexHash: serverCodexHash,
          codexVersion,
          codexUrl,
          status: 'ACTIVE',
          // ADR-200: optional profile & location
          ...(description && { description }),
          ...(purpose && { purpose }),
          ...(daoType && { daoType: daoType as any }),
          ...(membershipType && { membershipType: membershipType as any }),
          ...(focusAreas && { focusAreas }),
          ...(language && { language }),
          ...(website && { website }),
          ...(country && { country }),
          ...(region && { region }),
          ...(city && { city }),
          ...(typeof isOnlineOnly === 'boolean' && { isOnlineOnly }),
          ...(Array.isArray(images) && { images: images.length > 0 ? JSON.stringify(images.slice(0, 5)) : null }),
          members: {
            create: founders.map(pubkey => ({
              pubkey,
              role: pubkey === initiatorPubkey ? 'ADMIN' : 'ARBITRATOR',
              status: 'ACTIVE',
            })),
          },
        },
      })

      if (governanceConfig) {
        await prisma.daoGovernanceConfig.create({
          data: {
            daoId,
            proposalValidationStrategy: governanceConfig.proposalValidationStrategy ?? 'colpoints_threshold',
            votingStrategies: governanceConfig.votingStrategies ?? '["colpoints"]',
            minVotingPeriodSeconds: governanceConfig.minVotingPeriodSeconds ?? 7 * 86400,
            maxVotingPeriodSeconds: governanceConfig.maxVotingPeriodSeconds ?? 30 * 86400,
          },
        })
      } else {
        await prisma.daoGovernanceConfig.create({
          data: {
            daoId,
            proposalValidationStrategy: 'colpoints_threshold',
            votingStrategies: '["colpoints"]',
            minVotingPeriodSeconds: 7 * 86400,
            maxVotingPeriodSeconds: 30 * 86400,
          },
        })
      }

      console.log(`[DAO] Community DAO created: ${daoId} (${name}) by ${initiatorPubkey}`)

      const nostrTemplate = composeDaoCreationEvent(dao, initiatorPubkey, initiatorPubkey)

      res.status(201).json({ dao: { id: daoId, name, codexHash: serverCodexHash, codexVersion }, nostrTemplate })
    } catch (error) {
      console.error('Failed to create community DAO:', error)
      res.status(500).json({ error: 'Failed to create community DAO' })
    }
  })

  // ── GET /daos/:id/treasury ───────────────────────────────────────────
  router.get('/daos/:id/treasury', async (req: AppRequest, res: Response) => {
    try {
      const { id } = req.params

      let treasury = await prisma.daoTreasury.findUnique({
        where: { daoId: id },
        include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
      })

      if (!treasury) {
        treasury = await prisma.daoTreasury.create({
          data: { daoId: id },
          include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
        })
      }

      res.json({ treasury: { ...treasury, balanceSats: Number(treasury.balanceSats) } })
    } catch (error) {
      console.error('Failed to fetch treasury:', error)
      res.status(500).json({ error: 'Failed to fetch treasury' })
    }
  })

  // ── PATCH /daos/:id (edit profile) ───────────────────────────────────
  router.patch('/daos/:id', auth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id: daoId } = req.params
      const requesterPubkey = req.authPubkey!

      // Only an ADMIN member of the DAO may edit its profile
      const member = await prisma.daoMember.findUnique({
        where: { daoId_pubkey: { daoId, pubkey: requesterPubkey } },
      })
      if (!member || member.role !== 'ADMIN' || member.status !== 'ACTIVE') {
        return res.status(403).json({ error: 'Only active DAO admins may edit the profile' })
      }

      const {
        description, purpose, logoUrl, bannerUrl, website, language,
        country, region, city, isOnlineOnly, focusAreas,
        daoType, membershipType, images,
      } = req.body as {
        description?: string | null
        purpose?: string | null
        logoUrl?: string | null
        bannerUrl?: string | null
        website?: string | null
        language?: string
        country?: string | null
        region?: string | null
        city?: string | null
        isOnlineOnly?: boolean
        focusAreas?: string | null
        daoType?: string
        membershipType?: string
        images?: string[] | null
      }

      const updated = await prisma.dao.update({
        where: { id: daoId },
        data: {
          ...(description !== undefined && { description: description ?? null }),
          ...(purpose !== undefined && { purpose: purpose ?? null }),
          ...(logoUrl !== undefined && { logoUrl: logoUrl ?? null }),
          ...(bannerUrl !== undefined && { bannerUrl: bannerUrl ?? null }),
          ...(website !== undefined && { website: website ?? null }),
          ...(language !== undefined && { language: language ?? null }),
          ...(country !== undefined && { country: country ?? null }),
          ...(region !== undefined && { region: region ?? null }),
          ...(city !== undefined && { city: city ?? null }),
          ...(typeof isOnlineOnly === 'boolean' && { isOnlineOnly }),
          ...(focusAreas !== undefined && { focusAreas: focusAreas ?? null }),
          ...(daoType && { daoType: daoType as any }),
          ...(membershipType && { membershipType: membershipType as any }),
          ...(images !== undefined && { images: Array.isArray(images) && images.length > 0 ? JSON.stringify(images.slice(0, 5)) : null }),
        },
      })

      res.json({ dao: updated })
    } catch (error) {
      console.error('Failed to update DAO profile:', error)
      res.status(500).json({ error: 'Failed to update DAO profile' })
    }
  })

  // ── GET /daos/:id/members ────────────────────────────────────────────
  router.get('/daos/:id/members', async (req: AppRequest, res: Response) => {
    try {
      const { id: daoId } = req.params
      const members = await prisma.daoMember.findMany({
        where: { daoId },
        orderBy: { addedAt: 'asc' },
      })
      res.json({ members })
    } catch (error) {
      console.error('Failed to fetch DAO members:', error)
      res.status(500).json({ error: 'Failed to fetch DAO members' })
    }
  })

  // ── GET /daos ────────────────────────────────────────────────────────
  router.get('/daos', async (req: AppRequest, res: Response) => {
    try {
      const daos = await prisma.dao.findMany({
        include: {
          config: true,
          governanceConfig: true,
          treasury: true,
          _count: { select: { proposals: true, members: true } },
        },
        orderBy: { createdAt: 'desc' },
      })

      res.json({
        daos: daos.map(dao => ({
          ...dao,
          treasury: dao.treasury ? { ...dao.treasury, balanceSats: Number(dao.treasury.balanceSats) } : null,
        })),
      })
    } catch (error) {
      console.error('Failed to fetch DAOs:', error)
      res.status(500).json({ error: 'Failed to fetch DAOs' })
    }
  })

  return router
}
