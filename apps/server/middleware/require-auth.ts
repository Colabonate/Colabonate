import type { Response, NextFunction } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedRequest } from '../types/express.js'

export type { AuthenticatedRequest }

export function requireAuth(prisma: PrismaClient) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization

    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' })
      return
    }

    const token = authHeader.slice(7)

    try {
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: { select: { pubkey: true, identityLevel: true, blockedAt: true, blockedReason: true } } },
      })

      if (!session || session.expiresAt < new Date()) {
        if (session) {
          await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
        }
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' })
        return
      }

      // ADR-284 D6: a blocked account's sessions are already force-deleted at
      // block time, but this covers any session minted in the gap between the
      // block write and that delete, and any future request race.
      if (session.user.blockedAt) {
        await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
        res.status(403).json({ error: 'ACCOUNT_BLOCKED', message: session.user.blockedReason ?? 'This account has been blocked.' })
        return
      }

      req.authPubkey = session.user.pubkey
      req.authToken = token
      next()
    } catch (error) {
      console.error('[requireAuth] Error:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Authentication check failed' })
    }
  }
}

export async function validateToken(
  prisma: PrismaClient,
  token: string
): Promise<{ pubkey: string; identityLevel: number } | null> {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { pubkey: true, identityLevel: true, blockedAt: true } } },
  })

  if (!session) return null
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  if (session.user.blockedAt) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }

  return {
    pubkey: session.user.pubkey,
    identityLevel: session.user.identityLevel,
  }
}
