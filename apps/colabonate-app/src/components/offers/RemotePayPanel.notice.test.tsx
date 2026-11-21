// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act, screen } from '@testing-library/react'
import type { RemoteOrderView, RemotePayee } from '../../lib/remote-orders-api'
import { RemotePayPanel } from './RemotePayPanel'

// ADR-417 / FU-1011: automatic order notice after a remote order is PAID.

const mocks = vi.hoisted(() => ({
  useRemotePayee: vi.fn(),
  runRemotePayment: vi.fn(),
  confirmRemoteOrder: vi.fn(),
  fetchRemoteOrder: vi.fn(),
  send: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}))
vi.mock('../../hooks/useRemoteOrders', () => ({ useRemotePayee: (...a: unknown[]) => mocks.useRemotePayee(...a) }))
vi.mock('../../contexts/CashuContext', () => ({ useCashuOptional: () => null }))
vi.mock('../../hooks/usePayment', () => ({ usePayment: () => ({ payInvoice: vi.fn(), isBeta: false }) }))
vi.mock('../../lib/remote-pay-flow', () => ({ runRemotePayment: (...a: unknown[]) => mocks.runRemotePayment(...a) }))
vi.mock('../../lib/remote-orders-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/remote-orders-api')>()),
  fetchRemoteOrder: (...a: unknown[]) => mocks.fetchRemoteOrder(...a),
  confirmRemoteOrder: (...a: unknown[]) => mocks.confirmRemoteOrder(...a),
}))
vi.mock('../../lib/auth-guard', () => ({ requireLogin: vi.fn() }))
vi.mock('../../lib/zap-request', () => ({ signZapRequest: vi.fn() }))
vi.mock('../../lib/remote-delivery-deps', () => ({ createDefaultDeliveryDeps: () => ({}) }))
vi.mock('../../lib/remote-order-notice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/remote-order-notice')>()),
  sendOrderNotice: (...a: unknown[]) => mocks.send(...a),
}))

const SELLER = '0000000287d80000b421da1ef9556a969689c1c21d45582b6184cc5162799156'
const BUYER = 'c'.repeat(64)
const LISTING = `30402:${'a'.repeat(64)}:mercasats-187`
const BOLT11 = 'lnbc42u1pnremotetestinvoice0000000000000000000000000000000000000000'
const PREIMAGE = 'a'.repeat(64)

function payee(over: Partial<RemotePayee> = {}): RemotePayee {
  return { pubkey: SELLER, role: 'seller', lud16: 'alice@example.com', zap: false, minSats: 1, maxSats: 1_000_000, ...over }
}
function order(over: Partial<RemoteOrderView> = {}): RemoteOrderView {
  return {
    id: 'order-abcdef-1234',
    offerId: 'offer-1',
    quantity: 1,
    status: 'PAID',
    payee: payee(),
    amountSats: 4200,
    quoteExpiresAt: '2026-11-12T10:10:00.000Z',
    createdAt: '2026-11-12T10:00:00.000Z',
    ...over,
  }
}
function setPayee(p: RemotePayee = payee()) {
  mocks.useRemotePayee.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { orderable: true, payee: p, quote: { amountSats: 4200, basis: 'sats', quantity: 1 } },
  })
}
function store() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size
    },
  }
}
const renderPanel = () => render(<RemotePayPanel offerId="offer-1" formatNumber={String} listingAddress={LISTING} />)
const payButton = () => screen.getByRole('button', { name: /^Pay / })
const optIn = () => screen.getByTestId('remote-notice-optin') as HTMLInputElement

beforeEach(() => {
  vi.stubGlobal('localStorage', store())
  localStorage.setItem('pubkey', BUYER)
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.send.mockResolvedValue({ kind: 'sent', relayCount: 2 })
  setPayee()
})

describe('RemotePayPanel order notice (FU-1011)', () => {
  it('sends exactly one notice to the named seller after a wallet payment and says so', async () => {
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: order() })
    renderPanel()
    expect(mocks.send).not.toHaveBeenCalled()
    fireEvent.click(payButton())
    expect(await screen.findByText(/The seller was sent an encrypted order notice/)).toBeInTheDocument()
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send.mock.calls[0]![1]).toEqual({
      orderId: 'order-abcdef-1234',
      amountSats: 4200,
      payeeLud16: 'alice@example.com',
      listingAddress: LISTING,
      buyerPubkey: BUYER,
      sellerPubkey: SELLER,
    })
    expect(localStorage.getItem('colabonate:remoteOrderNotice:sent:order-abcdef-1234')).toBe('1')
  })

  it('shows the opt-in checked and before paying, only for a named seller', () => {
    renderPanel()
    expect(optIn().checked).toBe(true)
    expect(screen.getByText(/send the seller an encrypted order notice/)).toBeInTheDocument()
  })

  it('shows no opt-in and sends nothing when the payee is only the author', async () => {
    setPayee(payee({ role: 'author' }))
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: order({ payee: payee({ role: 'author' }) }) })
    renderPanel()
    expect(screen.queryByTestId('remote-notice-optin')).toBeNull()
    fireEvent.click(payButton())
    await screen.findByText('Payment sent')
    await act(async () => {})
    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.queryByTestId('remote-notice-status')).toBeNull()
  })

  it('sends nothing when the buyer opted out, and offers a manual button instead', async () => {
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: order() })
    renderPanel()
    fireEvent.click(optIn())
    expect(optIn().checked).toBe(false)
    fireEvent.click(payButton())
    await screen.findByText('Payment sent')
    await act(async () => {})
    expect(mocks.send).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send order notice to the seller' }))
    expect(await screen.findByText(/The seller was sent an encrypted order notice/)).toBeInTheDocument()
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('honours the opt-out when the payment completes through the manual invoice view', async () => {
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: order({ status: 'INVOICED' }),
      bolt11: BOLT11,
      paymentHash: 'hash',
      reason: 'wallet-unavailable',
    })
    mocks.confirmRemoteOrder.mockResolvedValue({ order: order() })
    renderPanel()
    fireEvent.click(payButton())
    const input = await screen.findByLabelText('Paste your payment preimage (optional)')
    expect(optIn().checked).toBe(true)
    fireEvent.click(optIn())
    fireEvent.change(input, { target: { value: PREIMAGE } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Payment sent')
    await act(async () => {})
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('sends once when the manual view reaches PAID by pasted preimage', async () => {
    mocks.runRemotePayment.mockResolvedValue({
      kind: 'manual',
      order: order({ status: 'INVOICED' }),
      bolt11: BOLT11,
      paymentHash: 'hash',
      reason: 'wallet-unavailable',
    })
    mocks.confirmRemoteOrder.mockResolvedValue({ order: order() })
    renderPanel()
    fireEvent.click(payButton())
    fireEvent.change(await screen.findByLabelText('Paste your payment preimage (optional)'), { target: { value: PREIMAGE } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText(/The seller was sent an encrypted order notice/)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('does not send again when the order was already noticed in this browser', async () => {
    localStorage.setItem('colabonate:remoteOrderNotice:sent:order-abcdef-1234', '1')
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: order() })
    renderPanel()
    fireEvent.click(payButton())
    expect(await screen.findByText(/The seller was sent an encrypted order notice/)).toBeInTheDocument()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('says so when the seller has no inbox, and does not mark the order as sent', async () => {
    mocks.send.mockResolvedValue({ kind: 'no-inbox' })
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: order() })
    renderPanel()
    fireEvent.click(payButton())
    expect(await screen.findByText(/has not published a Nostr inbox/)).toBeInTheDocument()
    expect(localStorage.getItem('colabonate:remoteOrderNotice:sent:order-abcdef-1234')).toBeNull()
  })

  it('offers a retry after a failure and marks the order only after a successful retry', async () => {
    mocks.send.mockResolvedValueOnce({ kind: 'failed', reason: 'no-relay-accepted' }).mockResolvedValueOnce({ kind: 'sent', relayCount: 1 })
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: order() })
    renderPanel()
    fireEvent.click(payButton())
    expect(await screen.findByText('The order notice could not be sent.')).toBeInTheDocument()
    expect(localStorage.getItem('colabonate:remoteOrderNotice:sent:order-abcdef-1234')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send order notice again' }))
    expect(await screen.findByText(/The seller was sent an encrypted order notice/)).toBeInTheDocument()
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('colabonate:remoteOrderNotice:sent:order-abcdef-1234')).toBe('1')
  })

  it('treats a throwing send as a failure instead of crashing the paid card', async () => {
    mocks.send.mockRejectedValue(new Error('boom'))
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: order() })
    renderPanel()
    fireEvent.click(payButton())
    expect(await screen.findByText('The order notice could not be sent.')).toBeInTheDocument()
    expect(screen.getByText('Payment sent')).toBeInTheDocument()
  })

  it('never puts a payment secret or an escrow/buy wording into the notice status', async () => {
    const SECRET = 'd'.repeat(64)
    mocks.runRemotePayment.mockResolvedValue({ kind: 'paid', order: { ...order(), preimage: SECRET, bolt11: BOLT11 } })
    const { container } = renderPanel()
    fireEvent.click(payButton())
    await screen.findByText(/The seller was sent an encrypted order notice/)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/escrow|\bbuy\b|add to cart|checkout/i)
    const sent = JSON.stringify(mocks.send.mock.calls)
    expect(sent).not.toContain(SECRET)
    expect(sent).not.toContain(BOLT11)
  })
})
