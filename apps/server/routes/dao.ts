import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { type AuthenticatedRequest, requireAdmin } from '../middleware/require-admin.js'
import { verifyEvent } from 'nostr-tools'
import { composeCredentialRevocation } from '../services/dao-nostr.js'

const FOUNDATION_DAO_ID = 'colabonate-foundation'

export function createDaoRouter(prisma: PrismaClient) {
  const router = Router()

  router.get('/foundation', async (req, res) => {
    try {
      const dao = await prisma.dao.findUnique({
        where: { id: FOUNDATION_DAO_ID },
        include: { config: true },
      })
      if (!dao) {
        res.status(404).json({ error: 'Foundation DAO not found' })
        return
      }
      res.json({ dao })
    } catch (error) {
      console.error('Failed to fetch Foundation DAO:', error)
      res.status(500).json({ error: 'Failed to fetch Foundation DAO' })
    }
  })

  router.get('/foundation/members', async (req, res) => {
    try {
      const { status } = req.query
      const where: Record<string, unknown> = { daoId: FOUNDATION_DAO_ID }
      if (status) {
        where.status = status as string
      }
      const members = await prisma.daoMember.findMany({
        where,
        orderBy: { addedAt: 'asc' },
      })
      res.json({ members })
    } catch (error) {
      console.error('Failed to fetch DAO members:', error)
      res.status(500).json({ error: 'Failed to fetch DAO members' })
    }
  })

  router.get('/foundation/admins', async (req, res) => {
    try {
      const admins = await prisma.daoMember.findMany({
        where: { daoId: FOUNDATION_DAO_ID, role: 'ADMIN', status: 'ACTIVE' },
        select: { pubkey: true },
      })
      res.json({ adminPubkeys: admins.map(a => a.pubkey) })
    } catch (error) {
      console.error('Failed to fetch admin pubkeys:', error)
      res.status(500).json({ error: 'Failed to fetch admin pubkeys' })
    }
  })

  router.post(
    '/foundation/members',
    requireAdmin(prisma),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { pubkey, role } = req.body as { pubkey?: string; role?: string }

        if (!pubkey || !role) {
          res.status(400).json({ error: 'pubkey and role are required' })
          return
        }

        if (!['ARBITRATOR', 'MEDIATOR'].includes(role)) {
          res.status(400).json({ error: 'role must be ARBITRATOR or MEDIATOR' })
          return
        }

        const adminPubkey = req.adminPubkey!

        const existing = await prisma.daoMember.findUnique({
          where: { daoId_pubkey: { daoId: FOUNDATION_DAO_ID, pubkey } },
        })

        if (existing) {
          res.status(409).json({ error: 'Member already exists' })
          return
        }

        const member = await prisma.daoMember.create({
          data: {
            daoId: FOUNDATION_DAO_ID,
            pubkey,
            role: role as 'ARBITRATOR' | 'MEDIATOR',
            status: 'PENDING',
            invitedBy: adminPubkey,
          },
        })

        await prisma.adminAuditLog.create({
          data: {
            adminPubkey,
            action: 'member_invite',
            targetId: pubkey,
            payload: JSON.stringify({ role, memberId: member.id }),
          },
        })

        res.status(201).json({ success: true, member })
      } catch (error) {
        console.error('Failed to invite member:', error)
        res.status(500).json({ error: 'Failed to invite member' })
      }
    }
  )

  router.patch(
    '/foundation/members/:pubkey/revoke',
    requireAdmin(prisma),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { pubkey } = req.params
        const adminPubkey = req.adminPubkey!

        const member = await prisma.daoMember.findUnique({
          where: { daoId_pubkey: { daoId: FOUNDATION_DAO_ID, pubkey } },
        })

        if (!member) {
          res.status(404).json({ error: 'Member not found' })
          return
        }

        if (member.status === 'REVOKED') {
          res.status(409).json({ error: 'Member already revoked' })
          return
        }

        if (pubkey === adminPubkey) {
          res.status(400).json({ error: 'Cannot revoke self in M2' })
          return
        }

        const updated = await prisma.daoMember.update({
          where: { daoId_pubkey: { daoId: FOUNDATION_DAO_ID, pubkey } },
          data: { status: 'REVOKED', revokedAt: new Date() },
        })

        await prisma.adminAuditLog.create({
          data: {
            adminPubkey,
            action: 'member_revoke',
            targetId: pubkey,
            payload: JSON.stringify({ memberId: updated.id, previousStatus: member.status }),
          },
        })

        const revocationTemplate = member.credentialEventId
          ? composeCredentialRevocation(member.credentialEventId, adminPubkey)
          : null

        res.json({ success: true, member: updated, revocationTemplate })
      } catch (error) {
        console.error('Failed to revoke member:', error)
        res.status(500).json({ error: 'Failed to revoke member' })
      }
    }
  )

  router.post('/foundation/members/:pubkey/accept', async (req, res) => {
    try {
      const { pubkey } = req.params
      const { signedCredentialEvent } = req.body as { signedCredentialEvent?: { kind: number; pubkey: string; content: string; tags: string[][]; id?: string; sig?: string } }

      if (!signedCredentialEvent) {
        res.status(400).json({ error: 'signedCredentialEvent is required' })
        return
      }

      if (signedCredentialEvent.kind !== 30021) {
        res.status(400).json({ error: 'Event must be Kind 30021 (Arbitrator Credential)' })
        return
      }

      if (signedCredentialEvent.pubkey !== pubkey) {
        res.status(400).json({ error: 'Event pubkey does not match URL pubkey' })
        return
      }

      const validSig = verifyEvent(signedCredentialEvent as any)
      if (!validSig) {
        res.status(400).json({ error: 'Invalid event signature' })
        return
      }

      const credentialTypeTag = signedCredentialEvent.tags.find(t => t[0] === 'credential_type')
      if (!credentialTypeTag || credentialTypeTag[1] !== 'arbitrator') {
        res.status(400).json({ error: 'credential_type must be "arbitrator"' })
        return
      }

      const daoIdTag = signedCredentialEvent.tags.find(t => t[0] === 'dao_id')
      if (!daoIdTag || daoIdTag[1] !== FOUNDATION_DAO_ID) {
        res.status(400).json({ error: 'dao_id must be "colabonate-foundation"' })
        return
      }

      const member = await prisma.daoMember.findUnique({
        where: { daoId_pubkey: { daoId: FOUNDATION_DAO_ID, pubkey } },
      })

      if (!member) {
        res.status(404).json({ error: 'No pending invitation found for this pubkey' })
        return
      }

      if (member.status !== 'PENDING') {
        res.status(409).json({ error: `Member status is ${member.status}, expected PENDING` })
        return
      }

      const eventId = signedCredentialEvent.id

      const updated = await prisma.daoMember.update({
        where: { daoId_pubkey: { daoId: FOUNDATION_DAO_ID, pubkey } },
        data: {
          status: 'ACTIVE',
          acceptedAt: new Date(),
          credentialEventId: eventId ?? null,
        },
      })

      res.json({ success: true, member: updated })
    } catch (error) {
      console.error('Failed to accept member invitation:', error)
      res.status(500).json({ error: 'Failed to accept invitation' })
    }
  })

  router.get('/foundation/config', async (req, res) => {
    try {
      const config = await prisma.daoConfig.findUnique({
        where: { daoId: FOUNDATION_DAO_ID },
      })
      if (!config) {
        res.status(404).json({ error: 'DAO config not found' })
        return
      }
      res.json({ config })
    } catch (error) {
      console.error('Failed to fetch DAO config:', error)
      res.status(500).json({ error: 'Failed to fetch DAO config' })
    }
  })

  router.post('/foundation/nostr-event-id', async (req, res) => {
    try {
      const { nostrEventId } = req.body
      if (!nostrEventId || typeof nostrEventId !== 'string') {
        res.status(400).json({ error: 'nostrEventId is required' })
        return
      }
      await prisma.dao.update({
        where: { id: FOUNDATION_DAO_ID },
        data: { nostrEventId },
      })
      res.json({ success: true })
    } catch (error) {
      console.error('Failed to update DAO nostrEventId:', error)
      res.status(500).json({ error: 'Failed to update nostrEventId' })
    }
  })

  router.post('/foundation/members/:pubkey/credential-event-id', async (req, res) => {
    try {
      const { pubkey } = req.params
      const { nostrEventId } = req.body
      if (!nostrEventId || typeof nostrEventId !== 'string') {
        res.status(400).json({ error: 'nostrEventId is required' })
        return
      }
      await prisma.daoMember.update({
        where: { daoId_pubkey: { daoId: FOUNDATION_DAO_ID, pubkey } },
        data: { credentialEventId: nostrEventId },
      })
      res.json({ success: true })
    } catch (error) {
      console.error('Failed to update member credentialEventId:', error)
      res.status(500).json({ error: 'Failed to update credentialEventId' })
    }
  })

  router.patch(
    '/foundation/config',
    requireAdmin(prisma),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { quorumType, thresholdN, coolingOffDays, verdictDeadlineHours } = req.body as {
          quorumType?: string
          thresholdN?: number
          coolingOffDays?: number
          verdictDeadlineHours?: number
        }

        const adminPubkey = req.adminPubkey!

        const updateData: Record<string, unknown> = {}
        if (quorumType) {
          if (!['SINGLE', 'MAJORITY', 'THRESHOLD'].includes(quorumType)) {
            res.status(400).json({ error: 'quorumType must be SINGLE, MAJORITY, or THRESHOLD' })
            return
          }
          updateData.quorumType = quorumType
        }
        if (thresholdN !== undefined) {
          if (thresholdN < 1) {
            res.status(400).json({ error: 'thresholdN must be >= 1' })
            return
          }
          updateData.thresholdN = thresholdN
        }
        if (coolingOffDays !== undefined) {
          if (coolingOffDays < 0 || coolingOffDays > 30) {
            res.status(400).json({ error: 'coolingOffDays must be between 0 and 30' })
            return
          }
          updateData.coolingOffDays = coolingOffDays
        }
        if (verdictDeadlineHours !== undefined) {
          if (verdictDeadlineHours < 1) {
            res.status(400).json({ error: 'verdictDeadlineHours must be >= 1' })
            return
          }
          updateData.verdictDeadlineHours = verdictDeadlineHours
        }

        if (Object.keys(updateData).length === 0) {
          res.status(400).json({ error: 'No valid fields to update' })
          return
        }

        const config = await prisma.daoConfig.update({
          where: { daoId: FOUNDATION_DAO_ID },
          data: updateData,
        })

        await prisma.adminAuditLog.create({
          data: {
            adminPubkey,
            action: 'config_update',
            targetId: FOUNDATION_DAO_ID,
            payload: JSON.stringify(updateData),
          },
        })

        res.json({ success: true, config })
      } catch (error) {
        console.error('Failed to update DAO config:', error)
        res.status(500).json({ error: 'Failed to update config' })
      }
    }
  )

  // ── Simulator Endpoints (DEV ONLY) ─────────────────────────────────────────

  router.post('/simulator/seed', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Simulator endpoints disabled in production' })
    }

    const DEMO_DAO_ID = 'colabonate-foundation'
    const DEMO_ADMIN_KEY = 'test-buyer-pubkey'

    await prisma.dao.upsert({
      where: { id: DEMO_DAO_ID },
      update: {},
      create: {
        id: DEMO_DAO_ID,
        name: 'Colabonate Foundation DAO',
        codexHash: 'demo-codex-hash',
        codexVersion: '1.0.0-demo',
        codexUrl: 'docs/protocols/governance/dao-codex.md',
        status: 'BOOTSTRAP',
      },
    })

    await prisma.daoConfig.upsert({
      where: { daoId: DEMO_DAO_ID },
      update: {},
      create: {
        daoId: DEMO_DAO_ID,
        quorumType: 'SINGLE',
        thresholdN: 1,
        coolingOffDays: 7,
        mediationDays: 14,
        verdictDeadlineHours: 48,
      },
    })

    await prisma.daoGovernanceConfig.upsert({
      where: { daoId: DEMO_DAO_ID },
      update: {
        quorumThreshold: 1,
        minVotingPeriodSeconds: 120,
        votingDelaySeconds: 0,
      },
      create: {
        daoId: DEMO_DAO_ID,
        proposalValidationStrategy: 'colpoints_threshold',
        votingStrategies: JSON.stringify(['colpoints']),
        quorumType: 'SIMPLE',
        quorumThreshold: 1,
        votingDelaySeconds: 0,
        minVotingPeriodSeconds: 120,
        maxVotingPeriodSeconds: 604800,
      },
    })

    await prisma.daoMember.upsert({
      where: { daoId_pubkey: { daoId: DEMO_DAO_ID, pubkey: DEMO_ADMIN_KEY } },
      update: { role: 'ADMIN', status: 'ACTIVE' },
      create: {
        daoId: DEMO_DAO_ID,
        pubkey: DEMO_ADMIN_KEY,
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    })

    res.json({ success: true, daoId: DEMO_DAO_ID, message: 'Demo DAO governance config ready' })
  })

  router.post('/simulator/reset', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Simulator endpoints disabled in production' })
    }

    const DEMO_DAO_ID = 'colabonate-foundation'

    const votes = await prisma.daoVote.deleteMany({
      where: { proposal: { daoId: DEMO_DAO_ID } },
    })
    const proposals = await prisma.daoProposal.deleteMany({
      where: { daoId: DEMO_DAO_ID },
    })

    res.json({
      success: true,
      deleted: { votes: votes.count, proposals: proposals.count },
      message: 'All proposals and votes deleted — DAO config preserved',
    })
  })

  return router
}
