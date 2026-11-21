/**
 * ADR-370 D4 (Phase 4b, FU-673): canvas-agent-runner persona relay.
 *
 * The seller's agent persona (LLM provider key, model, system prompt) lives on
 * the Offer as a NIP-44 blob sealed to the SELLER's own key (ADR-306 D2). To
 * let the runner act as that agent on a ticket canvas, the seller re-seals it
 * to the RUNNER's per-ticket pubkey — exactly the canister inject-config
 * shape (unseal in the client with the seller burner key → sealForRecipient →
 * relay ciphertext). This router is the ticket-keyed counterpart:
 *
 *   GET  /api/tickets/:id/agent-runner-key    → runner's per-ticket pubkey
 *                                               (seller only; public key)
 *   POST /api/tickets/:id/agent-runner-config → store the re-sealed ciphertext
 *                                               + enqueue a runner start when
 *                                               the canvas is already ready
 *
 * The server ONLY ever forwards/stores ciphertext — it never sees the persona
 * plaintext and never holds the runner's private key (FU-195-C, ADR-306/370).
 * Routes are seller-scoped: only the ticket seller (the agent owner) may
 * supply or read back the sealed config.
 */
import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { requireAuth } from '../middleware/require-auth.js'
import {
  enqueueCanvasAgentRunnerStart,
  requestRunnerTicketPubkey,
} from '../services/canvas-agent-runner.js'

const SEALED_RELAY_MAX_BYTES = 64 * 1024

// Mirror of canvas-lifecycle's terminal set (avoid module cycle — the relay
// must never re-enable a runner on a finished ticket).
const TERMINAL_TICKET_STATUSES = new Set(['COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED'])

export function createTicketAgentRunnerRouter(prisma: PrismaClient) {
  const router = Router()

  /** Seller-scoped ticket loader for runner endpoints. */
  async function loadForSeller(req: Request, res: Response, opts: { requireActive?: boolean } = {}) {
    const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!callerPubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return null
    }
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true,
        status: true,
        sellerPubkey: true,
        canvasProvider: true,
        canvasProvisioningStatus: true,
        canvasId: true,
        agentRunnerSealed: true,
      },
    })
    if (!ticket) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'ticket not found' })
      return null
    }
    if (ticket.sellerPubkey !== callerPubkey) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'only the ticket seller (agent owner) can manage the canvas agent' })
      return null
    }
    if (ticket.canvasProvider !== 'doop-hosted') {
      res.status(409).json({ error: 'NO_HOSTED_CANVAS', message: 'this ticket has no Colabonate-hosted canvas' })
      return null
    }
    // Terminal tickets are read-only for the agent: no re-seal/relay that could
    // (re)start a runner after the deal ended (the ticket status is the single
    // source of truth; the canvas may not even be locked yet at this moment).
    if (opts.requireActive && ticket.status && TERMINAL_TICKET_STATUSES.has(ticket.status)) {
      res.status(409).json({ error: 'TICKET_TERMINAL', message: 'the ticket has ended — the canvas agent cannot be re-enabled' })
      return null
    }
    return { callerPubkey, ticket }
  }

  // GET /:id/agent-runner-key — runner's per-ticket ECDH pubkey for re-sealing.
  router.get('/:id/agent-runner-key', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const ctx = await loadForSeller(req, res)
      if (!ctx) return
      const pubkey = await requestRunnerTicketPubkey(ctx.ticket.id)
      return res.json({ pubkey })
    } catch (err) {
      console.error('[ticket-agent-runner] GET agent-runner-key error:', err instanceof Error ? err.message : err)
      return res.status(502).json({ error: 'RUNNER_SERVICE_ERROR', message: 'the canvas agent runner could not issue a key — is it running?' })
    }
  })

  // POST /:id/agent-runner-config — relay the re-sealed persona ciphertext.
  // Rejected on terminal tickets: re-enabling the runner after the deal ended
  // must never be possible (the terminal guard lives here AND in the worker).
  router.post('/:id/agent-runner-config', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const ctx = await loadForSeller(req, res, { requireActive: true })
      if (!ctx) return
      const body = (req.body ?? {}) as { ciphertext?: unknown }
      if (typeof body.ciphertext !== 'string' || !body.ciphertext) {
        return res.status(400).json({ error: 'ciphertext is required' })
      }
      if (Buffer.byteLength(body.ciphertext, 'utf8') > SEALED_RELAY_MAX_BYTES) {
        return res.status(400).json({ error: 'ciphertext too large' })
      }

      const canvasId = ctx.ticket.canvasId
      // Re-injection replaces the old persona: store the new ciphertext and
      // reset any prior failed/stopped state so a fresh start can be enqueued
      // below (the runner decrypts in memory per session only).
      await prisma.ticket.update({
        where: { id: ctx.ticket.id },
        data: {
          agentRunnerSealed: body.ciphertext,
          agentRunnerLastError: null,
          agentRunnerStatus: ctx.ticket.canvasProvisioningStatus === 'ready' ? undefined : 'none',
        },
      })
      // When the canvas is already provisioned, kick the runner start now.
      // If not yet ready, the provisioning worker enqueues the start itself.
      if (ctx.ticket.canvasProvisioningStatus === 'ready' && canvasId) {
        await enqueueCanvasAgentRunnerStart(prisma, ctx.ticket.id, canvasId)
      }
      return res.json({ ok: true, status: ctx.ticket.canvasProvisioningStatus === 'ready' ? 'starting' : 'waiting_for_canvas' })
    } catch (err) {
      console.error('[ticket-agent-runner] POST agent-runner-config error:', err instanceof Error ? err.message : err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
