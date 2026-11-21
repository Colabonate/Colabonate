import { decodeInvoice } from '@getalby/lightning-tools'

/**
 * ADR-394 FU-839: bind an LNURL-pay invoice to the LNURL request it answers.
 *
 * LUD-06 requires a paying wallet to check that the invoice's `h` tag
 * (description_hash) equals sha256 of the LNURL `metadata` string. Without it a
 * misbehaving callback can hand back ANY invoice of the right amount — e.g. one
 * paying a third party — and nothing in our flow would notice (the amount check
 * of ADR-394 D7 still passes). `@getalby/lightning-tools` computes the metadata
 * hash but never compares it, and its `decodeInvoice` does not expose the `h`
 * tag — so this reads it directly.
 *
 * Only the tag layout is parsed here. Checksum/format validity is established
 * by `decodeInvoice` first; an invoice it rejects is rejected here too.
 */

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const TIMESTAMP_WORDS = 7
const SIGNATURE_WORDS = 104 // 65-byte recoverable signature
const CHECKSUM_CHARS = 6
const TAG_DESCRIPTION_HASH = 23 // 'h'

/** Returns the `h` tag as lowercase hex, or null when the invoice has none. */
export function readInvoiceDescriptionHash(bolt11: string): string | null {
  if (!decodeInvoice(bolt11)) throw new Error('Seller invoice could not be decoded (not a valid BOLT11 invoice)')
  const lower = bolt11.toLowerCase()
  const sep = lower.lastIndexOf('1')
  const data = lower.slice(sep + 1, lower.length - CHECKSUM_CHARS)
  const words = Array.from(data, (c) => {
    const w = BECH32_CHARSET.indexOf(c)
    if (w < 0) throw new Error('Seller invoice contains a non-bech32 character')
    return w
  })

  let i = TIMESTAMP_WORDS
  const end = words.length - SIGNATURE_WORDS
  while (i + 3 <= end) {
    const type = words[i]
    const len = words[i + 1] * 32 + words[i + 2]
    const start = i + 3
    if (start + len > end) break
    if (type === TAG_DESCRIPTION_HASH && len === 52) {
      return toHex(wordsToBytes(words.slice(start, start + len)).slice(0, 32))
    }
    i = start + len
  }
  return null
}

/**
 * Throws unless the invoice's description_hash equals the LNURL metadata hash
 * (hex sha256 of the raw `metadata` string, as computed by lightning-tools).
 * The message carries the `invoice` marker so the ticket route classifies it
 * as a 502 upstream failure, like any other rail failure.
 */
export function assertInvoiceMatchesLnurlMetadata(bolt11: string, metadataHashHex: string): void {
  const actual = readInvoiceDescriptionHash(bolt11)
  if (!actual) {
    throw new Error('LNURL invoice carries no description_hash (LUD-06) — refusing to bind it to the request')
  }
  if (actual !== metadataHashHex.toLowerCase()) {
    throw new Error('LNURL invoice description_hash does not match the LNURL metadata (LUD-06)')
  }
}

function wordsToBytes(words: number[]): number[] {
  const out: number[] = []
  let acc = 0
  let bits = 0
  for (const w of words) {
    acc = (acc << 5) | w
    bits += 5
    while (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
    acc &= (1 << bits) - 1
  }
  return out
}

function toHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}
