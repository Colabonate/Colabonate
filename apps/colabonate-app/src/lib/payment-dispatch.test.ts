import { describe, it, expect, vi } from 'vitest'
import { payNormalInvoice, dispatchHoldInvoice, canDispatchHoldInvoice } from './payment-dispatch'
import type { Wallet } from '../contexts/WalletContext'

const mockWallet = (provider: Wallet['provider'], mode: Wallet['mode'] = 'NON_CUSTODIAL'): Wallet => ({
  id: 'w1',
  userId: 'u1',
  provider,
  mode,
  walletId: 'wid',
  accountId: 'aid',
  status: 'ACTIVE',
  balanceSats: 0,
  lastSyncedAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
})

const createMockApi = () => ({
  post: vi.fn(),
})

const createMockWebLN = () => ({
  enable: vi.fn(),
  sendPayment: vi.fn(),
})

describe('payNormalInvoice', () => {
  it('pays via WebLN when wallet is WebLN non-custodial', async () => {
    const api = createMockApi()
    const webln = createMockWebLN()
    webln.enable.mockResolvedValue(undefined)
    webln.sendPayment.mockResolvedValue({ preimage: 'pre', paymentHash: 'hash123' })

    const result = await payNormalInvoice(mockWallet('WEBLN'), 'lnbc...', api, webln)

    expect(webln.enable).toHaveBeenCalledOnce()
    expect(webln.sendPayment).toHaveBeenCalledWith('lnbc...')
    expect(api.post).not.toHaveBeenCalled()
    expect(result).toEqual({ paymentHash: 'hash123', status: 'SUCCESS', preimage: 'pre' })
  })

  it('throws when WebLN is not available', async () => {
    const api = createMockApi()
    await expect(payNormalInvoice(mockWallet('WEBLN'), 'lnbc...', api, undefined))
      .rejects.toThrow('No WebLN wallet available')
  })

  // Prod regression (2026-09-19): some WebLN extensions resolve `sendPayment()`
  // without a payload, which crashed the caller on `result.paymentHash` *after*
  // the money had already left the wallet.
  it('survives a WebLN provider that resolves without a result', async () => {
    const api = createMockApi()
    const webln = createMockWebLN()
    webln.enable.mockResolvedValue(undefined)
    webln.sendPayment.mockResolvedValue(undefined)

    const result = await payNormalInvoice(mockWallet('WEBLN'), 'lnbc...', api, webln)

    expect(result).toEqual({ paymentHash: '', status: 'PENDING', preimage: undefined })
  })

  it('survives a WebLN provider that resolves with an empty object', async () => {
    const api = createMockApi()
    const webln = createMockWebLN()
    webln.sendPayment.mockResolvedValue({})

    const result = await payNormalInvoice(mockWallet('WEBLN'), 'lnbc...', api, webln)

    expect(result.status).toBe('PENDING')
    expect(result.paymentHash).toBe('')
  })

  it('derives sha256(preimage) when the WebLN provider reports only a preimage', async () => {
    const api = createMockApi()
    const webln = createMockWebLN()
    const preimage = 'aa'.repeat(32) // 32-byte hex
    webln.sendPayment.mockResolvedValue({ preimage })

    const result = await payNormalInvoice(mockWallet('WEBLN'), 'lnbc...', api, webln)

    // sha256 of the 32 zero-... bytes: matches the server's
    // crypto.createHash('sha256').update(Buffer.from(preimage,'hex')) derivation.
    expect(result.status).toBe('SUCCESS')
    expect(result.preimage).toBe(preimage)
    expect(result.paymentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.paymentHash).not.toBe('')
  })

  it('pays via NWC endpoint for NWC wallet', async () => {
    const api = createMockApi()
    api.post.mockResolvedValue({
      json: async () => ({ paymentHash: 'nwc-hash', status: 'SUCCESS', feesPaidSats: 3 }),
    })

    const result = await payNormalInvoice(mockWallet('NWC'), 'lnbc...', api)

    expect(api.post).toHaveBeenCalledWith('/api/wallet/nwc/pay', { bolt11: 'lnbc...', escrow: false })
    expect(result).toEqual({ paymentHash: 'nwc-hash', status: 'SUCCESS', feeSats: 3 })
  })

  it('pays via Alby OAuth endpoint for Alby wallet', async () => {
    const api = createMockApi()
    api.post.mockResolvedValue({
      json: async () => ({ paymentHash: 'alby-hash', status: 'SUCCESS', feeSats: 2, preimage: 'alby-pre' }),
    })

    const result = await payNormalInvoice(mockWallet('ALBY_OAUTH'), 'lnbc...', api)

    expect(api.post).toHaveBeenCalledWith('/api/wallet/alby/pay', { bolt11: 'lnbc...' })
    // ADR-253: the preimage must flow through — it is the only proof with which
    // a buyer can self-confirm a direct-pay ticket (parity with NWC/WebLN).
    expect(result).toEqual({ paymentHash: 'alby-hash', status: 'SUCCESS', feeSats: 2, preimage: 'alby-pre' })
  })

  it('falls back to custodial endpoint for custodial wallet', async () => {
    const api = createMockApi()
    api.post.mockResolvedValue({
      json: async () => ({ paymentHash: 'cust-hash', status: 'SUCCESS' }),
    })

    const result = await payNormalInvoice(mockWallet('LNBITS', 'CUSTODIAL'), 'lnbc...', api)

    expect(api.post).toHaveBeenCalledWith('/api/wallet/payments/send', { bolt11: 'lnbc...' })
    expect(result).toEqual({ paymentHash: 'cust-hash', status: 'SUCCESS' })
  })
})

describe('dispatchHoldInvoice', () => {
  it('dispatches via NWC endpoint with escrow=true', async () => {
    const api = createMockApi()
    api.post.mockResolvedValue({
      json: async () => ({ status: 'DISPATCHED' }),
    })

    const result = await dispatchHoldInvoice(mockWallet('NWC'), 'lnbc...', api)

    expect(api.post).toHaveBeenCalledWith('/api/wallet/nwc/pay', { bolt11: 'lnbc...', escrow: true })
    expect(result).toEqual({ dispatched: true })
  })

  it('throws when NWC dispatch fails', async () => {
    const api = createMockApi()
    api.post.mockResolvedValue({
      json: async () => ({ status: 'FAILED', message: 'relay down' }),
    })

    await expect(dispatchHoldInvoice(mockWallet('NWC'), 'lnbc...', api))
      .rejects.toThrow('relay down')
  })

  it('dispatches via WebLN fire-and-forget after enable()', async () => {
    const api = createMockApi()
    const webln = createMockWebLN()
    webln.enable.mockResolvedValue(undefined)
    webln.sendPayment.mockReturnValue(new Promise(() => {})) // never resolves — intentionally

    const result = await dispatchHoldInvoice(mockWallet('WEBLN'), 'lnbc...', api, webln)

    expect(webln.enable).toHaveBeenCalledOnce()
    expect(webln.sendPayment).toHaveBeenCalledWith('lnbc...')
    expect(result).toEqual({ dispatched: true })
  })

  it('throws when WebLN is not available', async () => {
    const api = createMockApi()
    await expect(dispatchHoldInvoice(mockWallet('WEBLN'), 'lnbc...', api, undefined))
      .rejects.toThrow('No WebLN wallet available')
  })

  it('throws when user rejects WebLN enable()', async () => {
    const api = createMockApi()
    const webln = createMockWebLN()
    webln.enable.mockRejectedValue(new Error('User rejected'))

    await expect(dispatchHoldInvoice(mockWallet('WEBLN'), 'lnbc...', api, webln))
      .rejects.toThrow('User rejected')
  })

  it('throws for Alby OAuth wallet', async () => {
    const api = createMockApi()
    await expect(dispatchHoldInvoice(mockWallet('ALBY_OAUTH'), 'lnbc...', api))
      .rejects.toThrow('not supported')
  })

  it('dispatches via custodial endpoint with escrow=true', async () => {
    const api = createMockApi()
    api.post.mockResolvedValue({
      json: async () => ({ ok: true, dispatched: true, status: 'DISPATCHED' }),
    })

    const result = await dispatchHoldInvoice(mockWallet('LNBITS', 'CUSTODIAL'), 'lnbc...', api)

    expect(api.post).toHaveBeenCalledWith('/api/wallet/payments/send', { bolt11: 'lnbc...', escrow: true })
    expect(result).toEqual({ dispatched: true })
  })

  it('throws when custodial dispatch fails', async () => {
    const api = createMockApi()
    api.post.mockResolvedValue({
      json: async () => ({ error: 'No active custodial wallet found' }),
    })

    await expect(dispatchHoldInvoice(mockWallet('LNBITS', 'CUSTODIAL'), 'lnbc...', api))
      .rejects.toThrow('No active custodial wallet found')
  })

  it('throws when no wallet is connected', async () => {
    const api = createMockApi()
    await expect(dispatchHoldInvoice(null, 'lnbc...', api))
      .rejects.toThrow('not supported')
  })
})

describe('canDispatchHoldInvoice', () => {
  it('returns true for NWC non-custodial', () => {
    expect(canDispatchHoldInvoice(mockWallet('NWC'))).toBe(true)
  })

  it('returns true for WebLN non-custodial', () => {
    expect(canDispatchHoldInvoice(mockWallet('WEBLN'))).toBe(true)
  })

  it('returns false for Alby OAuth', () => {
    expect(canDispatchHoldInvoice(mockWallet('ALBY_OAUTH'))).toBe(false)
  })

  it('returns true for custodial', () => {
    expect(canDispatchHoldInvoice(mockWallet('LNBITS', 'CUSTODIAL'))).toBe(true)
  })

  it('returns false when no wallet', () => {
    expect(canDispatchHoldInvoice(null)).toBe(false)
  })
})
