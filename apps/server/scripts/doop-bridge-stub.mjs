// ADR-342/370 local dev stub for the fork-side hosted-canvas service (plain
// Node — no tsx wrapper, so it survives as a detached background process).
// Implements the server-to-server contract the Colabonate outbox worker + ticket
// routes call (see docs/adr342/doop-fork/server/service.ts):
//   POST /api/service/provision-canvas  -> { canvasId }
//   POST /api/service/login-url         -> { url }
//   POST /api/service/set-canvas-lock   -> { canvasId, locked }
//   POST /api/service/mcp-session       -> { token, canvasId, agentName, expiresAt }
//   POST /api/service/mcp-session/revoke-> { ok: true }
//
// The "canvas" it opens is a placeholder page. Point
// DOOP_SERVICE_URL=http://127.0.0.1:9999 (already in .env) and run:
//   node apps/server/scripts/doop-bridge-stub.mjs
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'

const PORT = Number(process.env.DOOP_BRIDGE_PORT ?? 9999)
const TOKEN = process.env.DOOP_SERVICE_TOKEN ?? 'dev-dooptoken'

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) }
    })
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const method = req.method ?? 'GET'

  if (method === 'GET' && url.pathname === '/stub-canvas') {
    const ticketId = url.searchParams.get('ticket') ?? '?'
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
      <div style="text-align:center"><h2>Colabonate hosted canvas (local stub)</h2>
      <p>Ticket <code>${ticketId}</code> — the real doop fork would render the canvas here.</p></div></body></html>`)
    return
  }

  if (method !== 'POST' || !url.pathname.startsWith('/api/service/')) {
    json(res, 404, { error: 'not found' })
    return
  }

  const auth = req.headers.authorization ?? ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (presented !== TOKEN) {
    json(res, 401, { error: 'unauthorized' })
    return
  }

  const body = await readBody(req)

  switch (url.pathname) {
    case '/api/service/provision-canvas': {
      const ticketId = typeof body.ticketId === 'string' ? body.ticketId : '?'
      const canvasId = body.canvasId && typeof body.canvasId === 'string'
        ? body.canvasId
        : `stub-canvas-${ticketId.slice(0, 8)}-${randomBytes(4).toString('hex')}`
      json(res, 200, { canvasId })
      return
    }
    case '/api/service/login-url': {
      const pubkey = typeof body.pubkey === 'string' ? body.pubkey : ''
      const canvasId = typeof body.canvasId === 'string' ? body.canvasId : '?'
      const ticketId = canvasId.replace('stub-canvas-', '').split('-')[0]
      json(res, 200, { url: `http://127.0.0.1:${PORT}/stub-canvas?ticket=${encodeURIComponent(ticketId)}&pubkey=${encodeURIComponent(pubkey)}` })
      return
    }
    case '/api/service/set-canvas-lock': {
      const canvasId = typeof body.canvasId === 'string' ? body.canvasId : ''
      if (!canvasId) { json(res, 400, { error: 'canvasId required' }); return }
      json(res, 200, { canvasId, locked: Boolean(body.locked) })
      return
    }
    case '/api/service/mcp-session': {
      const canvasId = typeof body.canvasId === 'string' ? body.canvasId : ''
      const agentName = typeof body.agentName === 'string' ? body.agentName : 'stub-agent'
      if (!canvasId) { json(res, 400, { error: 'canvasId required' }); return }
      json(res, 200, { token: randomBytes(32).toString('base64url'), canvasId, agentName, expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString() })
      return
    }
    case '/api/service/mcp-session/revoke': {
      json(res, 200, { ok: true })
      return
    }
    default:
      json(res, 404, { error: 'not found' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[doop-stub] listening on http://127.0.0.1:${PORT}`)
})

process.on('uncaughtException', (err) => {
  console.error('[doop-stub] uncaught:', err)
})
