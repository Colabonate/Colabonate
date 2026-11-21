import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'
import { encrypt, decrypt, hasSecretKey } from './secretbox.js'

const TEST_KEY = randomBytes(32).toString('hex')

describe('secretbox', () => {
  let originalKey: string | undefined

  beforeEach(() => {
    originalKey = process.env.NWC_SECRET_KEY
    process.env.NWC_SECRET_KEY = TEST_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.NWC_SECRET_KEY
    else process.env.NWC_SECRET_KEY = originalKey
  })

  it('round-trips plaintext through encrypt/decrypt', () => {
    const plaintext = 'nostr+walletconnect://abc123?relay=wss://relay.example&secret=deadbeef'
    expect(decrypt(encrypt(plaintext))).toBe(plaintext)
  })

  it('round-trips empty and unicode strings', () => {
    expect(decrypt(encrypt(''))).toBe('')
    expect(decrypt(encrypt('déjà vu — 日本語'))).toBe('déjà vu — 日本語')
  })

  it('produces a different ciphertext on every call (random IV)', () => {
    const a = encrypt('same plaintext')
    const b = encrypt('same plaintext')
    expect(a).not.toBe(b)
  })

  it('formats the payload as ivHex:tagHex:ciphertextHex', () => {
    const payload = encrypt('x')
    const parts = payload.split(':')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/) // 12-byte IV
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/) // 16-byte GCM auth tag
  })

  it('detects tampering with the ciphertext', () => {
    const payload = encrypt('secret payload')
    const [iv, tag, ciphertext] = payload.split(':')
    const flippedLastByte = ciphertext.slice(0, -2) + (ciphertext.slice(-2) === '00' ? '01' : '00')
    expect(() => decrypt(`${iv}:${tag}:${flippedLastByte}`)).toThrow()
  })

  it('detects tampering with the auth tag', () => {
    const payload = encrypt('secret payload')
    const [iv, tag, ciphertext] = payload.split(':')
    const flippedTag = tag.slice(0, -2) + (tag.slice(-2) === '00' ? '01' : '00')
    expect(() => decrypt(`${iv}:${flippedTag}:${ciphertext}`)).toThrow()
  })

  it('rejects a malformed payload', () => {
    expect(() => decrypt('not-a-valid-payload')).toThrow(/Invalid secretbox payload format/)
  })

  it('throws when NWC_SECRET_KEY is missing', () => {
    delete process.env.NWC_SECRET_KEY
    expect(() => encrypt('x')).toThrow(/NWC_SECRET_KEY is not set/)
  })

  it('accepts a 32-byte utf-8 passphrase as an alternative to 64-char hex', () => {
    process.env.NWC_SECRET_KEY = 'a'.repeat(32)
    expect(decrypt(encrypt('hello'))).toBe('hello')
  })

  it('rejects a key that is neither 64-char hex nor 32-byte utf-8', () => {
    process.env.NWC_SECRET_KEY = 'too-short'
    expect(() => encrypt('x')).toThrow(/32 bytes/)
  })

  describe('hasSecretKey', () => {
    it('reflects whether NWC_SECRET_KEY is set', () => {
      expect(hasSecretKey()).toBe(true)
      delete process.env.NWC_SECRET_KEY
      expect(hasSecretKey()).toBe(false)
    })
  })
})
