/**
 * ADR-370 D3/D4 (Phase 4, FU-673): the canvas-agent-runner control surface.
 *
 * The runner is the Colabonate-side MCP CLIENT for the hosted doop canvas. The
 * server's outbox worker calls these control endpoints over HTTP (guarded by
 * the same DOOP_SERVICE_TOKEN server-to-server secret used for the doop fork
 * bridge); this process never exposes anything to the public network and never
 * writes Prisma.
 *
 * Endpoints (internal only):
 *   GET  /control/health            → liveness for the server / ops.
 *   GET  /control/key/:ticketId     → deterministic per-ticket ECDH pubkey the
 *                                     seller re-seals the persona to (ADR-370
 *                                     D4 — mirrors the canister output-key).
 *   POST /control/start             → decrypt the sealed persona in memory,
 *                                     mint a doop MCP session, launch the
 *                                     caretaker loop for that ticket canvas.
 *   POST /control/stop              → revoke the MCP session + tear down the
 *                                     loop (terminal ticket / canvas locked).
 *
 * The decrypted persona (LLM provider key, system prompt) exists ONLY in this
 * process's memory for the duration of a session — never persisted, never
 * logged (FU-195-C). Per-ticket keys are derived deterministically from a
 * runner master secret so a restart does not invalidate an already-sealed
 * persona.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { resolveTicketPubkey, startTicketSession, stopTicketSession, closeAllSessions } from './runner-core.js'

export const RUNNER_PORT = parseInt(process.env.CANVAS_RUNNER_PORT ?? '4010', 10)
/** Bind loopback by default; operators may override for container networking. */
export const RUNNER_HOST = process.env.CANVAS_RUNNER_HOST ?? '127.0.0.1'

const MAX_BODY_BYTES = 256 * 1024
const CONTROL_RATE_WINDOW_MS = 60_000
const CONTROL_RATE_LIMIT = 60

function bearerToken(req: IncomingMessage): string {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : ''
}

/** Constant-time bearer check against the shared server secret. */
function authorized(req: IncomingMessage): boolean {
  const expected = process.env.DOOP_SERVICE_TOKEN ?? ''
  const actual = bearerToken(req)
  if (!expected || !actual) return false
  const a = Buffer.from(actual, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// Minimal fixed-window rate limiter per client address. In-memory only — the
// control surface is internal and low-traffic; this is a brute-force backstop,
// not a general DoS defense.
const rateBuckets = new Map<string, { windowStart: number; count: number }>()

function rateLimited(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || now - bucket.windowStart >= CONTROL_RATE_WINDOW_MS) {
    rateBuckets.set(ip, { windowStart: now, count: 1 })
    return false
  }
  bucket.count += 1
  return bucket.count > CONTROL_RATE_LIMIT
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > MAX_BODY_BYTES) {
      throw new Error('request body too large')
    }
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (rateLimited(req)) {
    sendJson(res, 429, { error: 'TOO_MANY_REQUESTS' })
    return
  }
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'UNAUTHORIZED' })
    return
  }

  try {
    if (req.method === 'GET' && url.pathname === '/control/health') {
      sendJson(res, 200, { ok: true })
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/control/key/')) {
      const ticketId = decodeURIComponent(url.pathname.slice('/control/key/'.length))
      if (!ticketId) {
        sendJson(res, 400, { error: 'ticketId required' })
        return
      }
      const pubkey = await resolveTicketPubkey(ticketId)
      sendJson(res, 200, { pubkey })
      return
    }
    if (req.method === 'POST' && url.pathname === '/control/start') {
      const body = await readJson(req)
      const { ticketId, canvasId, agentName, sellerPubkey, sealed } = body as {
        ticketId?: unknown; canvasId?: unknown; agentName?: unknown; sellerPubkey?: unknown; sealed?: unknown
      }
      if (typeof ticketId !== 'string' || typeof canvasId !== 'string') {
        sendJson(res, 400, { error: 'ticketId and canvasId required' })
        return
      }
      if (typeof sealed !== 'string' || !sealed) {
        sendJson(res, 409, { error: 'SEALED_PERSONA_MISSING', message: 'the seller has not re-sealed the agent persona yet' })
        return
      }
      await startTicketSession({
        ticketId,
        canvasId,
        agentName: typeof agentName === 'string' && agentName ? agentName : 'Canvas Agent',
        sellerPubkey: typeof sellerPubkey === 'string' ? sellerPubkey : '',
        sealed,
      })
      sendJson(res, 200, { ok: true, status: 'running' })
      return
    }
    if (req.method === 'POST' && url.pathname === '/control/stop') {
      const body = await readJson(req)
      const { ticketId } = body as { ticketId?: unknown }
      if (typeof ticketId !== 'string' || !ticketId) {
        sendJson(res, 400, { error: 'ticketId required' })
        return
      }
      await stopTicketSession(ticketId)
      sendJson(res, 200, { ok: true, status: 'stopped' })
      return
    }

    sendJson(res, 404, { error: 'NOT_FOUND' })
  } catch (err) {
    // Never log the sealed persona or any provider key — error surfaces stay
    // generic (FU-195-C).
    console.error('[runner-control] error:', err instanceof Error ? err.message : err)
    sendJson(res, 500, { error: 'RUNNER_ERROR' })
  }
}

export function startControlServer(): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error('[runner-control] unhandled:', err instanceof Error ? err.message : err)
      if (!res.headersSent) sendJson(res, 500, { error: 'RUNNER_ERROR' })
    })
  })
  server.listen(RUNNER_PORT, RUNNER_HOST, () => {
    console.log(`[canvas-agent-runner] control listening on ${RUNNER_HOST}:${RUNNER_PORT}`)
  })

  // Clean shutdown: stop every caretaker session + revoke MCP tokens.
  const shutdown = () => {
    closeAllSessions().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  return server
}
