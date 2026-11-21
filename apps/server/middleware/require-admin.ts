import type { Response, NextFunction } from 'express'
import type { NostrEvent } from 'nostr-tools'
import type { PrismaClient } from '@prisma/client'
import { verifyChallenge } from '../services/nostr-auth.js'
import type { AuthenticatedRequest } from '../types/express.js'

export const FOUNDATION_DAO_ID = 'colabonate-foundation'

export type { AuthenticatedRequest }

export function requireAdmin(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Nostr ')) {
      res.status(403).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' })
      return
    }

    let signedEvent: NostrEvent
    try {
      const eventJson = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8')
      signedEvent = JSON.parse(eventJson) as NostrEvent
    } catch {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid authorization header encoding' })
      return
    }

    const result = await verifyChallenge(prisma, signedEvent)
    if (!result) {
      res.status(403).json({ error: 'AUTH_FAILED', message: 'Challenge verification failed or expired' })
      return
    }

    const member = await prisma.daoMember.findFirst({
      where: {
        daoId: FOUNDATION_DAO_ID,
        pubkey: result.pubkey,
        status: 'ACTIVE',
        role: 'ADMIN',
      },
    })

    if (!member) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Caller is not an active admin' })
      return
    }

    req.adminPubkey = result.pubkey
    next()
  }
}

/**
 * Launch-scope gate: restricts community-DAO creation (POST /api/daos) to
 * Foundation admins only. Same DB check as requireAdmin() above, but reuses
 * the caller's already-verified session (req.authPubkey, set by requireAuth
 * upstream) instead of demanding a second Nostr-signed challenge — the route
 * already sits behind requireAuth, and requireAdmin's own `Nostr <base64>`
 * header scheme can't be stacked after it (mutually exclusive Authorization
 * header formats). Temporary: lift once community DAO creation opens up to
 * everyone again — see docs/beta/MAINNET-CUTOVER-RUNBOOK.md.
 */
export function requireFoundationAdminBySession(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const pubkey = req.authPubkey
    if (!pubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing session' })
      return
    }
    const member = await prisma.daoMember.findFirst({
      where: { daoId: FOUNDATION_DAO_ID, pubkey, status: 'ACTIVE', role: 'ADMIN' },
    })
    if (!member) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'DAO creation is currently limited to Colabonate Foundation admins' })
      return
    }
    next()
  }
}