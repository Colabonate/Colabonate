// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DetailPriceHero } from './DetailPriceHero'

vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => ({
    currency: 'EUR',
    rateStale: false,
    hasRate: false,
    satsToFiat: () => null,
    fiatToSats: () => null,
    formatFiat: (value: number) => `€${value.toFixed(2)}`,
  }),
}))

describe('DetailPriceHero — foreign price', () => {
  it('shows the currency, the sat estimate and the estimate-only disclaimer', () => {
    render(
      <DetailPriceHero
        sats={0}
        foreignPrice={{ amount: '2', currency: 'eur' }}
        estimateLabel="≈ 2,500 sats"
      />,
    )
    expect(screen.getByText('EUR')).toBeInTheDocument()
    expect(screen.getByText('≈ 2,500 sats')).toBeInTheDocument()
    expect(screen.getByText('Estimate only. The merchant sets the final price.')).toBeInTheDocument()
    expect(screen.queryByText(/not yet purchasable/)).not.toBeInTheDocument()
  })

  it('uses a custom estimate note when given (payable remote listing)', () => {
    render(
      <DetailPriceHero
        sats={0}
        foreignPrice={{ amount: '2', currency: 'eur' }}
        estimateLabel="≈ 2,500 sats"
        estimateNote="Estimate only. The amount you pay is fixed and shown before you pay."
      />,
    )
    expect(screen.getByText('Estimate only. The amount you pay is fixed and shown before you pay.')).toBeInTheDocument()
    expect(screen.queryByText(/merchant sets the final price/)).not.toBeInTheDocument()
  })

  it('shows "No sat estimate available" when no estimate label is given', () => {
    render(<DetailPriceHero sats={0} foreignPrice={{ amount: '2', currency: 'eur' }} />)
    expect(screen.getByText('No sat estimate available')).toBeInTheDocument()
  })
})

describe('DetailPriceHero — price on request', () => {
  it('shows "Price on request" and the explanatory caption, never a number', () => {
    render(<DetailPriceHero sats={0} priceOnRequest />)
    expect(screen.getByText('Price on request')).toBeInTheDocument()
    expect(screen.getByText('The merchant has not published a price')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('takes precedence over foreignPrice', () => {
    render(
      <DetailPriceHero
        sats={0}
        priceOnRequest
        foreignPrice={{ amount: '2', currency: 'eur' }}
        estimateLabel="≈ 2,500 sats"
      />,
    )
    expect(screen.getByText('Price on request')).toBeInTheDocument()
    expect(screen.queryByText('EUR')).not.toBeInTheDocument()
    expect(screen.queryByText('≈ 2,500 sats')).not.toBeInTheDocument()
  })
})
