/**
 * DetailPriceHero — chip-style price display for detail-page CTA sidebars
 * (offer / coop detail).
 *
 * A self-contained price chip with a subtle border radius and a light contour:
 * bolt icon + big sats number, "satoshi" unit, BTC equivalent, and the fiat
 * hint (ADR-235). Bigger and more chip-like than the old full-bleed gradient
 * hero. Theme-aware via --theme-* / --color-* tokens.
 *
 * Lives in the app (not `packages/ui`) because it composes `FiatHint`, which is
 * context-coupled (same headless-first reasoning as `SatsAmount`, ADR-235).
 */

import { Box, Typography } from '@mui/material'
import { Bolt as BoltIcon } from '@mui/icons-material'
import { formatSatsNumber } from '../../lib/currency'
import { FiatHint } from './FiatHint'

export interface DetailPriceHeroProps {
  /** Sats amount (integer). Ignored (display sentinel only) when foreignPrice is set. */
  sats: number
  /** Caption above the number (e.g. "Price", "Budget"). */
  label?: string
  /** Whether to show a "from" prefix (for price ranges, ADR-270 D5). */
  fromPrefix?: boolean
  /**
   * ADR-277 D9.1/R5: set for foreign non-sats remote listings. When present, renders the
   * published amount/currency instead of the sats/BTC breakdown — `sats` is a 0 sentinel for
   * these offers, not a real price, and must never reach `formatSatsNumber`.
   */
  foreignPrice?: { amount: string; currency: string } | null
  /** Display-only sat estimate for a foreign price, pre-formatted (e.g. "≈ 2,500 sats"). */
  estimateLabel?: string | null
  /** Remote listing without any published price: renders "Price on request" instead of a number. */
  priceOnRequest?: boolean
  /** Caption under the estimate. Defaults to the link-out wording (merchant sets the final price). */
  estimateNote?: string
}

/** Format a sats amount as a BTC string (e.g. "0.00001234 BTC"). */
function formatBtc(sats: number): string {
  const btc = sats / 100_000_000
  if (btc >= 1) return `${btc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })} BTC`
  if (btc >= 0.001) return `${btc.toFixed(5)} BTC`
  if (btc >= 0.00001) return `${btc.toFixed(7)} BTC`
  return `${btc.toFixed(8)} BTC`
}

export function DetailPriceHero({
  sats,
  label = 'Price',
  fromPrefix = false,
  foreignPrice,
  estimateLabel = null,
  priceOnRequest = false,
  estimateNote = 'Estimate only. The merchant sets the final price.',
}: DetailPriceHeroProps) {
  return (
    <Box sx={{
      m: 2,
      p: { xs: 2, sm: 2.5 },
      borderRadius: '10px',
      border: '1px solid var(--theme-border)',
      background: 'linear-gradient(135deg, var(--theme-bg-elevated) 0%, rgba(99,179,237,0.06) 100%)',
      textAlign: 'center',
    }}>
      <Typography variant="caption" color="text.secondary" display="block" mb={1}
        sx={{ textTransform: 'uppercase', letterSpacing: 1.5, fontSize: '0.65rem', fontWeight: 600 }}>
        {fromPrefix ? `${label} (From)` : label}
      </Typography>
      {priceOnRequest ? (
        <>
          <Typography component="span" fontWeight={800}
            sx={{ fontSize: { xs: '2.3rem', sm: '2.8rem' }, lineHeight: 1, color: 'var(--color-primary-50)' }}>
            Price on request
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, letterSpacing: 0.5, color: 'text.secondary' }}>
            The merchant has not published a price
          </Typography>
        </>
      ) : foreignPrice ? (
        <>
          <Typography component="span" fontWeight={800}
            sx={{ fontSize: { xs: '2.3rem', sm: '2.8rem' }, lineHeight: 1, color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums' }}>
            {foreignPrice.amount}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, letterSpacing: 0.5, color: 'text.secondary' }}>
            {foreignPrice.currency.toUpperCase()}
          </Typography>
          {estimateLabel ? (
            <>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, letterSpacing: 0.5, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                {estimateLabel}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, letterSpacing: 0.5, color: 'text.secondary' }}>
                {estimateNote}
              </Typography>
            </>
          ) : (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, letterSpacing: 0.5, color: 'text.secondary' }}>
              No sat estimate available
            </Typography>
          )}
        </>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 0.5 }}>
            <BoltIcon sx={{ fontSize: { xs: 30, sm: 36 }, color: 'var(--color-primary-50)' }} />
            <Typography component="span" fontWeight={800}
              sx={{ fontSize: { xs: '2.3rem', sm: '2.8rem' }, lineHeight: 1, color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums' }}>
              {fromPrefix ? `from ${formatSatsNumber(sats, { compact: false })}` : formatSatsNumber(sats, { compact: false })}
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ letterSpacing: 0.5, color: 'text.secondary' }}>
            satoshi
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontWeight: 700, color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums', fontSize: '0.85rem' }}>
            {formatBtc(sats)}
          </Typography>
          <FiatHint sats={sats} className="block mt-1 text-[15px]" style={{ color: 'var(--theme-text-muted)' }} />
        </>
      )}
    </Box>
  )
}
