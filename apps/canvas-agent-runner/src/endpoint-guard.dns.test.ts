// FU-1008: the DNS layer of the runner guard, with a mocked resolver (nothing leaves the machine).
import { describe, expect, it, vi, beforeEach } from 'vitest'

const dns = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }))

import { checkEndpointSafe } from './endpoint-guard.js'

const answer = (...addresses: string[]) =>
  dns.lookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))

beforeEach(() => {
  dns.lookup.mockReset()
})

describe('checkEndpointSafe DNS layer (FU-1008)', () => {
  it('accepts a host that resolves to public addresses only', async () => {
    answer('93.184.216.34', '2606:4700:4700::1111')
    expect((await checkEndpointSafe('https://api.example.com', 'llm_base_url')).ok).toBe(true)
  })

  it.each([
    ['::ffff:a9fe:a9fe', 'hex-form IPv4-mapped metadata address'],
    ['::ffff:7f00:1', 'hex-form IPv4-mapped loopback'],
    ['::ffff:127.0.0.1', 'dotted IPv4-mapped loopback'],
    ['64:ff9b::7f00:1', 'NAT64 loopback'],
    ['2002:a9fe:a9fe::1', '6to4 metadata address'],
    ['fe80::1', 'link-local'],
    ['10.0.0.7', 'RFC1918'],
  ])('blocks a host resolving to %s (%s)', async (address) => {
    answer(address)
    const result = await checkEndpointSafe('https://rebind.example.com', 'tool')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('private/reserved')
  })

  it('blocks when only one of several answers is internal', async () => {
    answer('93.184.216.34', '::ffff:a9fe:a9fe')
    expect((await checkEndpointSafe('https://mixed.example.com', 'tool')).ok).toBe(false)
  })

  it('does not treat an empty answer as safe', async () => {
    dns.lookup.mockResolvedValue([])
    expect((await checkEndpointSafe('https://empty.example.com', 'tool')).ok).toBe(false)
  })

  it('fails closed when the lookup rejects', async () => {
    dns.lookup.mockImplementation(async () => {
      throw new Error('ENOTFOUND')
    })
    expect((await checkEndpointSafe('https://nx.example.com', 'tool')).ok).toBe(false)
  })

  it('does not resolve a literal IP at all', async () => {
    expect((await checkEndpointSafe('https://[::ffff:a9fe:a9fe]', 'tool')).ok).toBe(false)
    expect(dns.lookup).not.toHaveBeenCalled()
  })
})
