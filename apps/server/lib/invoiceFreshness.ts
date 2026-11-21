import { decodeInvoice } from '@getalby/lightning-tools'

const DEFAULT_EXPIRY_SECONDS = 3600
const MIN_REMAINING_SECONDS = 300

// A cached BOLT11 may only be handed out again while it can still be paid with
// a comfortable margin. Once it is (nearly) expired a fresh one must be minted —
// safe because the old invoice can no longer be paid after that point.
export function isInvoiceFresh(bolt11: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const decoded = decodeInvoice(bolt11)
  if (!decoded) return false
  const expiresAt = decoded.timestamp + (decoded.expiry ?? DEFAULT_EXPIRY_SECONDS)
  return expiresAt - nowSeconds > MIN_REMAINING_SECONDS
}
