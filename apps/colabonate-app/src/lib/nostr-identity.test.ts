/**
 * lib/nostr-identity unit tests — FU-458 (cross-device chat/workspace signer
 * export/import). Covers `getChatSignerNsecBech32()` / `setChatSignerFromNsec()`
 * only; the rest of this module's surface (identity status, bunker detection)
 * is exercised indirectly through the components that consume it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPublicKey, generateSecretKey, nip19 } from 'nostr-tools'
import {
  getChatSignerNsecBech32,
  setChatSignerFromNsec,
  getMyPubkeySync,
  rotateDeviceSigner,
  recordLoginSigner,
  getMissingIdentitySigner,
} from './nostr-identity'

function makeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage: Storage }).localStorage = makeLocalStorage() as unknown as Storage
})

describe('getChatSignerNsecBech32', () => {
  it('exports the device key as a valid nsec1… matching the device pubkey', () => {
    const nsec = getChatSignerNsecBech32()
    expect(nsec).toMatch(/^nsec1/)
    const decoded = nip19.decode(nsec)
    expect(decoded.type).toBe('nsec')
    expect(getPublicKey(decoded.data as Uint8Array)).toBe(getMyPubkeySync())
  })
})

describe('setChatSignerFromNsec', () => {
  it('round-trips: importing an exported nsec reproduces the same pubkey', () => {
    const before = getMyPubkeySync()
    const nsec = getChatSignerNsecBech32()

    // Simulate a second device with its own, different auto-generated key.
    localStorage.clear()
    const otherDevicePubkey = getMyPubkeySync()
    expect(otherDevicePubkey).not.toBe(before)

    const imported = setChatSignerFromNsec(nsec)
    expect(imported).toBe(before)
    expect(getMyPubkeySync()).toBe(before)
  })

  it('overwrites whatever key was previously on this device', () => {
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)
    const expectedPubkey = getPublicKey(sk)

    setChatSignerFromNsec(nsec)
    expect(getMyPubkeySync()).toBe(expectedPubkey)
  })

  it('rejects a malformed key without touching the stored key', () => {
    const before = getMyPubkeySync()
    expect(() => setChatSignerFromNsec('not-a-key')).toThrow(/nsec1/)
    expect(getMyPubkeySync()).toBe(before)
  })

  it('rejects an npub (wrong key type) with a clear error', () => {
    const before = getMyPubkeySync()
    const npub = nip19.npubEncode(before)
    expect(() => setChatSignerFromNsec(npub)).toThrow(/nsec1/)
  })

  it('trims surrounding whitespace from pasted input', () => {
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)
    const imported = setChatSignerFromNsec(`  ${nsec}\n`)
    expect(imported).toBe(getPublicKey(sk))
  })
})

describe('rotateDeviceSigner (ADR-401 review P1-1)', () => {
  it('replaces a key left behind by a previous user with a fresh one', () => {
    const previous = getMyPubkeySync()
    const rotated = rotateDeviceSigner()
    expect(rotated).not.toBe(previous)
    expect(getMyPubkeySync()).toBe(rotated)
  })

  it('clears the burner backup acknowledgement that belonged to the old key', () => {
    localStorage.setItem('colabonate:backupAck:burner', '1')
    rotateDeviceSigner()
    expect(localStorage.getItem('colabonate:backupAck:burner')).toBeNull()
  })
})

describe('identity signer notice (ADR-401 FU-893)', () => {
  const account = getPublicKey(generateSecretKey())
  const identity = getPublicKey(generateSecretKey())

  afterEach(() => vi.unstubAllGlobals())

  it('flags a login where the sovereign key signed into another account', () => {
    recordLoginSigner(identity, account)
    expect(getMissingIdentitySigner()).toBe(identity)
  })

  it('stays silent when the signing key is the account key', () => {
    recordLoginSigner(account, account)
    expect(getMissingIdentitySigner()).toBeNull()
  })

  it('clears an old flag on a normal login', () => {
    recordLoginSigner(identity, account)
    recordLoginSigner(account, account)
    expect(getMissingIdentitySigner()).toBeNull()
  })

  it('stays silent while a NIP-07 signer is available on this device', () => {
    recordLoginSigner(identity, account)
    vi.stubGlobal('window', { nostr: {} })
    expect(getMissingIdentitySigner()).toBeNull()
  })

  it('ignores a malformed stored value', () => {
    localStorage.setItem('colabonate:identitySigner', 'not-a-key')
    expect(getMissingIdentitySigner()).toBeNull()
  })
})
