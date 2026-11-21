import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { resolvePurchasePath } from '@col/nostr-schema'
import type { Offer } from '../../types/api'
import { estimateSatsFromForeignPrice, type RateMapLike } from '../../lib/remote-price'
import { buildNjumpUrl, buildNostrUri } from '../../lib/remote-listing-link'
import { useRemotePayee } from '../../hooks/useRemoteOrders'
import { PurchasePathBadge } from './PurchasePathBadge'
import { RemotePriceLabel, usesNonSatsPriceLabel } from './RemotePriceLabel'
import { RemotePayPanel } from './RemotePayPanel'

const NEW_TAB_ATTRS = { target: '_blank', rel: 'noopener noreferrer' } as const

// Same primary-button idiom as the rest of the app (e.g. CoopTemplateDetail): the
// `--theme-button-primary-*` tokens are not defined anywhere, so they must not be used.
const linkButtonClass =
  'inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold no-underline bg-[var(--color-primary-50)] text-white hover:opacity-90 transition-opacity'

const secondaryLinkClass = 'inline-flex items-center gap-2 text-sm font-semibold underline-offset-4 hover:underline'
const secondaryLinkStyle = { color: 'var(--color-primary-50)' }

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export function RemoteOfferPanel({
  offer,
  rates,
  formatNumber,
}: {
  offer: Offer
  rates: RateMapLike
  formatNumber: (n: number) => string
}) {
  const payeeQuery = useRemotePayee(offer.id)
  const hasPayee = payeeQuery.data?.orderable === true
  const result = resolvePurchasePath(offer, { hasPayee })
  const fallback = resolvePurchasePath(offer)
  const hasNonSatsPrice = usesNonSatsPriceLabel(offer)
  const hasEstimate =
    !!offer.priceCurrency &&
    estimateSatsFromForeignPrice(offer.priceAmount, offer.priceCurrency, rates) !== null

  let priceNote: string | null = null
  if (offer.priceCurrency && hasEstimate) {
    priceNote = hasPayee
      ? 'Estimate only. The amount you pay is fixed and shown before you pay.'
      : 'Estimate only. The merchant sets the final price.'
  } else if (result.reasons.includes('NON_LIGHTNING_CURRENCY')) {
    priceNote = `Priced in ${offer.priceCurrency?.toUpperCase()}, which cannot be paid over Lightning here.`
  } else if (offer.priceCurrency) {
    priceNote = 'No sat estimate is available for this currency right now.'
  }

  // In the zap-out case the path block shows the link-out path (the merchant contact options),
  // not the zap-out path, which is rendered by RemotePayPanel above the card.
  const pathResult = hasPayee ? fallback : result
  const externalUrl = pathResult.externalUrl
  const hostname = pathResult.path === 'origin-link' && externalUrl ? hostnameOf(externalUrl) : null

  const nostrRef = { pubkey: offer.creatorPubkey, dTag: offer.remoteDTag ?? '' }
  const nostrUri = buildNostrUri(nostrRef)
  const njumpUrl = buildNjumpUrl(nostrRef)

  let pathBlock: ReactNode = null
  if (pathResult.path === 'origin-link' && externalUrl) {
    pathBlock = (
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: 'var(--theme-text)' }}>
          {hostname
            ? `The merchant takes orders on their own site: ${hostname}.`
            : 'The merchant takes orders on their own site.'}
        </p>
        <div>
          <a href={externalUrl} {...NEW_TAB_ATTRS} className={linkButtonClass}>
            Order at merchant site
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
    )
  } else if (pathResult.path === 'open-in-client') {
    pathBlock = (
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: 'var(--theme-text)' }}>
          This listing has no order link. Open it in another Nostr client to contact the publisher.
        </p>
        {nostrUri && njumpUrl ? (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <a href={nostrUri} {...NEW_TAB_ATTRS} className={secondaryLinkClass} style={secondaryLinkStyle}>
                Open in your Nostr app
                <ExternalLink size={16} aria-hidden="true" />
              </a>
              <a href={njumpUrl} {...NEW_TAB_ATTRS} className={secondaryLinkClass} style={secondaryLinkStyle}>
                Open on njump.me
                <ExternalLink size={16} aria-hidden="true" />
              </a>
            </div>
            <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
              njump.me is a public Nostr viewer run by a third party.
            </p>
          </>
        ) : (
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            This listing cannot be opened elsewhere because its identifier is missing.
          </p>
        )}
      </div>
    )
  } else if (!hasPayee) {
    pathBlock = (
      <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
        This order path is not available yet.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {hasPayee && (
        <RemotePayPanel
          offerId={offer.id}
          formatNumber={formatNumber}
          originUrl={offer.originUrl}
          listingAddress={offer.remoteDTag ? `30402:${offer.creatorPubkey}:${offer.remoteDTag}` : undefined}
        />
      )}

      <div
        data-testid="remote-offer-panel"
        data-purchase-path={result.path}
        className="flex flex-col gap-4 rounded-xl border p-5 md:p-6"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}
      >
        <PurchasePathBadge path={result.path} />

        <h3>{hasPayee ? 'About this purchase' : 'Order outside Colabonate'}</h3>
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          {hasPayee
            ? 'This listing was published on another Nostr marketplace and cannot be added to the Colabonate cart. Payment goes directly to the seller; Colabonate does not hold funds or provide buyer protection for it.'
            : 'This listing was published on another Nostr marketplace. It cannot be added to the Colabonate cart, and Colabonate does not hold funds or provide buyer protection for it.'}
        </p>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--theme-text-muted)' }}>
            Listed price
          </span>
          {hasNonSatsPrice ? (
            <RemotePriceLabel
              offer={offer}
              rates={rates}
              formatNumber={formatNumber}
              className="text-2xl font-bold"
            />
          ) : (
            <span className="text-2xl font-bold" style={{ color: 'var(--theme-text)' }}>
              {`${formatNumber(offer.priceSats)} sats`}
            </span>
          )}
          {priceNote && (
            <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
              {priceNote}
            </p>
          )}
        </div>

        {hasPayee && pathBlock && (
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            You can also contact the merchant directly:
          </p>
        )}
        {pathBlock}

        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          The account that published this listing may not be the seller. Check who you are dealing with before you pay.
        </p>
      </div>
    </div>
  )
}
