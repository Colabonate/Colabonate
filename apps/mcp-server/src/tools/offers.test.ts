import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

// search_offers projection (REMOTE offers, ADR-145/277): the REAL tool registry
// through the MCP protocol layer, with the REST API mocked.

vi.mock('./api.js', () => ({ callApi: vi.fn() }))

import { callApi } from './api.js'
import { buildMcpServer } from '../mcp-instance.js'
import { GUEST_GATE } from './gate.js'

const mockedApi = vi.mocked(callApi)
const ctx = { pubkey: 'npub-test', token: 'tok', identityLevel: 2 }

async function connect(server: ReturnType<typeof buildMcpServer>) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  const client = new Client({ name: 'vitest', version: '0.0.0' })
  await client.connect(clientT)
  return client
}
const textOf = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text

const NEW_KEYS = ['source', 'priceAmount', 'priceCurrency', 'originUrl', 'orderableOnColabonate']

async function searchOne(hit: Record<string, unknown>) {
  mockedApi.mockResolvedValue({ hits: [hit] })
  const client = await connect(buildMcpServer(ctx, GUEST_GATE))
  const parsed = JSON.parse(textOf(await client.callTool({ name: 'search_offers', arguments: {} })))
  await client.close()
  return parsed.offers[0] as Record<string, unknown>
}

describe('search_offers projectOffer (REMOTE offers)', () => {
  beforeEach(() => mockedApi.mockReset())

  it('keeps the foreign price, origin and orderability flag for a REMOTE EUR offer', async () => {
    const offer = await searchOne({
      id: 'r1',
      title: 'Remote widget',
      priceSats: 0,
      offerType: 'PRODUCT',
      categoryCode: 'goods/electronics',
      status: 'ACTIVE',
      source: 'REMOTE',
      priceAmount: '2',
      priceCurrency: 'EUR',
      originUrl: 'https://merchant.example/widget',
    })
    expect(offer.source).toBe('REMOTE')
    expect(offer.priceAmount).toBe('2')
    expect(offer.priceCurrency).toBe('EUR')
    expect(offer.originUrl).toBe('https://merchant.example/widget')
    expect(offer.orderableOnColabonate).toBe(false)
    expect(offer.priceSats).toBe(0)
  })

  it('leaves a native LOCAL offer with exactly the previous keys plus source', async () => {
    const offer = await searchOne({
      id: 'l1',
      title: 'Native service',
      priceSats: 1000,
      offerType: 'SERVICE',
      categoryCode: 'services/programming',
      status: 'ACTIVE',
      source: 'LOCAL',
    })
    expect(Object.keys(offer).sort()).toEqual(
      ['category', 'id', 'offerType', 'priceSats', 'source', 'status', 'title'].sort(),
    )
    for (const key of NEW_KEYS.filter((k) => k !== 'source')) expect(offer).not.toHaveProperty(key)
  })

  it('adds none of the new keys when the offer carries no source', async () => {
    const offer = await searchOne({ id: 'n1', title: 'Legacy', priceSats: 500, status: 'ACTIVE' })
    for (const key of NEW_KEYS) expect(offer).not.toHaveProperty(key)
  })
})
