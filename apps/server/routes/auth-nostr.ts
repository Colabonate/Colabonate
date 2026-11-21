import { Router, type Request, Response } from 'express'
import type { NostrEvent } from 'nostr-tools'
import type { PrismaClient } from '@prisma/client'
import { issueChallenge, isValidPubkeyHex, verifyChallenge } from '../services/nostr-auth.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export function createNostrAuthRouter(prisma: PrismaClient) {
  const router = Router()

  router.post('/challenge', async (req: Request, res: Response) => {
    try {
      const { expectedPubkey } = req.body as { expectedPubkey?: string }

      if (expectedPubkey !== undefined && !isValidPubkeyHex(expectedPubkey)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'expectedPubkey must be 64-char hex' })
      }

      const { nonce, expiresAt } = await issueChallenge(prisma, expectedPubkey)

      res.json({
        nonce,
        expiresAt: expiresAt.toISOString(),
        ttlSeconds: Math.floor(CHALLENGE_TTL_MS / 1000),
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown'
      if (msg === 'INVALID_PUBKEY') {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'expectedPubkey must be 64-char hex' })
      }
      console.error('[NostrAuth] Failed to issue challenge:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to issue challenge' })
    }
  })

  router.post('/verify', async (req: Request, res: Response) => {
    try {
      const { event } = req.body as { event: NostrEvent }

      if (!event || typeof event !== 'object') {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'event object required' })
        return
      }

      const result = await verifyChallenge(prisma, event)
      if (!result) {
        res.status(403).json({ error: 'AUTH_FAILED', message: 'Challenge verification failed or expired' })
        return
      }

      // ADR-158 Part A: /verify now returns the same shape as /api/auth/demo
      // (and Google / Email) so the frontend can set Bearer token + pubkey
      // and authenticated requests work immediately.
      res.json({
        ok: true,
        pubkey: result.pubkey,
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
        verifiedAt: result.consumedAt.toISOString(),
      })
    } catch (error) {
      console.error('[NostrAuth] Failed to verify challenge:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to verify challenge' })
    }
  })

  return router
}