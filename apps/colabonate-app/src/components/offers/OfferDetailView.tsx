import { Navigate, useParams } from 'react-router-dom'

/**
 * @deprecated Use BuyProductDetail instead.
 * Route /offers/:offerId now redirects to /buy/product/:offerId.
 * MUI patterns have been merged into BuyProductDetail.
 * See: docs/plans/mui-migration-buy-ticket-consolidation.md -- Phase 3.11
 */
export function OfferDetailView() {
  const { offerId } = useParams<{ offerId: string }>()
  return <Navigate to={`/buy/product/${offerId}`} replace />
}
