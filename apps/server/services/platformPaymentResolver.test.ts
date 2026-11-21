import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
// ADR-394 FU-839: the LUD-06 binding decodes a real BOLT11; these tests use
// placeholder strings. Real logic: lib/bolt11-tags.test.ts.
vi.mock('../lib/bolt11-tags.js', () => ({ assertInvoiceMatchesLnurlMetadata: vi.fn(), readInvoiceDescriptionHash: vi.fn(() => 'h') }))

let betaModeOn = false
vi.mock('./betaMode.js', () => ({
  isBetaMode: () => betaModeOn,
}))

const mockMakeInvoice = vi.fn()
const mockClose = vi.fn()
vi.mock('./nwcClient.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./nwcClient.js')>()
  return {
    ...actual,
    NwcClient: class {
      makeInvoice = (...args: unknown[]) => mockMakeInvoice(...args)
      close = mockClose
    },
  }
})

import { resolvePlatformInvoice } from './platformPaymentResolver.js'

describe('resolvePlatformInvoice', () => {
  const originalAddress = process.env.PLATFORM_LN_ADDRESS
  const originalNwc = process.env.PLATFORM_NWC_URI
  const originalDomain = process.env.LNURLP_DOMAIN
  const originalHandle = process.env.PLATFORM_LN_HANDLE

  beforeEach(() => {
    vi.clearAllMocks()
    betaModeOn = false
    delete process.env.PLATFORM_LN_ADDRESS
    delete process.env.PLATFORM_NWC_URI
    delete process.env.PLATFORM_LN_HANDLE
    process.env.LNURLP_DOMAIN = 'colabonate.app'
  })

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore('PLATFORM_LN_ADDRESS', originalAddress)
    restore('PLATFORM_NWC_URI', originalNwc)
    restore('LNURLP_DOMAIN', originalDomain)
    restore('PLATFORM_LN_HANDLE', originalHandle)
  })

  it('resolves an LN invoice against PLATFORM_LN_ADDRESS when configured', async () => {
    process.env.PLATFORM_LN_ADDRESS = 'colabonate@blink.sv'
    mockRequestInvoice.mockResolvedValue({ paymentRequest: 'lnbc1...', paymentHash: 'hash-abc' })

    const result = await resolvePlatformInvoice(1000, 'Workspace initial funding: t1')

    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc1...', paymentHash: 'hash-abc' }, source: 'LNURL' })
    expect(LightningAddressCtor).toHaveBeenCalledWith('colabonate@blink.sv', { proxy: false })
    expect(mockRequestInvoice).toHaveBeenCalledWith({ satoshi: 1000, comment: 'Workspace initial funding: t1' })
  })

  it('ignores a blank PLATFORM_LN_ADDRESS and falls through', async () => {
    process.env.PLATFORM_LN_ADDRESS = '   '
    betaModeOn = true

    const result = await resolvePlatformInvoice(500, 'memo')

    expect(result).toEqual({ ok: true, rail: 'DEMO' })
    expect(mockRequestInvoice).not.toHaveBeenCalled()
  })

  it('falls back to DEMO rail in beta mode when unconfigured', async () => {
    betaModeOn = true

    const result = await resolvePlatformInvoice(500, 'memo')

    expect(result).toEqual({ ok: true, rail: 'DEMO' })
  })

  it('returns DEMO rail in beta mode EVEN when PLATFORM_LN_ADDRESS is set (ADR-372 D7.1)', async () => {
    betaModeOn = true
    process.env.PLATFORM_LN_ADDRESS = 'colabonate@blink.sv'

    const result = await resolvePlatformInvoice(500, 'memo')

    expect(result).toEqual({ ok: true, rail: 'DEMO' })
    expect(mockRequestInvoice).not.toHaveBeenCalled()
  })

  it('returns not-configured outside beta mode when unconfigured', async () => {
    betaModeOn = false

    const result = await resolvePlatformInvoice(500, 'memo')

    expect(result).toEqual({ ok: false, reason: 'PLATFORM_PAYMENT_NOT_CONFIGURED' })
  })

  // ADR-387 D4 — the platform treasury rail.
  it('mints on Colabonate\'s own hub via NWC when PLATFORM_NWC_URI is set', async () => {
    process.env.PLATFORM_NWC_URI = 'nostr+walletconnect://hub'
    mockMakeInvoice.mockResolvedValue({ bolt11: 'lnbc1nwc', paymentHash: 'hash-nwc' })

    const result = await resolvePlatformInvoice(2000, 'AI credit pack')

    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc1nwc', paymentHash: 'hash-nwc' }, source: 'NWC' })
    expect(mockMakeInvoice).toHaveBeenCalledWith(2000, 'AI credit pack')
    expect(mockClose).toHaveBeenCalled()
    expect(LightningAddressCtor).not.toHaveBeenCalled()
  })

  it('prefers the NWC rail over PLATFORM_LN_ADDRESS', async () => {
    process.env.PLATFORM_NWC_URI = 'nostr+walletconnect://hub'
    process.env.PLATFORM_LN_ADDRESS = 'colabonate@blink.sv'
    mockMakeInvoice.mockResolvedValue({ bolt11: 'lnbc1nwc', paymentHash: 'hash-nwc' })

    await resolvePlatformInvoice(100, 'memo')

    expect(LightningAddressCtor).not.toHaveBeenCalled()
    expect(mockRequestInvoice).not.toHaveBeenCalled()
  })

  it('closes the NWC client even when makeInvoice throws', async () => {
    process.env.PLATFORM_NWC_URI = 'nostr+walletconnect://hub'
    mockMakeInvoice.mockRejectedValue(new Error('relay unreachable'))

    await expect(resolvePlatformInvoice(100, 'memo')).rejects.toThrow('relay unreachable')
    expect(mockClose).toHaveBeenCalled()
  })

  it('refuses to self-fetch our own platform address when the NWC rail is missing', async () => {
    // `pay@colabonate.app` is served by this very endpoint — resolving it over
    // HTTP would recurse into ourselves.
    process.env.PLATFORM_LN_ADDRESS = 'pay@colabonate.app'

    const result = await resolvePlatformInvoice(100, 'memo')

    expect(result).toEqual({ ok: false, reason: 'PLATFORM_PAYMENT_NOT_CONFIGURED' })
    expect(LightningAddressCtor).not.toHaveBeenCalled()
  })

  it('honours a custom PLATFORM_LN_HANDLE for the self-reference guard', async () => {
    process.env.PLATFORM_LN_HANDLE = 'treasury'
    process.env.PLATFORM_LN_ADDRESS = 'treasury@colabonate.app'

    const result = await resolvePlatformInvoice(100, 'memo')

    expect(result).toEqual({ ok: false, reason: 'PLATFORM_PAYMENT_NOT_CONFIGURED' })
  })

  it('treats a blank PLATFORM_NWC_URI as unset and falls through to the external address', async () => {
    process.env.PLATFORM_NWC_URI = '   '
    process.env.PLATFORM_LN_ADDRESS = 'colabonate@blink.sv'
    mockRequestInvoice.mockResolvedValue({ paymentRequest: 'lnbc1ext', paymentHash: 'hash-ext' })

    const result = await resolvePlatformInvoice(500, 'memo')

    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc1ext', paymentHash: 'hash-ext' }, source: 'LNURL' })
    expect(LightningAddressCtor).toHaveBeenCalledWith('colabonate@blink.sv', { proxy: false })
  })

  it('beta mode short-circuits BEFORE the NWC rail (ADR-372 D7.1 preserved)', async () => {
    betaModeOn = true
    process.env.PLATFORM_NWC_URI = 'nostr+walletconnect://hub'

    const result = await resolvePlatformInvoice(500, 'memo')

    expect(result).toEqual({ ok: true, rail: 'DEMO' })
    expect(mockMakeInvoice).not.toHaveBeenCalled()
  })

  // ADR-387 D4 — small-amount fallback to the external rail.
  it('falls back to the external rail on a hub liquidity error', async () => {
    process.env.PLATFORM_NWC_URI = 'nostr+walletconnect://hub'
    process.env.PLATFORM_LN_ADDRESS = 'colabonate@blink.sv'
    mockMakeInvoice.mockRejectedValue(new Error('NodeError: LiquidityRequestFailed: Failed to request inbound liquidity.'))
    mockRequestInvoice.mockResolvedValue({ paymentRequest: 'lnbc1blink', paymentHash: 'hash-blink' })

    const result = await resolvePlatformInvoice(1000, 'AI credit pack')

    expect(result).toEqual({ ok: true, rail: 'LN', invoice: { bolt11: 'lnbc1blink', paymentHash: 'hash-blink' }, source: 'LNURL' })
    expect(LightningAddressCtor).toHaveBeenCalledWith('colabonate@blink.sv', { proxy: false })
  })

  it('rethrows a non-liquidity NWC error instead of falling back', async () => {
    process.env.PLATFORM_NWC_URI = 'nostr+walletconnect://hub'
    process.env.PLATFORM_LN_ADDRESS = 'colabonate@blink.sv'
    mockMakeInvoice.mockRejectedValue(new Error('NWC makeInvoice timed out after 30000ms'))

    await expect(resolvePlatformInvoice(1000, 'memo')).rejects.toThrow('timed out')
    expect(mockRequestInvoice).not.toHaveBeenCalled()
  })

  it('does not self-fetch when the fallback points at our own address', async () => {
    process.env.PLATFORM_NWC_URI = 'nostr+walletconnect://hub'
    process.env.PLATFORM_LN_ADDRESS = 'pay@colabonate.app'
    mockMakeInvoice.mockRejectedValue(new Error('LiquidityRequestFailed: Failed to request inbound liquidity.'))

    const result = await resolvePlatformInvoice(1000, 'memo')

    expect(result).toEqual({ ok: false, reason: 'PLATFORM_PAYMENT_NOT_CONFIGURED' })
    expect(LightningAddressCtor).not.toHaveBeenCalled()
  })
})
