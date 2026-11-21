import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { assertInvoiceMatchesLnurlMetadata, readInvoiceDescriptionHash } from './bolt11-tags.js'

// Minimal BOLT11 builder for tests: valid bech32 checksum and tag layout, a
// dummy signature (the parser never checks it — decodeInvoice does not either).
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let chk = 1
  for (const v of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i]
  }
  return chk
}

function hrpExpand(hrp: string): number[] {
  return [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)]
}

function toWords(bytes: Buffer): number[] {
  const out: number[] = []
  let acc = 0
  let bits = 0
  for (const b of bytes) {
    acc = (acc << 8) | b
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out.push((acc >> bits) & 31)
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31)
  return out
}

function tag(type: number, bytes: Buffer): number[] {
  const words = toWords(bytes)
  return [type, words.length >> 5, words.length & 31, ...words]
}

function buildInvoice(opts: { descriptionHash?: Buffer; description?: string }): string {
  const hrp = 'lnbc10u' // 1000 sats
  const timestamp = Math.floor(Date.now() / 1000)
  const tsWords: number[] = []
  for (let i = 6; i >= 0; i--) tsWords.push(Math.floor(timestamp / 32 ** i) % 32)
  const words = [
    ...tsWords,
    ...tag(1, Buffer.alloc(32, 7)), // p: payment hash
    ...(opts.descriptionHash ? tag(23, opts.descriptionHash) : []), // h
    ...(opts.description !== undefined ? tag(13, Buffer.from(opts.description)) : []), // d
    ...new Array(104).fill(0), // signature + recovery id
  ]
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31)
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join('')}`
}

const METADATA = '[["text/plain","Pay alice"],["text/identifier","alice@example.com"]]'
const METADATA_HASH = createHash('sha256').update(METADATA).digest()

describe('readInvoiceDescriptionHash (ADR-394 FU-839)', () => {
  it('reads the h tag of a description-hash invoice', () => {
    expect(readInvoiceDescriptionHash(buildInvoice({ descriptionHash: METADATA_HASH }))).toBe(METADATA_HASH.toString('hex'))
  })

  it('returns null for an invoice with only a plain description', () => {
    expect(readInvoiceDescriptionHash(buildInvoice({ description: 'Order: Test' }))).toBeNull()
  })

  it('throws on something that is not a BOLT11 invoice', () => {
    expect(() => readInvoiceDescriptionHash('lnbc1notaninvoice')).toThrow()
  })
})

describe('assertInvoiceMatchesLnurlMetadata (ADR-394 FU-839)', () => {
  it('accepts an invoice committing to the LNURL metadata', () => {
    const bolt11 = buildInvoice({ descriptionHash: METADATA_HASH })
    expect(() => assertInvoiceMatchesLnurlMetadata(bolt11, METADATA_HASH.toString('hex').toUpperCase())).not.toThrow()
  })

  it('rejects an invoice committing to different metadata', () => {
    const other = createHash('sha256').update('[["text/plain","Pay mallory"]]').digest()
    expect(() => assertInvoiceMatchesLnurlMetadata(buildInvoice({ descriptionHash: other }), METADATA_HASH.toString('hex')))
      .toThrow(/does not match/)
  })

  it('rejects an invoice without a description_hash', () => {
    expect(() => assertInvoiceMatchesLnurlMetadata(buildInvoice({ description: 'x' }), METADATA_HASH.toString('hex')))
      .toThrow(/no description_hash/)
  })
})
