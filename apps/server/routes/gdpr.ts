/**
 * ADR-156 — GDPR Art. 17 routes, + ADR-252 D6 / FU-11 Art. 15 export.
 *
 *   GET  /api/gdpr/pre-check                 — blockers + event ids + preview
 *   POST /api/gdpr/delete-account            — cascade (self-service)
 *   GET  /api/gdpr/export                    — full data export (self-service)
 *
 * The admin-triggered path lives in index.ts (POST /api/admin/gdpr/delete-user,
 * requireAdmin) to match the existing admin-endpoint convention (wipe,
 * remote-candidates).
 *
 * Signing: the Kind 5 NIP-09 deletion request is signed + published CLIENT-SIDE
 * (apps/colabonate-app/src/lib/nip09.ts) BEFORE delete-account is called; the
 * client passes {kind5EventId, relayResponses} into delete-account so the audit
 * log captures them atomically with the cascade. NIP-09 is best-effort — if the
 * client cannot publish (no extension, relay down), deletion still proceeds and
 * the audit log records nip09RelaysOk = 0.
 */

import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js'
import {
  preCheckDeletion,
  deleteUserAccount,
  DeletionBlockedError,
} from '../services/account-deletion.js'
import { exportUserData } from '../services/account-export.js'

const CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT'

export function createGdprRouter(prisma: PrismaClient) {
  const router = Router()

  // GET /api/gdpr/pre-check — what would be deleted + blockers + event ids.
  router.get('/pre-check', requireAuth(prisma), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pre = await preCheckDeletion(prisma, req.authPubkey!)
      res.json(pre)
    } catch (err) {
      console.error('[gdpr/pre-check] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Pre-check failed' })
    }
  })

  // POST /api/gdpr/delete-account — performs the cascade (self-service).
  // Body: { confirmation: 'DELETE MY ACCOUNT', kind5EventId?, relayResponses? }
  router.post(
    '/delete-account',
    requireAuth(prisma),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { confirmation, kind5EventId, relayResponses } = req.body as {
          confirmation?: string
          kind5EventId?: string | null
          relayResponses?: Record<string, { success: boolean; error?: string }>
        }

        if (confirmation !== CONFIRMATION_PHRASE) {
          return res.status(400).json({
            error: 'CONFIRMATION_REQUIRED',
            message: `Type "${CONFIRMATION_PHRASE}" to confirm.`,
          })
        }

        const result = await deleteUserAccount(prisma, req.authPubkey!, {
          trigger: 'USER',
          nip09: { kind5EventId, relayResponses },
        })

        res.json(result)
      } catch (err) {
        if (err instanceof DeletionBlockedError) {
          return res.status(409).json({
            error: 'DELETION_BLOCKED',
            blockers: err.blockers,
            message: err.message,
          })
        }
        console.error('[gdpr/delete-account] Error:', err)
        res.status(500).json({
          error: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Deletion failed',
        })
      }
    },
  )

  // GET /api/gdpr/export — full self-service data export (Art. 15).
  router.get('/export', requireAuth(prisma), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await exportUserData(prisma, req.authPubkey!)
      if (!data) {
        return res.status(404).json({ error: 'USER_NOT_FOUND' })
      }
      res.setHeader('Content-Disposition', 'attachment; filename="colabonate-data-export.json"')
      res.json(data)
    } catch (err) {
      console.error('[gdpr/export] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Export failed' })
    }
  })

  return router
}
