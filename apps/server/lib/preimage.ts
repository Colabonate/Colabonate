import { createHash } from 'crypto'

// ADR-253: for a direct-pay (seller-issued, non-platform) invoice, the
// buyer's own preimage is the only self-verifying proof of payment — no
// webhook or node poll is available since the platform never held the
// invoice. Matches the sha256(preimage) == paymentHash convention already
// used for NWC pay_invoice confirmation (apps/server/routes/wallet.ts).
export function verifyPreimage(preimage: string, paymentHash: string): boolean {
  if (!preimage || !paymentHash) return false
  const hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex')
  return hash === paymentHash
}
