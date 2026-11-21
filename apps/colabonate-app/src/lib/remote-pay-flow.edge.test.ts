import { describe, it, expect, vi } from 'vitest'
import { runRemotePayment, type PayFlowDeps } from './remote-pay-flow'
import type { CreateRemoteOrderResponse, RemoteInvoiceResponse, RemoteOrderView } from './remote-orders-api'
import type { ZapTemplate } from './zap-request'

// Edge cases for runRemotePayment. Happy path, basic stage errors and the
// main pay outcomes are covered in remote-pay-flow.test.ts; this file adds
// ordering, identity, empty-value and error-mapping edges.

const TEMPLATE: ZapTemplate = {
  payeePubkey: 'b'.repeat(64),
  amountMsats: 42000,
  lnurl: 'lnurl1edge',
  relays: ['wss://relay.edge'],
  listingAddress: '30402:' + 'b'.repeat(64) + ':offer-edge',
}

function order(id: string, status: RemoteOrderView['status'] = 'QUOTED', amountSats = 42): RemoteOrderView {
  return {
    id,
    offerId: 'offer-edge',
    quantity: 1,
    status,
    payee: {
      pubkey: 'b'.repeat(64),
      role: 'seller',
      lud16: 'edge@example.com',
      zap: true,
      minSats: 1,
      maxSats: 1000000,
    },
    amountSats,
    quoteExpiresAt: '2026-11-12T12:00:00.000Z',
    createdAt: '2026-11-12T11:00:00.000Z',
  }
}

type PayRes = { ok: boolean; mode: string; preimage?: string; error?: string }

/** Deps whose every call is appended to `log`, so ordering can be asserted. */
function makeLoggedDeps(log: string[], overrides: { created?: CreateRemoteOrderResponse; invoice?: RemoteInvoiceResponse } = {}) {
  const created: CreateRemoteOrderResponse = overrides.created ?? { order: order('ord-e'), zapRequestTemplate: TEMPLATE }
  const invoice: RemoteInvoiceResponse = overrides.invoice ?? {
    bolt11: 'lnbc42edge',
    paymentHash: 'hash-edge',
    order: order('ord-e', 'INVOICED'),
  }
  return {
    createOrder: vi.fn(async () => {
      log.push('createOrder')
      return created
    }),
    signZap: vi.fn(async () => {
      log.push('signZap')
      return { id: 'signed-edge' }
    }),
    requestInvoice: vi.fn(async () => {
      log.push('requestInvoice')
      return invoice
    }),
    payInvoice: vi.fn(async (): Promise<PayRes> => {
      log.push('payInvoice')
      return { ok: true, mode: 'NWC', preimage: 'pre-edge' }
    }),
    confirm: vi.fn(async () => {
      log.push('confirm')
      return { order: order('ord-e', 'PAID') }
    }),
    errorMessage: vi.fn((err: unknown) => `msg:${err instanceof Error ? err.message : String(err)}`),
  }
}

const asDeps = (d: ReturnType<typeof makeLoggedDeps>) => d as unknown as PayFlowDeps

describe('runRemotePayment: order and sign failures stop the flow', () => {
  it('createOrder throw: only createOrder ran, nothing is signed, invoiced or paid', async () => {
    const log: string[] = []
    const deps = makeLoggedDeps(log)
    deps.createOrder.mockImplementation(async () => {
      log.push('createOrder')
      throw new Error('quote expired')
    })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(result).toEqual({ kind: 'error', stage: 'order', message: 'msg:quote expired' })
    expect(log).toEqual(['createOrder'])
    expect(deps.createOrder).toHaveBeenCalledTimes(1)
  })

  it('createOrder rejecting with a non-Error value still reaches errorMessage unchanged', async () => {
    const deps = makeLoggedDeps([])
    deps.createOrder.mockRejectedValue('plain-string-rejection')

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(result).toEqual({ kind: 'error', stage: 'order', message: 'msg:plain-string-rejection' })
    expect(deps.errorMessage).toHaveBeenCalledWith('plain-string-rejection')
  })

  it('signZap throw: no invoice, no wallet call, no confirm; the created order is carried', async () => {
    const log: string[] = []
    const deps = makeLoggedDeps(log)
    deps.signZap.mockImplementation(async () => {
      log.push('signZap')
      throw new Error('user rejected signing')
    })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(result).toMatchObject({ kind: 'error', stage: 'sign', order: { id: 'ord-e', status: 'QUOTED' } })
    expect(log).toEqual(['createOrder', 'signZap'])
    expect(deps.payInvoice).not.toHaveBeenCalled()
    expect(deps.confirm).not.toHaveBeenCalled()
  })
})

describe('runRemotePayment: pay outcome edge cases', () => {
  it('payInvoice throw yields manual/wallet-unavailable with no detail key at all', async () => {
    const deps = makeLoggedDeps([])
    deps.payInvoice.mockRejectedValue(new Error('extension crashed'))

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(result.kind).toBe('manual')
    expect(result).toMatchObject({ reason: 'wallet-unavailable', bolt11: 'lnbc42edge', paymentHash: 'hash-edge' })
    expect('detail' in result).toBe(false)
  })

  it('ok:false WALLET without an error text yields wallet-failed and no detail key', async () => {
    const deps = makeLoggedDeps([])
    deps.payInvoice.mockResolvedValue({ ok: false, mode: 'WALLET' })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(result).toMatchObject({ kind: 'manual', reason: 'wallet-failed' })
    expect('detail' in result).toBe(false)
  })

  it('ok:false MANUAL ignores any error text: reason is wallet-unavailable and no detail', async () => {
    const deps = makeLoggedDeps([])
    deps.payInvoice.mockResolvedValue({ ok: false, mode: 'MANUAL', error: 'should not surface' })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(result).toMatchObject({ kind: 'manual', reason: 'wallet-unavailable' })
    expect('detail' in result).toBe(false)
  })

  it('ok:true with an empty-string preimage counts as no-preimage and never confirms', async () => {
    const deps = makeLoggedDeps([])
    deps.payInvoice.mockResolvedValue({ ok: true, mode: 'NWC', preimage: '' })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(result).toMatchObject({ kind: 'manual', reason: 'no-preimage' })
    expect(deps.confirm).not.toHaveBeenCalled()
  })

  it('confirm receives the preimage byte-for-byte as the wallet returned it', async () => {
    const deps = makeLoggedDeps([])
    deps.payInvoice.mockResolvedValue({ ok: true, mode: 'NWC', preimage: 'AbC123dEf' })

    await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(deps.confirm).toHaveBeenCalledWith('ord-e', 'AbC123dEf')
  })

  it('paid result carries the order returned by confirm, not the invoiced one', async () => {
    const deps = makeLoggedDeps([])
    deps.confirm.mockResolvedValue({ order: order('ord-e', 'PAID', 9999) })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(result).toEqual({ kind: 'paid', order: order('ord-e', 'PAID', 9999) })
  })

  it('a wallet failure never triggers a second payInvoice or a second order (no double pay)', async () => {
    const deps = makeLoggedDeps([])
    deps.payInvoice.mockResolvedValue({ ok: false, mode: 'NWC', error: 'timeout' })

    await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(deps.payInvoice).toHaveBeenCalledTimes(1)
    expect(deps.requestInvoice).toHaveBeenCalledTimes(1)
    expect(deps.createOrder).toHaveBeenCalledTimes(1)
  })
})

describe('runRemotePayment: error mapping and ordering', () => {
  it.each(['order', 'sign', 'invoice', 'confirm'] as const)(
    'stage %s hands the exact thrown value to errorMessage and returns its text',
    async (stage) => {
      const thrown = { code: 'X', nested: { reason: stage } }
      const deps = makeLoggedDeps([])
      if (stage === 'order') deps.createOrder.mockRejectedValue(thrown)
      if (stage === 'sign') deps.signZap.mockRejectedValue(thrown)
      if (stage === 'invoice') deps.requestInvoice.mockRejectedValue(thrown)
      if (stage === 'confirm') deps.confirm.mockRejectedValue(thrown)

      const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

      expect(result.kind).toBe('error')
      expect(deps.errorMessage).toHaveBeenCalledTimes(1)
      expect(deps.errorMessage.mock.calls[0][0]).toBe(thrown)
      if (result.kind === 'error') {
        expect(result.stage).toBe(stage)
        expect(result.message).toBe('msg:[object Object]')
      }
    },
  )

  it('without a zap template the order is createOrder -> requestInvoice -> payInvoice -> confirm', async () => {
    const log: string[] = []
    const deps = makeLoggedDeps(log, {
      created: { order: order('ord-n') },
      invoice: { bolt11: 'lnbc-n', paymentHash: 'hash-n', order: order('ord-n', 'INVOICED') },
    })

    const result = await runRemotePayment(asDeps(deps), { offerId: 'offer-edge' })

    expect(result.kind).toBe('paid')
    expect(log).toEqual(['createOrder', 'requestInvoice', 'payInvoice', 'confirm'])
    expect(deps.confirm).toHaveBeenCalledWith('ord-n', 'pre-edge')
  })
})
