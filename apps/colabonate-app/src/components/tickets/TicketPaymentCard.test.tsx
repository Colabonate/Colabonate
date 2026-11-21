// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Ticket } from '../../types/api'

const apiCall = vi.fn()
vi.mock('../../lib/api', () => {
  class ApiError extends Error {
    status: number
    data?: unknown
    constructor(status: number, message: string, data?: unknown) {
      super(message)
      this.status = status
      this.data = data
    }
  }
  return { apiCall: (...a: unknown[]) => apiCall(...a), ApiError }
})

const payInvoice = vi.fn()
const pollUntilPaid = vi.fn()
vi.mock('../../hooks/usePayment', () => ({
  usePayment: () => ({ payInvoice, pollUntilPaid, wallet: null }),
}))
vi.mock('../../hooks/useBetaMode', () => ({ useBetaMode: () => ({ isBeta: false }) }))
const showSnackbar = vi.fn()
vi.mock('../../context/NotificationContext', () => ({ useNotification: () => ({ showSnackbar }) }))
vi.mock('../../lib/nostr-ticket', () => ({ signAndPublishFromTemplate: vi.fn().mockResolvedValue(null) }))
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg data-testid="qr" /> }))
vi.mock('@col/cashu', () => ({
  decodeToken: () => ({ mintUrl: 'https://mint.minibits.cash/Bitcoin', proofs: [{ amount: 16 }, { amount: 8 }] }),
}))

const cashu = {
  enabled: true,
  status: 'ready',
  walletPubkey: 'wallet-pub',
  state: { buckets: [] as Array<{ mintUrl: string; proofs: Array<{ amount: number }> }> },
  sendP2PKForCheckout: vi.fn(),
  receiveLockedToken: vi.fn(),
  requestMeltQuote: vi.fn(),
  confirmMelt: vi.fn(),
}
vi.mock('../../contexts/CashuContext', () => ({ useCashu: () => cashu }))

// Node's own (flagless) localStorage global shadows jsdom's here, so use a plain map.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
})

const { TicketPaymentCard } = await import('./TicketPaymentCard')

function json(data: unknown) {
  return { ok: true, json: async () => data }
}

function makeTicket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    status: 'PENDING',
    amountSats: 21,
    buyerPubkey: 'buyer',
    sellerPubkey: 'seller',
    offer: { priceSats: 21 },
    ...over,
  } as unknown as Ticket
}

function renderCard(ticket: Ticket, role: 'buyer' | 'seller' = 'buyer') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TicketPaymentCard ticket={ticket} isBuyer={role === 'buyer'} isSeller={role === 'seller'} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  cashu.state.buckets = []
  cashu.enabled = true
  cashu.walletPubkey = 'wallet-pub'
  apiCall.mockImplementation(async (url: string) =>
    url.endsWith('/payment-status') ? json({ paid: false }) : json({ success: true }),
  )
})

describe('TicketPaymentCard: Lightning', () => {
  const ln = makeTicket({
    directPayRail: 'LN',
    lightningInvoice: 'lnbc210n1seller',
    paymentHash: 'hash',
    sellerInvoiceSource: 'LNURL',
    sellerVerifyUrl: 'https://wallet.example/verify',
  })

  it('shows the invoice, wallet pay and the automatic-detection hint for the buyer', () => {
    renderCard(ln)
    expect(screen.getByTestId('qr')).toBeInTheDocument()
    expect(screen.getByText('Awaiting payment')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay with wallet' })).toBeInTheDocument()
    expect(screen.getByText(/updates automatically once the payment settles/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter payment preimage manually' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay with eCash balance' })).not.toBeInTheDocument()
  })

  it('shows the preimage form directly when the server cannot detect the payment', () => {
    renderCard(makeTicket({ directPayRail: 'LN', lightningInvoice: 'lnbc1', paymentHash: 'hash', sellerInvoiceSource: 'LNURL' }))
    expect(screen.getByPlaceholderText('Payment preimage (hex)')).toBeVisible()
    expect(screen.getByText(/paste the payment preimage/)).toBeInTheDocument()
  })

  it('offers eCash melt when a mint holds enough balance, and confirms with the melt preimage', async () => {
    cashu.state.buckets = [{ mintUrl: 'https://mint.example', proofs: [{ amount: 64 }] }]
    cashu.requestMeltQuote.mockResolvedValue({ quote: 'q', bolt11: 'lnbc210n1seller', mintUrl: 'https://mint.example', amountSats: 21, feeReserveSats: 2, requiredSats: 23 })
    cashu.confirmMelt.mockResolvedValue({ paidSats: 21, preimage: 'aa'.repeat(32) })
    const user = userEvent.setup()
    renderCard(ln)
    await user.click(screen.getByRole('button', { name: 'Pay with eCash balance' }))
    await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/api/tickets/t1/confirm-direct-payment', expect.objectContaining({ method: 'POST' })))
    expect(await screen.findByText('Payment received')).toBeInTheDocument()
  })

  it('shows no pay actions to the seller', () => {
    renderCard(ln, 'seller')
    expect(screen.queryByRole('button', { name: 'Pay with wallet' })).not.toBeInTheDocument()
    expect(screen.getByText(/confirmed automatically as soon as your wallet receives it/)).toBeInTheDocument()
  })

  it('shows the paid state once the ticket moved on', () => {
    renderCard({ ...ln, status: 'PAID' })
    expect(screen.getByText('Payment received')).toBeInTheDocument()
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument()
  })

  // ADR-372 D7.3: price + fee. The seller leg is settled, the platform fee is
  // still open — the ticket status alone would say "awaiting payment" and
  // would let the buyer pay the settled seller invoice a second time.
  const feePending = makeTicket({
    directPayRail: 'LN',
    lightningInvoice: 'lnbc210n1seller',
    paymentHash: 'hash',
    sellerInvoiceSource: 'LNURL',
    sellerVerifyUrl: 'https://wallet.example/verify',
    preimage: 'aa'.repeat(32),
    platformFee: {
      id: 'fee-1',
      amountSats: 2600,
      feeBps: 500,
      rail: 'LN',
      status: 'PENDING',
      sellerLegConfirmedAt: '2026-10-30T19:45:08.397Z',
    },
  })

  it('shows a confirmed price as fee-pending and never offers a second payment on the settled invoice', () => {
    renderCard(feePending)
    expect(screen.getByText('Paid — fee pending')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting payment')).not.toBeInTheDocument()
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pay with wallet' })).not.toBeInTheDocument()
    expect(screen.getByText(/service fee is still open/)).toBeInTheDocument()
    expect(screen.getByText(/service fee below/)).toBeInTheDocument()
  })

  it('tells the seller the price arrived and only the platform fee is open', () => {
    renderCard(feePending, 'seller')
    expect(screen.getByText(/Price received/)).toBeInTheDocument()
    expect(screen.queryByText(/Waiting for the buyer/)).not.toBeInTheDocument()
  })
})

describe('TicketPaymentCard: Cashu', () => {
  const cashuTicket = makeTicket({ directPayRail: 'CASHU', cashuSellerPubkey: 'seller-wallet', cashuMintUrl: 'https://mint.minibits.cash/Bitcoin' })

  it('creates the token, stores it until delivered, and delivers it to the ticket', async () => {
    cashu.sendP2PKForCheckout.mockResolvedValue('cashuBtoken')
    const user = userEvent.setup()
    renderCard(cashuTicket)
    await user.click(screen.getByRole('button', { name: /Pay 21 sats with Cashu/ }))
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/tickets/t1/cashu-token', { method: 'POST', body: JSON.stringify({ token: 'cashuBtoken' }) }),
    )
    expect(cashu.sendP2PKForCheckout).toHaveBeenCalledWith('seller-wallet', 'https://mint.minibits.cash/Bitcoin', 21)
    expect(localStorage.getItem('ticket_cashu_pending_t1')).toBeNull()
  })

  it('never pays twice when the ticket already has a delivered token', async () => {
    apiCall.mockImplementation(async (url: string) =>
      url === '/api/tickets/t1' ? json({ ticket: { cashuTokenSentAt: '2026-09-25T10:00:00Z' } }) : json({ paid: false }),
    )
    const user = userEvent.setup()
    renderCard(cashuTicket)
    await user.click(screen.getByRole('button', { name: /Pay 21 sats with Cashu/ }))
    await waitFor(() => expect(apiCall).toHaveBeenCalledWith('/api/tickets/t1'))
    expect(cashu.sendP2PKForCheckout).not.toHaveBeenCalled()
  })

  it('offers redelivery instead of a second payment after a reload', () => {
    localStorage.setItem('ticket_cashu_pending_t1', 'cashuBpending')
    renderCard(cashuTicket)
    expect(screen.getByRole('button', { name: 'Deliver token to seller' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /with Cashu/ })).not.toBeInTheDocument()
  })

  it('shows a delivered token as sent to the buyer', () => {
    renderCard({ ...cashuTicket, cashuTokenSentAt: '2026-09-25T10:00:00Z' })
    expect(screen.getByText('Token sent')).toBeInTheDocument()
    expect(screen.getByText(/was delivered to the seller/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /with Cashu/ })).not.toBeInTheDocument()
  })

  it('lets the seller redeem the token and confirms the ticket', async () => {
    cashu.receiveLockedToken.mockResolvedValue(24)
    const user = userEvent.setup()
    renderCard({ ...cashuTicket, cashuTokenSentAt: '2026-09-25T10:00:00Z', cashuToken: 'cashuBtoken' }, 'seller')
    expect(screen.getByText(/sent a 24-sat token/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Redeem & confirm' }))
    await waitFor(() => expect(cashu.receiveLockedToken).toHaveBeenCalledWith('cashuBtoken'))
    await waitFor(() =>
      expect(apiCall).toHaveBeenCalledWith('/api/tickets/t1', { method: 'PATCH', body: JSON.stringify({ status: 'PAID' }) }),
    )
  })

  it('asks the buyer to enable eCash when the wallet is off', () => {
    cashu.enabled = false
    renderCard(cashuTicket)
    expect(screen.getByRole('button', { name: /Pay 21 sats with Cashu/ })).toBeDisabled()
    expect(screen.getByText(/Enable the eCash wallet/)).toBeInTheDocument()
  })
})

describe('TicketPaymentCard: demo and legacy', () => {
  it('offers the demo wallet on DEMO tickets', () => {
    renderCard(makeTicket({ directPayRail: 'DEMO', paymentHash: 'hash' }))
    expect(screen.getByRole('button', { name: 'Pay with demo wallet' })).toBeInTheDocument()
  })

  it('renders nothing for a ticket without any payment', () => {
    const { container } = renderCard(makeTicket())
    expect(container).toBeEmptyDOMElement()
  })
})
