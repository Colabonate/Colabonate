// Edge cases for the SSRF guard on server-chosen provider URLs (ADR-417 / FU-1004).
// DNS is faked; no real network access. Failing assertions here are security findings, not test bugs.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dnsState = vi.hoisted(() => ({ lookup: vi.fn() }))

vi.mock('dns/promises', () => ({ lookup: dnsState.lookup }))

import {
  checkProviderUrlSyntax,
  checkProviderUrlSafe,
  resolvePublicAddresses,
  isBlockedIp,
} from './provider-url-safety.js'

beforeEach(() => {
  dnsState.lookup.mockReset()
})

describe('checkProviderUrlSyntax — must be BLOCKED', () => {
  it.each([
    ['https://127.0.0.1', 'IPv4 loopback'],
    ['https://0.0.0.0', 'unspecified'],
    ['https://10.1.2.3', 'RFC1918 10/8'],
    ['https://172.16.0.1', 'RFC1918 172.16/12 lower bound'],
    ['https://172.31.255.255', 'RFC1918 172.16/12 upper bound'],
    ['https://192.168.1.1', 'RFC1918 192.168/16'],
    ['https://169.254.169.254', 'cloud metadata link-local'],
    ['https://100.64.0.1', 'CGNAT 100.64/10'],
    ['https://[::1]', 'IPv6 loopback'],
    ['https://[::]', 'IPv6 unspecified'],
    ['https://[fe80::1]', 'IPv6 link-local'],
    ['https://[fc00::1]', 'IPv6 unique-local fc00::/7'],
    ['https://[fd12:3456::1]', 'IPv6 unique-local fd'],
    ['https://[::ffff:127.0.0.1]', 'IPv4-mapped loopback, dotted form'],
    ['https://[::ffff:7f00:1]', 'IPv4-mapped loopback, hex form'],
    ['https://[::ffff:a9fe:a9fe]', 'IPv4-mapped metadata address, hex form'],
    ['https://[64:ff9b::7f00:1]', 'NAT64 embedding 127.0.0.1'],
    ['https://2130706433', 'decimal-encoded 127.0.0.1'],
    ['https://0177.0.0.1', 'octal-encoded 127.0.0.1'],
    ['https://0x7f.1', 'hex/short-form 127.0.0.1'],
    ['https://localhost', 'localhost'],
    ['https://localhost.', 'localhost with trailing dot'],
    ['https://foo.local', 'mDNS suffix'],
    ['https://foo.internal', 'internal suffix'],
    ['https://foo.localdomain', 'localdomain suffix'],
    ['http://example.com', 'plain http'],
    ['ftp://example.com', 'ftp scheme'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['', 'empty string'],
    ['not a url', 'garbage input'],
  ])('blocks %s (%s)', (url) => {
    const result = checkProviderUrlSyntax(url)
    expect(result.ok).toBe(false)
  })

  it('does not accept userinfo credentials in the URL', () => {
    // Secure expectation: a URL carrying credentials is not a valid provider base URL.
    expect(checkProviderUrlSyntax('https://user:pw@example.com').ok).toBe(false)
  })
})

describe('checkProviderUrlSyntax — must be ALLOWED', () => {
  it.each([
    'https://example.com',
    'https://93.184.216.34',
    'https://[2606:4700:4700::1111]',
    'https://172.15.0.1',
    'https://172.32.0.1',
    'https://100.63.255.255',
    'https://100.128.0.1',
    'https://11.0.0.1',
  ])('allows %s', (url) => {
    expect(checkProviderUrlSyntax(url)).toEqual({ ok: true })
  })
})

describe('isBlockedIp', () => {
  it('fails closed on unrecognizable literals', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true)
    expect(isBlockedIp('')).toBe(true)
  })

  it.each(['10.0.0.1', '127.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1'])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  it.each(['93.184.216.34', '2606:4700:4700::1111', '172.32.0.1'])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false)
  })
})

describe('checkProviderUrlSafe — DNS layer', () => {
  it('ok when the hostname resolves to public addresses only', async () => {
    dnsState.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    expect(await checkProviderUrlSafe('https://example.com')).toEqual({ ok: true })
    expect(dnsState.lookup).toHaveBeenCalledWith('example.com', { all: true, verbatim: true })
  })

  it('blocks when any resolved address is private (mixed public + private)', async () => {
    dnsState.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ])
    expect((await checkProviderUrlSafe('https://example.com')).ok).toBe(false)
  })

  it('blocks a hostname that resolves to a private IPv6 address only', async () => {
    dnsState.lookup.mockResolvedValue([{ address: 'fd00::5', family: 6 }])
    expect((await checkProviderUrlSafe('https://example.com')).ok).toBe(false)
  })

  it('does not treat an empty DNS answer as safe', async () => {
    dnsState.lookup.mockResolvedValue([])
    expect((await checkProviderUrlSafe('https://example.com')).ok).toBe(false)
  })

  it('blocks when the lookup rejects', async () => {
    dnsState.lookup.mockRejectedValue(new Error('ENOTFOUND'))
    expect((await checkProviderUrlSafe('https://example.com')).ok).toBe(false)
  })

  it('blocks a hex-form IPv4-mapped metadata address returned by DNS', async () => {
    dnsState.lookup.mockResolvedValue([{ address: '::ffff:a9fe:a9fe', family: 6 }])
    expect((await checkProviderUrlSafe('https://example.com')).ok).toBe(false)
  })

  it('does not perform a DNS lookup for a literal public IP', async () => {
    expect(await checkProviderUrlSafe('https://93.184.216.34')).toEqual({ ok: true })
    expect(dnsState.lookup).not.toHaveBeenCalled()
  })

  it('does not perform a DNS lookup for a literal private IP (rejected syntactically)', async () => {
    expect((await checkProviderUrlSafe('https://10.1.2.3')).ok).toBe(false)
    expect(dnsState.lookup).not.toHaveBeenCalled()
  })
})

describe('resolvePublicAddresses — pinned address set', () => {
  it('returns every validated address with its family', async () => {
    dnsState.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ])
    expect(await resolvePublicAddresses('https://example.com')).toEqual({
      ok: true,
      addresses: [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ],
    })
  })

  it('blocks when any address is private (mixed public + private)', async () => {
    dnsState.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    expect((await resolvePublicAddresses('https://example.com')).ok).toBe(false)
  })

  it('blocks when the only IPv6 answer is private', async () => {
    dnsState.lookup.mockResolvedValue([{ address: 'fe80::1', family: 6 }])
    expect((await resolvePublicAddresses('https://example.com')).ok).toBe(false)
  })

  it('returns not ok for an empty answer array', async () => {
    dnsState.lookup.mockResolvedValue([])
    expect((await resolvePublicAddresses('https://example.com')).ok).toBe(false)
  })

  it('returns not ok when the lookup rejects', async () => {
    dnsState.lookup.mockRejectedValue(new Error('ENOTFOUND'))
    expect((await resolvePublicAddresses('https://example.com')).ok).toBe(false)
  })

  it('blocks a hex-form IPv4-mapped metadata address returned by DNS', async () => {
    dnsState.lookup.mockResolvedValue([{ address: '::ffff:a9fe:a9fe', family: 6 }])
    expect((await resolvePublicAddresses('https://example.com')).ok).toBe(false)
  })

  it('pins a literal public IPv6 without a DNS lookup', async () => {
    expect(await resolvePublicAddresses('https://[2606:4700:4700::1111]')).toEqual({
      ok: true,
      addresses: [{ address: '2606:4700:4700::1111', family: 6 }],
    })
    expect(dnsState.lookup).not.toHaveBeenCalled()
  })

  it('never returns addresses for a URL with credentials', async () => {
    // Secure expectation: credentials in a provider URL are rejected before any DNS or pinning.
    dnsState.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    expect((await resolvePublicAddresses('https://user:pw@example.com')).ok).toBe(false)
  })
})
