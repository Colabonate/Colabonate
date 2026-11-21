import type { Response, NextFunction } from 'express'
import type { AuthenticatedRequest } from '../types/express.js'

/**
 * Binds the legacy `callerPubkey` request field to the authenticated session.
 *
 * Escrow/dispute routes historically read the acting party from
 * `req.body.callerPubkey` (or `req.query.callerPubkey`) and compared it to the
 * ticket's buyer/seller/arbitrator — but never verified the claim itself, so
 * any caller could act as any pubkey. Mount this AFTER requireAuth: it rejects
 * a claimed callerPubkey that does not match `req.authPubkey` with 403.
 * Handlers can keep reading callerPubkey from the request unchanged — after
 * this middleware the claim is guaranteed to equal the session identity.
 */
export function enforceCallerIdentity(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const claimed =
    (req.body as { callerPubkey?: unknown } | undefined)?.callerPubkey ??
    (req.query as { callerPubkey?: unknown } | undefined)?.callerPubkey

  if (typeof claimed === 'string' && claimed && claimed !== req.authPubkey) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'callerPubkey does not match authenticated user' })
    return
  }
  next()
}
