// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, screen, act } from '@testing-library/react'
import { RemoteDeliveryForm } from './RemoteDeliveryForm'
import type { DeliveryDeps } from '../../lib/remote-delivery'

const SELLER = 'b'.repeat(64)
const BUYER = 'c'.repeat(64)
const DETAILS = 'Jane Doe, Main Street 1, 10115 Berlin, jane@example.com'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../../lib/remote-delivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/remote-delivery')>()),
  sendDeliveryMessage: (...args: unknown[]) => mocks.send(...args),
}))
vi.mock('../../lib/remote-delivery-deps', () => ({ createDefaultDeliveryDeps: () => ({}) as DeliveryDeps }))

function renderForm() {
  return render(
    <RemoteDeliveryForm
      orderId="order-abcdef-1234"
      amountSats={3090}
      payeeLud16="seller@example.com"
      sellerPubkey={SELLER}
      listingAddress={`30402:${'a'.repeat(64)}:mercasats-187`}
      buyerPubkey={BUYER}
    />,
  )
}

const field = () => screen.getByLabelText('Delivery details for the seller') as HTMLTextAreaElement
const sendButton = () => screen.getByRole('button', { name: /Send privately|Sending/ }) as HTMLButtonElement
const copyButton = () => screen.getByRole('button', { name: /Copy message instead|Copied/ }) as HTMLButtonElement

beforeEach(() => {
  mocks.send.mockReset()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true })
})

describe('RemoteDeliveryForm (FU-1000)', () => {
  it('sends nothing on render and keeps both buttons disabled until the details are long enough', () => {
    renderForm()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(sendButton().disabled).toBe(true)
    expect(copyButton().disabled).toBe(true)
    fireEvent.change(field(), { target: { value: 'short' } })
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(field(), { target: { value: DETAILS } })
    expect(sendButton().disabled).toBe(false)
    expect(copyButton().disabled).toBe(false)
  })

  it('sends the message for this seller and shows the sent state with the relay count', async () => {
    mocks.send.mockResolvedValue({ kind: 'sent', relayCount: 2 })
    renderForm()
    fireEvent.change(field(), { target: { value: DETAILS } })
    fireEvent.click(sendButton())
    expect(await screen.findByText('Delivery details sent')).toBeInTheDocument()
    expect(screen.getByText(/2 relays/)).toBeInTheDocument()
    const input = mocks.send.mock.calls[0][1]
    expect(input).toMatchObject({
      orderId: 'order-abcdef-1234',
      amountSats: 3090,
      payeeLud16: 'seller@example.com',
      sellerPubkey: SELLER,
      buyerPubkey: BUYER,
      details: DETAILS,
    })
  })

  it('uses the singular for one relay', async () => {
    mocks.send.mockResolvedValue({ kind: 'sent', relayCount: 1 })
    renderForm()
    fireEvent.change(field(), { target: { value: DETAILS } })
    fireEvent.click(sendButton())
    expect(await screen.findByText(/1 relay of the seller/)).toBeInTheDocument()
  })

  it('does not send twice on a double click while sending', async () => {
    let resolve!: (v: unknown) => void
    mocks.send.mockImplementation(() => new Promise((r) => { resolve = r }))
    renderForm()
    fireEvent.change(field(), { target: { value: DETAILS } })
    fireEvent.click(sendButton())
    fireEvent.click(sendButton())
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(sendButton().disabled).toBe(true)
    await act(async () => resolve({ kind: 'sent', relayCount: 1 }))
  })

  it('tells the buyer when the seller has no inbox and keeps the copy route', async () => {
    mocks.send.mockResolvedValue({ kind: 'no-inbox' })
    renderForm()
    fireEvent.change(field(), { target: { value: DETAILS } })
    fireEvent.click(sendButton())
    expect(await screen.findByText(/has not published a Nostr inbox/)).toBeInTheDocument()
    expect(copyButton().disabled).toBe(false)
  })

  it('shows a retryable error on failure and allows sending again', async () => {
    mocks.send.mockResolvedValueOnce({ kind: 'failed', reason: 'error' })
    mocks.send.mockResolvedValueOnce({ kind: 'sent', relayCount: 1 })
    renderForm()
    fireEvent.change(field(), { target: { value: DETAILS } })
    fireEvent.click(sendButton())
    expect(await screen.findByText(/could not be sent/)).toBeInTheDocument()
    fireEvent.click(sendButton())
    expect(await screen.findByText('Delivery details sent')).toBeInTheDocument()
  })

  it('copies the full message (order, amount, listing, buyer, details) and nothing secret', async () => {
    renderForm()
    fireEvent.change(field(), { target: { value: DETAILS } })
    fireEvent.click(copyButton())
    await act(async () => {})
    const copied = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(copied).toContain('Order order-ab')
    expect(copied).toContain('3090 sats')
    expect(copied).toContain(BUYER)
    expect(copied).toContain(DETAILS)
    expect(copied.toLowerCase()).not.toContain('preimage')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('survives a clipboard failure', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    renderForm()
    fireEvent.change(field(), { target: { value: DETAILS } })
    fireEvent.click(copyButton())
    await act(async () => {})
    expect(copyButton().textContent).toBe('Copy message instead')
  })

  it('caps the input at 1000 characters', () => {
    renderForm()
    fireEvent.change(field(), { target: { value: 'x'.repeat(1500) } })
    expect(field().value.length).toBe(1000)
  })

  it('never uses buy or checkout wording', () => {
    const { container } = renderForm()
    expect(container.textContent ?? '').not.toMatch(/\bbuy\b|add to cart|checkout/i)
  })
})
