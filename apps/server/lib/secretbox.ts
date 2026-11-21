/**
 * secretbox — AES-256-GCM at-rest field encryption (ADR-208 §D6).
 *
 * Used to encrypt the NWC connection URI, which embeds a spend-capable
 * ephemeral client `secret`. The key comes from `NWC_SECRET_KEY` (32-byte
 * hex). When `NWC_ENABLED=1` the key must be present at startup (validated in
 * routes/wallet.ts); this module is otherwise inert.
 *
 * Format: `ivHex:tagHex:ciphertextHex` — base64url-free so it round-trips
 * cleanly through a Postgres text column.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // 96-bit nonce (NIST SP 800-38D recommendation for GCM)

function getKey(): Buffer {
  const hex = process.env.NWC_SECRET_KEY
  if (!hex) {
    throw new Error('NWC_SECRET_KEY is not set (required for at-rest NWC encryption)')
  }
  // Accept either a 64-char hex string or a 32-byte utf-8 passphrase.
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex')
  }
  const buf = Buffer.from(hex, 'utf8')
  if (buf.length !== 32) {
    throw new Error('NWC_SECRET_KEY must be 32 bytes (64 hex chars) or a 32-byte utf-8 string')
  }
  return buf
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decrypt(payload: string): string {
  const key = getKey()
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid secretbox payload format')
  }
  const [ivHex, tagHex, ciphertextHex] = parts
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8')
}

/** True when the encryption key is available — call before the first use. */
export function hasSecretKey(): boolean {
  return Boolean(process.env.NWC_SECRET_KEY)
}
