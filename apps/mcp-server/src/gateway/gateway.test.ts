import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpGateway } from './gateway.js'
import { McpTokenError, type ResolvedSession } from './session-resolver.js'
import { gateFromScopes } from '../tools/gate.js'

// Hermetic REST base. The tools call the Colabonate API via `API_BASE`
// (config.ts, read at import time), and `search_offers` below is a real tool
// call — pointing it at a live dev server made this suite hang past the test
// timeout and depend on whatever the server's `/api/offers` latency happened to
// be. A closed local port makes `callApi` reject immediately; the tool call
// still completes (as an error result, which the ledger records) without
// touching the network. `vi.hoisted` runs before the imports are evaluated.
// NB: global `fetch` must NOT be stubbed — the MCP SDK client uses it to reach
// the in-process gateway server under test.
vi.hoisted(() => {
  process.env.API_BASE = 'http://127.0.0.1:9'
})

// ADR-371 D1/D8 — gateway integration tests over real HTTP using the official
// MCP SDK client (the same transport mainstream agents use):
// guest initialization advertises the public read subset, a bearer session
// advertises exactly the granted scopes, and an invalid bearer is rejected
// before any session exists.

function userSession(scopes: string[]): ResolvedSession {
  return {
    kind: 'user',
    ctx: { pubkey: 'npub-gateway-test', token: 'derived-session-token', identityLevel: 2 },
    gate: gateFromScopes(scopes, false),
    connectionId: 'conn-test',
    expiresAt: Date.now() + 30 * 60 * 1000,
  }
}

describe('McpGateway (ADR-371)', () => {
  const servers: Server[] = []
  const gateways: McpGateway[] = []

  async function bootGateway(resolve?: (bearer: string, now?: number) => Promise<ResolvedSession>): Promise<string> {
    const gateway = new McpGateway({ resolve })
    gateways.push(gateway)
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'POST' && url.pathname === '/mcp') {
        gateway.handler(req, res).catch(() => {})
        return
      }
      res.statusCode = 404
      res.end('Not found')
    })
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    return `http://127.0.0.1:${port}`
  }

  async function connectAs(base: string, bearer?: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: bearer ? { headers: { authorization: `Bearer ${bearer}` } } : undefined,
    })
    const client = new Client({ name: 'vitest', version: '0.0.0' })
    await client.connect(transport)
    return { client, transport }
  }

  afterEach(async () => {
    while (gateways.length) gateways.pop()?.close()
    while (servers.length) {
      const s = servers.pop()
      if (!s) continue
      await new Promise<void>((r) => s.close(() => r()))
    }
  })

  it('guest sessions advertise only the public read subset', async () => {
    const base = await bootGateway()
    const { client } = await connectAs(base)
    try {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      for (const allowed of ['search_offers', 'get_offer', 'discover_cooperations', 'list_companies', 'get_identity', 'list_proposals', 'list_bounties', 'get_bounty']) {
        expect(names).toContain(allowed)
      }
      for (const forbidden of [
        'apply_to_bounty',
        'my_bounty_applications',
        'create_offer',
        'update_offer',
        'delete_offer',
        'get_my_offers',
        'get_my_cooperations',
        'get_my_tickets',
        'create_ticket',
        'upsert_company',
        'vote_proposal',
        'upload_image',
        'get_pending_images',
      ]) {
        expect(names).not.toContain(forbidden)
      }
    } finally {
      await client.close()
    }
  })

  it('a scoped bearer session advertises exactly the granted surface', async () => {
    const base = await bootGateway(async () => userSession(['read', 'offers:write']))
    const { client } = await connectAs(base, 'test-mcp-token')
    try {
      const { tools } = await client.listTools()
      const names = tools.map((t) => t.name)
      // granted: offers writes + account-scoped reads (read scope is always on)
      expect(names).toContain('create_offer')
      expect(names).toContain('update_offer')
      expect(names).toContain('delete_offer')
      expect(names).toContain('get_my_tickets')
      expect(names).toContain('get_my_cooperations')
      // NOT granted: other write families + the chat-attachment tool
      for (const absent of [
        'create_cooperation',
        'update_cooperation',
        'create_ticket',
        'create_proposal',
        'publish_proposal',
        'vote_proposal',
        'upsert_company',
        'upload_image',
        'get_pending_images',
      ]) {
        expect(names).not.toContain(absent)
      }
    } finally {
      await client.close()
    }
  })

  it('an invalid/revoked bearer is rejected during connection', async () => {
    const base = await bootGateway(async () => {
      throw new McpTokenError('Invalid, revoked or expired MCP connection', 401)
    })
    await expect(connectAs(base, 'dead-token')).rejects.toThrow()
  })

  it('a new session must start with an initialize request', async () => {
    const base = await bootGateway()
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(400)
  })

  it('guest sessions never report Phase 3 ledger events', async () => {
    const recordEvent = vi.fn()
    const gateway = new McpGateway({ recordEvent })
    gateways.push(gateway)
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'POST' && url.pathname === '/mcp') gateway.handler(req, res).catch(() => {})
      else { res.statusCode = 404; res.end('Not found') }
    })
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const { client } = await connectAs(base)
    try {
      await client.listTools()
    } finally {
      await client.close()
    }
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('bearer tool calls report Phase 3 ledger events with the agent label', async () => {
    const recordEvent = vi.fn()
    const gateway = new McpGateway({ resolve: async () => userSession(['read']), recordEvent })
    gateways.push(gateway)
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'POST' && url.pathname === '/mcp') gateway.handler(req, res).catch(() => {})
      else { res.statusCode = 404; res.end('Not found') }
    })
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const { client } = await connectAs(base, 'test-mcp-token')
    try {
      // search_offers is a public read tool — call it and swallow any REST-side
      // outcome (the ledger records success AND error).
      await client.callTool({ name: 'search_offers', arguments: {} }).catch(() => {})
    } finally {
      await client.close()
    }
    expect(recordEvent).toHaveBeenCalled()
    const event = recordEvent.mock.calls[0][0] as { bearer?: string; agentLabel?: string | null; tool: string; outcome: string }
    expect(event.bearer).toBe('test-mcp-token')
    expect(event.tool).toBe('search_offers')
    expect(['success', 'error']).toContain(event.outcome)
    // clientInfo from the SDK test client: { name: 'vitest', version: '0.0.0' }
    expect(event.agentLabel).toBe('vitest 0.0.0')
  })
})
