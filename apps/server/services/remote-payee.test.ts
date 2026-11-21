// ADR-417 D1/D3 — remote payee resolution. Only fake PayeeDeps are used here;
// the nostr relay service is mocked so importing the module never touches a relay.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./nostr-relay.js', () => ({
  nostrService: { getEvents: vi.fn(async () => []) },
}))

import { resolveRemotePayee, createDefaultPayeeDeps, type LnurlInfo, type PayeeDeps } from './remote-payee.js'

const SELLER = 'a'.repeat(64)
const AUTHOR = 'b'.repeat(64)
const NOSTR_KEY = 'c'.repeat(64)

const GOOD_LNURL: LnurlInfo = {
  callback: 'https://ln.example.com/cb',
  lnurl: 'lnurl1fakepayendpoint',
  minSendableMsats: 1500,
  maxSendableMsats: 10_000_999,
  metadataHash: 'd'.repeat(64),
  allowsNostr: true,
  nostrPubkey: NOSTR_KEY,
}

function makeDeps(overrides: Partial<PayeeDeps> = {}): PayeeDeps {
  return {
    getProfile: vi.fn(async () => ({ name: 'Seller', lud16: 'seller@ln.example.com' })),
    getLnurl: vi.fn(async () => GOOD_LNURL),
    ...overrides,
  }
}

describe('resolveRemotePayee', () => {
  it('pays the seller tag with a good profile and LNURL, with sat bounds and zap support', async () => {
    const deps = makeDeps()
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payee.role).toBe('seller')
    expect(result.payee.pubkey).toBe(SELLER)
    expect(result.payee.name).toBe('Seller')
    expect(result.payee.lud16).toBe('seller@ln.example.com')
    expect(result.payee.zap).toBe(true)
    expect(result.payee.minSats).toBe(2) // ceil(1500 / 1000)
    expect(result.payee.maxSats).toBe(10_000) // floor(10_000_999 / 1000)
    expect(result.payee.lnurl).toEqual(GOOD_LNURL)
  })

  it('falls back to the author when there is no seller tag', async () => {
    const deps = makeDeps({
      getProfile: vi.fn(async () => ({ lud16: 'author@ln.example.com' })),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: null }, deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payee.role).toBe('author')
    expect(result.payee.pubkey).toBe(AUTHOR)
    expect(deps.getProfile).toHaveBeenCalledWith(AUTHOR)
  })

  it('does not fall back to the author when the seller has no Lightning address', async () => {
    const deps = makeDeps({
      getProfile: vi.fn(async (pubkey: string) =>
        pubkey === SELLER ? { name: 'Seller', lud16: null } : { lud16: 'author@ln.example.com' },
      ),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)

    expect(result).toEqual({ ok: false, reason: 'NO_LIGHTNING_ADDRESS' })
    const calls = (deps.getProfile as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(calls).toEqual([SELLER])
    expect(calls).not.toContain(AUTHOR)
    expect(deps.getLnurl).not.toHaveBeenCalled()
  })

  it('treats a non-routable placeholder address as NO_LIGHTNING_ADDRESS', async () => {
    const deps = makeDeps({
      getProfile: vi.fn(async () => ({ lud16: 'x@demo.local' })),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)

    expect(result).toEqual({ ok: false, reason: 'NO_LIGHTNING_ADDRESS' })
    expect(deps.getLnurl).not.toHaveBeenCalled()
  })

  it('maps a throwing getProfile to NO_LIGHTNING_ADDRESS', async () => {
    const deps = makeDeps({
      getProfile: vi.fn(async () => {
        throw new Error('relay down')
      }),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)
    expect(result).toEqual({ ok: false, reason: 'NO_LIGHTNING_ADDRESS' })
  })

  it('maps a null getLnurl to LNURL_UNREACHABLE', async () => {
    const deps = makeDeps({ getLnurl: vi.fn(async () => null) })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)
    expect(result).toEqual({ ok: false, reason: 'LNURL_UNREACHABLE' })
  })

  it('maps a throwing getLnurl to LNURL_UNREACHABLE', async () => {
    const deps = makeDeps({
      getLnurl: vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)
    expect(result).toEqual({ ok: false, reason: 'LNURL_UNREACHABLE' })
  })

  it('sets zap to false when allowsNostr is true but nostrPubkey is missing', async () => {
    const deps = makeDeps({
      getLnurl: vi.fn(async () => ({ ...GOOD_LNURL, nostrPubkey: undefined })),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payee.zap).toBe(false)
  })

  it('sets zap to false when allowsNostr is false', async () => {
    const deps = makeDeps({
      getLnurl: vi.fn(async () => ({ ...GOOD_LNURL, allowsNostr: false })),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payee.zap).toBe(false)
  })

  it('maps max below min to LNURL_UNREACHABLE', async () => {
    const deps = makeDeps({
      getLnurl: vi.fn(async () => ({ ...GOOD_LNURL, minSendableMsats: 5000, maxSendableMsats: 1000 })),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)
    expect(result).toEqual({ ok: false, reason: 'LNURL_UNREACHABLE' })
  })

  it('maps non-integer or non-positive msat bounds to LNURL_UNREACHABLE', async () => {
    const deps = makeDeps({
      getLnurl: vi.fn(async () => ({ ...GOOD_LNURL, minSendableMsats: 1500.5 })),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)
    expect(result).toEqual({ ok: false, reason: 'LNURL_UNREACHABLE' })
  })

  it('returns NO_PAYEE when there is no seller and the author key is not 64 hex', async () => {
    const deps = makeDeps()
    const result = await resolveRemotePayee({ creatorPubkey: 'not-a-pubkey', remoteSellerPubkey: null }, deps)
    expect(result).toEqual({ ok: false, reason: 'NO_PAYEE' })
    expect(deps.getProfile).not.toHaveBeenCalled()
  })

  it('never throws for an empty creator pubkey', async () => {
    const deps = makeDeps()
    await expect(resolveRemotePayee({ creatorPubkey: '' }, deps)).resolves.toEqual({
      ok: false,
      reason: 'NO_PAYEE',
    })
  })

  it('trims the Lightning address before resolving it', async () => {
    const deps = makeDeps({
      getProfile: vi.fn(async () => ({ lud16: '  seller@ln.example.com  ' })),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)
    expect(deps.getLnurl).toHaveBeenCalledWith('seller@ln.example.com')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payee.lud16).toBe('seller@ln.example.com')
  })

  it('clamps minSats to at least 1', async () => {
    const deps = makeDeps({
      getLnurl: vi.fn(async () => ({ ...GOOD_LNURL, minSendableMsats: 1, maxSendableMsats: 999 })),
    })
    const result = await resolveRemotePayee({ creatorPubkey: AUTHOR, remoteSellerPubkey: SELLER }, deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payee.minSats).toBe(1)
      expect(result.payee.maxSats).toBe(0)
    }
  })
})

describe('createDefaultPayeeDeps', () => {
  it('exposes getProfile and getLnurl without performing any lookup', () => {
    const deps = createDefaultPayeeDeps()
    expect(typeof deps.getProfile).toBe('function')
    expect(typeof deps.getLnurl).toBe('function')
  })
})
