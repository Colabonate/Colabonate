// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import type { Offer } from '../../types/api'
import type { RateMapLike } from '../../lib/remote-price'
import { RemotePriceLabel, usesNonSatsPriceLabel } from './RemotePriceLabel'

const formatNumber = (n: number) => String(n)
const rates: RateMapLike = { eur: { price: 80000 } }

function priceOffer(overrides: Partial<Offer>): Pick<Offer, 'source' | 'priceSats' | 'priceAmount' | 'priceCurrency'> {
  return { source: 'REMOTE', priceSats: 0, priceAmount: null, priceCurrency: null, ...overrides }
}

function expectNoZeroSats(container: HTMLElement) {
  expect(container.textContent ?? '').not.toMatch(/\b0 sats\b/)
}

describe('usesNonSatsPriceLabel', () => {
  it('is true for a foreign currency price', () => {
    expect(usesNonSatsPriceLabel({ priceCurrency: 'EUR', priceSats: 0 } as Offer)).toBe(true)
  })

  it('is true for a REMOTE offer without a positive sat price', () => {
    expect(usesNonSatsPriceLabel({ source: 'REMOTE', priceSats: 0 } as Offer)).toBe(true)
  })

  it('is false for a LOCAL offer with zero sats and no currency', () => {
    expect(usesNonSatsPriceLabel({ source: 'LOCAL', priceSats: 0 } as Offer)).toBe(false)
  })

  it('is false for a REMOTE offer with a positive sat price', () => {
    expect(usesNonSatsPriceLabel({ source: 'REMOTE', priceSats: 1500 } as Offer)).toBe(false)
  })
})

describe('RemotePriceLabel', () => {
  it('renders the amount, currency and a sat estimate when a rate exists', () => {
    const { container, getByText } = render(
      <RemotePriceLabel
        offer={priceOffer({ priceAmount: '2', priceCurrency: 'EUR' })}
        rates={rates}
        formatNumber={formatNumber}
      />,
    )
    expect(getByText('2 EUR')).toBeInTheDocument()
    expect(getByText('≈ 2500 sats')).toBeInTheDocument()
    expectNoZeroSats(container)
  })

  it('renders only the foreign amount when no rate is available', () => {
    const { container, queryByText, getByText } = render(
      <RemotePriceLabel
        offer={priceOffer({ priceAmount: '2', priceCurrency: 'EUR' })}
        rates={{}}
        formatNumber={formatNumber}
      />,
    )
    expect(getByText('2 EUR')).toBeInTheDocument()
    expect(queryByText(/≈/)).toBeNull()
    expect(container.textContent).not.toContain('≈')
    expectNoZeroSats(container)
  })

  it('renders no estimate for XMR', () => {
    const { container, queryByText, getByText } = render(
      <RemotePriceLabel
        offer={priceOffer({ priceAmount: '1', priceCurrency: 'XMR' })}
        rates={rates}
        formatNumber={formatNumber}
      />,
    )
    expect(getByText('1 XMR')).toBeInTheDocument()
    expect(queryByText(/≈/)).toBeNull()
    expectNoZeroSats(container)
  })

  it('renders "Price on request" for a REMOTE offer with zero sats and no currency', () => {
    const { container, getByText } = render(
      <RemotePriceLabel offer={priceOffer({ source: 'REMOTE', priceSats: 0 })} rates={rates} formatNumber={formatNumber} />,
    )
    expect(getByText('Price on request')).toBeInTheDocument()
    expectNoZeroSats(container)
  })

  it('renders the sat amount for a sats-priced LOCAL offer', () => {
    const { container, getByText } = render(
      <RemotePriceLabel offer={priceOffer({ source: 'LOCAL', priceSats: 1500 })} rates={rates} formatNumber={formatNumber} />,
    )
    expect(getByText('1500 sats')).toBeInTheDocument()
    expectNoZeroSats(container)
  })
})
