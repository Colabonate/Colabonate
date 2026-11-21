/**
 * ai-keybox — AES-256-GCM at-rest field encryption for per-user AI provider
 * API keys (ADR-281 D3).
 *
 * The key comes from `AI_KEY_ENCRYPTION_SECRET` (32-byte hex or 32-byte utf-8
 * string), a separate secret from the NWC one on purpose: storing an AI
 * provider key must not be coupled to the wallet stack. When the env var is
 * unset, saving an API key is refused (503) — local dev and the beta stack
 * must set it explicitly.
 *
 * Format: `ivHex:tagHex:ciphertextHex` — same layout as lib/secretbox.ts so it
 * round-trips through a Postgres text column.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12 // 96-bit nonce (NIST SP 800-38D recommendation for GCM)

function getKey(): Buffer {
  const hex = process.env.AI_KEY_ENCRYPTION_SECRET
  if (!hex) {
    throw new Error('AI_KEY_ENCRYPTION_SECRET is not set (required for at-rest AI provider key encryption)')
  }
  // Accept either a 64-char hex string or a 32-byte utf-8 passphrase.
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Buffer.from(hex, 'hex')
  }
  const buf = Buffer.from(hex, 'utf8')
  if (buf.length !== 32) {
    throw new Error('AI_KEY_ENCRYPTION_SECRET must be 32 bytes (64 hex chars) or a 32-byte utf-8 string')
  }
  return buf
}

export function encryptKey(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`
}

export function decryptKey(payload: string): string {
  const key = getKey()
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid ai-keybox payload format')
  }
  const [ivHex, tagHex, ciphertextHex] = parts
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8')
}

/** True when the encryption key is available — call before the first use. */
export function hasKeyEncryptionSecret(): boolean {
  return Boolean(process.env.AI_KEY_ENCRYPTION_SECRET)
}