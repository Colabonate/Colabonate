import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, apiCall } from './api'
import {
  fetchRemotePayee,
  createRemoteOrder,
  requestRemoteInvoice,
  confirmRemoteOrder,
  fetchRemoteOrder,
  fetchMyRemoteOrders,
  remoteOrderErrorCode,
  remoteOrderErrorMessage,
} from './remote-orders-api'

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiCall: vi.fn() }
})

function ok(payload: unknown) {
  return { ok: true, json: async () => payload } as unknown as Response
}

describe('remote-orders-api requests', () => {
  beforeEach(() => {
    vi.mocked(apiCall).mockReset()
    vi.mocked(apiCall).mockResolvedValue(ok({ marker: true }))
  })

  it('fetchRemotePayee uses GET with encoded id and quantity', async () => {
    const data = await fetchRemotePayee('offer/1', 3)
    expect(apiCall).toHaveBeenCalledWith('/api/remote-orders/payee/offer%2F1?quantity=3')
    expect(data).toEqual({ marker: true })
  })

  it('fetchRemotePayee defaults quantity to 1', async () => {
    await fetchRemotePayee('abc')
    expect(apiCall).toHaveBeenCalledWith('/api/remote-orders/payee/abc?quantity=1')
  })

  it('createRemoteOrder POSTs offerId and quantity', async () => {
    await createRemoteOrder('abc', 2)
    expect(apiCall).toHaveBeenCalledWith('/api/remote-orders', {
      method: 'POST',
      body: JSON.stringify({ offerId: 'abc', quantity: 2 }),
    })
  })

  it('createRemoteOrder defaults quantity to 1', async () => {
    await createRemoteOrder('abc')
    expect(apiCall).toHaveBeenCalledWith('/api/remote-orders', {
      method: 'POST',
      body: JSON.stringify({ offerId: 'abc', quantity: 1 }),
    })
  })

  it('requestRemoteInvoice omits zapRequest when undefined', async () => {
    await requestRemoteInvoice('ord1')
    const [url, init] = vi.mocked(apiCall).mock.calls[0] as [string, { method: string; body: string }]
    expect(url).toBe('/api/remote-orders/ord1/invoice')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({})
    expect(init.body).not.toContain('zapRequest')
  })

  it('requestRemoteInvoice sends the signed zap request when given', async () => {
    const zap = { id: 'z', kind: 9734 } as never
    await requestRemoteInvoice('ord1', zap)
    const [, init] = vi.mocked(apiCall).mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(init.body)).toEqual({ zapRequest: zap })
  })

  it('confirmRemoteOrder POSTs the preimage', async () => {
    await confirmRemoteOrder('ord1', 'pre')
    expect(apiCall).toHaveBeenCalledWith('/api/remote-orders/ord1/confirm', {
      method: 'POST',
      body: JSON.stringify({ preimage: 'pre' }),
    })
  })

  it('fetchRemoteOrder uses GET on the order id', async () => {
    await fetchRemoteOrder('ord1')
    expect(apiCall).toHaveBeenCalledWith('/api/remote-orders/ord1')
  })

  it('fetchMyRemoteOrders lists all, or filters by offerId', async () => {
    await fetchMyRemoteOrders()
    expect(apiCall).toHaveBeenLastCalledWith('/api/remote-orders')
    await fetchMyRemoteOrders('off 1')
    expect(apiCall).toHaveBeenLastCalledWith('/api/remote-orders?offerId=off%201')
  })
})

describe('remoteOrderErrorCode', () => {
  it('returns the server code from an ApiError', () => {
    const err = new ApiError(400, 'Not orderable', { error: 'NOT_ORDERABLE', code: 'NOT_ORDERABLE' })
    expect(remoteOrderErrorCode(err)).toBe('NOT_ORDERABLE')
  })

  it('falls back to error when code is absent', () => {
    const err = new ApiError(409, 'Quote expired', { error: 'QUOTE_EXPIRED' })
    expect(remoteOrderErrorCode(err)).toBe('QUOTE_EXPIRED')
  })

  it('returns null for ApiErrors without data and for non-ApiError values', () => {
    expect(remoteOrderErrorCode(new ApiError(500, 'boom'))).toBeNull()
    expect(remoteOrderErrorCode(new Error('plain'))).toBeNull()
    expect(remoteOrderErrorCode('string')).toBeNull()
    expect(remoteOrderErrorCode(undefined)).toBeNull()
    expect(remoteOrderErrorCode({ data: { code: 'X' } })).toBeNull()
  })
})

describe('remoteOrderErrorMessage', () => {
  it('prefers the server message', () => {
    const err = new ApiError(400, 'Amount too high', { error: 'ABOVE_LAUNCH_CAP', message: 'Amount too high' })
    expect(remoteOrderErrorMessage(err)).toBe('Amount too high')
  })

  it('uses the error text when no message is present', () => {
    const err = new ApiError(502, 'UPSTREAM_ERROR', { error: 'Upstream failed' })
    expect(remoteOrderErrorMessage(err)).toBe('Upstream failed')
  })

  it('returns the generic fallback for unknown values', () => {
    const generic = 'Something went wrong, please try again.'
    expect(remoteOrderErrorMessage(new Error('x'))).toBe(generic)
    expect(remoteOrderErrorMessage(42)).toBe(generic)
    expect(remoteOrderErrorMessage(null)).toBe(generic)
    expect(remoteOrderErrorMessage(new ApiError(500, '', undefined))).toBe(generic)
  })
})
