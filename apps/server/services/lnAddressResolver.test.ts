// ADR-240 D2 — the invoice resolver behind the self-serve Lightning Address.
// The resolver itself is real here; only its two rails are mocked, so the
// dispatch/validation logic (and the FU-760 routability rule) is exercised.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { LnurlpError, resolveUserLnAddressInvoice } from './lnAddressResolver'

const mockResolveLnAddress = vi.fn()
vi.mock('../lib/lnAddressInvoice.js', () => ({
  resolveLnAddressInvoice: (...args: unknown[]) => mockResolveLnAddress(...args),
}))

const mockMakeInvoice = vi.fn()
const mockClose = vi.fn()
vi.mock('./nwcClient.js', () => {
  class NwcClient {
    constructor(public readonly uri: string) {}
    makeInvoice = (...args: unknown[]) => mockMakeInvoice(...args)
    close = () => mockClose()
  }
  return { NwcClient }
})

const mockDecrypt = vi.fn().mockReturnValue('nostr+walletconnect://decrypted')
vi.mock('../lib/secretbox.js', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}))

function makePrisma(user: Record<string, unknown> | null) {
  return { user: { findUnique: vi.fn().mockResolvedValue(user) } } as unknown as PrismaClient
}

beforeEach(() => {
  mockResolveLnAddress.mockReset()
  mockMakeInvoice.mockReset()
  mockClose.mockReset()
})

describe('resolveUserLnAddressInvoice (ADR-240 D2)', () => {
  it('rejects an account that never opted in', async () => {
    const prisma = makePrisma({ lnAddress: null, lnAddressMode: null, wallets: [] })
    await expect(resolveUserLnAddressInvoice(prisma, 'u1', 21, 'memo')).rejects.toThrow(LnurlpError)
  })

  it('EXTERNAL: proxies to the user\'s own LUD-16 address', async () => {
    mockResolveLnAddress.mockResolvedValue({ bolt11: 'lnbc1ext', paymentHash: 'h-ext' })
    const prisma = makePrisma({
      lnAddress: 'alice@wallet.example',
      lnAddressMode: 'EXTERNAL',
      wallets: [],
    })

    const result = await resolveUserLnAddressInvoice(prisma, 'u1', 21, 'Pay alice')

    expect(result).toEqual({ bolt11: 'lnbc1ext', paymentHash: 'h-ext' })
    expect(mockResolveLnAddress).toHaveBeenCalledWith('alice@wallet.example', 21, 'Pay alice')
  })

  it('EXTERNAL: refuses a non-routable synthetic address (FU-760 regression)', async () => {
    const prisma = makePrisma({
      lnAddress: 'abc12345@demo.local',
      lnAddressMode: 'EXTERNAL',
      wallets: [],
    })

    await expect(resolveUserLnAddressInvoice(prisma, 'u1', 21, 'memo')).rejects.toThrow(LnurlpError)
    expect(mockResolveLnAddress).not.toHaveBeenCalled()
  })

  it('NWC: mints on the user\'s own wallet and closes the client', async () => {
    mockMakeInvoice.mockResolvedValue({ bolt11: 'lnbc1nwc', paymentHash: 'h-nwc' })
    const prisma = makePrisma({
      lnAddress: null,
      lnAddressMode: 'NWC',
      wallets: [{ nwcConnectionUriEnc: 'enc', status: 'ACTIVE' }],
    })

    const result = await resolveUserLnAddressInvoice(prisma, 'u1', 42, 'Pay bob')

    expect(result).toEqual({ bolt11: 'lnbc1nwc', paymentHash: 'h-nwc' })
    expect(mockDecrypt).toHaveBeenCalledWith('enc')
    expect(mockMakeInvoice).toHaveBeenCalledWith(42, 'Pay bob')
    expect(mockClose).toHaveBeenCalled()
  })

  it('NWC: rejects when no connection URI is stored', async () => {
    const prisma = makePrisma({ lnAddress: null, lnAddressMode: 'NWC', wallets: [] })
    await expect(resolveUserLnAddressInvoice(prisma, 'u1', 21, 'memo')).rejects.toThrow(LnurlpError)
  })

  it('CASHU: reports that the rail is not served yet', async () => {
    const prisma = makePrisma({ lnAddress: null, lnAddressMode: 'CASHU', wallets: [] })
    await expect(resolveUserLnAddressInvoice(prisma, 'u1', 21, 'memo')).rejects.toThrow(/Cashu receiving is not available/)
  })
})
