/**
 * @deprecated Use CreateOfferPage with ?type=service instead.
 * This redirect is kept for backward compatibility with existing routes and links.
 */
import { Navigate, useLocation } from 'react-router-dom'

export function CreateServicePage() {
  const { state } = useLocation()

  return (
    <Navigate
      to="/offers/new?type=service"
      state={state}
      replace
    />
  )
}
