import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

// upsert_company openingHours (2026-11-20 fix): the REAL tool registry through
// the MCP protocol layer, with the REST API mocked. The field was previously
// missing from the zod schema, so zod silently stripped it from the forwarded
// body — the wire format of that body is the contract under test.

vi.mock('./api.js', () => ({ callApi: vi.fn() }))

import { callApi } from './api.js'
import { buildMcpServer } from '../mcp-instance.js'

const mockedApi = vi.mocked(callApi)
const ctx = { pubkey: 'npub-test', token: 'tok', identityLevel: 2 }

async function connect(server: ReturnType<typeof buildMcpServer>) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  const client = new Client({ name: 'vitest', version: '0.0.0' })
  await client.connect(clientT)
  return client
}

// Exactly what the web UI (SellCompanySetup) sends for Mon–Fri 9–18, weekends closed.
const WEB_UI_HOURS = {
  mon: { start: '09:00', end: '18:00' },
  tue: { start: '09:00', end: '18:00' },
  wed: { start: '09:00', end: '18:00' },
  thu: { start: '09:00', end: '18:00' },
  fri: { start: '09:00', end: '15:00' },
  sat: null,
  sun: null,
}

const writeCalls = () => mockedApi.mock.calls.filter(([, init]) => Boolean(init?.body))

describe('upsert_company openingHours passthrough', () => {
  beforeEach(() => mockedApi.mockReset())

  it('forwards the web-UI hours map verbatim when creating (POST /api/company)', async () => {
    mockedApi.mockImplementation(async (path?: string, init?: { body?: unknown }) => {
      if (!path) return undefined as never // stray zero-arg call during teardown
      if (path === '/api/company/me' && init?.body === undefined) return { company: null }
      if (path === '/api/company') return { company: {}, created: true }
      throw new Error(`unexpected callApi: ${path}`)
    })
    const client = await connect(buildMcpServer(ctx))
    await client.callTool({
      name: 'upsert_company',
      arguments: { name: 'Test Cafe', city: 'Istanbul', openingHours: WEB_UI_HOURS },
    })
    await client.close()

    expect(writeCalls()).toHaveLength(1)
    const [path, init] = writeCalls()[0]
    expect(path).toBe('/api/company')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Test Cafe',
      city: 'Istanbul',
      openingHours: WEB_UI_HOURS,
    })
  })

  it('forwards the hours map on PATCH /api/company/me for an existing company', async () => {
    mockedApi.mockImplementation(async (path?: string, init?: { body?: unknown }) => {
      if (!path) return undefined as never // stray zero-arg call during teardown
      if (path === '/api/company/me' && init?.body === undefined) return { company: { name: 'existing' } }
      if (path === '/api/company/me') return { company: { name: 'existing' }, created: false }
      throw new Error(`unexpected callApi: ${path}`)
    })
    const client = await connect(buildMcpServer(ctx))
    await client.callTool({
      name: 'upsert_company',
      arguments: { name: 'existing', openingHours: WEB_UI_HOURS },
    })
    await client.close()

    expect(writeCalls()).toHaveLength(1)
    const [path, init] = writeCalls()[0]
    expect(path).toBe('/api/company/me')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'existing',
      openingHours: WEB_UI_HOURS,
    })
  })

  it('rejects unknown day keys before any REST write fires', async () => {
    const client = await connect(buildMcpServer(ctx))
    const result = (await client.callTool({
      name: 'upsert_company',
      arguments: { name: 'Test Cafe', openingHours: { monday: { start: '09:00', end: '18:00' } } },
    })) as { isError?: boolean; content: Array<{ text: string }> }
    await client.close()

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('openingHours')
    expect(writeCalls()).toHaveLength(0)
  })

  it('rejects a plain-string day value instead of silently dropping it', async () => {
    const client = await connect(buildMcpServer(ctx))
    const result = (await client.callTool({
      name: 'upsert_company',
      arguments: { name: 'Test Cafe', openingHours: { mon: '09:00-18:00' } },
    })) as { isError?: boolean; content: Array<{ text: string }> }
    await client.close()

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('openingHours')
    expect(writeCalls()).toHaveLength(0)
  })
})
