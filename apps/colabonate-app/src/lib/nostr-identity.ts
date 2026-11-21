/**
 * Nostr Identity Helpers (ADR-153 — extracted from lib/nostr.ts)
 *
 * Centralizes the burner-privkey lifecycle (generate, persist, derive pubkey)
 * plus the login-pubkey lookup (NIP-07 extension > localStorage 'pubkey' >
 * burner fallback). These are the foundational primitives that chat, tickets,
 * handshake, and gift-wrap modules all depend on.
 *
 * IMPORTANT: The burner privkey is the "chat identity" for NIP-17. It is
 * persisted in localStorage['nostr_burner_key'] and rotated only on explicit
 * user action (see Settings). It is NEVER exported to the network.
 */

import { generateSecretKey, getPublicKey, finalizeEvent, nip19, type EventTemplate, type VerifiedEvent } from 'nostr-tools'
import { isNip46Active, getNip46UserPubkey, nip46SignEvent } from './nostr-nip46'

// ─── ADR-195: Identity Status + Backup Flags ──────────────────────────────

/**
 * ADR-195 §3.1 — three-level Identity Status, derived from key-type + backup
 * state. Computed client-side only; never touches the server (ADR-141).
 *
 *   RED    — Burner identity (browser localStorage). Device-bound, not secured.
 *   YELLOW — Real key (NIP-07/NIP-46) but backup not acknowledged.
 *   GREEN  — Real key AND backup acknowledged.
 */
export type IdentityStatus = 'RED' | 'YELLOW' | 'GREEN'

/** Where the user's identity private key currently lives. */
export type IdentityKeyType = 'bunker' | 'extension' | 'burner'

const BURNER_BACKUP_FLAG = 'colabonate:backupAck:burner'
const NIP07_BACKUP_FLAG = 'colabonate:backupAck:nip07'
const NIP46_BACKUP_FLAG = 'colabonate:backupAck:nip46'

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    // localStorage unavailable (private mode) — non-fatal
  }
}

/** Which signer currently backs the user's identity. */
export function getIdentityKeyType(): IdentityKeyType {
  if (isNip46Active()) return 'bunker'
  if (isNip07Available()) return 'extension'
  return 'burner'
}

/** The pubkey backing the current identity (for npub display / custody text). */
export function getIdentityPubkey(): string | null {
  if (isNip46Active()) {
    const pk = getNip46UserPubkey()
    if (pk && isValidHex64(pk)) return pk
  }
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('pubkey')
    if (stored && isValidHex64(stored)) return stored
  }
  // Burner fallback (sync) — only resolve if a burner key already exists,
  // to avoid generating a new one as a side effect of merely reading status.
  try {
    const skHex = localStorage.getItem('nostr_burner_key')
    if (skHex && skHex.length === 64) return getPublicKey(hexToBytes(skHex))
  } catch {
    // ignore
  }
  return null
}

/**
 * ADR-195 §3.1 — compute the Identity Status.
 * Sync; safe to call in render.
 */
export function getMyIdentityStatus(): IdentityStatus {
  const type = getIdentityKeyType()
  if (type === 'bunker') return readFlag(NIP46_BACKUP_FLAG) ? 'GREEN' : 'YELLOW'
  if (type === 'extension') return readFlag(NIP07_BACKUP_FLAG) ? 'GREEN' : 'YELLOW'
  return 'RED' // burner — device-bound, never "secured" status
}

export function isBackupAcknowledged(): boolean {
  switch (getIdentityKeyType()) {
    case 'bunker': return readFlag(NIP46_BACKUP_FLAG)
    case 'extension': return readFlag(NIP07_BACKUP_FLAG)
    case 'burner': return readFlag(BURNER_BACKUP_FLAG)
  }
}

/** Acknowledge that the current identity's key was backed up offline. */
export function acknowledgeBackup(value = true): void {
  switch (getIdentityKeyType()) {
    case 'bunker': writeFlag(NIP46_BACKUP_FLAG, value); break
    case 'extension': writeFlag(NIP07_BACKUP_FLAG, value); break
    case 'burner': writeFlag(BURNER_BACKUP_FLAG, value); break
  }
}

/**
 * Encode the burner private key as a bech32 `nsec1…` string.
 *
 * SECURITY (ADR-195 §3.3): export is client-side only and ONLY valid for the
 * burner path. NIP-07/NIP-46 keys live externally and cannot be exported
 * in-app — callers must guard on `getIdentityKeyType() === 'burner'`.
 *
 * NOTE: this reads the existing burner key; it does NOT generate one if
 * absent (so calling it on a non-burner identity has no side effect beyond
 * throwing when no burner key exists).
 */
export function getMyNsecBech32(): string {
  if (getIdentityKeyType() !== 'burner') {
    throw new Error('nsec export is only available for the burner identity')
  }
  const skHex = (() => {
    try { return localStorage.getItem('nostr_burner_key') } catch { return null }
  })()
  if (!skHex || skHex.length !== 64) {
    throw new Error('No burner key found in local storage')
  }
  return nip19.nsecEncode(hexToBytes(skHex))
}

/** Encode a 64-char hex pubkey as `npub1…`, or null if invalid. */
export function toNpub(hex: string | null | undefined): string | null {
  if (!hex || !isValidHex64(hex)) return null
  try {
    return nip19.npubEncode(hex)
  } catch {
    return null
  }
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
}

/** Returns the user's persisted burner secret-key as a 64-char hex string. */
export function getPrivkeyHex(): string {
  if (typeof localStorage === 'undefined') {
    throw new Error('nostr-identity: localStorage is not available')
  }
  let skHex = localStorage.getItem('nostr_burner_key')
  if (!skHex || skHex.length !== 64) {
    const sk = generateSecretKey()
    skHex = Array.from(sk).map(b => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('nostr_burner_key', skHex)
  }
  return skHex
}

export function getPrivkeyBytes(): Uint8Array {
  const skHex = getPrivkeyHex()
  return new Uint8Array(skHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
}

/**
 * Encode this device's local chat/workspace-signer key as `nsec1…`.
 *
 * Unlike `getMyNsecBech32()` (identity-key export, burner-login only), this
 * always works: NIP-17 DMs and ADR-314 workspace chat sign raw actions with
 * this device-local key regardless of login method (bunker/NIP-07/burner) —
 * see `workspaceChat.ts`'s own module doc for why it's a separate key from
 * the login identity.
 */
export function getChatSignerNsecBech32(): string {
  return nip19.nsecEncode(getPrivkeyBytes())
}

/**
 * FU-458: overwrite this device's local chat/workspace-signer key from an
 * `nsec1…` exported on another device, so workspace chats and NIP-17 DMs
 * opened there become reachable here too.
 *
 * Destructive: replaces whatever key this device was signing with. Any
 * workspace/canister that trusts the OLD device key (`canisterBuyerPubkey`,
 * baked in at deploy time) can no longer be reached from this device after
 * this call. Returns the new key's derived pubkey (hex) for UI confirmation.
 */
export function setChatSignerFromNsec(nsec: string): string {
  const trimmed = nsec.trim()
  if (!trimmed.startsWith('nsec1')) {
    throw new Error('That doesn\'t look like a valid nsec key — it should start with "nsec1…".')
  }
  let decoded: ReturnType<typeof nip19.decode>
  try {
    decoded = nip19.decode(trimmed)
  } catch {
    throw new Error('Could not decode that key — check for typos.')
  }
  if (decoded.type !== 'nsec') {
    throw new Error('That key is not a private key (nsec).')
  }
  const skBytes = decoded.data as Uint8Array
  const skHex = Array.from(skBytes).map(b => b.toString(16).padStart(2, '0')).join('')
  localStorage.setItem('nostr_burner_key', skHex)
  return getPublicKey(skBytes)
}

/**
 * ADR-401 D5/D7: replace this device's signer with a fresh key and return its
 * pubkey. The email-less onboarding path keys the new Colabonate account by the
 * device signer, and `nostr_burner_key` survives logout — without rotating, a
 * second person on a shared browser would sign in to the previous user's
 * account. Destructive in the same way as `setChatSignerFromNsec()`: the old
 * key's chats/workspaces are no longer reachable from this device.
 */
export function rotateDeviceSigner(): string {
  const sk = generateSecretKey()
  localStorage.setItem('nostr_burner_key', Array.from(sk).map(b => b.toString(16).padStart(2, '0')).join(''))
  // The burner backup acknowledgement belonged to the old key.
  writeFlag(BURNER_BACKUP_FLAG, false)
  return getPublicKey(sk)
}

// ADR-401 FU-893 (signer-first): the Nostr identity a session was signed in
// with, stored only when it differs from the account key — i.e. the sovereign
// key signed back into its bound account (D7.4). Cleared by logout.
export const IDENTITY_SIGNER_STORAGE_KEY = 'colabonate:identitySigner'

/** Remember which key signed the login when it is not the account key itself. */
export function recordLoginSigner(signerPubkey: string, sessionPubkey: string): void {
  try {
    if (isValidHex64(signerPubkey) && signerPubkey !== sessionPubkey) {
      localStorage.setItem(IDENTITY_SIGNER_STORAGE_KEY, signerPubkey)
    } else {
      localStorage.removeItem(IDENTITY_SIGNER_STORAGE_KEY)
    }
  } catch {
    // localStorage unavailable — the notice simply never shows.
  }
}

/**
 * The identity pubkey the user signed in with, when no signer (NIP-46 bunker or
 * NIP-07 extension) is connected on this device to act as it. In that state
 * `signOrDelegate()` falls back to this device's own key, so in-app events are
 * not authored by the user's identity. Null when nothing needs to be done.
 */
export function getMissingIdentitySigner(): string | null {
  let signer: string | null = null
  try {
    signer = localStorage.getItem(IDENTITY_SIGNER_STORAGE_KEY)
  } catch {
    return null
  }
  if (!signer || !isValidHex64(signer)) return null
  if (isNip46Active() || isNip07Available()) return null
  return signer
}

/** Returns the burner pubkey (derived from localStorage key). */
export function getMyPubkey(): Promise<string> {
  return Promise.resolve(getPublicKey(getPrivkeyBytes()))
}

/** Sync version for cases where we cannot await (e.g. relay callback paths). */
export function getMyPubkeySync(): string {
  return getPublicKey(getPrivkeyBytes())
}

/**
 * Returns the user's "real" login pubkey — the NIP-07 extension pubkey if
 * available, falling back to the persisted 'pubkey' localStorage entry
 * (used by the email + Google auth flows), and finally the burner pubkey.
 *
 * Per NIP-17 anti-spoofing, the `p` tag on Gift Wraps should be the
 * recipient's REAL identity pubkey, not a rotating chat key. This is
 * what the user gives out as their handle.
 */
export async function getMyLoginPubkey(): Promise<string> {
  // ADR-154: a connected NIP-46 bunker exposes the user's REAL pubkey.
  if (isNip46Active()) {
    const nip46Pk = getNip46UserPubkey()
    if (nip46Pk && isValidHex64(nip46Pk)) return nip46Pk
  }
  if (typeof window !== 'undefined' && (window as Window & { nostr?: { getPublicKey(): Promise<string> } }).nostr) {
    try {
      const pk = await (window as unknown as Window & { nostr: { getPublicKey(): Promise<string> } }).nostr.getPublicKey()
      if (pk && /^[0-9a-fA-F]{64}$/.test(pk)) return pk
    } catch {
      // Extension present but rejected — fall through
    }
  }
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('pubkey')
    if (stored && /^[0-9a-fA-F]{64}$/.test(stored)) return stored
  }
  return getMyPubkeySync()
}

/** True if a NIP-07 browser extension is available. */
export function isNip07Available(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & { nostr?: unknown }).nostr !== 'undefined'
}

export function isValidHex64(s: string | null | undefined): boolean {
  return !!s && /^[0-9a-fA-F]{64}$/.test(s)
}

/**
 * Returns true when the current session was created via the email-magic-link
 * flow (TabEmail). The email flow is the only login path that persists
 * `localStorage.email`; every other login (NIP-07, NIP-46, Alby, MetaMask,
 * LNURL-auth) does not.
 *
 * Used by Account → EmailLoginExplainer to surface the right onboarding
 * context: email login = L0 anonymous + key bound to this browser until a
 * Nostr extension / Lightning wallet is connected.
 */
export function isLoggedInViaEmail(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const email = localStorage.getItem('email')
    if (!email) return false
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  } catch {
    return false
  }
}

/** Returns the email address the user logged in with, if any. */
export function getLoggedInEmail(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const email = localStorage.getItem('email')
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
  } catch {
    return null
  }
}

/**
 * ADR-154: sign an event template via the strongest available signer.
 * Dispatch order: NIP-46 bunker → NIP-07 browser extension → burner privkey.
 * The burner fallback keeps existing flows (chat, tickets) working unchanged
 * until their call-sites are migrated to this wrapper.
 */
export async function signOrDelegate(template: Omit<EventTemplate, 'created_at'> & { created_at?: number }): Promise<VerifiedEvent> {
  if (isNip46Active()) {
    return nip46SignEvent({ created_at: Math.floor(Date.now() / 1000), ...template } as EventTemplate)
  }
  if (typeof window !== 'undefined' && (window as Window & { nostr?: { signEvent(e: EventTemplate): Promise<VerifiedEvent> } }).nostr) {
    try {
      return await (window as unknown as Window & { nostr: { signEvent(e: EventTemplate): Promise<VerifiedEvent> } }).nostr.signEvent({
        created_at: Math.floor(Date.now() / 1000),
        ...template,
      } as EventTemplate)
    } catch {
      // Extension rejected — fall through to burner
    }
  }
  return finalizeEventBurner(template)
}

/** Burner-privkey signer (the original local fallback). */
function finalizeEventBurner(template: Omit<EventTemplate, 'created_at'> & { created_at?: number }): VerifiedEvent {
  return finalizeEvent({ created_at: Math.floor(Date.now() / 1000), ...template } as EventTemplate, getPrivkeyBytes())
}
