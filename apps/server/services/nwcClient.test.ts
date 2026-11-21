import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetInfo,
  mockGetBalance,
  mockMakeInvoice,
  mockLookupInvoice,
  mockPayInvoice,
  mockClose,
  mockParseWalletConnectUrl,
} = vi.hoisted(() => ({
  mockGetInfo: vi.fn(),
  mockGetBalance: vi.fn(),
  mockMakeInvoice: vi.fn(),
  mockLookupInvoice: vi.fn(),
  mockPayInvoice: vi.fn(),
  mockClose: vi.fn(),
  mockParseWalletConnectUrl: vi.fn(),
}))

vi.mock('@getalby/sdk', () => {
  class MockNWCClient {
    static parseWalletConnectUrl = mockParseWalletConnectUrl
    getInfo = mockGetInfo
    getBalance = mockGetBalance
    makeInvoice = mockMakeInvoice
    lookupInvoice = mockLookupInvoice
    payInvoice = mockPayInvoice
    close = mockClose
    constructor(_options: unknown) {
      void _options
    }
  }
  return { NWCClient: MockNWCClient }
})

const { NwcClient, isNwcRestrictedError, parseNwcUri } = await import('./nwcClient.js')

const VALID_URI = 'nostr+walletconnect://abc123?relay=wss://relay.example&secret=deadbeef'

describe('parseNwcUri', () => {
  beforeEach(() => {
    mockParseWalletConnectUrl.mockReset()
  })

  it('rejects a URI that does not start with the nostr+walletconnect scheme', () => {
    expect(() => parseNwcUri('https://example.com')).toThrow(/must start with nostr\+walletconnect/)
    expect(mockParseWalletConnectUrl).not.toHaveBeenCalled()
  })

  it('rejects a non-string input', () => {
    expect(() => parseNwcUri(undefined as unknown as string)).toThrow(/must start with nostr\+walletconnect/)
  })

  it('delegates parsing to the SDK and maps the fields', () => {
    mockParseWalletConnectUrl.mockReturnValue({
      walletPubkey: 'pubkey123',
      secret: 'secret456',
      relayUrls: ['wss://relay.example'],
      lud16: 'user@getalby.com',
    })
    const parsed = parseNwcUri(VALID_URI)
    expect(mockParseWalletConnectUrl).toHaveBeenCalledWith(VALID_URI, true)
    expect(parsed).toEqual({
      walletPubkey: 'pubkey123',
      secret: 'secret456',
      relayUrls: ['wss://relay.example'],
      lud16: 'user@getalby.com',
    })
  })

  it('rejects when the SDK parser returns no wallet pubkey or secret', () => {
    mockParseWalletConnectUrl.mockReturnValue({ walletPubkey: '', secret: '', relayUrls: ['wss://relay.example'] })
    expect(() => parseNwcUri(VALID_URI)).toThrow(/missing wallet pubkey or secret/)
  })

  it('rejects when the SDK parser returns no relays', () => {
    mockParseWalletConnectUrl.mockReturnValue({ walletPubkey: 'pk', secret: 's', relayUrls: [] })
    expect(() => parseNwcUri(VALID_URI)).toThrow(/no relays specified/)
  })

  it('propagates the SDK parser throwing on malformed input', () => {
    mockParseWalletConnectUrl.mockImplementation(() => {
      throw new Error('bad uri')
    })
    expect(() => parseNwcUri(VALID_URI)).toThrow('bad uri')
  })
})

describe('NwcClient', () => {
  beforeEach(() => {
    mockGetInfo.mockReset()
    mockGetBalance.mockReset()
    mockMakeInvoice.mockReset()
    mockLookupInvoice.mockReset()
    mockPayInvoice.mockReset()
    mockClose.mockReset()
  })

  it('getInfo maps the NIP-47 response onto NwcInfo', async () => {
    mockGetInfo.mockResolvedValue({
      alias: 'Alby Hub',
      pubkey: 'walletpubkey',
      network: 'mainnet',
      methods: ['pay_invoice', 'get_balance', 'get_info'],
      lud16: 'user@getalby.com',
    })
    const client = new NwcClient(VALID_URI)
    await expect(client.getInfo()).resolves.toEqual({
      alias: 'Alby Hub',
      pubkey: 'walletpubkey',
      network: 'mainnet',
      methods: ['pay_invoice', 'get_balance', 'get_info'],
      lud16: 'user@getalby.com',
    })
  })

  it('getInfo propagates a relay/timeout failure to the caller', async () => {
    mockGetInfo.mockRejectedValue(new Error('Relay connection timed out'))
    const client = new NwcClient(VALID_URI)
    await expect(client.getInfo()).rejects.toThrow('Relay connection timed out')
  })

  it('getBalance converts msat to whole sats, rounding to the nearest sat', async () => {
    mockGetBalance.mockResolvedValue({ balance: 1500 })
    const client = new NwcClient(VALID_URI)
    await expect(client.getBalance()).resolves.toEqual({ balanceSats: 2 })
  })

  it('makeInvoice converts amountSats to msat on the request and maps the response', async () => {
    mockMakeInvoice.mockResolvedValue({ invoice: 'lnbc1...', payment_hash: 'hash123' })
    const client = new NwcClient(VALID_URI)
    const inv = await client.makeInvoice(1000, 'test invoice')
    expect(mockMakeInvoice).toHaveBeenCalledWith({ amount: 1_000_000, description: 'test invoice' })
    expect(inv).toEqual({ bolt11: 'lnbc1...', paymentHash: 'hash123' })
  })

  it('lookupInvoice reports paid=true only for a settled state', async () => {
    mockLookupInvoice.mockResolvedValue({ state: 'settled', preimage: 'abc' })
    const client = new NwcClient(VALID_URI)
    await expect(client.lookupInvoice('hash123')).resolves.toEqual({ paid: true, preimage: 'abc', state: 'settled' })
  })

  it('lookupInvoice reports paid=false and no preimage for a pending/held state', async () => {
    mockLookupInvoice.mockResolvedValue({ state: 'pending', preimage: '' })
    const client = new NwcClient(VALID_URI)
    const status = await client.lookupInvoice('hash123')
    expect(status.paid).toBe(false)
    expect(status.preimage).toBeUndefined()
    expect(status.state).toBe('pending')
  })

  it('payInvoice sends the bolt11 and converts fees from msat to whole sats', async () => {
    mockPayInvoice.mockResolvedValue({ preimage: 'preimage123', fees_paid: 2500 })
    const client = new NwcClient(VALID_URI)
    const result = await client.payInvoice('lnbc1...')
    expect(mockPayInvoice).toHaveBeenCalledWith({ invoice: 'lnbc1...' })
    expect(result).toEqual({ preimage: 'preimage123', feesPaidSats: 3 })
  })

  it('payInvoice propagates rejection (timeout / relay-all-fail) to the caller instead of hanging', async () => {
    mockPayInvoice.mockRejectedValue(new Error('all relays unreachable'))
    const client = new NwcClient(VALID_URI)
    await expect(client.payInvoice('lnbc1...')).rejects.toThrow('all relays unreachable')
  })

  it('close() releases the underlying relay subscriptions', () => {
    const client = new NwcClient(VALID_URI)
    client.close()
    expect(mockClose).toHaveBeenCalledTimes(1)
  })
})

describe('isNwcRestrictedError (2026-09-30 Alby scope finding)', () => {
  it('matches Alby Hub’s scope message and the NIP-47 RESTRICTED code', () => {
    expect(isNwcRestrictedError(new Error('This app does not have the required scope: lookup_invoice'))).toBe(true)
    expect(isNwcRestrictedError(new Error('RESTRICTED'))).toBe(true)
  })

  it('does not match transient failures or non-errors', () => {
    expect(isNwcRestrictedError(new Error('NOT_FOUND'))).toBe(false)
    expect(isNwcRestrictedError(new Error('all relays unreachable'))).toBe(false)
    expect(isNwcRestrictedError('RESTRICTED')).toBe(false)
    expect(isNwcRestrictedError(undefined)).toBe(false)
  })
})
