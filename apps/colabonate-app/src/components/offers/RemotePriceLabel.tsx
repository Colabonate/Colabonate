import { cn } from '@ds/utils'
import type { Offer } from '../../types/api'
import {
  estimateSatsFromForeignPrice,
  formatEstimateLabel,
  type RateMapLike,
} from '../../lib/remote-price'

type PriceFields = Pick<Offer, 'source' | 'priceSats' | 'priceAmount' | 'priceCurrency'>

/**
 * True when the listing must be shown in its own currency instead of sats.
 * Foreign non-sats listings store priceSats=0 as a sentinel, so a REMOTE offer
 * without a positive sat price is treated the same way.
 */
export function usesNonSatsPriceLabel(offer: PriceFields): boolean {
  if (offer.priceCurrency) return true
  return offer.source === 'REMOTE' && !(offer.priceSats > 0)
}

export function RemotePriceLabel({
  offer,
  rates,
  formatNumber,
  showEstimate = true,
  className,
}: {
  offer: PriceFields
  rates: RateMapLike
  formatNumber: (n: number) => string
  showEstimate?: boolean
  className?: string
}) {
  if (offer.priceCurrency) {
    const amount = offer.priceAmount ?? '?'
    const currency = offer.priceCurrency.toUpperCase()
    const estimate = showEstimate
      ? estimateSatsFromForeignPrice(offer.priceAmount, offer.priceCurrency, rates)
      : null

    return (
      <span className={cn('inline-flex flex-wrap items-baseline', className)}>
        <span>{`${amount} ${currency}`}</span>
        {estimate && (
          <span className="ml-2 text-sm font-medium" style={{ color: 'var(--theme-text-muted)' }}>
            {formatEstimateLabel(estimate, formatNumber)}
          </span>
        )}
      </span>
    )
  }

  if (offer.source === 'REMOTE' && !(offer.priceSats > 0)) {
    return <span className={className}>Price on request</span>
  }

  return <span className={className}>{`${formatNumber(offer.priceSats)} sats`}</span>
}
