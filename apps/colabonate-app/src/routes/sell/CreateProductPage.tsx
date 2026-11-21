/**
 * @deprecated Use CreateOfferPage with ?type=product instead.
 * This redirect is kept for backward compatibility with existing routes and links.
 */
import { Navigate, useLocation } from 'react-router-dom'

export function CreateProductPage() {
  const { state } = useLocation()

  return (
    <Navigate
      to="/offers/new?type=product"
      state={state}
      replace
    />
  )
}
