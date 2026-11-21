// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SatsAmount } from './SatsAmount'

const mockUseCurrency = vi.fn()
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => mockUseCurrency(),
}))

function withRate() {
  mockUseCurrency.mockReturnValue({
    currency: 'EUR',
    rateStale: false,
    hasRate: true,
    satsToFiat: (sats: number) => sats * 0.0004,
    fiatToSats: (fiat: number) => Math.round(fiat / 0.0004),
    formatFiat: (value: number) => `€${value.toFixed(2)}`,
  })
}

function withoutRate() {
  mockUseCurrency.mockReturnValue({
    currency: 'EUR',
    rateStale: false,
    hasRate: false,
    satsToFiat: () => null,
    fiatToSats: () => null,
    formatFiat: (value: number) => `€${value.toFixed(2)}`,
  })
}

describe('SatsAmount', () => {
  it('renders the sats value with the "sats" unit label by default', () => {
    withRate()
    render(<SatsAmount sats={500} />)
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByText('sats')).toBeInTheDocument()
  })

  it('hides the unit label when showUnit=false', () => {
    withRate()
    render(<SatsAmount sats={500} showUnit={false} />)
    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.queryByText('sats')).not.toBeInTheDocument()
  })

  it('renders the fiat hint when a rate is available (ADR-235 D5)', () => {
    withRate()
    render(<SatsAmount sats={500} />)
    expect(screen.getByText('€0.20')).toBeInTheDocument()
  })

  it('fails open — renders sats only, no fiat hint, when no rate is available', () => {
    withoutRate()
    render(<SatsAmount sats={500} />)
    expect(screen.getByText('500')).toBeInTheDocument()
    // ADR-235 D5: never a misleading zero — the fiat span must not render at all.
    expect(screen.queryByText(/€/)).not.toBeInTheDocument()
  })
})
