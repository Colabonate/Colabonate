/**
 * lib/nostr-nip46 unit tests (ADR-154 / FU-154-E).
 *
 * Covers the deterministic seam of the NIP-46 manager: the disconnected-state
 * accessors, the delegation primitives (which must throw until a bunker is
 * connected), the listener registry, and the restore path's no-op / garbage-
 * persisted behaviour. The live connect/sign round-trip needs a real relay and
 * is exercised end-to-end by `apps/server/scripts/nip46-mock-smoke-test.ts`
 * against the dev mock bunker — not duplicated here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isNip46Active,
  getNip46UserPubkey,
  getNip46Connection,
  getActiveSigner,
  onNip46Change,
  disconnectBunker,
  restoreNip46Session,
  nip46SignEvent,
  nip44EncryptViaBunker,
  nip44DecryptViaBunker,
  nip46GetPublicKey,
} from './nostr-nip46'

// Minimal localStorage shim — the manager persists the session there.
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
  ;(globalThis as { localStorage: Storage }).localStorage =
    makeLocalStorage() as unknown as Storage
})

afterEach(async () => {
  await disconnectBunker()
  vi.restoreAllMocks()
})

// — Disconnected-state accessors ——————————————————————————————————

describe('disconnected state', () => {
  it('reports inactive before any connection', () => {
    expect(isNip46Active()).toBe(false)
    expect(getNip46UserPubkey()).toBeNull()
    expect(getNip46Connection()).toBeNull()
    expect(getActiveSigner()).toBeNull()
  })
})

// — Delegation primitives throw when no bunker connected ——————————————————

describe('delegation primitives without a connected bunker', () => {
  it('signEvent throws a clear error', async () => {
    await expect(
      nip46SignEvent({ kind: 1, created_at: 1, tags: [], content: '' }),
    ).rejects.toThrow(/no bunker connected/i)
  })

  it('nip44Encrypt throws a clear error', async () => {
    await expect(
      nip44EncryptViaBunker('00'.repeat(32), 'hello'),
    ).rejects.toThrow(/no bunker connected/i)
  })

  it('nip44Decrypt throws a clear error', async () => {
    await expect(
      nip44DecryptViaBunker('00'.repeat(32), 'ciphertext=='),
    ).rejects.toThrow(/no bunker connected/i)
  })

  it('getPublicKey throws a clear error', async () => {
    await expect(nip46GetPublicKey()).rejects.toThrow(/no bunker connected/i)
  })
})

// — Listener registry ——————————————————————————————————————————————

describe('onNip46Change listener registry', () => {
  it('returns an unsubscribe function', () => {
    const unsub = onNip46Change(() => {})
    expect(typeof unsub).toBe('function')
    unsub()
  })

  it('fires listeners when state changes (disconnect emits)', async () => {
    const fn = vi.fn()
    const unsub = onNip46Change(fn)
    // disconnectBunker always emits a change (even from an already-disconnected
    // state), so the listener must be called.
    await disconnectBunker()
    expect(fn).toHaveBeenCalled()
    unsub()
  })

  it('stops firing after unsubscribe', async () => {
    const fn = vi.fn()
    const unsub = onNip46Change(fn)
    unsub()
    await disconnectBunker()
    expect(fn).not.toHaveBeenCalled()
  })
})

// — restoreNip46Session ————————————————————————————————————————————

describe('restoreNip46Session', () => {
  it('is a no-op when nothing is persisted', async () => {
    await expect(restoreNip46Session()).resolves.toBeUndefined()
    expect(isNip46Active()).toBe(false)
  })

  it('clears garbage persisted state without throwing or connecting', async () => {
    localStorage.setItem(
      'colabonate:nip46',
      JSON.stringify({
        clientSecretKey: '00'.repeat(32),
        userPubkey: '00'.repeat(32),
        // Not a bunker:// URI and not a name@domain NIP-05, so parseBunkerInput
        // returns null without any network fetch.
        bunkerUri: 'not-a-valid-bunker',
        relays: ['wss://inbox.nostr.wine'],
      }),
    )
    await expect(restoreNip46Session()).resolves.toBeUndefined()
    expect(isNip46Active()).toBe(false)
    // Garbage state must be purged so we don't retry it on every reload.
    expect(localStorage.getItem('colabonate:nip46')).toBeNull()
  })
})
