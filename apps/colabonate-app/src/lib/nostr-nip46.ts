/**
 * NIP-46 Nostr Connect manager (ADR-154).
 *
 * Wraps nostr-tools' `BunkerSigner` to provide a real, portable, non-custodial
 * Nostr identity: the user's nsec stays in a remote "bunker" (Amber, Alby Hub,
 * nsecBunker, …). Colabonate only ever holds an ephemeral client key + the
 * bunker pointer — never the user's secret key (respects ADR-141).
 *
 * Self-contained: keeps its own SimplePool + relay list so it does NOT import
 * `nostr-relay-config` (which would create a circular dependency with
 * `nostr-identity`). Relay defaults mirror getRelays().
 *
 * Two connection modes (NIP-46 §"Initiating a connection"):
 *   A. Bunker-initiated — user pastes a `bunker://…` URI (or name@domain NIP-05).
 *   B. Client-initiated — we generate a `nostrconnect://…` URI the user scans
 *      with their bunker app; the bunker connects back to us.
 */

import { generateSecretKey, getPublicKey, SimplePool, type EventTemplate, type VerifiedEvent } from 'nostr-tools'
import {
  BunkerSigner,
  parseBunkerInput,
  createNostrConnectURI,
  toBunkerURL,
  type BunkerPointer,
  type NostrConnectParams,
} from 'nostr-tools/nip46'

const STORAGE_KEY = 'colabonate:nip46'
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

export interface Nip46Connection {
  /** The user's REAL identity pubkey — served by the bunker. */
  userPubkey: string
  /** Canonical `bunker://` URI (for re-establishing the session). */
  bunkerUri: string
  /** Relays used as the NIP-46 transport. */
  relays: string[]
}

interface PersistedState {
  clientSecretKey: string
  userPubkey: string
  bunkerUri: string
  relays: string[]
}

let activeSigner: BunkerSigner | null = null
let activeMeta: Nip46Connection | null = null
let _pool: SimplePool | null = null
const listeners = new Set<() => void>()

// ── helpers ────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('')
}

function nip46Relays(): string[] {
  const env = (import.meta as { env?: Record<string, string> }).env
  if (env?.VITE_NOSTR_RELAY_URLS) {
    return env.VITE_NOSTR_RELAY_URLS.split(',').map((u) => u.trim()).filter(Boolean)
  }
  const relays = [...DEFAULT_RELAYS]
  if (env?.DEV && typeof window !== 'undefined') {
    relays.unshift(`ws://${window.location.hostname}:4001`)
  }
  return relays
}

function pool(): SimplePool {
  if (!_pool) _pool = new SimplePool()
  return _pool
}

function persist(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage may be unavailable (private mode) — non-fatal, just no restore
  }
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as PersistedState) : null
  } catch {
    return null
  }
}

function clearPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

function emitChange(): void {
  for (const l of listeners) {
    try {
      l()
    } catch {
      // listener errors must not break other listeners
    }
  }
}

function setActive(signer: BunkerSigner, meta: Nip46Connection): void {
  activeSigner = signer
  activeMeta = meta
  emitChange()
}

// ── public API ─────────────────────────────────────────────────────────────

/** True when a NIP-46 bunker is connected and can sign. */
export function isNip46Active(): boolean {
  return activeSigner !== null
}

/** The connected bunker's real user pubkey (sync, from cache), or null. */
export function getNip46UserPubkey(): string | null {
  return activeMeta?.userPubkey ?? null
}

/** Connection metadata for UI display, or null when disconnected. */
export function getNip46Connection(): Nip46Connection | null {
  return activeMeta
}

/** The underlying signer (for direct delegation); null when not connected. */
export function getActiveSigner(): BunkerSigner | null {
  return activeSigner
}

/** Subscribe to connection-state changes (connect / disconnect / restore). Returns an unsubscribe fn. */
export function onNip46Change(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Mode A — connect from a `bunker://…` URI or a `name@domain` NIP-05.
 * Performs the connect handshake + `get_public_key`, then persists the session.
 */
export async function connectFromBunkerUri(input: string): Promise<Nip46Connection> {
  const bp: BunkerPointer | null = await parseBunkerInput(input)
  if (!bp || bp.relays.length === 0) {
    throw new Error('Invalid bunker URI — could not parse relays + pubkey')
  }

  const clientSk = generateSecretKey()
  const signer = BunkerSigner.fromBunker(clientSk, bp, { pool: pool() })
  await signer.connect()
  const userPubkey = await signer.getPublicKey()

  const meta: Nip46Connection = {
    userPubkey,
    bunkerUri: toBunkerURL(bp),
    relays: bp.relays,
  }
  persist({ clientSecretKey: bytesToHex(clientSk), userPubkey, bunkerUri: meta.bunkerUri, relays: meta.relays })
  setActive(signer, meta)
  return meta
}

/**
 * Mode B — build a `nostrconnect://…` URI for the user to scan with their
 * bunker app. The bunker connects back over the relays; this resolves once the
 * connection is established. Call `disconnectBunker()` to cancel.
 */
export async function connectFromNostrConnect(
  onUri: (uri: string) => void,
  opts?: { name?: string; perms?: string[]; timeoutMs?: number },
): Promise<Nip46Connection> {
  const clientSk = generateSecretKey()
  const clientPubkey = getPublicKey(clientSk)
  const relays = nip46Relays()
  const secret = bytesToHex(generateSecretKey())

  const params: NostrConnectParams = {
    clientPubkey,
    relays,
    secret,
    name: opts?.name ?? 'Colabonate',
    perms: opts?.perms ?? ['nip44_encrypt', 'nip44_decrypt', 'sign_event'],
  }
  const nostrconnectUri = createNostrConnectURI(params)
  onUri(nostrconnectUri)

  const signer = await BunkerSigner.fromURI(clientSk, nostrconnectUri, { pool: pool() }, opts?.timeoutMs ?? 120000)
  const userPubkey = await signer.getPublicKey()

  const meta: Nip46Connection = { userPubkey, bunkerUri: toBunkerURL(signer.bp), relays: signer.bp.relays }
  persist({ clientSecretKey: bytesToHex(clientSk), userPubkey, bunkerUri: meta.bunkerUri, relays: meta.relays })
  setActive(signer, meta)
  return meta
}

/** Disconnect, close the relay subscription, and drop the persisted session. */
export async function disconnectBunker(): Promise<void> {
  if (activeSigner) {
    try {
      await activeSigner.close()
    } catch {
      // best-effort close
    }
  }
  activeSigner = null
  activeMeta = null
  clearPersisted()
  emitChange()
}

/**
 * Restore a previously persisted session on app load. Safe to call multiple
 * times; resolves (possibly with no active signer) on failure.
 */
export async function restoreNip46Session(): Promise<void> {
  if (activeSigner) return
  const persisted = loadPersisted()
  if (!persisted) return
  try {
    const bp = await parseBunkerInput(persisted.bunkerUri)
    if (!bp) {
      clearPersisted()
      return
    }
    const signer = BunkerSigner.fromBunker(hexToBytes(persisted.clientSecretKey), bp, { pool: pool() })
    await signer.connect()
    const userPubkey = await signer.getPublicKey()
    setActive(signer, { userPubkey, bunkerUri: persisted.bunkerUri, relays: bp.relays })
  } catch (err) {
    console.warn('[NIP-46] Failed to restore session:', err)
    clearPersisted()
  }
}

// ── delegation primitives ──────────────────────────────────────────────────
// Thin async wrappers over the active signer. Throw when no bunker is connected.

export async function nip46SignEvent(event: EventTemplate): Promise<VerifiedEvent> {
  if (!activeSigner) throw new Error('NIP-46: no bunker connected')
  return activeSigner.signEvent(event)
}

export async function nip44EncryptViaBunker(peerPubkey: string, plaintext: string): Promise<string> {
  if (!activeSigner) throw new Error('NIP-46: no bunker connected')
  return activeSigner.nip44Encrypt(peerPubkey, plaintext)
}

export async function nip44DecryptViaBunker(peerPubkey: string, ciphertext: string): Promise<string> {
  if (!activeSigner) throw new Error('NIP-46: no bunker connected')
  return activeSigner.nip44Decrypt(peerPubkey, ciphertext)
}

export async function nip46GetPublicKey(): Promise<string> {
  if (!activeSigner) throw new Error('NIP-46: no bunker connected')
  return activeSigner.getPublicKey()
}
