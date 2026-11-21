import { describe, it, expect, vi } from 'vitest'
import { fetchRemoteInvoice, type InvoiceDeps } from './remote-zap-invoice.js'
import { zapDescriptionHash } from '../lib/zap-request.js'

const METADATA_HASH = 'a'.repeat(64)
const ZAP_JSON = JSON.stringify({ id: 'b'.repeat(64), kind: 9734, content: '', tags: [] })
const CALLBACK = 'https://pay.example.com/lnurl/callback'
const LNURL = 'lnurl1example'
const PAYMENT_HASH = 'c'.repeat(64)

function makeDeps(overrides: Partial<InvoiceDeps> & { pr?: unknown; descHash?: string | null; decoded?: unknown } = {}) {
  const pr = 'pr' in overrides ? overrides.pr : 'lnbc1fakeinvoice'
  const fetchJson = vi.fn(async (_url: string): Promise<unknown> => ({
    pr,
    verify: 'https://pay.example.com/verify/abc',
  }))
  const decodeInvoice = vi.fn((_bolt11: string) => {
    if ('decoded' in overrides) return overrides.decoded as null
    return { satoshi: 21, paymentHash: PAYMENT_HASH, timestamp: 1_800_000_000, expiry: 600 }
  })
  const readDescriptionHash = vi.fn((_bolt11: string) => ('descHash' in overrides ? overrides.descHash! : METADATA_HASH))
  return {
    deps: {
      fetchJson: overrides.fetchJson ?? fetchJson,
      decodeInvoice: overrides.decodeInvoice ?? decodeInvoice,
      readDescriptionHash: overrides.readDescriptionHash ?? readDescriptionHash,
    } satisfies InvoiceDeps,
    fetchJson,
  }
}

const plain = { callback: CALLBACK, lnurl: LNURL, amountSats: 21, metadataHash: METADATA_HASH }
const zap = { ...plain, zapRequestJson: ZAP_JSON }

describe('fetchRemoteInvoice', () => {
  it('returns the invoice for a plain LNURL-pay bound to the metadata hash', async () => {
    const { deps } = makeDeps()
    const result = await fetchRemoteInvoice(plain, deps)
    expect(result.bolt11).toBe('lnbc1fakeinvoice')
    expect(result.paymentHash).toBe(PAYMENT_HASH)
    expect(result.verifyUrl).toBe('https://pay.example.com/verify/abc')
    expect(result.expiresAt).toEqual(new Date((1_800_000_000 + 600) * 1000))
  })

  it('returns the invoice for a zap bound to the sha256 of the zap request JSON', async () => {
    const { deps } = makeDeps({ descHash: zapDescriptionHash(ZAP_JSON) })
    const result = await fetchRemoteInvoice(zap, deps)
    expect(result.paymentHash).toBe(PAYMENT_HASH)
  })

  it('sets amount in msats on the request URL and leaves nostr/lnurl out for plain pay', async () => {
    const { deps, fetchJson } = makeDeps()
    await fetchRemoteInvoice(plain, deps)
    const url = new URL(fetchJson.mock.calls[0][0])
    expect(url.searchParams.get('amount')).toBe('21000')
    expect(url.searchParams.has('nostr')).toBe(false)
    expect(url.searchParams.has('lnurl')).toBe(false)
  })

  it('sets nostr and lnurl on the request URL for a zap and replaces existing amount/nostr params', async () => {
    const { deps, fetchJson } = makeDeps({ descHash: zapDescriptionHash(ZAP_JSON) })
    await fetchRemoteInvoice(
      { ...zap, callback: `${CALLBACK}?amount=1&nostr=old&lnurl=old&keep=yes` },
      deps,
    )
    const url = new URL(fetchJson.mock.calls[0][0])
    expect(url.searchParams.getAll('amount')).toEqual(['21000'])
    expect(url.searchParams.getAll('nostr')).toEqual([ZAP_JSON])
    expect(url.searchParams.getAll('lnurl')).toEqual([LNURL])
    expect(url.searchParams.get('keep')).toBe('yes')
  })

  it.each([
    'http://pay.example.com/cb',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://10.0.0.5/x',
  ])('refuses unsafe callback %s without calling fetchJson', async (callback) => {
    const { deps, fetchJson } = makeDeps()
    await expect(fetchRemoteInvoice({ ...plain, callback }, deps)).rejects.toThrow()
    expect(fetchJson).not.toHaveBeenCalled()
  })

  it('refuses a callback with userinfo', async () => {
    const { deps, fetchJson } = makeDeps()
    await expect(fetchRemoteInvoice({ ...plain, callback: 'https://user:pw@pay.example.com/cb' }, deps)).rejects.toThrow()
    expect(fetchJson).not.toHaveBeenCalled()
  })

  it('throws when the LNURL body reports ERROR', async () => {
    const fetchJson = vi.fn(async () => ({ status: 'ERROR', reason: 'nope' }))
    const { deps } = makeDeps({ fetchJson })
    await expect(fetchRemoteInvoice(plain, deps)).rejects.toThrow('LNURL error')
  })

  it('throws when the body has no pr', async () => {
    const fetchJson = vi.fn(async () => ({ verify: 'https://pay.example.com/v' }))
    const { deps } = makeDeps({ fetchJson })
    await expect(fetchRemoteInvoice(plain, deps)).rejects.toThrow()
  })

  it('throws when the body is not an object', async () => {
    const fetchJson = vi.fn(async () => 'text')
    const { deps } = makeDeps({ fetchJson })
    await expect(fetchRemoteInvoice(plain, deps)).rejects.toThrow()
  })

  it('throws when the invoice cannot be decoded', async () => {
    const { deps } = makeDeps({ decoded: null })
    await expect(fetchRemoteInvoice(plain, deps)).rejects.toThrow('Invoice could not be decoded')
  })

  it('throws on an invoice amount mismatch', async () => {
    const decodeInvoice = vi.fn(() => ({ satoshi: 22, paymentHash: PAYMENT_HASH }))
    const { deps } = makeDeps({ decodeInvoice })
    await expect(fetchRemoteInvoice(plain, deps)).rejects.toThrow('Invoice amount mismatch')
  })

  it('throws when a plain invoice commits to a different hash', async () => {
    const { deps } = makeDeps({ descHash: 'd'.repeat(64) })
    await expect(fetchRemoteInvoice(plain, deps)).rejects.toThrow('Invoice not bound to LNURL metadata')
  })

  it('throws when a zap invoice commits to a different hash', async () => {
    const { deps } = makeDeps({ descHash: METADATA_HASH })
    await expect(fetchRemoteInvoice(zap, deps)).rejects.toThrow('Invoice not bound to zap request')
  })

  it('throws when the invoice has no h tag', async () => {
    const { deps } = makeDeps({ descHash: null })
    await expect(fetchRemoteInvoice(plain, deps)).rejects.toThrow('Invoice not bound to LNURL metadata')
  })

  it('drops an unsafe verify URL without throwing', async () => {
    const fetchJson = vi.fn(async () => ({ pr: 'lnbc1x', verify: 'http://127.0.0.1/verify' }))
    const { deps } = makeDeps({ fetchJson })
    const result = await fetchRemoteInvoice(plain, deps)
    expect(result.verifyUrl).toBeUndefined()
    expect(result.bolt11).toBe('lnbc1x')
  })

  it('omits expiresAt when the invoice has no expiry', async () => {
    const decodeInvoice = vi.fn(() => ({ satoshi: 21, paymentHash: PAYMENT_HASH }))
    const { deps } = makeDeps({ decodeInvoice })
    const result = await fetchRemoteInvoice(plain, deps)
    expect(result.expiresAt).toBeUndefined()
  })

  it('throws a fixed message when fetchJson rejects', async () => {
    const fetchJson = vi.fn(async () => {
      throw new Error('socket hang up with secret detail')
    })
    const { deps } = makeDeps({ fetchJson })
    await expect(fetchRemoteInvoice(plain, deps)).rejects.toThrow('LNURL callback request failed')
  })
})
