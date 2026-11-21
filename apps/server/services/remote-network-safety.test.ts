// ADR-417 SSRF hardening (FU-1004): every server-side LNURL fetch resolves the host once, rejects
// private/loopback targets and pins the connection to the validated addresses, so a second
// (rebinding) DNS answer cannot redirect it. DNS and node:https are faked; nothing leaves the machine.
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const dnsState = vi.hoisted(() => ({ lookup: vi.fn() }))
const httpsState = vi.hoisted(() => ({
  request: vi.fn(),
  // Per-test response: status + body (string or chunks).
  response: { status: 200, chunks: ['{}'] as string[] },
}))

vi.mock('dns/promises', () => ({ lookup: dnsState.lookup }))
vi.mock('node:https', () => ({ default: { request: httpsState.request }, request: httpsState.request }))
vi.mock('./nostr-relay.js', () => ({
  nostrService: { getEvents: vi.fn(async () => []) },
}))

import { createDefaultPayeeDeps } from './remote-payee.js'
import { createDefaultInvoiceDeps } from './remote-zap-invoice.js'

const PUBLIC_IP = '93.184.216.34'

function resolveTo(address: string) {
  dnsState.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }])
}

function respondWith(status: number, ...chunks: string[]) {
  httpsState.response = { status, chunks }
}

beforeEach(() => {
  respondWith(200, '{}')
  httpsState.request.mockImplementation((_options: unknown, callback: (res: EventEmitter) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (e?: Error) => void }
    req.destroy = (error?: Error) => {
      if (error) req.emit('error', error)
    }
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: () => void }
      res.statusCode = httpsState.response.status
      res.resume = () => undefined
      callback(res)
      for (const chunk of httpsState.response.chunks) res.emit('data', Buffer.from(chunk))
      res.emit('end')
    }
    return req
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('createDefaultInvoiceDeps().fetchJson — DNS-aware, pinned', () => {
  it.each([
    ['10.0.0.7', 'RFC1918 10/8'],
    ['127.0.0.1', 'loopback'],
    ['169.254.169.254', 'link-local / cloud metadata'],
    ['::1', 'IPv6 loopback'],
  ])('rejects a host resolving to %s (%s) without opening a connection', async (address) => {
    resolveTo(address)
    await expect(createDefaultInvoiceDeps().fetchJson('https://lnurl.example.com/cb?amount=1')).rejects.toThrow(
      'unsafe url',
    )
    expect(httpsState.request).not.toHaveBeenCalled()
  })

  it('rejects when any one resolved address is internal', async () => {
    dnsState.lookup.mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: '10.0.0.7', family: 4 },
    ])
    await expect(createDefaultInvoiceDeps().fetchJson('https://lnurl.example.com/cb')).rejects.toThrow('unsafe url')
    expect(httpsState.request).not.toHaveBeenCalled()
  })

  it('rejects when the host cannot be resolved', async () => {
    dnsState.lookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(createDefaultInvoiceDeps().fetchJson('https://unresolvable.example.com/cb')).rejects.toThrow(
      'unsafe url',
    )
    expect(httpsState.request).not.toHaveBeenCalled()
  })

  it('returns parsed JSON and keeps the hostname for TLS while pinning the connection to the validated IP', async () => {
    resolveTo(PUBLIC_IP)
    respondWith(200, '{"pr":"lnbc1example"}')

    const body = await createDefaultInvoiceDeps().fetchJson('https://lnurl.example.com/cb?amount=1')

    expect(body).toEqual({ pr: 'lnbc1example' })
    const options = httpsState.request.mock.calls[0][0] as {
      hostname: string
      path: string
      lookup: (host: string, opts: object, cb: (err: Error | null, address: string, family: number) => void) => void
    }
    expect(options.hostname).toBe('lnurl.example.com')
    expect(options.path).toBe('/cb?amount=1')

    // DNS now answers with an internal address (rebinding): the connection must still use the pinned one.
    resolveTo('169.254.169.254')
    const answered = await new Promise<{ address: string; family: number }>((resolve) => {
      options.lookup('lnurl.example.com', {}, (_err, address, family) => resolve({ address, family }))
    })
    expect(answered).toEqual({ address: PUBLIC_IP, family: 4 })
  })

  it('answers the all-addresses lookup form with the pinned addresses only', async () => {
    resolveTo(PUBLIC_IP)
    respondWith(200, '{}')
    await createDefaultInvoiceDeps().fetchJson('https://lnurl.example.com/cb')
    const options = httpsState.request.mock.calls[0][0] as {
      lookup: (host: string, opts: { all: boolean }, cb: (err: Error | null, all: unknown) => void) => void
    }
    const all = await new Promise((resolve) => options.lookup('x', { all: true }, (_e, a) => resolve(a)))
    expect(all).toEqual([{ address: PUBLIC_IP, family: 4 }])
  })

  it('does not follow redirects', async () => {
    resolveTo(PUBLIC_IP)
    respondWith(302, '')
    await expect(createDefaultInvoiceDeps().fetchJson('https://lnurl.example.com/cb')).rejects.toThrow('HTTP 302')
  })

  it('rejects an oversized response', async () => {
    resolveTo(PUBLIC_IP)
    respondWith(200, 'x'.repeat(40 * 1024), 'x'.repeat(40 * 1024))
    await expect(createDefaultInvoiceDeps().fetchJson('https://lnurl.example.com/cb')).rejects.toThrow(
      'response too large',
    )
  })

  it('rejects a literal internal IP without a DNS lookup or connection', async () => {
    await expect(createDefaultInvoiceDeps().fetchJson('https://10.0.0.7/cb')).rejects.toThrow('unsafe url')
    expect(dnsState.lookup).not.toHaveBeenCalled()
    expect(httpsState.request).not.toHaveBeenCalled()
  })
})

// The payee lookup caches per address, so every case uses its own.
let addressCounter = 0
const freshAddress = () => `seller${++addressCounter}@lnurl.example.com`

const METADATA = '[["text/plain","pay seller"]]'

function lnurlBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tag: 'payRequest',
    callback: 'https://lnurl.example.com/cb',
    minSendable: 1000,
    maxSendable: 5_000_000,
    metadata: METADATA,
    allowsNostr: true,
    nostrPubkey: 'b'.repeat(64),
    ...overrides,
  })
}

describe('createDefaultPayeeDeps().getLnurl — DNS-aware, pinned', () => {
  it('returns null for a Lightning address whose host resolves to a private IP, without a connection', async () => {
    resolveTo('10.0.0.7')
    expect(await createDefaultPayeeDeps().getLnurl(freshAddress().replace('lnurl.example.com', 'private.example.com'))).toBeNull()
    expect(httpsState.request).not.toHaveBeenCalled()
  })

  it('parses a public LNURL-pay response, including the LUD-06 metadata hash and the NIP-57 key', async () => {
    resolveTo(PUBLIC_IP)
    respondWith(200, lnurlBody())

    const address = freshAddress()
    const info = await createDefaultPayeeDeps().getLnurl(address)

    expect(info).toMatchObject({
      callback: 'https://lnurl.example.com/cb',
      minSendableMsats: 1000,
      maxSendableMsats: 5_000_000,
      allowsNostr: true,
      nostrPubkey: 'b'.repeat(64),
      metadataHash: createHash('sha256').update(METADATA).digest('hex'),
    })
    expect(info?.lnurl.startsWith('lnurl1')).toBe(true)
    const options = httpsState.request.mock.calls[0][0] as { path: string }
    expect(options.path).toBe(`/.well-known/lnurlp/${address.split('@')[0]}`)
  })

  it.each([
    ['a non-https callback', { callback: 'http://lnurl.example.com/cb' }],
    ['a callback with userinfo', { callback: 'https://user:pw@lnurl.example.com/cb' }],
    ['a literal-IP callback to an internal host', { callback: 'https://10.0.0.7/cb' }],
    ['a localhost callback', { callback: 'https://localhost/cb' }],
    ['a wrong tag', { tag: 'withdrawRequest' }],
    ['min greater than max', { minSendable: 9_000_000 }],
    ['a missing maxSendable', { maxSendable: undefined }],
  ])('returns null for %s', async (_label, overrides) => {
    resolveTo(PUBLIC_IP)
    respondWith(200, lnurlBody(overrides))
    expect(await createDefaultPayeeDeps().getLnurl(freshAddress())).toBeNull()
  })

  it('returns null when the endpoint answers with an error status or invalid JSON', async () => {
    resolveTo(PUBLIC_IP)
    respondWith(500, '{}')
    expect(await createDefaultPayeeDeps().getLnurl(freshAddress())).toBeNull()
    respondWith(200, 'not json')
    expect(await createDefaultPayeeDeps().getLnurl(freshAddress())).toBeNull()
  })
})
