import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const mockFetch = vi.fn().mockResolvedValue(undefined)
const mockRequestInvoice = vi.fn()
const LightningAddressCtor = vi.fn()

vi.mock('@getalby/lightning-tools', () => ({
  LightningAddress: class {
    constructor(...args: unknown[]) {
      LightningAddressCtor(...args)
    }
    fetch = mockFetch
    requestInvoice = mockRequestInvoice
  },
}))

const mockMakeInvoice = vi.fn()
const mockClose = vi.fn()
const NwcClientCtor = vi.fn()

vi.mock('./nwcClient.js', () => ({
  NwcClient: class {
    constructor(...args: unknown[]) {
      NwcClientCtor(...args)
    }
    makeInvoice = mockMakeInvoice
    close = mockClose
  },
}))

const mockDecrypt = vi.fn((s: string) => `decrypted:${s}`)
vi.mock('../lib/secretbox.js', () => ({
  decrypt: (s: string) => mockDecrypt(s),
}))

// Isolated per test — the real module is a shared, process-wide Map, which
// would leak cooldown state between tests using the same seller pubkey.
let coolingDown = false
const mockMarkNwcFailure = vi.fn()
const mockClearNwcCooldown = vi.fn()
vi.mock('../lib/nwc-cooldown.js', () => ({
  isNwcCoolingDown: () => coolingDown,
  markNwcFailure: (...args: unknown[]) => mockMarkNwcFailure(...args),
  clearNwcCooldown: (...args: unknown[]) => mockClearNwcCooldown(...args),
}))

// ADR-255 D1: isolated per test, mirrors the coolingDown pattern above —
// controls the Beta-only DEMO-wallet fallback without touching real env vars.
let betaModeOn = false
vi.mock('./betaMode.js', () => ({
  isBetaMode: () => betaModeOn,
}))

// ADR-298 D2: mocked at the module boundary, same as NwcClient above —
// resolveViaAlbyOauth() reuses this factory unmodified, so the resolver test
// only needs to assert it was called with the seller's id and the returned
// invoice was passed through.
const mockCreateInvoice = vi.fn()
const mockCreateAlbyOauthProviderForUser = vi.fn()
vi.mock('./albyOauthProvider.js', () => ({
  createAlbyOauthProviderForUser: (...args: unknown[]) => mockCreateAlbyOauthProviderForUser(...args),
}))

// ADR-394: the amount verification decodes a real BOLT11, but these tests use
// placeholder invoice strings ('lnbc1...') — mock it at the module boundary.
// The real decode/compare logic is covered by lib/invoice-amount.test.ts.
const mockAssertSellerInvoiceAmount = vi.fn()
vi.mock('../lib/invoice-amount.js', () => ({
  assertSellerInvoiceAmount: (...args: unknown[]) => mockAssertSellerInvoiceAmount(...args),
}))
// ADR-394 FU-839: same for the LUD-06 description_hash binding (real logic in
// lib/bolt11-tags.test.ts).
vi.mock('../lib/bolt11-tags.js', () => ({ assertInvoiceMatchesLnurlMetadata: vi.fn(), readInvoiceDescriptionHash: vi.fn(() => 'h') }))

const { resolveSellerInvoice, hasSellerPaymentMethodConfigured, isRoutableLnAddress } = await import('./sellerPaymentResolver.js')

interface MockWalletRow {
  provider: 'NWC' | 'ALBY_OAUTH' | 'CASHU' | 'DEMO'
  nwcConnectionUriEnc?: string | null
  cashuReceivePubkey?: string | null
  cashuReceiveMintUrl?: string | null
  id?: string
  status?: string
}

interface MockSeller {
  id?: string
  pubkey?: string
  lnAddress?: string | null
  wallets?: MockWalletRow[]
}

function makeMockPrisma(seller: MockSeller | null) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(seller ? { id: 'seller-id', wallets: [], ...seller } : null),
    },
  } as unknown as PrismaClient
}

describe('resolveSellerInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue(undefined)
    mockDecrypt.mockImplementation((s: string) => `decrypted:${s}`)
    coolingDown = false
    betaModeOn = false
    mockCreateAlbyOauthProviderForUser.mockResolvedValue({ createInvoice: mockCreateInvoice })
  })

  it('returns SELLER_UNCONFIGURED when no user is found', async () => {
    const prisma = makeMockPrisma(null)
    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 1000, 'Order: Test')
    expect(result).toEqual({ ok: false, reason: 'SELLER_UNCONFIGURED' })
  })

  it('returns SELLER_UNCONFIGURED when nothing is configured', async () => {
    const prisma = makeMockPrisma({ pubkey: 'seller-pubkey', lnAddress: null, wallets: [] })
    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 1000, 'Order: Test')
    expect(result).toEqual({ ok: false, reason: 'SELLER_UNCONFIGURED' })
  })

  it('resolves rail LN via LightningAddress with proxy disabled', async () => {
    const prisma = makeMockPrisma({ pubkey: 'seller-pubkey', lnAddress: 'alice@getalby.com' })
    mockRequestInvoice.mockResolvedValue({ paymentRequest: 'lnbc1...', paymentHash: 'abc123' })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 1000, 'Order: Test')

    expect(LightningAddressCtor).toHaveBeenCalledWith('alice@getalby.com', { proxy: false })
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockRequestInvoice).toHaveBeenCalledWith({ satoshi: 1000, comment: 'Order: Test' })
    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc1...', paymentHash: 'abc123', source: 'LNURL' } })
    expect(mockAssertSellerInvoiceAmount).toHaveBeenCalledWith('lnbc1...', 1000)
    expect(NwcClientCtor).not.toHaveBeenCalled()
  })

  it('propagates LN-address upstream failures instead of swallowing them', async () => {
    const prisma = makeMockPrisma({ pubkey: 'seller-pubkey', lnAddress: 'alice@getalby.com' })
    mockRequestInvoice.mockRejectedValue(new Error('Failed to generate invoice: 502 Bad Gateway'))

    await expect(resolveSellerInvoice(prisma, 'seller-pubkey', 1000, 'Order: Test')).rejects.toThrow(
      'Failed to generate invoice',
    )
  })

  it('falls back to NWC make_invoice (rail LN) when there is no lnAddress', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' }],
    })
    mockMakeInvoice.mockResolvedValue({ bolt11: 'lnbc2...', paymentHash: 'def456' })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')

    expect(mockDecrypt).toHaveBeenCalledWith('enc:uri')
    expect(NwcClientCtor).toHaveBeenCalledWith('decrypted:enc:uri')
    expect(mockMakeInvoice).toHaveBeenCalledWith(500, 'Order: Test')
    expect(mockClose).toHaveBeenCalledOnce()
    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc2...', paymentHash: 'def456', source: 'NWC' } })
    expect(LightningAddressCtor).not.toHaveBeenCalled()
    expect(mockClearNwcCooldown).toHaveBeenCalledWith('seller-pubkey')
  })

  it('prefers lnAddress over a connected NWC wallet when both exist', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: 'alice@getalby.com',
      wallets: [{ provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' }],
    })
    mockRequestInvoice.mockResolvedValue({ paymentRequest: 'lnbc1...', paymentHash: 'abc123' })

    await resolveSellerInvoice(prisma, 'seller-pubkey', 1000, 'Order: Test')

    expect(LightningAddressCtor).toHaveBeenCalledOnce()
    expect(NwcClientCtor).not.toHaveBeenCalled()
  })

  it('closes the NWC client even when make_invoice throws', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' }],
    })
    mockMakeInvoice.mockRejectedValue(new Error('NWC makeInvoice timed out after 30000ms'))

    await expect(resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')).rejects.toThrow('timed out')
    expect(mockClose).toHaveBeenCalledOnce()
    expect(mockMarkNwcFailure).toHaveBeenCalledWith('seller-pubkey')
  })

  it('skips the NWC attempt and falls back to Cashu while cooling down', async () => {
    coolingDown = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [
        { provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' },
        { provider: 'CASHU', cashuReceivePubkey: 'x', cashuReceiveMintUrl: 'https://mint.example' },
      ],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')

    expect(result).toEqual({ ok: true, rail: 'CASHU', cashu: { pubkey: 'x', mintUrl: 'https://mint.example' } })
    expect(NwcClientCtor).not.toHaveBeenCalled()
    expect(mockMakeInvoice).not.toHaveBeenCalled()
  })

  it('throws a clear temporarily-unavailable error while cooling down with no Cashu fallback', async () => {
    coolingDown = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' }],
    })

    await expect(resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')).rejects.toThrow(
      'temporarily unavailable',
    )
    expect(NwcClientCtor).not.toHaveBeenCalled()
  })

  it('propagates decrypt failures for a corrupted NWC credential', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' }],
    })
    mockDecrypt.mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data')
    })

    await expect(resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')).rejects.toThrow()
    expect(NwcClientCtor).not.toHaveBeenCalled()
  })

  // ADR-298 D2: Alby OAuth wallet-connect rail.
  it('falls back to Alby OAuth (rail LN) when neither lnAddress nor NWC is configured', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      id: 'seller-id',
      lnAddress: null,
      wallets: [{ provider: 'ALBY_OAUTH', status: 'ACTIVE' }],
    })
    mockCreateInvoice.mockResolvedValue({ bolt11: 'lnbc3...', paymentHash: 'ghi789' })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 700, 'Order: Test')

    expect(mockCreateAlbyOauthProviderForUser).toHaveBeenCalledWith(prisma, 'seller-id')
    expect(mockCreateInvoice).toHaveBeenCalledWith(700, 'Order: Test')
    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc3...', paymentHash: 'ghi789', source: 'ALBY_OAUTH' } })
    expect(LightningAddressCtor).not.toHaveBeenCalled()
    expect(NwcClientCtor).not.toHaveBeenCalled()
  })

  it('prefers NWC over Alby OAuth when both are configured', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [
        { provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' },
        { provider: 'ALBY_OAUTH', status: 'ACTIVE' },
      ],
    })
    mockMakeInvoice.mockResolvedValue({ bolt11: 'lnbc2...', paymentHash: 'def456' })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')

    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc2...', paymentHash: 'def456', source: 'NWC' } })
    expect(mockCreateAlbyOauthProviderForUser).not.toHaveBeenCalled()
  })

  it('prefers Alby OAuth over Cashu when both are configured', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      id: 'seller-id',
      lnAddress: null,
      wallets: [
        { provider: 'ALBY_OAUTH', status: 'ACTIVE' },
        { provider: 'CASHU', cashuReceivePubkey: 'x', cashuReceiveMintUrl: 'https://mint.example' },
      ],
    })
    mockCreateInvoice.mockResolvedValue({ bolt11: 'lnbc3...', paymentHash: 'ghi789' })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')

    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc3...', paymentHash: 'ghi789', source: 'ALBY_OAUTH' } })
  })

  it('ignores a non-ACTIVE Alby OAuth wallet and falls through to Cashu', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [
        { provider: 'ALBY_OAUTH', status: 'SUSPENDED' },
        { provider: 'CASHU', cashuReceivePubkey: 'x', cashuReceiveMintUrl: 'https://mint.example' },
      ],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')

    expect(result).toEqual({ ok: true, rail: 'CASHU', cashu: { pubkey: 'x', mintUrl: 'https://mint.example' } })
    expect(mockCreateAlbyOauthProviderForUser).not.toHaveBeenCalled()
  })

  it('skips the NWC attempt and falls back to Alby OAuth while cooling down', async () => {
    coolingDown = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      id: 'seller-id',
      lnAddress: null,
      wallets: [
        { provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' },
        { provider: 'ALBY_OAUTH', status: 'ACTIVE' },
      ],
    })
    mockCreateInvoice.mockResolvedValue({ bolt11: 'lnbc3...', paymentHash: 'ghi789' })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')

    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc3...', paymentHash: 'ghi789', source: 'ALBY_OAUTH' } })
    expect(NwcClientCtor).not.toHaveBeenCalled()
  })

  it('falls back to rail CASHU when neither lnAddress nor NWC is configured', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'CASHU', cashuReceivePubkey: 'sellercashupubkeyhex', cashuReceiveMintUrl: 'https://mint.example' }],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')

    expect(result).toEqual({
      ok: true,
      rail: 'CASHU',
      cashu: { pubkey: 'sellercashupubkeyhex', mintUrl: 'https://mint.example' },
    })
    expect(LightningAddressCtor).not.toHaveBeenCalled()
    expect(NwcClientCtor).not.toHaveBeenCalled()
  })

  it('prefers NWC over an incomplete Cashu configuration', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [
        { provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' },
        { provider: 'CASHU', cashuReceivePubkey: 'x', cashuReceiveMintUrl: 'https://mint.example' },
      ],
    })
    mockMakeInvoice.mockResolvedValue({ bolt11: 'lnbc2...', paymentHash: 'def456' })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')

    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc2...', paymentHash: 'def456', source: 'NWC' } })
  })

  it('returns SELLER_UNCONFIGURED when the Cashu row is missing a mint URL', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'CASHU', cashuReceivePubkey: 'sellercashupubkeyhex', cashuReceiveMintUrl: null }],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')
    expect(result).toEqual({ ok: false, reason: 'SELLER_UNCONFIGURED' })
  })

  // ADR-255 D1: Beta-only DEMO-wallet fallback.
  it('falls back to rail DEMO when in beta mode with only an active demo wallet', async () => {
    betaModeOn = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'DEMO', id: 'wallet-1', status: 'ACTIVE' }],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')

    expect(result).toEqual({ ok: true, rail: 'DEMO', demo: { walletId: 'wallet-1' } })
    expect(LightningAddressCtor).not.toHaveBeenCalled()
    expect(NwcClientCtor).not.toHaveBeenCalled()
  })

  it('does not fall back to DEMO outside beta mode, even with an active demo wallet', async () => {
    betaModeOn = false
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'DEMO', id: 'wallet-1', status: 'ACTIVE' }],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')
    expect(result).toEqual({ ok: false, reason: 'SELLER_UNCONFIGURED' })
  })

  it('ignores a non-ACTIVE demo wallet even in beta mode', async () => {
    betaModeOn = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'DEMO', id: 'wallet-1', status: 'SUSPENDED' }],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')
    expect(result).toEqual({ ok: false, reason: 'SELLER_UNCONFIGURED' })
  })

  it('prefers a real lnAddress over a demo wallet even in beta mode', async () => {
    betaModeOn = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: 'alice@getalby.com',
      wallets: [{ provider: 'DEMO', id: 'wallet-1', status: 'ACTIVE' }],
    })
    mockRequestInvoice.mockResolvedValue({ paymentRequest: 'lnbc1...', paymentHash: 'abc123' })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 1000, 'Order: Test')
    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc1...', paymentHash: 'abc123', source: 'LNURL' } })
  })

  it('skips the synthetic @demo.local lnAddress and falls through to the DEMO wallet in beta mode', async () => {
    // auth-session's demo login upserts `<pubkey8>@demo.local` — that address
    // can never resolve, so it must not shadow the ADR-255 D1 fallback.
    betaModeOn = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: 'seller-pu@demo.local',
      wallets: [{ provider: 'DEMO', id: 'wallet-1', status: 'ACTIVE' }],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 1000, 'Order: Test')
    expect(result).toEqual({ ok: true, rail: 'DEMO', demo: { walletId: 'wallet-1' } })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns SELLER_UNCONFIGURED for a demo.local-only seller outside beta mode', async () => {
    betaModeOn = false
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: 'seller-pu@demo.local',
      wallets: [],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 1000, 'Order: Test')
    expect(result).toEqual({ ok: false, reason: 'SELLER_UNCONFIGURED' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('prefers a complete Cashu config over a demo wallet even in beta mode', async () => {
    betaModeOn = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [
        { provider: 'CASHU', cashuReceivePubkey: 'x', cashuReceiveMintUrl: 'https://mint.example' },
        { provider: 'DEMO', id: 'wallet-1', status: 'ACTIVE' },
      ],
    })

    const result = await resolveSellerInvoice(prisma, 'seller-pubkey', 500, 'Order: Test')
    expect(result).toEqual({
      ok: true,
      rail: 'CASHU',
      cashu: { pubkey: 'x', mintUrl: 'https://mint.example' },
    })
  })
})

describe('hasSellerPaymentMethodConfigured', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    betaModeOn = false
  })

  it('returns false when nothing is configured', async () => {
    const prisma = makeMockPrisma({ pubkey: 'seller-pubkey', lnAddress: null, wallets: [] })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(false)
  })

  it('returns true when lnAddress is set', async () => {
    const prisma = makeMockPrisma({ pubkey: 'seller-pubkey', lnAddress: 'alice@getalby.com' })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(true)
  })

  // FU-754: synthetic non-routable placeholders must never satisfy the gate —
  // MetaMask signup used to set `<evm8>@metamask.local`, so the seller could
  // publish a listing that every buyer checkout failed to pay.
  it('returns false for a synthetic @metamask.local lnAddress', async () => {
    const prisma = makeMockPrisma({ pubkey: 'seller-pubkey', lnAddress: '0xdeadbe@metamask.local' })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(false)
  })

  it('returns false for a synthetic @demo.local lnAddress', async () => {
    const prisma = makeMockPrisma({ pubkey: 'seller-pubkey', lnAddress: 'seller-pu@demo.local' })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(false)
  })

  it('returns true when an NWC wallet row exists', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'NWC', nwcConnectionUriEnc: 'enc:uri' }],
    })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(true)
  })

  // ADR-298 D2: Alby OAuth wallet-connect rail.
  it('returns true when an ACTIVE Alby OAuth wallet row exists', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'ALBY_OAUTH', status: 'ACTIVE' }],
    })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(true)
  })

  it('returns false when the Alby OAuth wallet row is not ACTIVE', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'ALBY_OAUTH', status: 'SUSPENDED' }],
    })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(false)
  })

  it('returns true when a complete Cashu receiving config exists', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'CASHU', cashuReceivePubkey: 'x', cashuReceiveMintUrl: 'https://mint.example' }],
    })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(true)
  })

  it('returns false when the Cashu config is incomplete', async () => {
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'CASHU', cashuReceivePubkey: 'x', cashuReceiveMintUrl: null }],
    })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(false)
  })

  // ADR-255 D1: Beta-only DEMO-wallet fallback.
  it('returns true for a demo-only seller in beta mode', async () => {
    betaModeOn = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'DEMO', status: 'ACTIVE' }],
    })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(true)
  })

  it('returns false for a demo-only seller outside beta mode', async () => {
    betaModeOn = false
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'DEMO', status: 'ACTIVE' }],
    })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(false)
  })

  it('returns false for a non-ACTIVE demo wallet even in beta mode', async () => {
    betaModeOn = true
    const prisma = makeMockPrisma({
      pubkey: 'seller-pubkey',
      lnAddress: null,
      wallets: [{ provider: 'DEMO', status: 'SUSPENDED' }],
    })
    expect(await hasSellerPaymentMethodConfigured(prisma, 'seller-pubkey')).toBe(false)
  })
})

describe('isRoutableLnAddress (FU-754)', () => {
  it('accepts a normal LUD-16 address', () => {
    expect(isRoutableLnAddress('alice@getalby.com')).toBe(true)
    expect(isRoutableLnAddress('  Bob@Wallet.example  ')).toBe(true)
  })

  it('rejects synthetic .local / .invalid placeholders', () => {
    expect(isRoutableLnAddress('abc12345@metamask.local')).toBe(false)
    expect(isRoutableLnAddress('seller-pu@demo.local')).toBe(false)
    expect(isRoutableLnAddress('x@host.invalid')).toBe(false)
  })

  it('rejects empty / malformed values', () => {
    expect(isRoutableLnAddress(null)).toBe(false)
    expect(isRoutableLnAddress(undefined)).toBe(false)
    expect(isRoutableLnAddress('')).toBe(false)
    expect(isRoutableLnAddress('no-at-sign')).toBe(false)
    expect(isRoutableLnAddress('@getalby.com')).toBe(false)
    expect(isRoutableLnAddress('alice@')).toBe(false)
  })
})
