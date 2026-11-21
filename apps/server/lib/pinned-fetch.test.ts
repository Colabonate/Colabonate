// Edge cases for the pinned outbound JSON fetch (ADR-417 / FU-1004).
// DNS and node:https are faked; nothing leaves the machine.
import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dnsState = vi.hoisted(() => ({ lookup: vi.fn() }))
const httpsState = vi.hoisted(() => ({
  request: vi.fn(),
  script: null as null | ((req: any, cb: (res: any) => void) => void),
  reqs: [] as any[],
  lastOptions: null as any,
}))

vi.mock('dns/promises', () => ({ lookup: dnsState.lookup }))
vi.mock('node:https', () => ({ default: { request: httpsState.request }, request: httpsState.request }))

import { createPinnedLookup, pinnedFetchJson, UnsafeUrlError } from './pinned-fetch.js'

class FakeReq extends EventEmitter {
  destroyed = false
  destroyCalls: Array<Error | undefined> = []
  end(): void {
    httpsState.script?.(this, this.callback)
  }
  callback: (res: unknown) => void = () => undefined
  destroy(err?: Error): this {
    this.destroyed = true
    this.destroyCalls.push(err)
    if (err) this.emit('error', err)
    return this
  }
}

class FakeRes extends EventEmitter {
  statusCode = 200
  resume = vi.fn()
}

/** Respond with a status and body chunks; stops emitting once the request is destroyed. */
function respond(status: number, chunks: Array<string | Buffer>) {
  httpsState.script = (req, cb) => {
    const res = new FakeRes()
    res.statusCode = status
    cb(res)
    for (const chunk of chunks) {
      if (req.destroyed) return
      res.emit('data', Buffer.from(chunk))
    }
    if (!req.destroyed) res.emit('end')
  }
}

const PUBLIC_IP = '93.184.216.34'

beforeEach(() => {
  dnsState.lookup.mockReset()
  dnsState.lookup.mockResolvedValue([{ address: PUBLIC_IP, family: 4 }])
  httpsState.reqs = []
  httpsState.lastOptions = null
  httpsState.request.mockReset()
  httpsState.request.mockImplementation((options: unknown, callback: (res: unknown) => void) => {
    httpsState.lastOptions = options
    const req = new FakeReq()
    req.callback = callback
    httpsState.reqs.push(req)
    return req
  })
  respond(200, ['{}'])
})

function callLookup(fn: unknown, options: unknown): Promise<unknown[]> {
  return new Promise((resolve) => {
    ;(fn as (h: string, o: unknown, cb: (...a: unknown[]) => void) => void)('host', options, (...args) =>
      resolve(args),
    )
  })
}

describe('createPinnedLookup', () => {
  it('answers the single form with the first pinned address', async () => {
    const lookup = createPinnedLookup([
      { address: PUBLIC_IP, family: 4 },
      { address: '93.184.216.35', family: 4 },
    ])
    expect(await callLookup(lookup, {})).toEqual([null, PUBLIC_IP, 4])
  })

  it('answers {all:true} with the whole pinned array', async () => {
    const addrs = [
      { address: PUBLIC_IP, family: 4 as const },
      { address: '93.184.216.35', family: 4 as const },
    ]
    const lookup = createPinnedLookup(addrs)
    expect(await callLookup(lookup, { all: true })).toEqual([null, addrs])
  })

  it('reports family 6 for a pinned IPv6 address', async () => {
    const lookup = createPinnedLookup([{ address: '2606:4700:4700::1111', family: 6 }])
    expect(await callLookup(lookup, {})).toEqual([null, '2606:4700:4700::1111', 6])
  })

  it('preserves the order of a two-entry pinned list', async () => {
    const lookup = createPinnedLookup([
      { address: '2606:4700:4700::1111', family: 6 },
      { address: PUBLIC_IP, family: 4 },
    ])
    const [, all] = await callLookup(lookup, { all: true })
    expect((all as Array<{ address: string }>).map((a) => a.address)).toEqual(['2606:4700:4700::1111', PUBLIC_IP])
  })
})

describe('pinnedFetchJson — request shape', () => {
  it('passes an explicit port and the path plus query', async () => {
    await pinnedFetchJson('https://example.com:8443/x?y=1')
    expect(Number(httpsState.lastOptions.port)).toBe(8443)
    expect(httpsState.lastOptions.path).toBe('/x?y=1')
    expect(httpsState.lastOptions.hostname).toBe('example.com')
  })

  it('defaults to port 443 when the URL has none', async () => {
    await pinnedFetchJson('https://example.com/x')
    expect(Number(httpsState.lastOptions.port)).toBe(443)
  })

  it('strips brackets from an IPv6 literal host and does not look it up', async () => {
    await pinnedFetchJson('https://[2606:4700:4700::1111]/x')
    expect(httpsState.lastOptions.hostname).toBe('2606:4700:4700::1111')
    expect(dnsState.lookup).not.toHaveBeenCalled()
  })

  it('sends GET with an accept header', async () => {
    await pinnedFetchJson('https://example.com/x')
    expect(httpsState.lastOptions.method).toBe('GET')
    expect(httpsState.lastOptions.headers.accept).toBe('application/json')
  })

  it('passes a custom timeoutMs through as the timeout option', async () => {
    await pinnedFetchJson('https://example.com/x', { timeoutMs: 1234 })
    expect(httpsState.lastOptions.timeout).toBe(1234)
  })

  it('attaches a pinned lookup that only answers with the validated addresses', async () => {
    dnsState.lookup.mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ])
    await pinnedFetchJson('https://example.com/x')
    const lookup = httpsState.lastOptions.lookup
    expect(await callLookup(lookup, { all: true })).toEqual([
      null,
      [
        { address: PUBLIC_IP, family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ],
    ])
  })
})

describe('pinnedFetchJson — HTTP status handling', () => {
  it.each([199, 300, 301, 404, 500])('rejects status %i with the status in the message', async (status) => {
    respond(status, ['{}'])
    await expect(pinnedFetchJson('https://example.com/x')).rejects.toThrow(`HTTP ${status}`)
  })

  it('does not follow a 302 redirect', async () => {
    respond(302, [''])
    await expect(pinnedFetchJson('https://example.com/x')).rejects.toThrow('HTTP 302')
    expect(httpsState.request).toHaveBeenCalledTimes(1)
  })

  it('rejects a 204 with an empty body (JSON parse error)', async () => {
    respond(204, [])
    await expect(pinnedFetchJson('https://example.com/x')).rejects.toThrow(SyntaxError)
  })

  it('rejects invalid JSON', async () => {
    respond(200, ['{not json'])
    await expect(pinnedFetchJson('https://example.com/x')).rejects.toThrow(SyntaxError)
  })

  it("resolves JSON 'null' to null", async () => {
    respond(200, ['null'])
    await expect(pinnedFetchJson('https://example.com/x')).resolves.toBeNull()
  })
})

describe('pinnedFetchJson — body size cap', () => {
  it('rejects a body delivered in many small chunks that sum over maxBytes and destroys the request', async () => {
    respond(200, ['a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a'])
    await expect(pinnedFetchJson('https://example.com/x', { maxBytes: 5 })).rejects.toThrow('response too large')
    const req = httpsState.reqs[0]
    expect(req.destroyed).toBe(true)
    expect(req.destroyCalls[0]?.message).toBe('response too large')
  })

  it('accepts a body exactly at maxBytes', async () => {
    // 10 bytes: a JSON string of 8 'a' characters plus quotes
    respond(200, ['"aaaaaaaa"'])
    await expect(pinnedFetchJson('https://example.com/x', { maxBytes: 10 })).resolves.toBe('aaaaaaaa')
  })
})

describe('pinnedFetchJson — failure events', () => {
  it("destroys the request with a 'timeout' error when the socket times out", async () => {
    httpsState.script = (req) => {
      req.emit('timeout')
    }
    await expect(pinnedFetchJson('https://example.com/x')).rejects.toThrow('timeout')
    expect(httpsState.reqs[0].destroyCalls[0]?.message).toBe('timeout')
  })

  it("rejects on a request-level 'error' event", async () => {
    httpsState.script = (req) => {
      req.emit('error', new Error('ECONNRESET'))
    }
    await expect(pinnedFetchJson('https://example.com/x')).rejects.toThrow('ECONNRESET')
  })

  it("rejects on a response-level 'error' event", async () => {
    httpsState.script = (_req, cb) => {
      const res = new FakeRes()
      res.statusCode = 200
      cb(res)
      res.emit('error', new Error('aborted'))
    }
    await expect(pinnedFetchJson('https://example.com/x')).rejects.toThrow('aborted')
  })
})

describe('pinnedFetchJson — SSRF gate', () => {
  it('rejects a host that resolves to a private address with UnsafeUrlError and never opens a connection', async () => {
    dnsState.lookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }])
    await expect(pinnedFetchJson('https://example.com/x')).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(httpsState.request).not.toHaveBeenCalled()
  })

  it('rejects a syntactically blocked URL (plain http) with UnsafeUrlError and never opens a connection', async () => {
    await expect(pinnedFetchJson('http://example.com/x')).rejects.toBeInstanceOf(UnsafeUrlError)
    expect(httpsState.request).not.toHaveBeenCalled()
  })

  it('UnsafeUrlError carries the stable message and name', () => {
    const err = new UnsafeUrlError()
    expect(err.name).toBe('UnsafeUrlError')
    expect(err.message).toBe('unsafe url')
    expect(err).toBeInstanceOf(Error)
  })
})
