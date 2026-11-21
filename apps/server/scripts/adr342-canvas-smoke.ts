// ADR-342 Phase A + Phase B live smoke test: doop-local canvas reference on
// AGENT_SETUP offers — config validation (D1), async health probe via the
// outbox worker + publish gate (D2/P1), structured error codes
// (CANVAS_UNREACHABLE / CANVAS_HOSTED_UNAVAILABLE), probeStatus forge-guard,
// AND Phase B doop-hosted provisioning (D3): workspace create snapshots
// canvasBuyerAccess, enqueues a canvas-provision outbox event, the worker
// calls the fork-side service route (stubbed here), and GET
// /api/tickets/:id/canvas-url returns the one-time login URL (D4) — the
// buyer sees 403 CANVAS_PRIVATE when buyerAccess='none' (D4a/F1).
// Runs against the running dev server + local Postgres:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr342-canvas-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

/** Minimal doop stand-in: GET /healthz -> { ok: true }. */
function startDoopStub(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } else {
        res.writeHead(404).end()
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

/** Reserve-then-release a port so probing it reliably refuses. */
function deadPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

/** Poll the DB until the outbox worker has cached a probe result. */
async function awaitProbeStatus(offerId: string, timeoutMs = 30_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { agentConfigMeta: true } })
    const status = (offer?.agentConfigMeta as Record<string, any> | null)?.canvas?.probeStatus
    if (status === 'ok' || status === 'unreachable') return status
    await new Promise(r => setTimeout(r, 1_000))
  }
  return null
}

async function main() {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  // ADR-253: ACTIVE direct-pay listings need a resolvable seller payment
  // method — set one directly so this smoke isolates the ADR-342 gates.
  await prisma.user.create({ data: { pubkey, identityLevel: 2, lnAddress: 'smoke@test.invalid' } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  const agentProfile = await prisma.agentProfile.create({
    data: {
      ownerPubkey: pubkey,
      name: 'smoke-test-agent-342',
      capabilities: ['design'],
      tools: [],
      isPublic: true,
    },
  })

  const stub = await startDoopStub()
  const closedPort = await deadPort()

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const post = (body: unknown) => fetch(`${BASE_URL}/api/offers`, { method: 'POST', headers, body: JSON.stringify(body) })
  const patch = (id: string, body: unknown) => fetch(`${BASE_URL}/api/offers/${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) })

  const sealedBlob = Buffer.from('fake-nip44-ciphertext').toString('base64')
  const base = {
    title: 'ADR-342 Smoke Agent', priceSats: 2500, categoryCode: 'services/other', offerType: 'AGENT_SETUP',
    agentProfileId: agentProfile.id,
    agentConfigMeta: { capabilities: ['design'] },
    agentConfigSealed: sealedBlob,
  }

  let draftId: string | undefined
  let hostedId: string | undefined
  try {
    // 1. D1: malformed canvas configs are rejected.
    let r = await post({ ...base, agentConfigMeta: { capabilities: ['design'], canvas: { provider: 'miro' } } })
    check('unknown canvas.provider -> 400', r.status === 400, await r.json())
    r = await post({ ...base, agentConfigMeta: { capabilities: ['design'], canvas: { provider: 'doop-local' } } })
    check('doop-local without instanceUrl -> 400', r.status === 400, await r.json())
    r = await post({ ...base, agentConfigMeta: { capabilities: ['design'], canvas: { provider: 'doop-local', instanceUrl: 'ftp://x' } } })
    check('non-http(s) instanceUrl -> 400', r.status === 400, await r.json())
    r = await post({ ...base, agentConfigMeta: { capabilities: ['design'], canvas: { provider: 'doop-hosted', instanceUrl: 'https://x.example.com' } } })
    check('doop-hosted with instanceUrl -> 400', r.status === 400, await r.json())

    // 2. D2: direct publish with doop-local is impossible — the async probe
    //    cannot have run yet (structured code per PAYMENTS.md contract).
    r = await post({ ...base, status: 'ACTIVE', agentConfigMeta: { capabilities: ['design'], canvas: { provider: 'doop-local', instanceUrl: stub.url } } })
    {
      const body = await r.json()
      check('POST ACTIVE doop-local -> 400 CANVAS_UNREACHABLE', r.status === 400 && body?.code === 'CANVAS_UNREACHABLE', body)
    }

    // 3. Draft saves always succeed — and a client-forged probeStatus:'ok'
    //    is stripped (the publish gate must not be bypassable).
    r = await post({ ...base, agentConfigMeta: { capabilities: ['design'], canvas: { provider: 'doop-local', instanceUrl: `${stub.url}/`, probeStatus: 'ok', probeAt: '2026-01-01' } } })
    let body = await r.json()
    check('POST DRAFT doop-local (forged probeStatus) -> 200', r.status === 200, body)
    draftId = body?.offer?.id
    check('forged probeStatus stripped -> stored as unchecked', body?.offer?.agentConfigMeta?.canvas?.probeStatus === 'unchecked', body?.offer?.agentConfigMeta?.canvas)
    check('instanceUrl normalized (trailing slash stripped)', body?.offer?.agentConfigMeta?.canvas?.instanceUrl === stub.url, body?.offer?.agentConfigMeta?.canvas?.instanceUrl)

    // 4. The async outbox probe flips the cache to 'ok' against the stub.
    const probed = await awaitProbeStatus(draftId!)
    check('outbox probe -> probeStatus ok', probed === 'ok', probed)

    // 5. With probeStatus ok the publish gate lets the offer through.
    r = await patch(draftId!, { status: 'ACTIVE' })
    check('PATCH DRAFT -> ACTIVE after ok probe -> 200', r.status === 200, await r.json())

    // 5b. A1: the flat canvasProvider facet reached the Meili index document
    //     (async outbox indexing — poll briefly; Meili outbox waits up to
    //     30s in worst case plus the polling backoff).
    const meiliUrl = process.env.MEILISEARCH_URL
    const meiliKey = process.env.MEILISEARCH_MASTER_KEY
    if (meiliUrl && meiliKey) {
      let doc: Record<string, any> | null = null
      const deadline = Date.now() + 45_000
      while (Date.now() < deadline) {
        const res = await fetch(`${meiliUrl}/indexes/offers/documents/${draftId}`, {
          headers: { Authorization: `Bearer ${meiliKey}` },
        })
        if (res.ok) { doc = await res.json(); break }
        await new Promise(r2 => setTimeout(r2, 1_500))
      }
      check('Meili document carries canvasProvider=doop-local', doc?.canvasProvider === 'doop-local', doc?.canvasProvider)
    } else {
      check('Meili document carries canvasProvider=doop-local', false, 'MEILISEARCH_URL/MEILISEARCH_MASTER_KEY not set')
    }

    // 6. Unrelated PATCH keeps the probe cache (canvas unchanged).
    r = await patch(draftId!, { title: 'ADR-342 Smoke Agent (renamed)' })
    body = await r.json()
    check('unrelated PATCH preserves probeStatus ok', body?.offer?.agentConfigMeta?.canvas?.probeStatus === 'ok', body?.offer?.agentConfigMeta?.canvas)

    // 7. Changing the instance URL resets the probe cache and re-probes; a
    //    dead instance becomes 'unreachable' and the publish gate blocks.
    const deadUrl = `http://127.0.0.1:${closedPort}`
    r = await patch(draftId!, { status: 'DRAFT', agentConfigMeta: { capabilities: ['design'], canvas: { provider: 'doop-local', instanceUrl: deadUrl } } })
    body = await r.json()
    check('changed instanceUrl -> probeStatus reset to unchecked', body?.offer?.agentConfigMeta?.canvas?.probeStatus === 'unchecked', body?.offer?.agentConfigMeta?.canvas)
    const deadProbed = await awaitProbeStatus(draftId!)
    check('dead instance -> probeStatus unreachable', deadProbed === 'unreachable', deadProbed)
    r = await patch(draftId!, { status: 'ACTIVE' })
    {
      const gateBody = await r.json()
      check('PATCH ACTIVE with unreachable canvas -> 400 CANVAS_UNREACHABLE', r.status === 400 && gateBody?.code === 'CANVAS_UNREACHABLE', gateBody)
    }

    // 8. doop-hosted (Phase A): draft save works incl. buyerAccess (D4a), but
    //    publishing is blocked when the hosted bridge is not configured
    //    (CANVAS_HOSTED_UNAVAILABLE). The gate flips open the moment both
    //    DOOP_SERVICE_URL and DOOP_SERVICE_TOKEN are set on the server
    //    (verified by the canvas-config unit test).
    r = await post({ ...base, agentConfigMeta: { capabilities: ['design'], canvas: { provider: 'doop-hosted', buyerAccess: 'none' } } })
    body = await r.json()
    check('POST DRAFT doop-hosted -> 200', r.status === 200, body)
    hostedId = body?.offer?.id
    check('buyerAccess none persisted', body?.offer?.agentConfigMeta?.canvas?.buyerAccess === 'none', body?.offer?.agentConfigMeta?.canvas)

    // Phase B only: when the server has the hosted-bridge env vars, the gate
    // flips and the offer becomes ACTIVE. This is the natural entry point to
    // the Phase B provisioning checks below.
    const hostedBridgeConfigured = Boolean(process.env.DOOP_SERVICE_URL && process.env.DOOP_SERVICE_TOKEN)
    if (hostedBridgeConfigured) {
      r = await patch(hostedId!, { status: 'ACTIVE' })
      body = await r.json()
      check('PATCH ACTIVE doop-hosted (bridge configured) -> 200', r.status === 200, body)
    } else {
      r = await patch(hostedId!, { status: 'ACTIVE' })
      {
        const gateBody = await r.json()
        check('PATCH ACTIVE doop-hosted (no bridge) -> 400 CANVAS_HOSTED_UNAVAILABLE', r.status === 400 && gateBody?.code === 'CANVAS_HOSTED_UNAVAILABLE', gateBody)
      }
    }

    // 9. Phase B end-to-end (only when the hosted bridge is configured):
    //    create a paid ticket for the hosted offer, create a workspace, see
    //    the canvasProvider + buyerAccess snapshotted + status pending, wait
    //    for the outbox worker to flip status to 'ready' against a stub
    //    /api/service/provision-canvas, then GET /api/tickets/:id/canvas-url
    //    returns the one-time login URL. Also: a buyerAccess='none' ticket
    //    refuses the buyer's canvas-url with 403 CANVAS_PRIVATE (D4a/F1).
    //
    //    The stub fork-side service is started BEFORE the workspace create so
    //    the outbox worker can reach it on its first poll — otherwise the
    //    worker marks 'failed' and the retry action would be required to
    //    flip it to 'ready' (defeats the smoke).
    if (hostedBridgeConfigured && hostedId) {
      // Stand up a fork-side service stub on the SAME URL the dev server's
      // DOOP_SERVICE_URL points to (port 4400 by convention; 14400 fallback
      // if 4400 is taken). /api/service/provision-canvas returns { canvasId },
      // /api/service/login-url returns { url }. The server's outbox worker
      // calls these routes when processing the canvas-provision event.
      const STUB_PORT = Number(process.env.SMOKE_STUB_PORT ?? 4400)
      const STUB_FALLBACK = 14400
      // ADR-353 lifecycle: records every set-canvas-lock call so the smoke
      // can assert the lock/unlock round trip against the stub.
      const lockCalls: { canvasId: string; locked: boolean }[] = []
      const serviceStub = createServer((req, res) => {
        let chunks = ''
        req.on('data', (c) => { chunks += c })
        req.on('end', () => {
          if (req.method === 'POST' && req.url === '/api/service/provision-canvas') {
            const b = chunks ? JSON.parse(chunks) : {}
            const canvasId = typeof b.canvasId === 'string' && b.canvasId ? b.canvasId : `stub-${Date.now().toString(36)}`
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ canvasId }))
          } else if (req.method === 'POST' && req.url === '/api/service/login-url') {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ url: `http://127.0.0.1:${STUB_PORT}/api/service/consume-login?token=stub` }))
          } else if (req.method === 'POST' && req.url === '/api/service/set-canvas-lock') {
            const b = chunks ? JSON.parse(chunks) : {}
            lockCalls.push({ canvasId: b.canvasId, locked: b.locked })
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ canvasId: b.canvasId, locked: b.locked }))
          } else {
            res.writeHead(404).end()
          }
        })
      })
      const bindStub = (port: number): Promise<number> => new Promise((resolve, reject) => {
        serviceStub.once('error', reject)
        serviceStub.listen(port, '127.0.0.1', () => resolve(port))
      })
      let servicePort: number
      try {
        servicePort = await bindStub(STUB_PORT)
      } catch {
        servicePort = await bindStub(STUB_FALLBACK)
        console.log(`[Phase B] port ${STUB_PORT} busy, stub bound to ${STUB_FALLBACK} — server DOOP_SERVICE_URL must point to :${STUB_FALLBACK}`)
      }
      console.log(`[Phase B] fork-side service stub listening on http://127.0.0.1:${servicePort}`)
      try {
        // A second buyer/seller pair exercises the hosted ticket flow.
        const sellerPubkey = randomBytes(32).toString('hex')
        const sellerToken = randomBytes(32).toString('hex')
        const buyerPubkey = randomBytes(32).toString('hex')
        const buyerToken = randomBytes(32).toString('hex')
        await prisma.user.createMany({
          data: [
            { pubkey: sellerPubkey, identityLevel: 2, lnAddress: 'seller@test.invalid' },
            { pubkey: buyerPubkey, identityLevel: 2, lnAddress: 'buyer@test.invalid' },
          ],
        })
        await prisma.session.createMany({
          data: [
            { pubkey: sellerPubkey, k1: randomUUID(), token: sellerToken, expiresAt: new Date(Date.now() + 3600_000) },
            { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) },
          ],
        })
        const ticket = await prisma.ticket.create({
          data: {
            id: `t-${randomUUID()}`,
            offerId: hostedId,
            buyerPubkey,
            sellerPubkey,
            status: 'PAID',
            offerType: 'AGENT_SETUP',
            amountSats: 2500,
          },
        })
        const sellerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerToken}` }
        const buyerHeaders  = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }
        // Create the workspace as the buyer (ADR-311/FU-447): the route
        // should snapshot the offer's canvas buyerAccess + enqueue
        // provisioning in one shot (D3/A2).
        const wsRes = await fetch(`${BASE_URL}/api/workspaces`, {
          method: 'POST',
          headers: buyerHeaders,
          body: JSON.stringify({ ticketId: ticket.id }),
        })
        const wsBody = await wsRes.json()
        check('POST /api/workspaces (hosted canvas) -> 201', wsRes.status === 201, wsBody)
        const wsId = wsBody?.workspace?.id
        check('workspace.canvasProvider snapshot = doop-hosted', wsBody?.workspace?.canvasProvider === 'doop-hosted', wsBody?.workspace)
        check('workspace.canvasBuyerAccess snapshot = none',      wsBody?.workspace?.canvasBuyerAccess === 'none',      wsBody?.workspace)
        check('workspace.canvasProvisioningStatus initial = pending', wsBody?.workspace?.canvasProvisioningStatus === 'pending', wsBody?.workspace)

        // Wait for the outbox worker to flip status to 'ready' against the
        // stub service (D3/A2). Poll briefly.
        let readyWs: { canvasId: string | null; canvasProvisioningStatus: string | null } | null = null
        const deadline = Date.now() + 20_000
        while (Date.now() < deadline) {
          const cur = await prisma.workspace.findUnique({ where: { id: wsId }, select: { canvasId: true, canvasProvisioningStatus: true } })
          if (cur?.canvasProvisioningStatus === 'ready') { readyWs = cur; break }
          await new Promise((r) => setTimeout(r, 500))
        }
        check('outbox provision worker flipped status -> ready', readyWs?.canvasProvisioningStatus === 'ready', readyWs)
        check('outbox provision worker wrote canvasId', typeof readyWs?.canvasId === 'string' && readyWs.canvasId.length > 0, readyWs)

        // GET /api/tickets/:id (server) should now surface workspaceCanvas
        // (Phase B contract used by the UI).
        const ticketRes = await fetch(`${BASE_URL}/api/tickets/${ticket.id}`, { headers: sellerHeaders })
        const ticketBody = await ticketRes.json()
        check('GET /api/tickets/:id surfaces workspaceCanvas (seller)', ticketBody?.ticket?.workspaceCanvas?.provider === 'doop-hosted' && ticketBody?.ticket?.workspaceCanvas?.provisioningStatus === 'ready', ticketBody?.ticket?.workspaceCanvas)

        // GET canvas-url: seller gets the login URL (D4).
        const sellerUrlRes = await fetch(`${BASE_URL}/api/tickets/${ticket.id}/canvas-url`, { headers: sellerHeaders })
        const sellerUrlBody = await sellerUrlRes.json()
        check('GET canvas-url (seller) -> url string', sellerUrlRes.status === 200 && typeof sellerUrlBody?.url === 'string' && sellerUrlBody.url.includes('consume-login'), sellerUrlBody)

        // GET canvas-url: buyer with buyerAccess='none' is refused (D4a/F1).
        const buyerUrlRes = await fetch(`${BASE_URL}/api/tickets/${ticket.id}/canvas-url`, { headers: buyerHeaders })
        const buyerUrlBody = await buyerUrlRes.json()
        check('GET canvas-url (buyer, buyerAccess=none) -> 403 CANVAS_PRIVATE', buyerUrlRes.status === 403 && buyerUrlBody?.error === 'CANVAS_PRIVATE', buyerUrlBody)

        // Public capability flag the wizard labels the hosted option by
        // (Phase B follow-up; must reflect the configured bridge).
        const hostedStatusRes = await fetch(`${BASE_URL}/api/canvas/hosted-status`)
        const hostedStatusBody = await hostedStatusRes.json()
        check('GET /api/canvas/hosted-status -> available=true with bridge configured', hostedStatusRes.status === 200 && hostedStatusBody?.available === true, hostedStatusBody)

        // ── ADR-353 (FU-547) lifecycle: terminal ticket state locks the
        //    hosted canvas read-only, reopen unlocks (Q2). The outbox
        //    worker relays both to the stub's set-canvas-lock route.
        const completeRes = await fetch(`${BASE_URL}/api/tickets/${ticket.id}`, {
          method: 'PATCH',
          headers: { ...sellerHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'COMPLETED' }),
        })
        check('PATCH ticket -> COMPLETED accepted (lifecycle trigger)', completeRes.status === 200, await completeRes.text().catch(() => ''))

        let lockSeen = false
        const lockDeadline = Date.now() + 20_000
        while (Date.now() < lockDeadline) {
          if (lockCalls.some(c => c.canvasId === readyWs?.canvasId && c.locked === true)) { lockSeen = true; break }
          await new Promise((r) => setTimeout(r, 500))
        }
        check('outbox worker locked the canvas on COMPLETED (set-canvas-lock locked=true)', lockSeen && !!readyWs?.canvasId, { lockCalls, readyWs })

        const reopenRes = await fetch(`${BASE_URL}/api/tickets/${ticket.id}`, {
          method: 'PATCH',
          headers: { ...sellerHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'ACCEPTED' }),
        })
        check('PATCH ticket -> ACCEPTED accepted (reopen trigger, Q2)', reopenRes.status === 200, await reopenRes.text().catch(() => ''))

        let unlockSeen = false
        const unlockDeadline = Date.now() + 20_000
        while (Date.now() < unlockDeadline) {
          if (lockCalls.some(c => c.canvasId === readyWs?.canvasId && c.locked === false)) { unlockSeen = true; break }
          await new Promise((r) => setTimeout(r, 500))
        }
        check('outbox worker unlocked the canvas on reopen (set-canvas-lock locked=false)', unlockSeen, { lockCalls })

        // Cleanup the Phase B tickets/workspaces/users; the outbox events
        // for them go too.
        await prisma.workspace.deleteMany({ where: { ticketId: ticket.id } })
        await prisma.outboxEvent.deleteMany({ where: { aggregate: 'canvas-provision', aggregateId: wsId } })
        await prisma.ticket.deleteMany({ where: { id: ticket.id } })
        await prisma.session.deleteMany({ where: { pubkey: { in: [sellerPubkey, buyerPubkey] } } })
        await prisma.user.deleteMany({ where: { pubkey: { in: [sellerPubkey, buyerPubkey] } } })
      } finally {
        serviceStub.close()
      }
    }
  } finally {
    stub.server.close()
    if (draftId) await prisma.offer.deleteMany({ where: { id: draftId } })
    if (hostedId) await prisma.offer.deleteMany({ where: { id: hostedId } })
    await prisma.outboxEvent.deleteMany({ where: { aggregate: { in: ['canvas-probe', 'canvas-provision'] }, aggregateId: { in: [draftId, hostedId].filter(Boolean) as string[] } } })
    await prisma.workspace.deleteMany({ where: { offerId: { in: [draftId, hostedId].filter(Boolean) as string[] } } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: pubkey } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: pubkey } })
    await prisma.session.deleteMany({ where: { pubkey } })
    await prisma.user.deleteMany({ where: { pubkey } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
