// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import type { Offer } from '../../types/api'
import type { RateMapLike } from '../../lib/remote-price'
import { RemoteOfferPanel } from './RemoteOfferPanel'

const payeeState = vi.hoisted(() => ({
  current: { data: undefined as unknown, isLoading: false } as { data: unknown; isLoading: boolean },
}))
const payPanelCalls = vi.hoisted(() => ({
  calls: [] as Array<{ offerId: string; formatNumber: (n: number) => string }>,
}))

vi.mock('../../hooks/useRemoteOrders', () => ({
  useRemotePayee: () => payeeState.current,
}))

vi.mock('./RemotePayPanel', async () => {
  const React = await import('react')
  return {
    RemotePayPanel: (props: { offerId: string; formatNumber: (n: number) => string }) => {
      payPanelCalls.calls.push(props)
      return React.createElement('div', { 'data-testid': 'remote-pay-panel-stub' })
    },
  }
})

const formatNumber = (n: number) => String(n)
const rates: RateMapLike = { eur: { price: 80000 } }
const VALID_PUBKEY = '0000000287d80000b421da1ef9556a969689c1c21d45582b6184cc5162799156'
const ORIGIN = 'https://mercasats.kilombino.com/?p=187'
const ZAP_OUT_INTRO =
  'This listing was published on another Nostr marketplace and cannot be added to the Colabonate cart. Payment goes directly to the seller; Colabonate does not hold funds or provide buyer protection for it.'

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'offer-1',
    title: 'Remote listing',
    description: 'A listing mirrored from another marketplace',
    priceSats: 0,
    creatorPubkey: VALID_PUBKEY,
    category: 'Product',
    categoryCode: 'products/other',
    createdAt: '2026-11-01T00:00:00.000Z',
    source: 'REMOTE',
    ...overrides,
  } as Offer
}

function expectNoBuyCopy(container: HTMLElement) {
  const text = container.textContent ?? ''
  expect(text).not.toMatch(/\bbuy\b/i)
  expect(text).not.toMatch(/add to cart/i)
}

function anchors(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll('a'))
}

beforeEach(() => {
  payeeState.current = { data: undefined, isLoading: false }
  payPanelCalls.calls = []
})

describe('RemoteOfferPanel', () => {
  it('shows the origin-link path with a hardened external link and the hostname', () => {
    const { container, getByRole, getByText } = render(
      <RemoteOfferPanel offer={makeOffer({ originUrl: ORIGIN })} rates={rates} formatNumber={formatNumber} />,
    )
    const panel = container.querySelector('[data-testid="remote-offer-panel"]')
    expect(panel?.getAttribute('data-purchase-path')).toBe('origin-link')

    const link = getByRole('link', { name: 'Order at merchant site' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(ORIGIN)
    expect(link.getAttribute('target')).toBe('_blank')
    const rel = link.getAttribute('rel') ?? ''
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')

    expect(getByText(/mercasats\.kilombino\.com/)).toBeInTheDocument()
    expectNoBuyCopy(container)
  })

  it('refuses a javascript: origin URL and renders no javascript: anchor', () => {
    const { container } = render(
      <RemoteOfferPanel
        offer={makeOffer({ originUrl: 'javascript:alert(1)', remoteDTag: 'mercasats-187' })}
        rates={rates}
        formatNumber={formatNumber}
      />,
    )
    const panel = container.querySelector('[data-testid="remote-offer-panel"]')
    expect(panel?.getAttribute('data-purchase-path')).toBe('open-in-client')
    for (const a of anchors(container)) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
    }
    expectNoBuyCopy(container)
  })

  it('offers nostr and njump links in open-in-client when the identifier is present', () => {
    const { getByRole } = render(
      <RemoteOfferPanel offer={makeOffer({ remoteDTag: 'mercasats-187' })} rates={rates} formatNumber={formatNumber} />,
    )
    const nostr = getByRole('link', { name: 'Open in your Nostr app' }) as HTMLAnchorElement
    const njump = getByRole('link', { name: 'Open on njump.me' }) as HTMLAnchorElement
    expect(nostr.getAttribute('href')?.startsWith('nostr:naddr1')).toBe(true)
    expect(njump.getAttribute('href')?.startsWith('https://njump.me/naddr1')).toBe(true)
  })

  it('shows the missing-identifier paragraph and no links when remoteDTag is absent', () => {
    const { container, getByText } = render(
      <RemoteOfferPanel offer={makeOffer()} rates={rates} formatNumber={formatNumber} />,
    )
    expect(getByText(/its identifier is missing/)).toBeInTheDocument()
    expect(anchors(container)).toHaveLength(0)
    expectNoBuyCopy(container)
  })

  it('explains that an XMR price cannot be paid over Lightning', () => {
    const { container, getByText } = render(
      <RemoteOfferPanel
        offer={makeOffer({ priceCurrency: 'XMR', priceAmount: '1' })}
        rates={rates}
        formatNumber={formatNumber}
      />,
    )
    expect(getByText(/which cannot be paid over Lightning here/)).toBeInTheDocument()
    expectNoBuyCopy(container)
  })

  it('shows the estimate disclaimer for a EUR price with a rate', () => {
    const { container, getByText } = render(
      <RemoteOfferPanel
        offer={makeOffer({ priceCurrency: 'EUR', priceAmount: '2' })}
        rates={rates}
        formatNumber={formatNumber}
      />,
    )
    expect(getByText('Estimate only. The merchant sets the final price.')).toBeInTheDocument()
    expectNoBuyCopy(container)
  })

  it('shows the sat price for a sats-priced remote offer', () => {
    const { container, getByText, queryByText } = render(
      <RemoteOfferPanel offer={makeOffer({ priceSats: 21000 })} rates={rates} formatNumber={formatNumber} />,
    )
    expect(getByText('21000 sats')).toBeInTheDocument()
    expect(queryByText('Price on request')).toBeNull()
    expectNoBuyCopy(container)
  })

  describe('zap-out (orderable payee)', () => {
    const orderablePayee = {
      orderable: true,
      payee: { pubkey: VALID_PUBKEY },
      quote: {},
    }

    it('renders the pay panel before the card, with the offer id and formatter', () => {
      payeeState.current = { data: orderablePayee, isLoading: false }
      const { container } = render(
        <RemoteOfferPanel offer={makeOffer({ originUrl: ORIGIN })} rates={rates} formatNumber={formatNumber} />,
      )
      const stub = container.querySelector('[data-testid="remote-pay-panel-stub"]') as HTMLElement
      const card = container.querySelector('[data-testid="remote-offer-panel"]') as HTMLElement
      expect(stub).not.toBeNull()
      expect(card).not.toBeNull()
      expect(stub.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      expect(payPanelCalls.calls).toHaveLength(1)
      expect(payPanelCalls.calls[0].offerId).toBe('offer-1')
      expect(payPanelCalls.calls[0].formatNumber).toBe(formatNumber)
    })

    it('marks the card as zap-out with the about heading and the new intro text', () => {
      payeeState.current = { data: orderablePayee, isLoading: false }
      const { container, getByRole, getByText } = render(
        <RemoteOfferPanel offer={makeOffer({ originUrl: ORIGIN })} rates={rates} formatNumber={formatNumber} />,
      )
      const card = container.querySelector('[data-testid="remote-offer-panel"]')
      expect(card?.getAttribute('data-purchase-path')).toBe('zap-out')
      expect(getByRole('heading', { name: 'About this purchase' })).toBeInTheDocument()
      expect(getByText(ZAP_OUT_INTRO)).toBeInTheDocument()
      expect(getByText('You can also contact the merchant directly:')).toBeInTheDocument()
    })

    it('shows the origin link from the fallback path when originUrl is set', () => {
      payeeState.current = { data: orderablePayee, isLoading: false }
      const { getByRole } = render(
        <RemoteOfferPanel offer={makeOffer({ originUrl: ORIGIN })} rates={rates} formatNumber={formatNumber} />,
      )
      const link = getByRole('link', { name: 'Order at merchant site' }) as HTMLAnchorElement
      expect(link.getAttribute('href')).toBe(ORIGIN)
      expect(link.getAttribute('target')).toBe('_blank')
      const rel = link.getAttribute('rel') ?? ''
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
    })

    it('shows the nostr and njump links from the fallback path when there is no origin link', () => {
      payeeState.current = { data: orderablePayee, isLoading: false }
      const { container, getByRole } = render(
        <RemoteOfferPanel offer={makeOffer({ remoteDTag: 'mercasats-187' })} rates={rates} formatNumber={formatNumber} />,
      )
      const card = container.querySelector('[data-testid="remote-offer-panel"]')
      expect(card?.getAttribute('data-purchase-path')).toBe('zap-out')
      expect(getByRole('link', { name: 'Open in your Nostr app' }).getAttribute('href')?.startsWith('nostr:naddr1')).toBe(true)
      expect(getByRole('link', { name: 'Open on njump.me' }).getAttribute('href')?.startsWith('https://njump.me/naddr1')).toBe(true)
    })

    it('says the payable amount is fixed before paying, not that the merchant sets the final price', () => {
      payeeState.current = { data: orderablePayee, isLoading: false }
      const { queryByText, getByText } = render(
        <RemoteOfferPanel
          offer={makeOffer({ originUrl: ORIGIN, priceCurrency: 'EUR', priceAmount: '2' })}
          rates={rates}
          formatNumber={formatNumber}
        />,
      )
      expect(getByText('Estimate only. The amount you pay is fixed and shown before you pay.')).toBeInTheDocument()
      expect(queryByText(/merchant sets the final price/)).toBeNull()
    })

    it('never contains buy or checkout copy', () => {
      payeeState.current = { data: orderablePayee, isLoading: false }
      const { container } = render(
        <RemoteOfferPanel offer={makeOffer({ originUrl: ORIGIN })} rates={rates} formatNumber={formatNumber} />,
      )
      const text = container.textContent ?? ''
      expect(text).not.toMatch(/\bbuy\b|add to cart|checkout/i)
    })
  })

  describe('not orderable or no payee data', () => {
    it('renders no pay panel and the original texts when orderable is false', () => {
      payeeState.current = { data: { orderable: false, reason: 'NO_PAYEE' }, isLoading: false }
      const { container, getByRole, getByText, queryByText } = render(
        <RemoteOfferPanel offer={makeOffer({ originUrl: ORIGIN })} rates={rates} formatNumber={formatNumber} />,
      )
      expect(container.querySelector('[data-testid="remote-pay-panel-stub"]')).toBeNull()
      expect(payPanelCalls.calls).toHaveLength(0)
      const card = container.querySelector('[data-testid="remote-offer-panel"]')
      expect(card?.getAttribute('data-purchase-path')).toBe('origin-link')
      expect(getByRole('heading', { name: 'Order outside Colabonate' })).toBeInTheDocument()
      expect(getByText(/It cannot be added to the Colabonate cart, and Colabonate does not hold funds/)).toBeInTheDocument()
      expect(queryByText('You can also contact the merchant directly:')).toBeNull()
      expect(getByRole('link', { name: 'Order at merchant site' })).toBeInTheDocument()
      expectNoBuyCopy(container)
    })

    it('renders no pay panel when the payee query has no data', () => {
      payeeState.current = { data: undefined, isLoading: true }
      const { container, getByRole } = render(
        <RemoteOfferPanel offer={makeOffer({ remoteDTag: 'mercasats-187' })} rates={rates} formatNumber={formatNumber} />,
      )
      expect(container.querySelector('[data-testid="remote-pay-panel-stub"]')).toBeNull()
      expect(payPanelCalls.calls).toHaveLength(0)
      const card = container.querySelector('[data-testid="remote-offer-panel"]')
      expect(card?.getAttribute('data-purchase-path')).toBe('open-in-client')
      expect(getByRole('heading', { name: 'Order outside Colabonate' })).toBeInTheDocument()
    })
  })
})
