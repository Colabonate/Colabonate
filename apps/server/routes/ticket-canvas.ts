/**
 * ADR-342 D4/D5 (Phase B) + ADR-370 D2 (Phase 1, FU-670): Nostr SSO bridge into
 * the Colabonate-hosted doop canvas. Colabonate already knows who the caller is
 * (requireAuth session); this router asks the hosted doop instance (fork-side
 * service route, token-guarded, server-to-server) for a one-time, short-TTL
 * login URL and hands exactly that URL to the browser — no Nostr key material,
 * no service token, no session tokens ever cross to the client (FU-195-C).
 *
 * Routes (all auth-required, mounted under /api/tickets):
 *   GET  /:id/canvas-url   — buyer/seller of the ticket; mints the one-time
 *                            login URL for the ticket's provisioned canvas.
 *   POST /:id/canvas-retry — re-enqueues provisioning after a 'failed'
 *                            status (D3 button contract).
 *
 * Binding resolution since ADR-370 Phase 1: the doop-hosted binding lives on
 * the TICKET (snapshotted at purchase, provisioned at PAID) and the canvas
 * works even with NO Workspace row (fix G2). Legacy pre-Phase-1 tickets carry
 * the binding on their Workspace — resolved as a fallback here.
 *
 * Access rules: ticket buyer or seller only (orchestrator/multi-party is
 * FU-550). The buyer is refused when the D4a snapshot says
 * canvasBuyerAccess === 'none' (F1: doop has no view-only share link — the
 * canvas is seller-only then).
 */
import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/require-auth.js'
import { enqueueCanvasProvisioning, enqueueCanvasProvisioningForTicket, requestCanvasLoginUrl } from '../services/canvas-provisioning.js'

interface CanvasBinding {
  /** Where the authoritative binding lives — drives which row to update. */
  anchor: 'ticket' | 'workspace'
  workspaceId?: string
  canvasId: string | null
  canvasBuyerAccess: string | null
  canvasProvisioningStatus: string | null
}

/**
 * Resolve the ticket's hosted-canvas binding. Ticket columns are authoritative
 * (Phase 1); the legacy Workspace row is the fallback for pre-Phase-1 tickets.
 */
async function resolveCanvasBinding(
  prisma: PrismaClient,
  ticket: { id: string; canvasProvider: string | null; canvasId: string | null; canvasBuyerAccess: string | null; canvasProvisioningStatus: string | null },
): Promise<CanvasBinding | null> {
  if (ticket.canvasProvider === 'doop-hosted') {
    return {
      anchor: 'ticket',
      canvasId: ticket.canvasId,
      canvasBuyerAccess: ticket.canvasBuyerAccess,
      canvasProvisioningStatus: ticket.canvasProvisioningStatus,
    }
  }
  const workspace = await prisma.workspace.findUnique({ where: { ticketId: ticket.id } })
  if (workspace?.canvasProvider === 'doop-hosted') {
    return {
      anchor: 'workspace',
      workspaceId: workspace.id,
      canvasId: workspace.canvasId,
      canvasBuyerAccess: workspace.canvasBuyerAccess,
      canvasProvisioningStatus: workspace.canvasProvisioningStatus,
    }
  }
  return null
}

export function createTicketCanvasRouter(prisma: PrismaClient) {
  const router = Router()

  // Shared loader: ticket + its canvas binding, caller must be buyer or seller.
  async function loadForParty(req: Request, res: Response) {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return null
    }
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true,
        buyerPubkey: true,
        sellerPubkey: true,
        buyer: { select: { name: true } },
        seller: { select: { name: true } },
        canvasProvider: true,
        canvasId: true,
        canvasBuyerAccess: true,
        canvasProvisioningStatus: true,
      },
    })
    if (!ticket) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'ticket not found' })
      return null
    }
    if (ticket.buyerPubkey !== callerPubkey && ticket.sellerPubkey !== callerPubkey) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return null
    }
    const binding = await resolveCanvasBinding(prisma, ticket)
    if (!binding) {
      res.status(409).json({ error: 'NO_HOSTED_CANVAS', message: 'this ticket has no Colabonate-hosted canvas' })
      return null
    }
    const callerName =
      ticket.buyerPubkey === callerPubkey ? ticket.buyer.name : ticket.seller.name
    return { callerPubkey, callerName: callerName ?? undefined, ticket, binding }
  }

  // GET /:id/canvas-url — one-time login URL into the ticket's canvas (D4).
  router.get('/:id/canvas-url', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const ctx = await loadForParty(req, res)
      if (!ctx) return
      const { callerPubkey, callerName, ticket, binding } = ctx

      // D4a/F1: buyer access is the creator's choice, snapshotted at
      // provisioning time.
      if (ticket.buyerPubkey === callerPubkey && binding.canvasBuyerAccess === 'none') {
        return res.status(403).json({ error: 'CANVAS_PRIVATE', message: 'the canvas for this setup is private' })
      }
      if (binding.canvasProvisioningStatus !== 'ready' || !binding.canvasId) {
        return res.status(409).json({
          error: 'CANVAS_NOT_READY',
          status: binding.canvasProvisioningStatus ?? 'pending',
          message: 'the canvas is not provisioned yet',
        })
      }

      const url = await requestCanvasLoginUrl({ pubkey: callerPubkey, displayName: callerName }, binding.canvasId)
      return res.json({ url })
    } catch (err) {
      console.error('[ticket-canvas] GET canvas-url error:', err instanceof Error ? err.message : err)
      return res.status(502).json({ error: 'CANVAS_SERVICE_ERROR', message: 'the canvas service could not issue a login URL — try again' })
    }
  })

  // POST /:id/canvas-retry — re-enqueue provisioning after failure (D3).
  router.post('/:id/canvas-retry', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const ctx = await loadForParty(req, res)
      if (!ctx) return
      const { ticket, binding } = ctx

      if (binding.canvasProvisioningStatus === 'ready') {
        return res.status(409).json({ error: 'CANVAS_ALREADY_READY', message: 'the canvas is already provisioned' })
      }
      if (binding.canvasProvisioningStatus === 'pending') {
        return res.json({ ok: true, status: 'pending' }) // already in flight
      }
      // Reset to 'pending' + enqueue on the authoritative anchor row.
      await prisma.$transaction(async (tx) => {
        if (binding.anchor === 'ticket') {
          await tx.ticket.update({
            where: { id: ticket.id },
            data: { canvasProvisioningStatus: 'pending' },
          })
          await enqueueCanvasProvisioningForTicket(tx, ticket.id)
        } else {
          await tx.workspace.update({
            where: { id: binding.workspaceId },
            data: { canvasProvisioningStatus: 'pending' },
          })
          await enqueueCanvasProvisioning(tx, binding.workspaceId!)
        }
      })
      return res.json({ ok: true, status: 'pending' })
    } catch (err) {
      console.error('[ticket-canvas] POST canvas-retry error:', err instanceof Error ? err.message : err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
