/**
 * useSliderItemsFiat — decorates SliderListItem arrays with the pre-formatted
 * fiat equivalent (`priceFiat`, e.g. "€4.85") for the white price chip in the
 * SliderList card theme (ADR-235). No `≈`/`=` prefix by design — the chip
 * styling marks it as an approximation context.
 *
 * `packages/ui` stays headless: the chip renders whatever string the app
 * provides here. Fail-open: without a rate the items pass through unchanged
 * and the chip simply does not render.
 */

import { useMemo } from 'react'
import type { SliderListItem } from '@ds/ui'
import { useCurrency } from '../../contexts/CurrencyContext'

export function useSliderItemsFiat(items: SliderListItem[]): SliderListItem[] {
  const { satsToFiat, formatFiat, hasRate } = useCurrency()

  return useMemo(() => {
    if (!hasRate) return items
    return items.map(item => {
      if (item.priceFiat || item.priceSats == null || item.priceSats <= 0) return item
      const fiat = satsToFiat(item.priceSats)
      if (fiat === null) return item
      return { ...item, priceFiat: formatFiat(fiat) }
    })
  }, [items, hasRate, satsToFiat, formatFiat])
}
