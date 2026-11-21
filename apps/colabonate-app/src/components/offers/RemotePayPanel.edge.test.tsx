// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, screen } from '@testing-library/react'
import type { RemoteOrderView, RemotePayee, RemoteQuote } from '../../lib/remote-orders-api'
import { ApiError } from '../../lib/api'
import { RemotePayPanel } from './RemotePayPanel'

// Edge cases only. The happy paths, basic payee/basis copy, eCash melt and the
// first polling transitions are covered in RemotePayPanel.test.tsx.

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useRemotePayee: vi.fn(),
  usePayment: vi.fn(),
  runRemotePayment: vi.fn(),
  requireLogin: vi.fn(),
  fetchRemoteOrder: vi.fn(),
  confirmRemoteOrder: vi.fn(),
  cashu: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

vi.mock('../../hooks/useRemoteOrders', () => ({
  useRemotePayee: (...args: unknown[]) => mocks.useRemotePayee(...args),
}))

vi.mock('../../contexts/CashuContext', () => ({
  useCashuOptional: () => mocks.cashu(),
}))

vi.mock('../../hooks/usePayment', () => ({
  usePayment: () => mocks.usePayment(),
}))

vi.mock('../../lib/remote-pay-flow', () => ({
  runRemotePayment: (...args: unknown[]) => mocks.runRemotePayment(...args),
}))

vi.mock('../../lib/remote-orders-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/remote-orders-api')>()),
  fetchRemoteOrder: (...args: unknown[]) => mocks.fetchRemoteOrder(...args),
  confirmRemoteOrder: (...args: unknown[]) => mocks.confirmRemoteOrder(...args),
}))

vi.mock('../../lib/auth-guard', () => ({
  requireLogin: (...args: unknown[]) => mocks.requireLogin(...args),
}))

// The paid view sends an order notice to a named seller; keep these tests off the real relay pool.
vi.mock('../../lib/remote-delivery-deps', () => ({ createDefaultDeliveryDeps: () => ({}) }))
vi.mock('../../lib/remote-order-notice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/remote-order-notice')>()),
  sendOrderNotice: vi.fn(async () => ({ kind: 'no-inbox' })),
}))

vi.mock('../../lib/zap-request', () => ({
  signZapRequest: vi.fn(),
}))

const VALID_PUBKEY = '0000000287d80000b421da1ef9556a969689c1c21d45582b6184cc5162799156'
const OFFER_ID = 'offer-edge'
const BOLT11 = 'lnbc42u1pedgecaseinvoice0000000000000000000000000000000000000000000'
const PREIMAGE = 'b'.repeat(64)
const ORDER_ID = 'order-edge-7777'
const PAY_NAME = /^Pay /

function makePayee(overrides: Partial<RemotePayee> = {}): RemotePayee {
  return {
    pubkey: VALID_PUBKEY,
    role: 'seller',
    name: 'Alice Shop',
    lud16: 'alice@example.com',
    zap: false,
    minSats: 1,
    maxSats: 1_000_000,
    ...overrides,
  }
}

function makeQuote(overrides: Partial<RemoteQuote> = {}): RemoteQuote {
  return { amountSats: 4200, basis: 'sats', quantity: 1, ...overrides }
}

function makeOrder(overrides: Partial<RemoteOrderView> = {}): RemoteOrderView {
  return {
    id: ORDER_ID,
    offerId: OFFER_ID,
    quantity: 1,
    status: 'INVOICED',
    payee: makePayee(),
    amountSats: 4200,
    quoteExpiresAt: '2026-11-12T10:10:00.000Z',
    createdAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  }
}

function setPayee(data: { payee?: RemotePayee; quote?: RemoteQuote } = {}) {
  mocks.useRemotePayee.mockReturnValue({
    isLoading: false,
    isError: false,
    data: {
      orderable: true,
      payee: 'payee' in data ? data.payee : makePayee(),
      quote: 'quote' in data ? data.quote : makeQuote(),
    },
  })
}

function setPayment(isBeta = false) {
  mocks.usePayment.mockReturnValue({ payInvoice: vi.fn(), isBeta })
}

function payButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: PAY_NAME }) as HTMLButtonElement
}

/** Reaches the manual (invoice) view with a given order. */
async function openManual(order: RemoteOrderView = makeOrder()) {
  setPayee()
  mocks.runRemotePayment.mockResolvedValue({
    kind: 'manual',
    order,
    bolt11: BOLT11,
    paymentHash: 'hash-edge',
    reason: 'wallet-unavailable',
  })
  const utils = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
  fireEvent.click(payButton())
  await screen.findByText('Pay this invoice with any Lightning wallet.')
  return utils
}

/** Flushes pending microtasks and fake-timer callbacks inside act. */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const formatNumber = (n: number) => String(n)

function createMemoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
  localStorage.setItem('pubkey', VALID_PUBKEY)
  mocks.navigate.mockReset()
  mocks.useRemotePayee.mockReset()
  mocks.usePayment.mockReset()
  mocks.runRemotePayment.mockReset()
  mocks.requireLogin.mockReset()
  mocks.fetchRemoteOrder.mockReset()
  mocks.confirmRemoteOrder.mockReset()
  mocks.cashu.mockReset()
  mocks.cashu.mockReturnValue(null)
  setPayment(false)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (navigator as { clipboard?: unknown }).clipboard
})

describe('RemotePayPanel: pay button guards', () => {
  it('a double click runs the payment flow once and the button stays disabled while working', () => {
    setPayee()
    mocks.runRemotePayment.mockReturnValue(new Promise(() => {}))
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)

    const btn = payButton()
    fireEvent.click(btn)
    fireEvent.click(btn)

    expect(mocks.runRemotePayment).toHaveBeenCalledTimes(1)
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toBe('Paying…')
  })

  it('an empty-string pubkey counts as logged out: requireLogin, no payment', () => {
    localStorage.setItem('pubkey', '')
    setPayee()
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)

    fireEvent.click(payButton())

    expect(mocks.requireLogin).toHaveBeenCalledTimes(1)
    expect(mocks.runRemotePayment).not.toHaveBeenCalled()
  })

  it('pay -> error -> Try again -> pay again runs the flow a second time and reaches success', async () => {
    setPayee()
    mocks.runRemotePayment
      .mockResolvedValueOnce({ kind: 'error', stage: 'sign', message: 'Signing was cancelled.' })
      .mockResolvedValueOnce({ kind: 'paid', order: makeOrder({ status: 'PAID' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)

    fireEvent.click(payButton())
    expect(await screen.findByText('Signing was cancelled.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pay 4200 sats' }))

    expect(await screen.findByText('Payment sent')).toBeInTheDocument()
    expect(mocks.runRemotePayment).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Signing was cancelled.')).toBeNull()
  })

  it('a rejected runRemotePayment (contract says it never throws) must not leave the button stuck on Paying…', async () => {
    setPayee()
    mocks.runRemotePayment.mockRejectedValue(new Error('unexpected'))
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)

    fireEvent.click(payButton())
    await act(async () => {})

    expect(screen.queryByRole('button', { name: 'Paying…' })).toBeNull()
  })
})

describe('RemotePayPanel: manual phase polling', () => {
  it('a transient fetchRemoteOrder failure keeps polling and a later PAID switches to success', async () => {
    vi.useFakeTimers()
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: makeOrder(),
      bolt11: BOLT11,
      paymentHash: 'hash-edge',
      reason: 'no-preimage',
    })
    mocks.fetchRemoteOrder
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ order: makeOrder({ status: 'PAID' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    await tick(0)

    await tick(5_000)
    expect(mocks.fetchRemoteOrder).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument()
    expect(screen.queryByText('Payment sent')).toBeNull()

    await tick(5_000)
    expect(mocks.fetchRemoteOrder).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Payment sent')).toBeInTheDocument()
  })

  it('polling stops after unmount: no fetchRemoteOrder call once the panel is gone', async () => {
    vi.useFakeTimers()
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: makeOrder(),
      bolt11: BOLT11,
      paymentHash: 'hash-edge',
      reason: 'wallet-unavailable',
    })
    mocks.fetchRemoteOrder.mockResolvedValue({ order: makeOrder() })
    const { unmount } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    await tick(0)

    await tick(5_000)
    expect(mocks.fetchRemoteOrder).toHaveBeenCalledTimes(1)

    unmount()
    await tick(30_000)
    expect(mocks.fetchRemoteOrder).toHaveBeenCalledTimes(1)
  })

  it('an in-flight poll that resolves PAID after unmount does not throw', async () => {
    vi.useFakeTimers()
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: makeOrder(),
      bolt11: BOLT11,
      paymentHash: 'hash-edge',
      reason: 'wallet-unavailable',
    })
    let resolvePoll!: (v: { order: RemoteOrderView }) => void
    mocks.fetchRemoteOrder.mockImplementation(() => new Promise((r) => (resolvePoll = r)))
    const { unmount } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    await tick(0)
    await tick(5_000)

    unmount()
    await expect(
      act(async () => {
        resolvePoll({ order: makeOrder({ status: 'PAID' }) })
      }),
    ).resolves.not.toThrow()
  })

  it('a FAILED order shows the same expiry message as EXPIRED', async () => {
    vi.useFakeTimers()
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: makeOrder(),
      bolt11: BOLT11,
      paymentHash: 'hash-edge',
      reason: 'no-preimage',
    })
    mocks.fetchRemoteOrder.mockResolvedValue({ order: makeOrder({ status: 'FAILED' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    await tick(0)
    await tick(5_000)

    expect(
      screen.getByText('This payment window has expired. Start again to get a new amount.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('RemotePayPanel: preimage confirm', () => {
  it('Confirm is disabled for an empty and for a whitespace-only input', async () => {
    await openManual()
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
    const input = screen.getByLabelText('Paste your payment preimage (optional)')

    expect(confirm.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '   \t  ' } })
    expect(confirm.disabled).toBe(true)

    fireEvent.change(input, { target: { value: PREIMAGE } })
    expect(confirm.disabled).toBe(false)
  })

  it('Confirm is disabled while the confirm call is in flight', async () => {
    await openManual()
    mocks.confirmRemoteOrder.mockReturnValue(new Promise(() => {}))
    fireEvent.change(screen.getByLabelText('Paste your payment preimage (optional)'), { target: { value: PREIMAGE } })
    const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement

    fireEvent.click(confirm)
    await act(async () => {})

    expect(confirm.disabled).toBe(true)
    expect(mocks.confirmRemoteOrder).toHaveBeenCalledTimes(1)
  })

  it('a confirm answered with INVOICED keeps the manual view and clears the input', async () => {
    await openManual()
    mocks.confirmRemoteOrder.mockResolvedValue({ order: makeOrder({ status: 'INVOICED' }) })
    const input = screen.getByLabelText('Paste your payment preimage (optional)') as HTMLInputElement
    fireEvent.change(input, { target: { value: PREIMAGE } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await act(async () => {})

    expect(screen.getByText('Pay this invoice with any Lightning wallet.')).toBeInTheDocument()
    expect(screen.queryByText('Payment sent')).toBeNull()
    expect(input.value).toBe('')
  })

  it('a rejected confirm shows the mapped server message in an alert', async () => {
    await openManual()
    mocks.confirmRemoteOrder.mockRejectedValue(
      new ApiError(400, 'PREIMAGE_MISMATCH', {
        error: 'PREIMAGE_MISMATCH',
        code: 'PREIMAGE_MISMATCH',
        message: 'The preimage does not match this invoice.',
      }),
    )
    fireEvent.change(screen.getByLabelText('Paste your payment preimage (optional)'), { target: { value: PREIMAGE } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The preimage does not match this invoice.')
    expect(screen.queryByText(/PREIMAGE_MISMATCH/)).toBeNull()
  })
})

describe('RemotePayPanel: payee and amount rendering', () => {
  it('a payee without a name renders the seller line without a double space', () => {
    setPayee({ payee: makePayee({ name: undefined }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(screen.getByText('You pay the seller at alice@example.com.')).toBeInTheDocument()
  })

  it('an empty-string name is treated like a missing name', () => {
    setPayee({ payee: makePayee({ name: '' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(screen.getByText('You pay the seller at alice@example.com.')).toBeInTheDocument()
  })

  it('large amounts go through the provided formatNumber on the button, price and success card', async () => {
    const fmt = vi.fn((n: number) => `fmt(${n})`)
    setPayee({ quote: makeQuote({ amountSats: 12_345_678 }) })
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'paid',
      order: makeOrder({ status: 'PAID', amountSats: 12_345_678 }),
    })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={fmt} />)

    expect(payButton().textContent).toBe('Pay fmt(12345678) sats')
    expect(screen.getByText('fmt(12345678) sats')).toBeInTheDocument()

    fireEvent.click(payButton())
    expect(await screen.findByText(/You paid fmt\(12345678\) sats to/)).toBeInTheDocument()
    expect(fmt).toHaveBeenCalledWith(12_345_678)
  })
})

describe('RemotePayPanel: origin link safety after payment', () => {
  it.each([
    ['javascript URL', 'javascript:alert(1)'],
    ['data URL', 'data:text/html,<script>alert(1)</script>'],
    ['ftp URL', 'ftp://files.example/listing'],
    ['empty string', ''],
    ['relative path', '/listings/187'],
    ['malformed absolute URL', 'https://'],
  ])('%s never produces a listing link', async (_label, originUrl) => {
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: makeOrder({ status: 'PAID' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} originUrl={originUrl} />)
    fireEvent.click(payButton())

    await screen.findByText('Payment sent')
    expect(screen.queryByRole('link', { name: 'Open the listing page' })).toBeNull()
  })

  it.each([
    ['https', 'https://mercasats.example/p/187'],
    ['http', 'http://mercasats.example/p/187'],
  ])('%s origin produces a listing link opening in a new tab', async (_label, originUrl) => {
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: makeOrder({ status: 'PAID' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} originUrl={originUrl} />)
    fireEvent.click(payButton())

    const link = (await screen.findByRole('link', { name: 'Open the listing page' })) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(originUrl)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
})

describe('RemotePayPanel: copy invoice', () => {
  it('copies the bolt11 string to the clipboard and shows Copied', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await openManual()

    fireEvent.click(screen.getByRole('button', { name: 'Copy invoice' }))
    await act(async () => {})

    expect(writeText).toHaveBeenCalledWith(BOLT11)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('a clipboard rejection does not crash and leaves the button label unchanged', async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await openManual()

    fireEvent.click(screen.getByRole('button', { name: 'Copy invoice' }))
    await act(async () => {})

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Copy invoice' })).toBeInTheDocument()
    expect(screen.getByText('Pay this invoice with any Lightning wallet.')).toBeInTheDocument()
  })

  it('a missing clipboard API does not crash the invoice view', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await openManual()

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Copy invoice' }))).not.toThrow()
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Copy invoice' })).toBeInTheDocument()
  })
})
