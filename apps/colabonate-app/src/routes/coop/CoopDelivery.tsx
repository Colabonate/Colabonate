// Availability moved to /sell/company/availability (ADR-110)
// This redirect keeps old /coop/delivery deep-links working
import { Navigate } from 'react-router-dom'
export function CoopDelivery() {
  return <Navigate to="/sell/company/availability" replace />
}
