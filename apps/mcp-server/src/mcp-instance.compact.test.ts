import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

// FU-961 integration: the REAL tool registry + MCP protocol layer, with the REST
// API mocked. Proves the compact option is applied end to end (and only when
// asked for), that the observer ledger still sees every call, and that
// upload_image is left untouched.

vi.mock('./tools/api.js', () => ({ callApi: vi.fn() }))

import { callApi } from './tools/api.js'
import { buildMcpServer } from './mcp-instance.js'
import { GUEST_GATE, gateFromScopes } from './tools/gate.js'

const mockedApi = vi.mocked(callApi)
const B64 = 'UklGRo4VAABXRUJQVlA4'.repeat(200)
const uri = `data:image/webp;base64,${B64}`
const ctx = { pubkey: 'npub-test', token: 'tok', identityLevel: 2 }

async function connect(server: ReturnType<typeof buildMcpServer>) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  const client = new Client({ name: 'vitest', version: '0.0.0' })
  await client.connect(clientT)
  return client
}
const textOf = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text

describe('buildMcpServer compactResults (FU-961)', () => {
  beforeEach(() => mockedApi.mockReset())

  it('strips inline images from list_daos when compactResults is on', async () => {
    mockedApi.mockResolvedValue({ daos: [{ id: 'd1', name: 'Foundation', images: JSON.stringify([uri]) }] })
    const client = await connect(buildMcpServer(ctx, GUEST_GATE, undefined, { compactResults: true }))
    const text = textOf(await client.callTool({ name: 'list_daos', arguments: {} }))
    expect(text).not.toContain('base64,')
    expect(JSON.parse(text).daos[0].name).toBe('Foundation')
    expect(text.length).toBeLessThan(400)
    await client.close()
  })

  it('keeps the full payload when compactResults is off (in-app behavior)', async () => {
    mockedApi.mockResolvedValue({ daos: [{ id: 'd1', images: JSON.stringify([uri]) }] })
    const client = await connect(buildMcpServer(ctx, GUEST_GATE))
    const text = textOf(await client.callTool({ name: 'list_daos', arguments: {} }))
    expect(text).toContain('base64,')
    await client.close()
  })

  it('de-duplicates a discover_cooperations page', async () => {
    const coops = [{ id: 'c1', title: 'A' }, { id: 'c2', title: 'B' }]
    mockedApi.mockResolvedValue({ edges: coops.map((node) => ({ cursor: node.id, node })), pageInfo: { hasNextPage: false }, cooperations: coops })
    const client = await connect(buildMcpServer(ctx, GUEST_GATE, undefined, { compactResults: true }))
    const parsed = JSON.parse(textOf(await client.callTool({ name: 'discover_cooperations', arguments: {} })))
    expect(parsed.edges).toBeUndefined()
    expect(parsed.cooperations).toHaveLength(2)
    await client.close()
  })

  it('leaves upload_image output intact so the data URL can be reused', async () => {
    mockedApi.mockResolvedValue({ success: true, url: uri })
    const client = await connect(buildMcpServer(ctx, gateFromScopes(['read', 'images:write']), undefined, { compactResults: true }))
    const text = textOf(await client.callTool({ name: 'upload_image', arguments: { dataUrl: `data:image/png;base64,${'A'.repeat(100)}` } }))
    expect(JSON.parse(text).url).toBe(uri)
    await client.close()
  })

  it('still reports every call to the observer, success and error', async () => {
    const calls: Array<[string, string]> = []
    const observer = { onToolCall: (tool: string, outcome: 'success' | 'error') => void calls.push([tool, outcome]) }
    mockedApi.mockResolvedValueOnce({ daos: [] })
    mockedApi.mockRejectedValueOnce(new Error('API Error: 404 Not Found — {"error":"Offer not found"}'))
    const client = await connect(buildMcpServer(ctx, GUEST_GATE, observer, { compactResults: true }))
    await client.callTool({ name: 'list_daos', arguments: {} })
    const failed = await client.callTool({ name: 'get_offer', arguments: { id: 'x' } })
    expect((failed as { isError?: boolean }).isError).toBe(true)
    expect(calls).toEqual([['list_daos', 'success'], ['get_offer', 'error']])
    await client.close()
  })
})
