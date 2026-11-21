// ADR-417 D1/D3 — who gets paid for a REMOTE offer, and whether that payee can
// be zapped / invoiced over Lightning. Pure resolution logic lives in
// `resolveRemotePayee` (dependency-injected, unit-testable); the network-facing
// implementations live in `createDefaultPayeeDeps` and are never exercised by
// unit tests.
import { bech32 } from 'bech32'
import { createHash } from 'node:crypto'
import { verifyEvent } from 'nostr-tools'
import { nostrService } from './nostr-relay.js'
import { isRoutableLnAddress } from './sellerPaymentResolver.js'
import { checkProviderUrlSyntax } from '../lib/provider-url-safety.js'
import { pinnedFetchJson } from '../lib/pinned-fetch.js'

export type PayeeReason = 'NO_PAYEE' | 'NO_LIGHTNING_ADDRESS' | 'LNURL_UNREACHABLE'

export interface ProfileInfo {
  name?: string
  lud16?: string | null
}

export interface LnurlInfo {
  /** https callback URL from the LNURL-pay response. */
  callback: string
  /** bech32 'lnurl1…' of the pay endpoint (for the zap request lnurl tag). */
  lnurl: string
  minSendableMsats: number
  maxSendableMsats: number
  /** sha256 hex of the LNURL metadata string (LUD-06). */
  metadataHash: string
  allowsNostr: boolean
  /** hex, from the LNURL response; only meaningful with allowsNostr. */
  nostrPubkey?: string
}

export interface PayeeDeps {
  getProfile(pubkey: string): Promise<ProfileInfo | null>
  getLnurl(lud16: string): Promise<LnurlInfo | null>
}

export interface ResolvedPayee {
  pubkey: string
  role: 'seller' | 'author'
  name?: string
  lud16: string
  /** allowsNostr && nostrPubkey is 64 hex. */
  zap: boolean
  /** ceil(minSendableMsats / 1000), at least 1. */
  minSats: number
  /** floor(maxSendableMsats / 1000). */
  maxSats: number
  /** Full info for the invoice step; never sent to the browser. */
  lnurl: LnurlInfo
}

export type PayeeResult = { ok: true; payee: ResolvedPayee } | { ok: false; reason: PayeeReason }

const HEX64 = /^[0-9a-f]{64}$/i

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export async function resolveRemotePayee(
  offer: { creatorPubkey: string; remoteSellerPubkey?: string | null },
  deps: PayeeDeps,
): Promise<PayeeResult> {
  // The seller tag is authoritative when present: no fallback to the author,
  // since the author may be an organisation that does not handle payments.
  const seller = offer.remoteSellerPubkey
  const useSeller = typeof seller === 'string' && HEX64.test(seller)
  const role: 'seller' | 'author' = useSeller ? 'seller' : 'author'
  const pubkey = useSeller ? seller : offer.creatorPubkey
  if (typeof pubkey !== 'string' || !HEX64.test(pubkey)) {
    return { ok: false, reason: 'NO_PAYEE' }
  }

  let profile: ProfileInfo | null
  try {
    profile = await deps.getProfile(pubkey)
  } catch {
    return { ok: false, reason: 'NO_LIGHTNING_ADDRESS' }
  }
  const lud16 = typeof profile?.lud16 === 'string' ? profile.lud16.trim() : ''
  if (!lud16 || !isRoutableLnAddress(lud16)) {
    return { ok: false, reason: 'NO_LIGHTNING_ADDRESS' }
  }

  let info: LnurlInfo | null
  try {
    info = await deps.getLnurl(lud16)
  } catch {
    return { ok: false, reason: 'LNURL_UNREACHABLE' }
  }
  if (
    !info ||
    !isPositiveInteger(info.minSendableMsats) ||
    !isPositiveInteger(info.maxSendableMsats) ||
    info.maxSendableMsats < info.minSendableMsats
  ) {
    return { ok: false, reason: 'LNURL_UNREACHABLE' }
  }

  return {
    ok: true,
    payee: {
      pubkey,
      role,
      name: profile?.name,
      lud16,
      zap: info.allowsNostr === true && HEX64.test(info.nostrPubkey ?? ''),
      minSats: Math.max(1, Math.ceil(info.minSendableMsats / 1000)),
      maxSats: Math.floor(info.maxSendableMsats / 1000),
      lnurl: info,
    },
  }
}

// ---------------------------------------------------------------------------
// Default (network) implementations
// ---------------------------------------------------------------------------

const PROFILE_TIMEOUT_MS = 6_000
const PROFILE_TTL_HIT_MS = 10 * 60_000
const PROFILE_TTL_MISS_MS = 60_000
const LNURL_TIMEOUT_MS = 8_000
const LNURL_TTL_MS = 5 * 60_000
const CACHE_MAX_ENTRIES = 500

interface CacheEntry<T> {
  value: T | null
  expiresAt: number
}

const profileCache = new Map<string, CacheEntry<ProfileInfo>>()
const lnurlCache = new Map<string, CacheEntry<LnurlInfo>>()

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> | undefined {
  const entry = map.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    map.delete(key)
    return undefined
  }
  return entry
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T | null, ttlMs: number): void {
  map.delete(key)
  if (map.size >= CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, { value, expiresAt: Date.now() + ttlMs })
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 80) : undefined
}

async function fetchProfile(pubkey: string): Promise<ProfileInfo | null> {
  const events = await nostrService.getEvents({ kinds: [0], authors: [pubkey], limit: 10 })
  const newest = events
    .filter((event) => event.pubkey === pubkey && verifyEvent(event))
    .sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return null

  let meta: unknown
  try {
    meta = JSON.parse(newest.content)
  } catch {
    return null
  }
  if (!meta || typeof meta !== 'object') return null
  const record = meta as Record<string, unknown>
  const lud16 = typeof record.lud16 === 'string' ? record.lud16.trim() : ''
  return {
    name: cleanText(record.display_name) ?? cleanText(record.name),
    lud16: lud16 || null,
  }
}

async function fetchLnurl(lud16: string): Promise<LnurlInfo | null> {
  // The host comes from a Lightning address set by any Nostr user. Both fetches below are DNS-aware
  // and pinned to the addresses that passed the private-range check (FU-1004), so neither a private
  // name nor a rebinding answer can reach internal hosts. Own parser instead of the Alby library,
  // which resolves DNS itself and cannot be pinned.
  const [name, domain] = lud16.split('@')
  const endpoint = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`

  let raw: unknown
  try {
    raw = await pinnedFetchJson(endpoint)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  if (data.tag !== 'payRequest' || typeof data.callback !== 'string') return null

  const callback = data.callback.trim()
  let callbackUrl: URL
  try {
    callbackUrl = new URL(callback)
  } catch {
    return null
  }
  // https only, no userinfo; host safety is enforced again, pinned, when the callback is fetched.
  if (callbackUrl.protocol !== 'https:' || callbackUrl.username || callbackUrl.password) return null
  if (!checkProviderUrlSyntax(callback).ok) return null

  const min = Math.ceil(Number(data.minSendable || 0))
  const max = Math.floor(Number(data.maxSendable))
  if (!(min > 0 && max > 0) || min > max) return null

  // LUD-06: the invoice description hash commits to the exact metadata string.
  const metadataHash = createHash('sha256')
    .update(typeof data.metadata === 'string' ? data.metadata : '[]')
    .digest('hex')

  const rawNostrPubkey = data.nostrPubkey
  const lnurl = bech32.encode('lnurl', bech32.toWords(Buffer.from(endpoint, 'utf8')), 2000)

  return {
    callback,
    lnurl,
    minSendableMsats: min,
    maxSendableMsats: max,
    metadataHash,
    allowsNostr: data.allowsNostr === true,
    nostrPubkey: typeof rawNostrPubkey === 'string' ? rawNostrPubkey : undefined,
  }
}

export function createDefaultPayeeDeps(): PayeeDeps {
  return {
    async getProfile(pubkey) {
      const hit = cacheGet(profileCache, pubkey)
      if (hit) return hit.value
      let profile: ProfileInfo | null = null
      try {
        profile = await withTimeout(fetchProfile(pubkey), PROFILE_TIMEOUT_MS)
      } catch {
        console.warn('[remote-payee] profile lookup failed')
      }
      cacheSet(profileCache, pubkey, profile, profile ? PROFILE_TTL_HIT_MS : PROFILE_TTL_MISS_MS)
      return profile
    },
    async getLnurl(lud16) {
      const key = lud16.toLowerCase()
      const hit = cacheGet(lnurlCache, key)
      if (hit) return hit.value
      let info: LnurlInfo | null = null
      try {
        info = await withTimeout(fetchLnurl(lud16), LNURL_TIMEOUT_MS)
      } catch {
        console.warn('[remote-payee] LNURL lookup failed')
      }
      if (info) cacheSet(lnurlCache, key, info, LNURL_TTL_MS)
      return info
    },
  }
}
