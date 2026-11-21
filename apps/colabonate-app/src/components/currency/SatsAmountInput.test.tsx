// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SatsAmountInput, type SatsAmountInputProps } from './SatsAmountInput'

// SatsAmountInput is fully controlled — typing into it with a static
// valueSats prop (e.g. a bare vi.fn() as onChangeSats) leaves the DOM value
// out of sync with what the user actually typed, since React resets the
// input back to the unchanged prop on every keystroke. A stateful harness
// wires it up the way a real caller would.
function Harness(props: Omit<SatsAmountInputProps, 'valueSats' | 'onChangeSats'> & { initial: number | '' }) {
  const [valueSats, setValueSats] = useState<number | ''>(props.initial)
  return <SatsAmountInput valueSats={valueSats} onChangeSats={setValueSats} {...props} />
}

const mockUseCurrency = vi.fn()
vi.mock('../../contexts/CurrencyContext', () => ({
  useCurrency: () => mockUseCurrency(),
}))

function withRate() {
  mockUseCurrency.mockReturnValue({
    currency: 'EUR',
    rateStale: false,
    hasRate: true,
    satsToFiat: (sats: number) => Math.round(sats * 0.0004 * 100) / 100,
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

describe('SatsAmountInput', () => {
  it('labels the field with the sats unit and renders the current value', () => {
    withRate()
    render(<SatsAmountInput valueSats={1000} onChangeSats={() => {}} label="Price" />)
    // formatSatsNumber({compact:false}) delegates to toLocaleString('en-US').
    expect(screen.getByLabelText('Price (sats)')).toHaveValue('1,000')
  })

  it('reports only digits back through onChangeSats, ignoring non-numeric input', async () => {
    withRate()
    const user = userEvent.setup()
    render(<Harness label="Price" initial="" />)
    await user.type(screen.getByLabelText('Price (sats)'), '5a0b0')
    // The canonical value is always integer sats — 'a'/'b' never reach the field.
    expect(screen.getByLabelText('Price (sats)')).toHaveValue('500')
  })

  it('clears to the empty string when the field is emptied', async () => {
    withRate()
    const onChangeSats = vi.fn()
    const user = userEvent.setup()
    render(<SatsAmountInput valueSats={100} onChangeSats={onChangeSats} label="Price" />)
    await user.clear(screen.getByLabelText('Price (sats)'))
    expect(onChangeSats).toHaveBeenLastCalledWith('')
  })

  it('disables the sats/fiat toggle when no rate is available', () => {
    withoutRate()
    render(<SatsAmountInput valueSats={1000} onChangeSats={() => {}} label="Price" />)
    expect(screen.getByRole('button', { name: /switch to eur input/i })).toBeDisabled()
  })

  it('toggling to fiat mode converts the sats value into a fiat draft and relabels the field', async () => {
    withRate()
    const user = userEvent.setup()
    render(<SatsAmountInput valueSats={1000} onChangeSats={() => {}} label="Price" />)
    await user.click(screen.getByRole('button', { name: /switch to eur input/i }))
    expect(screen.getByLabelText('Price (EUR)')).toHaveValue('0.4')
  })

  it('converts a typed fiat amount back to integer sats via onChangeSats', async () => {
    withRate()
    const onChangeSats = vi.fn()
    const user = userEvent.setup()
    render(<SatsAmountInput valueSats={0} onChangeSats={onChangeSats} label="Price" defaultUnit="fiat" />)
    const field = screen.getByLabelText('Price (EUR)')
    await user.clear(field)
    await user.type(field, '1')
    // fiatToSats(1) = round(1 / 0.0004) = 2500, per the mocked conversion rate.
    expect(onChangeSats).toHaveBeenLastCalledWith(2500)
  })
})
