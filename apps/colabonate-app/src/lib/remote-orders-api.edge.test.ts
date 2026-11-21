import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, apiCall } from './api'
import {
  fetchRemotePayee,
  createRemoteOrder,
  requestRemoteInvoice,
  confirmRemoteOrder,
  fetchRemoteOrder,
  fetchMyRemoteOrders,
  remoteOrderErrorMessage,
  type RemoteOrderReason,
} from './remote-orders-api'

// Edge cases only. Happy-path request shapes and the basic error helpers are
// covered in remote-orders-api.test.ts.

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiCall: vi.fn() }
})

const GENERIC = 'Something went wrong, please try again.'
const BUY_WORDING = /\bbuy\b|checkout|cart/i

function ok(payload: unknown) {
  return { ok: true, json: async () => payload } as unknown as Response
}

const lastUrl = () => String(vi.mocked(apiCall).mock.calls.at(-1)?.[0])

describe('remoteOrderErrorMessage: documented server codes', () => {
  const CODES = [
    'OFFER_NOT_FOUND',
    'NOT_REMOTE',
    'NOT_ORDERABLE',
    'QUOTE_EXPIRED',
    'ZAP_REQUEST_INVALID',
    'INVALID_STATE',
    'PREIMAGE_MISMATCH',
    'UPSTREAM_ERROR',
    'FORBIDDEN',
    'UNAUTHORIZED',
  ]

  it.each(CODES)('%s with a server message returns that human text, not the code', (code) => {
    const human = `Human explanation for ${code.toLowerCase().replace(/_/g, ' ')}.`
    const err = new ApiError(400, code, { error: code, code, message: human })
    const text = remoteOrderErrorMessage(err)
    expect(text).toBe(human)
    expect(text).not.toContain(code)
    expect(text).not.toMatch(BUY_WORDING)
  })

  it.each(CODES)('%s without a server message must not show the raw code to the user', (code) => {
    const err = new ApiError(400, code, { error: code, code })
    const text = remoteOrderErrorMessage(err)
    expect(text.trim().length).toBeGreaterThan(0)
    expect(text).not.toContain(code)
  })

  it('NOT_ORDERABLE: every reason yields the server message and never leaks the code or reason', () => {
    const reasons: RemoteOrderReason[] = [
      'NOT_REMOTE',
      'OFFER_NOT_ACTIVE',
      'NO_PAYEE',
      'NO_LIGHTNING_ADDRESS',
      'LNURL_UNREACHABLE',
      'PRICE_NOT_CONVERTIBLE',
      'AMOUNT_OUT_OF_RANGE',
      'ABOVE_LAUNCH_CAP',
    ]
    for (const reason of reasons) {
      const human = `Seller cannot be paid right now (${reason.toLowerCase()}).`
      const err = new ApiError(400, 'NOT_ORDERABLE', { error: 'NOT_ORDERABLE', code: 'NOT_ORDERABLE', reason, message: human })
      const text = remoteOrderErrorMessage(err)
      expect(text).toBe(human)
      expect(text).not.toContain('NOT_ORDERABLE')
      expect(text).not.toContain(reason)
      expect(text).not.toMatch(BUY_WORDING)
    }
  })

  it('NOT_ORDERABLE with a reason but no message does not leak the reason code', () => {
    const err = new ApiError(400, 'NOT_ORDERABLE', { error: 'NOT_ORDERABLE', code: 'NOT_ORDERABLE', reason: 'ABOVE_LAUNCH_CAP' })
    const text = remoteOrderErrorMessage(err)
    expect(text).not.toContain('ABOVE_LAUNCH_CAP')
    expect(text).not.toContain('NOT_ORDERABLE')
  })

  it('an ApiError whose message is a bare code (no data) falls back to the generic text', () => {
    expect(remoteOrderErrorMessage(new ApiError(409, 'QUOTE_EXPIRED'))).toBe(GENERIC)
  })
})

describe('remoteOrderErrorMessage: never throws, always safe text', () => {
  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['plain string', 'boom'],
    ['number', 42],
    ['boolean', false],
    ['plain Error', new Error('x')],
    ['network TypeError', new TypeError('Failed to fetch')],
    ['ApiError with empty message and no data', new ApiError(500, '')],
    ['ApiError with string data', new ApiError(500, '', 'oops as string')],
    ['ApiError with null data', new ApiError(500, '', null)],
    ['ApiError with empty data message', new ApiError(500, '', { message: '' })],
    ['ApiError with non-string message', new ApiError(500, '', { message: 123 })],
    ['ApiError with object message', new ApiError(500, '', { message: { nested: true } })],
    ['object that looks like ApiError data', { data: { error: 'X', message: 'Y' } }],
  ])('%s returns the generic message without throwing', (_label, input) => {
    let text = ''
    expect(() => {
      text = remoteOrderErrorMessage(input)
    }).not.toThrow()
    expect(text).toBe(GENERIC)
  })

  it('the generic message contains no buy/checkout/cart wording', () => {
    expect(GENERIC).not.toMatch(BUY_WORDING)
    expect(remoteOrderErrorMessage(undefined)).not.toMatch(BUY_WORDING)
  })
})

describe('remote-orders-api: request edges', () => {
  beforeEach(() => {
    vi.mocked(apiCall).mockReset()
    vi.mocked(apiCall).mockResolvedValue(ok({ marker: true }))
  })

  it('propagates the ApiError from apiCall unchanged (same instance, status kept)', async () => {
    const apiErr = new ApiError(404, 'not found', { error: 'OFFER_NOT_FOUND' })
    vi.mocked(apiCall).mockRejectedValueOnce(apiErr)
    const caught = await fetchRemotePayee('offer-x').catch((e: unknown) => e)
    expect(caught).toBe(apiErr)
    expect((caught as ApiError).status).toBe(404)
  })

  it('propagates a network failure from createRemoteOrder without swallowing it', async () => {
    const netErr = new TypeError('Failed to fetch')
    vi.mocked(apiCall).mockRejectedValueOnce(netErr)
    await expect(createRemoteOrder('offer-x', 1)).rejects.toBe(netErr)
  })

  it('a malformed (non-JSON) success body rejects instead of resolving to garbage', async () => {
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    } as unknown as Response)
    await expect(fetchRemoteOrder('ord-1')).rejects.toBeInstanceOf(SyntaxError)
  })

  it('a null JSON body is returned as-is (the component guards on orderable)', async () => {
    vi.mocked(apiCall).mockResolvedValueOnce(ok(null))
    await expect(fetchRemotePayee('offer-x')).resolves.toBeNull()
  })

  it('fetchRemotePayee encodes an offer id with query and fragment characters into the path only', async () => {
    const id = 'a&quantity=9#frag?x y/é'
    await fetchRemotePayee(id, 2)
    const url = lastUrl()
    const [path, query] = url.split('?')
    expect(path).toBe(`/api/remote-orders/payee/${encodeURIComponent(id)}`)
    expect(query).toBe('quantity=2')
    expect(url.includes('#')).toBe(false)
  })

  it('fetchMyRemoteOrders keeps an offerId containing & and = as a single query value', async () => {
    await fetchMyRemoteOrders('a&quantity=9')
    const params = new URL('http://api.local' + lastUrl()).searchParams
    expect(params.getAll('offerId')).toEqual(['a&quantity=9'])
    expect(params.has('quantity')).toBe(false)
  })

  it('fetchMyRemoteOrders with an empty offerId sends no filter at all', async () => {
    await fetchMyRemoteOrders('')
    expect(lastUrl()).toBe('/api/remote-orders')
  })

  it('order-id path segments encode slashes and question marks for invoice, confirm and fetch', async () => {
    const id = 'ord/1?x'
    const enc = encodeURIComponent(id)
    await requestRemoteInvoice(id)
    expect(lastUrl()).toBe(`/api/remote-orders/${enc}/invoice`)
    await confirmRemoteOrder(id, 'pre')
    expect(lastUrl()).toBe(`/api/remote-orders/${enc}/confirm`)
    await fetchRemoteOrder(id)
    expect(lastUrl()).toBe(`/api/remote-orders/${enc}`)
  })

  it('createRemoteOrder round-trips quotes, backslashes and unicode in the offer id through the JSON body', async () => {
    const id = 'offer "quoted" \\ ünïcode 🙂'
    await createRemoteOrder(id, 3)
    const [, init] = vi.mocked(apiCall).mock.calls.at(-1) as [string, { body: string }]
    expect(JSON.parse(init.body)).toEqual({ offerId: id, quantity: 3 })
  })
})
