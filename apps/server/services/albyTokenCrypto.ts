/**
 * albyTokenCrypto — AES-256-GCM at-rest encryption for Alby OAuth tokens
 * (ADR-228 D3).
 *
 * Key: `ALBY_TOKEN_ENCRYPTION_KEY`, 32 bytes base64-encoded
 * (`openssl rand -base64 32`). Fail-closed — no dev default.
 *
 * Format: base64(iv[12] || tag[16] || ciphertext) — one blob per row, safe
 * for a Postgres text column. Per-row IV avoids any IV-collision risk across
 * users; no AAD is used (single-tenant deployment, ADR-212).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function getKey(): Buffer {
  const b64 = process.env.ALBY_TOKEN_ENCRYPTION_KEY
  if (!b64) {
    throw new Error('ALBY_TOKEN_ENCRYPTION_KEY required')
  }
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('ALBY_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (base64 of `openssl rand -base64 32`)')
  }
  return key
}

export function encryptAlbyToken(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

export function decryptAlbyToken(blob: string): string {
  const key = getKey()
  const buf = Buffer.from(blob, 'base64')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** True when the encryption key is available — call before the first use. */
export function hasAlbyTokenKey(): boolean {
  return Boolean(process.env.ALBY_TOKEN_ENCRYPTION_KEY)
}

/** Non-secret last-4 chars for UI display (D2) — never enough to authenticate. */
export function last4(token: string): string {
  return token.slice(-4)
}
