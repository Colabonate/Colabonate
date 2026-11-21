// Selective disclosure for dispute arbitration — ADR-152.
//
// When a Tier 1 (PRIVATE_PAYLOAD) ticket enters DISPUTED, the parties must
// disclose the commercial payload to the assigned arbitrator. Two mechanisms:
//   1. Re-encryption: party re-sends as NIP-17 gift-wrap to arbitrator pubkey
//   2. Plaintext disclosure: party publishes plaintext; arbitrator recomputes
//      SHA-256(canonical(disclosed)) and checks against payload_commitment.
//
// This module provides the canonical serialization spec and commitment
// verification shared by server and client.

export interface CommercialPayload {
  offerId: string
  title?: string
  quantity?: number
  priceSats?: number
  shippingAddress?: string
  contactData?: string
  notes?: string
  [key: string]: unknown
}

export function canonicalizePayload(payload: CommercialPayload): string {
  const keys = Object.keys(payload).sort()
  const pairs: string[] = []
  for (const key of keys) {
    const value = payload[key]
    if (value === undefined || value === null) continue
    pairs.push(`${key}:${JSON.stringify(value)}`)
  }
  return pairs.join('|')
}

export async function computePayloadCommitment(payload: CommercialPayload): Promise<string> {
  const canonical = canonicalizePayload(payload)
  const encoded = new TextEncoder().encode(canonical)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPayloadCommitment(
  payload: CommercialPayload,
  expectedCommitment: string,
): Promise<boolean> {
  const actual = await computePayloadCommitment(payload)
  return actual === expectedCommitment
}

export type DisclosureMethod = 'plaintext'
