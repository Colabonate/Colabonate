// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, screen } from '@testing-library/react'
import { nip19 } from 'nostr-tools'
import type { RemoteOrderView, RemotePayee, RemoteQuote } from '../../lib/remote-orders-api'
import { RemotePayPanel } from './RemotePayPanel'

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
const OFFER_ID = 'offer-1'
const BOLT11 = 'lnbc42u1pnremotetestinvoice0000000000000000000000000000000000000000'
const PREIMAGE = 'a'.repeat(64)
const formatNumber = (n: number) => String(n)

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
    id: 'order-abcdef-1234',
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

function setPayee(data: { orderable?: boolean; payee?: RemotePayee; quote?: RemoteQuote } = {}) {
  mocks.useRemotePayee.mockReturnValue({
    isLoading: false,
    isError: false,
    data: {
      orderable: data.orderable ?? true,
      payee: 'payee' in data ? data.payee : makePayee(),
      quote: 'quote' in data ? data.quote : makeQuote(),
    },
  })
}

function setPayment(isBeta = false) {
  mocks.usePayment.mockReturnValue({ payInvoice: vi.fn(), isBeta })
}

function expectNoBuyCopy(container: HTMLElement) {
  expect(container.textContent ?? '').not.toMatch(/\bbuy\b|add to cart|checkout/i)
}

function payButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement
}

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
})

describe('RemotePayPanel', () => {
  it('shows a muted loading line while the payee is checked', () => {
    mocks.useRemotePayee.mockReturnValue({ isLoading: true, isError: false, data: undefined })
    const { container } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(container.textContent).toContain('Checking how this seller can be paid…')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing when the listing is not orderable', () => {
    setPayee({ orderable: false, payee: undefined, quote: undefined })
    const { container } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the payee query failed', () => {
    mocks.useRemotePayee.mockReturnValue({ isLoading: false, isError: true, data: undefined })
    const { container } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing without throwing when quote or payee is missing', () => {
    setPayee({ orderable: true, payee: makePayee(), quote: undefined })
    const { container } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the seller payee line with name and lud16', () => {
    setPayee()
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Pay the seller with Lightning' })).toBeInTheDocument()
    expect(screen.getByText('You pay the seller Alice Shop at alice@example.com.')).toBeInTheDocument()
  })

  it('shows the author payee line without naming a seller', () => {
    setPayee({ payee: makePayee({ role: 'author', name: undefined }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(
      screen.getByText('The seller is not named in this listing. You pay the publishing account at alice@example.com.'),
    ).toBeInTheDocument()
  })

  it('shows the amount and the sats basis line', () => {
    setPayee({ quote: makeQuote({ amountSats: 4200, basis: 'sats' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(screen.getByText('4200 sats')).toBeInTheDocument()
    expect(screen.getByText('Price as listed by the seller.')).toBeInTheDocument()
  })

  it('shows the exact-btc basis line', () => {
    setPayee({ quote: makeQuote({ basis: 'exact-btc' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(screen.getByText('Converted exactly from the BTC price.')).toBeInTheDocument()
  })

  it('shows the rate basis line with the fiat price and fixed-amount note', () => {
    setPayee({
      quote: makeQuote({ basis: 'rate', priceAmount: '10', priceCurrency: 'eur' }),
    })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(
      screen.getByText(
        "Estimate from the EUR price (10 EUR) at today's rate. The amount is fixed for 10 minutes after you continue.",
      ),
    ).toBeInTheDocument()
  })

  it('shows the stablecoin-as-usd basis line', () => {
    setPayee({
      quote: makeQuote({ basis: 'stablecoin-as-usd', priceAmount: '5', priceCurrency: 'usdt' }),
    })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(
      screen.getByText(
        "Estimate: USDT is treated as USD at today's rate. The amount is fixed for 10 minutes after you continue.",
      ),
    ).toBeInTheDocument()
  })

  it('shows exactly the four disclosure items when the payee is not a zap target', () => {
    setPayee({ payee: makePayee({ zap: false }) })
    const { container } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    const items = Array.from(container.querySelectorAll('ul li')).map((li) => li.textContent)
    expect(items).toEqual([
      'The seller is an independent third party, not Colabonate.',
      'Colabonate does not hold this payment and offers no buyer protection or dispute process for it.',
      'Delivery is arranged with the seller after you pay.',
      'A Lightning payment cannot be reversed.',
    ])
  })

  it('adds the zap disclosure only when the payee is a zap target', () => {
    setPayee({ payee: makePayee({ zap: true }) })
    const { container } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    const items = Array.from(container.querySelectorAll('ul li')).map((li) => li.textContent)
    expect(items).toHaveLength(5)
    expect(items[4]).toBe('Your payment is published on Nostr as a zap that references this listing.')
  })

  it('labels the button with the amount', () => {
    setPayee({ quote: makeQuote({ amountSats: 4200 }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(payButton().textContent).toBe('Pay 4200 sats')
    expect(payButton().disabled).toBe(false)
  })

  it('disables the button and shows the demo note in beta mode', () => {
    setPayee()
    setPayment(true)
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expect(payButton().disabled).toBe(true)
    expect(
      screen.getByText('Remote purchases need a real wallet and are not available in demo mode.'),
    ).toBeInTheDocument()
  })

  it('asks for login and does not pay when logged out', () => {
    localStorage.removeItem('pubkey')
    setPayee()
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    expect(mocks.requireLogin).toHaveBeenCalledWith(mocks.navigate, window.location.pathname)
    expect(mocks.runRemotePayment).not.toHaveBeenCalled()
  })

  it('runs the payment flow for the offer when logged in', async () => {
    setPayee()
    mocks.runRemotePayment.mockReturnValue(new Promise(() => {}))
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    expect(mocks.runRemotePayment).toHaveBeenCalledWith(expect.anything(), { offerId: OFFER_ID })
    expect(mocks.requireLogin).not.toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Paying…' })).toBeDisabled()
  })

  it('shows the success card with reference and hardened Nostr links', async () => {
    setPayee({ payee: makePayee({ zap: true }) })
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: makeOrder() })
    const { container } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())

    expect(await screen.findByText('Payment sent')).toBeInTheDocument()
    expect(
      screen.getByText('You paid 4200 sats to alice@example.com. Order reference: order-ab.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Contact the seller to arrange delivery. Colabonate does not hold or protect this payment.'),
    ).toBeInTheDocument()

    const npub = nip19.npubEncode(VALID_PUBKEY)
    const message = screen.getByRole('link', { name: 'Message the seller on Nostr' }) as HTMLAnchorElement
    const profile = screen.getByRole('link', { name: "Open the seller's profile" }) as HTMLAnchorElement
    expect(message.getAttribute('href')).toBe(`nostr:${npub}`)
    expect(npub.startsWith('npub1')).toBe(true)
    expect(profile.getAttribute('href')).toBe(`https://njump.me/${npub}`)
    for (const link of [message, profile]) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
    expectNoBuyCopy(container)
  })

  it('adds the listing page link and the delivery-address hint after payment', async () => {
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: makeOrder({ status: 'PAID' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} originUrl="https://mercasats.example/p/187" />)
    fireEvent.click(payButton())
    const link = (await screen.findByRole('link', { name: 'Open the listing page' })) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://mercasats.example/p/187')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByTestId('remote-delivery-form')).toBeInTheDocument()
    expect(screen.getByText(/does not carry your address/)).toBeInTheDocument()
  })

  it('never links a non-http origin after payment', async () => {
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: makeOrder({ status: 'PAID' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} originUrl="javascript:alert(1)" />)
    fireEvent.click(payButton())
    await screen.findByText('Payment sent')
    expect(screen.queryByRole('link', { name: 'Open the listing page' })).toBeNull()
  })

  it('shows the error message and resets to the pay button on Try again', async () => {
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({ kind: 'error', stage: 'invoice', message: 'The seller could not be reached.' })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())

    expect(await screen.findByText('The seller could not be reached.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('button', { name: 'Pay 4200 sats' })).toBeInTheDocument()
    expect(screen.queryByText('The seller could not be reached.')).toBeNull()
  })

  it('shows the manual invoice with QR, bolt11, copy button and waiting line', async () => {
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: makeOrder(),
      bolt11: BOLT11,
      paymentHash: 'hash',
      reason: 'wallet-unavailable',
    })
    const { container } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())

    expect(await screen.findByText('Pay this invoice with any Lightning wallet.')).toBeInTheDocument()
    expect(screen.getByTestId('remote-pay-qr').querySelector('svg')).not.toBeNull()
    expect(screen.getByText(BOLT11)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy invoice' })).toBeInTheDocument()
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument()
    expectNoBuyCopy(container)
  })

  it('shows the wallet failure detail above the QR', async () => {
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: makeOrder(),
      bolt11: BOLT11,
      paymentHash: 'hash',
      reason: 'wallet-failed',
      detail: 'Your wallet rejected the route.',
    })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    expect(await screen.findByText('Your wallet rejected the route.')).toBeInTheDocument()
  })

  it('switches to the success card when polling reports the order as PAID', async () => {
    vi.useFakeTimers()
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: makeOrder(),
      bolt11: BOLT11,
      paymentHash: 'hash',
      reason: 'no-preimage',
    })
    mocks.fetchRemoteOrder.mockResolvedValue({ order: makeOrder({ status: 'PAID' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(mocks.fetchRemoteOrder).toHaveBeenCalledWith('order-abcdef-1234')
    expect(screen.getByText('Payment sent')).toBeInTheDocument()
  })

  it('shows an expiry error when polling reports the order as EXPIRED', async () => {
    vi.useFakeTimers()
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: makeOrder(),
      bolt11: BOLT11,
      paymentHash: 'hash',
      reason: 'no-preimage',
    })
    mocks.fetchRemoteOrder.mockResolvedValue({ order: makeOrder({ status: 'EXPIRED' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(
      screen.getByText('This payment window has expired. Start again to get a new amount.'),
    ).toBeInTheDocument()
  })

  it('confirms a pasted preimage through confirmRemoteOrder', async () => {
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: makeOrder(),
      bolt11: BOLT11,
      paymentHash: 'hash',
      reason: 'wallet-unavailable',
    })
    mocks.confirmRemoteOrder.mockResolvedValue({ order: makeOrder({ status: 'INVOICED' }) })
    render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    fireEvent.click(payButton())
    const input = await screen.findByLabelText('Paste your payment preimage (optional)')
    fireEvent.change(input, { target: { value: `  ${PREIMAGE}  ` } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await act(async () => {})
    expect(mocks.confirmRemoteOrder).toHaveBeenCalledWith('order-abcdef-1234', PREIMAGE)
  })

  it('keeps the copy free of buy and checkout wording in every phase', async () => {
    setPayee()
    mocks.runRemotePayment.mockResolvedValue({ kind: 'error', stage: 'pay', message: 'Nope.' })
    const { container } = render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
    expectNoBuyCopy(container)
    fireEvent.click(payButton())
    expect(await screen.findByText('Nope.')).toBeInTheDocument()
    expectNoBuyCopy(container)
  })

  describe('eCash melt (FU-1002)', () => {
    function readyCashu(balance = 9000) {
      const api = {
        enabled: true,
        status: 'ready',
        state: { buckets: [{ mintUrl: 'https://mint.example', proofs: [{ amount: balance }] }] },
        requestMeltQuote: vi.fn(async (_b: string, mintUrl: string) => ({ requiredSats: 4300, mintUrl })),
        confirmMelt: vi.fn(async () => ({ paidSats: 4200, preimage: PREIMAGE })),
      }
      mocks.cashu.mockReturnValue(api)
      return api
    }

    async function openInvoice() {
      setPayee()
      mocks.runRemotePayment.mockResolvedValue({
        kind: 'manual',
        order: makeOrder(),
        bolt11: BOLT11,
        paymentHash: 'hash',
        reason: 'wallet-unavailable',
      })
      render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
      fireEvent.click(payButton())
      await screen.findByText('Pay this invoice with any Lightning wallet.')
    }

    it('offers no eCash button without a ready wallet', async () => {
      await openInvoice()
      expect(screen.queryByRole('button', { name: 'Pay with eCash balance' })).toBeNull()
    })

    it('offers no eCash button when no mint holds enough', async () => {
      readyCashu(100)
      await openInvoice()
      expect(screen.queryByRole('button', { name: 'Pay with eCash balance' })).toBeNull()
    })

    it('melts the invoice, confirms with the preimage and shows the success card', async () => {
      const api = readyCashu()
      mocks.confirmRemoteOrder.mockResolvedValue({ order: makeOrder({ status: 'PAID' }) })
      await openInvoice()
      fireEvent.click(screen.getByRole('button', { name: 'Pay with eCash balance' }))
      expect(await screen.findByText('Payment sent')).toBeInTheDocument()
      expect(api.requestMeltQuote).toHaveBeenCalledWith(BOLT11, 'https://mint.example')
      expect(mocks.confirmRemoteOrder).toHaveBeenCalledWith('order-abcdef-1234', PREIMAGE)
    })

    it('shows the error and keeps the invoice when the quote does not fit the balance', async () => {
      const api = readyCashu(4250)
      await openInvoice()
      fireEvent.click(screen.getByRole('button', { name: 'Pay with eCash balance' }))
      expect(await screen.findByText(/Not enough eCash at https:\/\/mint\.example/)).toBeInTheDocument()
      expect(api.confirmMelt).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Pay with eCash balance' })).toBeInTheDocument()
    })

    it('removes the eCash button after a melt without preimage so it cannot be paid twice', async () => {
      const api = readyCashu()
      api.confirmMelt.mockResolvedValue({ paidSats: 4200 } as never)
      await openInvoice()
      fireEvent.click(screen.getByRole('button', { name: 'Pay with eCash balance' }))
      expect(await screen.findByText('Paid with eCash. Waiting for the confirmation.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Pay with eCash balance' })).toBeNull()
      expect(mocks.confirmRemoteOrder).not.toHaveBeenCalled()
    })

    it('removes the button and waits for the provider when the confirm call fails after the melt', async () => {
      readyCashu()
      mocks.confirmRemoteOrder.mockRejectedValue(new Error('network'))
      await openInvoice()
      fireEvent.click(screen.getByRole('button', { name: 'Pay with eCash balance' }))
      expect(await screen.findByText('Paid with eCash. Waiting for the confirmation.')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Pay with eCash balance' })).toBeNull()
    })

    it('hides the eCash button in demo mode', async () => {
      readyCashu()
      setPayment(true)
      setPayee()
      mocks.runRemotePayment.mockResolvedValue({ kind: 'manual', order: makeOrder(), bolt11: BOLT11, paymentHash: 'h', reason: 'wallet-unavailable' })
      render(<RemotePayPanel offerId={OFFER_ID} formatNumber={formatNumber} />)
      // The pay button is disabled in demo mode, so the manual view is never reached.
      expect((screen.getByRole('button', { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
