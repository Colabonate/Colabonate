import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'
import { LndHoldClient, LND_STATE_TO_HOLD } from './LndHoldClient.js'

const REST = 'https://lnd:8080'
const MACAROON = '0a0b0cdeadbeef'

function newClient() {
  return new LndHoldClient({ restUrl: REST, macaroonHex: MACAROON })
}

function b64(buf: Buffer) {
  return buf.toString('base64')
}

describe('LndHoldClient', () => {
  const fetchMock = vi.fn()
  let realFetch: typeof fetch

  beforeEach(() => {
    realFetch = globalThis.fetch
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    fetchMock.mockReset()
  })

  it('strips trailing slashes from the REST URL', () => {
    const c = new LndHoldClient({ restUrl: 'https://lnd:8080/', macaroonHex: MACAROON })
    expect((c as unknown as { restUrl: string }).restUrl).toBe('https://lnd:8080')
  })

  it('sends the macaroon header on every request', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ payment_request: 'lnbcrt...' }) })
    const hash = randomBytes(32).toString('hex')
    const client = newClient()
    await client.createHoldInvoice(1000, hash, 'm')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['Grpc-Metadata-macaroon']).toBe(MACAROON)
  })

  it('createHoldInvoice base64-encodes the hash and stringifies the amount', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ payment_request: 'lnbcrt...' }) })
    const hash = randomBytes(32).toString('hex')
    const client = newClient()
    const res = await client.createHoldInvoice(1000, hash, 'memo-x')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${REST}/v2/invoices/hodl`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.hash).toBe(b64(Buffer.from(hash, 'hex')))
    expect(body.value).toBe('1000')
    expect(body.memo).toBe('memo-x')
    // Returns the same payment hash we supplied (LND keys by it).
    expect(res.paymentHash).toBe(hash)
    expect(res.bolt11).toBe('lnbcrt...')
  })

  it('rejects a hash that is not 32 bytes', async () => {
    const client = newClient()
    await expect(client.createHoldInvoice(1000, 'abcd', 'm')).rejects.toThrow(/32-byte/i)
  })

  it('settleHoldInvoice base64-encodes the preimage and POSTs /v2/invoices/settle', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const preimage = randomBytes(32).toString('hex')
    const client = newClient()
    await client.settleHoldInvoice(preimage)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${REST}/v2/invoices/settle`)
    expect(JSON.parse(init.body as string).preimage).toBe(b64(Buffer.from(preimage, 'hex')))
  })

  it('cancelHoldInvoice base64-encodes the payment_hash and POSTs /v2/invoices/cancel', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const hash = randomBytes(32).toString('hex')
    const client = newClient()
    await client.cancelHoldInvoice(hash)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${REST}/v2/invoices/cancel`)
    expect(JSON.parse(init.body as string).payment_hash).toBe(b64(Buffer.from(hash, 'hex')))
  })

  it('getHoldState GETs lookup with URL-encoded base64 payment_hash', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ state: 'ACCEPTED', r_preimage: b64(randomBytes(32)) }),
    })
    const hash = randomBytes(32).toString('hex')
    const client = newClient()
    const res = await client.getHoldState(hash)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    const expected = encodeURIComponent(b64(Buffer.from(hash, 'hex')))
    expect(url).toBe(`${REST}/v2/invoices/lookup?payment_hash=${expected}`)
    expect(res.state).toBe('ACCEPTED')
    expect(res.preimage).toMatch(/^[0-9a-f]{64}$/)
  })

  it('throws with status + body on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' })
    const client = newClient()
    await expect(client.settleHoldInvoice(randomBytes(32).toString('hex'))).rejects.toThrow(
      /LND settle error: 500 - boom/,
    )
  })

  it('maps LND hold states onto the HoldState union', () => {
    expect(LND_STATE_TO_HOLD.OPEN).toBe('pending')
    expect(LND_STATE_TO_HOLD.ACCEPTED).toBe('paid')
    expect(LND_STATE_TO_HOLD.SETTLED).toBe('settled')
    expect(LND_STATE_TO_HOLD.CANCELED).toBe('cancelled')
  })
})
