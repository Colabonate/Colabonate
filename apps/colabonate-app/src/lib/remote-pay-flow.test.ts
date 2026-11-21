import { describe, it, expect, vi } from 'vitest'
import { runRemotePayment, type PayFlowDeps } from './remote-pay-flow'
import type { CreateRemoteOrderResponse, RemoteInvoiceResponse, RemoteOrderView } from './remote-orders-api'
import type { ZapTemplate } from './zap-request'

const TEMPLATE: ZapTemplate = {
  payeePubkey: 'a'.repeat(64),
  amountMsats: 21000,
  lnurl: 'lnurl1example',
  relays: ['wss://relay.example'],
  listingAddress: '30402:' + 'a'.repeat(64) + ':offer-1',
}

function order(id: string, status: RemoteOrderView['status'] = 'QUOTED'): RemoteOrderView {
  return {
    id,
    offerId: 'offer-1',
    quantity: 1,
    status,
    payee: {
      pubkey: 'a'.repeat(64),
      role: 'seller',
      lud16: 'seller@example.com',
      zap: true,
      minSats: 1,
      maxSats: 1000000,
    },
    amountSats: 21,
    quoteExpiresAt: '2026-11-12T12:00:00.000Z',
    createdAt: '2026-11-12T11:00:00.000Z',
  }
}

const SIGNED = { id: 'signed-zap', kind: 9734 }

type PayRes = { ok: boolean; mode: string; preimage?: string; error?: string }

function makeDeps(overrides: {
  createResponse?: CreateRemoteOrderResponse
  invoiceResponse?: RemoteInvoiceResponse
} = {}) {
  const created: CreateRemoteOrderResponse = overrides.createResponse ?? {
    order: order('ord-1'),
    zapRequestTemplate: TEMPLATE,
  }
  const invoice: RemoteInvoiceResponse = overrides.invoiceResponse ?? {
    bolt11: 'lnbc210n1example',
    paymentHash: 'hash-1',
    order: order('ord-1', 'INVOICED'),
  }
  const deps = {
    createOrder: vi.fn(async () => created),
    signZap: vi.fn(async () => SIGNED),
    requestInvoice: vi.fn(async () => invoice),
    payInvoice: vi.fn(async (): Promise<PayRes> => ({ ok: true, mode: 'NWC', preimage: 'pre-1' })),
    confirm: vi.fn(async () => ({ order: order('ord-1', 'PAID') })),
    errorMessage: vi.fn((err: unknown) => `msg:${err instanceof Error ? err.message : String(err)}`),
  }
  return deps
}

type Deps = ReturnType<typeof makeDeps>
const asDeps = (d: Deps) => d as unknown as PayFlowDeps

describe('runRemotePayment: happy path', () => {
  it('runs createOrder -> signZap -> requestInvoice -> payInvoice -> confirm and returns paid', async () => {
    const deps = makeDeps()
    const calls: string[] = []
    deps.createOrder.mockImplementation(async () => { calls.push('createOrder'); return { order: order('ord-1'), zapRequestTemplate: TEMPLATE } })
    deps.signZap.mockImplementation(async () => { calls.push('signZap'); return SIGNED })
    deps.requestInvoice.mockImplementation(async () => { calls.push('requestInvoice'); return { bolt11: 'lnbc1', paymentHash: 'hash-1', order: order('ord-1', 'INVOICED') } })
    deps.payInvoice.mockImplementation(async (): Promise<PayRes> => { calls.push('payInvoice'); return { ok: true, mode: 'NWC', preimage: 'pre-1' } })
    deps.confirm.mockImplementation(async () => { calls.push('confirm'); return { order: order('ord-1', 'PAID') } })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(calls).toEqual(['createOrder', 'signZap', 'requestInvoice', 'payInvoice', 'confirm'])
    expect(deps.signZap).toHaveBeenCalledWith(TEMPLATE)
    expect(deps.requestInvoice).toHaveBeenCalledWith('ord-1', SIGNED)
    expect(deps.payInvoice).toHaveBeenCalledWith({ invoice: 'lnbc1', paymentHash: 'hash-1' })
    expect(deps.confirm).toHaveBeenCalledWith('ord-1', 'pre-1')
    expect(result).toEqual({ kind: 'paid', order: order('ord-1', 'PAID') })
  })

  it('without a zap template: signZap is never called and requestInvoice gets exactly one argument', async () => {
    const deps = makeDeps({
      createResponse: { order: order('ord-2') },
      invoiceResponse: { bolt11: 'lnbc2', paymentHash: 'hash-2', order: order('ord-2', 'INVOICED') },
    })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(deps.signZap).not.toHaveBeenCalled()
    expect(deps.requestInvoice).toHaveBeenCalledTimes(1)
    expect(deps.requestInvoice.mock.calls[0]).toHaveLength(1)
    expect(deps.requestInvoice).toHaveBeenCalledWith('ord-2')
    expect(deps.confirm).toHaveBeenCalledWith('ord-2', 'pre-1')
    expect(result.kind).toBe('paid')
  })

  it('defaults quantity to 1 and passes an explicit quantity through unchanged', async () => {
    const deps = makeDeps()
    await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })
    expect(deps.createOrder).toHaveBeenLastCalledWith('offer-1', 1)

    await runRemotePayment(asDeps(deps), { offerId: 'offer-1', quantity: 7 })
    expect(deps.createOrder).toHaveBeenLastCalledWith('offer-1', 7)
  })
})

describe('runRemotePayment: stage errors', () => {
  it('maps a createOrder throw to stage order with errorMessage text', async () => {
    const deps = makeDeps()
    deps.createOrder.mockRejectedValue(new Error('sold out'))

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(result).toEqual({ kind: 'error', stage: 'order', message: 'msg:sold out' })
    expect(deps.errorMessage).toHaveBeenCalled()
    expect(deps.requestInvoice).not.toHaveBeenCalled()
  })

  it('maps a signZap throw to stage sign and carries the created order', async () => {
    const deps = makeDeps()
    deps.signZap.mockRejectedValue(new Error('signer refused'))

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(result).toEqual({ kind: 'error', stage: 'sign', message: 'msg:signer refused', order: order('ord-1') })
    expect(deps.requestInvoice).not.toHaveBeenCalled()
  })

  it('maps a requestInvoice throw to stage invoice and carries the created order', async () => {
    const deps = makeDeps()
    deps.requestInvoice.mockRejectedValue(new Error('lnurl down'))

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(result).toEqual({ kind: 'error', stage: 'invoice', message: 'msg:lnurl down', order: order('ord-1') })
    expect(deps.payInvoice).not.toHaveBeenCalled()
  })

  it('maps a confirm throw to stage confirm and carries the invoiced order', async () => {
    const deps = makeDeps()
    deps.confirm.mockRejectedValue(new Error('bad preimage'))

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(result).toEqual({
      kind: 'error',
      stage: 'confirm',
      message: 'msg:bad preimage',
      order: order('ord-1', 'INVOICED'),
    })
  })
})

describe('runRemotePayment: pay outcomes', () => {
  it('ok with preimage -> confirm and paid', async () => {
    const deps = makeDeps()
    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })
    expect(result.kind).toBe('paid')
    expect(deps.confirm).toHaveBeenCalledTimes(1)
  })

  it('ok without preimage -> manual/no-preimage and no confirm', async () => {
    const deps = makeDeps()
    deps.payInvoice.mockResolvedValue({ ok: true, mode: 'WEBLN' })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(result).toEqual({
      kind: 'manual',
      order: order('ord-1', 'INVOICED'),
      bolt11: 'lnbc210n1example',
      paymentHash: 'hash-1',
      reason: 'no-preimage',
    })
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it('ok:false with mode MANUAL -> manual/wallet-unavailable', async () => {
    const deps = makeDeps()
    deps.payInvoice.mockResolvedValue({ ok: false, mode: 'MANUAL' })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(result.kind).toBe('manual')
    expect(result).toMatchObject({ reason: 'wallet-unavailable' })
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it('ok:false with mode NWC and error -> manual/wallet-failed with detail', async () => {
    const deps = makeDeps()
    deps.payInvoice.mockResolvedValue({ ok: false, mode: 'NWC', error: 'boom' })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(result).toMatchObject({ kind: 'manual', reason: 'wallet-failed', detail: 'boom' })
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it('payInvoice throwing -> manual/wallet-unavailable', async () => {
    const deps = makeDeps()
    deps.payInvoice.mockRejectedValue(new Error('extension crashed'))

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(result).toMatchObject({ kind: 'manual', reason: 'wallet-unavailable' })
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it('manual result uses the order from the invoice response, not the created one', async () => {
    const deps = makeDeps()
    deps.payInvoice.mockResolvedValue({ ok: false, mode: 'MANUAL' })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })

    expect(result.kind).toBe('manual')
    if (result.kind === 'manual') {
      expect(result.order.status).toBe('INVOICED')
    }
  })

  it('never includes the preimage in the result', async () => {
    const deps = makeDeps()
    const paid = await runRemotePayment(asDeps(deps), { offerId: 'offer-1' })
    expect(JSON.stringify(paid)).not.toContain('pre-1')

    const deps2 = makeDeps()
    deps2.payInvoice.mockResolvedValue({ ok: false, mode: 'NWC', error: 'nope' })
    const failed = await runRemotePayment(asDeps(deps2), { offerId: 'offer-1' })
    expect(JSON.stringify(failed)).not.toContain('pre-1')
  })
})
