/**
 * SatsAmountInput — dual-currency sats/fiat input (ADR-235 D6).
 *
 * Wraps the MUI `TextField` idiom with a unit toggle (sats ↔ user currency) and
 * a live conversion line under the field. The canonical value is ALWAYS integer
 * sats — form state, validation, and API payloads keep their existing
 * `priceSats`-style contracts; fiat entry is converted at the current rate on
 * input (`Math.round` to sats) and never leaves the component.
 *
 * When no rate is available the toggle is disabled (sats-only entry).
 */

import { useEffect, useState } from 'react'
import type { Ref } from 'react'
import { TextField, InputAdornment, IconButton, type TextFieldProps } from '@mui/material'
import { SwapVert } from '@mui/icons-material'
import { useCurrency } from '../../contexts/CurrencyContext'
import { formatFiat as formatFiatPure, formatSatsNumber } from '../../lib/currency'

export interface SatsAmountInputProps {
  /** Canonical value in integer sats (controlled). */
  valueSats: number | ''
  /** Called with the new integer sats value (or '' when the field is cleared). */
  onChangeSats: (sats: number | '') => void
  /**
   * Base label WITHOUT a unit (e.g. "Price", "Rate", "Budget"); the active
   * unit is always appended by the component — "Price (sats)" / "Price (EUR)".
   * Never bake a unit into this prop: it would lie in the other mode.
   */
  label?: string
  /** Default unit the field opens in (defaults to sats). */
  defaultUnit?: 'sats' | 'fiat'
  size?: TextFieldProps['size']
  fullWidth?: boolean
  error?: boolean
  helperText?: string
  disabled?: boolean
  required?: boolean
  id?: string
  /** Ref to the underlying input element (e.g. validation scroll/focus). */
  inputRef?: Ref<HTMLInputElement>
}

type Unit = 'sats' | 'fiat'

export function SatsAmountInput({
  valueSats,
  onChangeSats,
  label,
  defaultUnit = 'sats',
  size = 'medium',
  fullWidth = true,
  error = false,
  helperText,
  disabled = false,
  required = false,
  id,
  inputRef,
}: SatsAmountInputProps) {
  const { currency, hasRate, satsToFiat, fiatToSats } = useCurrency()
  const [unit, setUnit] = useState<Unit>(defaultUnit)
  const [fiatDraft, setFiatDraft] = useState<string>('')

  // When entering fiat mode (or rate arrives late), seed the draft from the
  // current sats value so the field does not start empty.
  useEffect(() => {
    if (unit === 'fiat' && hasRate && valueSats !== '' && valueSats > 0 && fiatDraft === '') {
      const fiat = satsToFiat(valueSats)
      if (fiat !== null) setFiatDraft(trimFiat(fiat))
    }
  }, [unit, hasRate, valueSats, fiatDraft, satsToFiat])

  function handleToggle() {
    if (!hasRate) return
    if (unit === 'sats') {
      // sats → fiat: seed the draft from the current value.
      const sats = typeof valueSats === 'number' ? valueSats : 0
      const fiat = satsToFiat(sats)
      setFiatDraft(fiat !== null ? trimFiat(fiat) : '')
      setUnit('fiat')
    } else {
      setUnit('sats')
    }
  }

  function handleSatsChange(raw: string) {
    const digits = raw.replace(/[^\d]/g, '')
    if (digits === '') {
      onChangeSats('')
      return
    }
    onChangeSats(parseInt(digits, 10))
  }

  function handleFiatChange(raw: string) {
    // Allow digits + a single decimal separator; the canonical value is sats.
    const normalized = raw.replace(',', '.').replace(/[^\d.]/g, '')
    setFiatDraft(normalized)
    if (normalized === '') {
      onChangeSats('')
      return
    }
    const fiat = parseFloat(normalized)
    const sats = fiatToSats(fiat)
    onChangeSats(sats ?? '')
  }

  // Empty-string label = caller renders its own field label outside (e.g. the
  // Sell detail pages); the MUI label then shows only the active unit.
  const baseLabel = label ?? 'Price'
  const unitText = unit === 'sats' ? 'sats' : currency
  const inputLabel = baseLabel ? `${baseLabel} (${unitText})` : unitText

  // Live conversion line under the field. Full digits, never compact — the
  // user is deciding an exact amount here (FormatSatsOptions.compact rule).
  // No `≈`/`=` prefix (global format decision 2026-07-13).
  let conversionLine = ''
  if (unit === 'sats') {
    if (hasRate && typeof valueSats === 'number' && valueSats > 0) {
      const fiat = satsToFiat(valueSats)
      if (fiat !== null) conversionLine = formatFiatPure(fiat, currency)
    }
  } else {
    if (typeof valueSats === 'number' && valueSats > 0) {
      conversionLine = `${formatSatsNumber(valueSats, { compact: false })} sats`
    }
  }

  // Same tinted-pill idiom already used for price/status chips elsewhere
  // (e.g. CoopOffers/CoopManageView badges) — reads as a live, calculated
  // value rather than a throwaway caption.
  const conversionNode = conversionLine ? (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 font-semibold tabular-nums transition-colors duration-200"
      style={{ color: 'var(--color-primary-50)', background: 'rgba(232,69,65,0.08)' }}
    >
      {conversionLine}
    </span>
  ) : ' '

  return (
    <TextField
      id={id}
      label={inputLabel}
      size={size}
      fullWidth={fullWidth}
      error={error}
      disabled={disabled}
      required={required}
      inputRef={inputRef}
      value={unit === 'sats' ? (valueSats === '' ? '' : formatSatsNumber(valueSats, { compact: false })) : fiatDraft}
      onChange={(e) => (unit === 'sats' ? handleSatsChange(e.target.value) : handleFiatChange(e.target.value))}
      inputMode={unit === 'sats' ? 'numeric' : 'decimal'}
      helperText={helperText ?? conversionNode}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              aria-label={`Switch to ${unit === 'sats' ? currency : 'sats'} input`}
              onClick={handleToggle}
              disabled={!hasRate || disabled}
              edge="end"
              size="small"
              title={hasRate ? `Toggle ${currency}` : 'Fiat input unavailable while offline'}
            >
              <SwapVert fontSize="small" />
            </IconButton>
          </InputAdornment>
        ),
      }}
      sx={{ '& .MuiInputBase-input': { fontWeight: 600 } }}
    />
  )
}

/** Trim trailing zeros from a fiat number for display in the input. */
function trimFiat(fiat: number): string {
  return String(Number(fiat.toFixed(4)))
}
