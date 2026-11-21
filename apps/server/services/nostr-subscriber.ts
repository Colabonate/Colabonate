/**
 * NostrSubscriber — Passive ingestion of remote NIP-99 offers (ADR-139 Phase 5)
 *
 * Architecture:
 *   Nostr Relays → NostrSubscriber → NostrNormalizer → RemoteOfferCandidate (PENDING_REVIEW)
 *   ↓ (admin approve) → Offer (source=REMOTE) → Outbox → Meilisearch
 *
 * Features:
 *   - Rate-limited per relay and per author
 *   - Dedup by addressable-event identity (author + NIP-99 `d` tag, ADR-363
 *     D4) with remoteEventId (UNIQUE) as the non-addressable fallback
 *   - Loop prevention: drops events authored by own pubkey
 *   - Exponential backoff reconnect
 *   - Feature-flagged: NOSTR_INGEST_ENABLED (default: false)
 *   - Daily expire/purge of stale candidates
 */

import { SimplePool, verifyEvent, type Event } from 'nostr-tools'
import type { PrismaClient } from '@prisma/client'
import { NOSTR_KINDS } from './kind-mapping.js'
import { normalizeOfferEvent, type NormalizedRemoteOffer } from './nostr-normalizer.js'
import { parseShippingOptionRefs } from '@col/nostr-schema'

const SUBSCRIPTION_BATCH_SIZE = 1000
const DEFAULT_PER_RELAY_LIMIT = 100   // events/hour
const DEFAULT_PER_AUTHOR_LIMIT = 20   // events/hour
const EXPIRE_DAYS = 30
const PURGE_DAYS = 30

// ADR-363 D4: NIP-99 listings are addressable events — the `d` tag is the
// stable identity of a logical listing across re-publishes (each update gets
// a NEW event id). Events without a `d` tag fall back to remoteEventId as
// their identity. Returns null for non-addressable events.
function getDTag(event: Event): string | null {
  return event.tags.find(t => t[0] === 'd')?.[1] ?? null
}

/**
 * Upsert a normalized event into RemoteOfferCandidate (ADR-363 D4 identity:
 * author + `d` tag, remoteEventId UNIQUE as the non-addressable fallback).
 * Exported for unit tests.
 *
 * ADR-423 re-queue fix: the update path refreshes fetchedAt/expiresAt but
 * never the status, so a re-published listing whose 30-day window had EXPIRED
 * would stay terminal (approve rejects EXPIRED) until purge. A re-publish of
 * an EXPIRED candidate resets it to PENDING_REVIEW; REJECTED stays terminal —
 * a deliberate human decision must not be resurrected by a re-publish.
 */
export async function persistRemoteCandidate(
  prisma: PrismaClient,
  event: Event,
  normalized: NormalizedRemoteOffer,
  dTag: string | null,
): Promise<void> {
  const identityWhere = dTag
    ? { remoteAuthor_remoteDTag: { remoteAuthor: normalized.remoteAuthor, remoteDTag: dTag } }
    : { remoteEventId: event.id }

  const row = await prisma.remoteOfferCandidate.upsert({
    where: identityWhere,
    create: {
      remoteEventId: event.id,
      remoteDTag: dTag,
      remoteRelay: normalized.remoteRelay,
      remoteAuthor: normalized.remoteAuthor,
      rawEvent: event as any,
      normalized: normalized as any,
      status: 'PENDING_REVIEW',
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + EXPIRE_DAYS * 86400000),
    },
    update: {
      // Refresh the raw payload + keep the candidate alive on re-publish.
      // A re-published update therefore flows the NEWER event through to
      // approveCandidate's re-normalization (remote-candidate-approval.ts)
      // while preserving the row's status/review history.
      remoteEventId: event.id,
      remoteRelay: normalized.remoteRelay,
      rawEvent: event as any,
      normalized: normalized as any,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + EXPIRE_DAYS * 86400000),
    },
  })

  // CAS on status: only an EXPIRED row flips back, never a REJECTED one.
  if (row.status === 'EXPIRED') {
    await prisma.remoteOfferCandidate.updateMany({
      where: { id: row.id, status: 'EXPIRED' },
      data: { status: 'PENDING_REVIEW' },
    })
  }
}

/** Simple in-memory rate limiter (token bucket) */
class RateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly maxTokens: number
  private readonly refillRate: number // tokens per hour

  constructor(maxPerHour: number) {
    this.maxTokens = maxPerHour
    this.tokens = maxPerHour
    this.refillRate = maxPerHour
    this.lastRefill = Date.now()
  }

  consume(): boolean {
    this.refill()
    if (this.tokens <= 0) return false
    this.tokens--
    return true
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const tokensToAdd = (elapsed / 3600000) * this.refillRate
    if (tokensToAdd >= 1) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd)
      this.lastRefill = now
    }
  }
}

export class NostrSubscriber {
  private pool: SimplePool
  private relays: string[]
  private ownPubkey: string | null = null
  private running = false
  private perRelayLimiters = new Map<string, RateLimiter>()
  private perAuthorLimiters = new Map<string, RateLimiter>()
  private prisma: PrismaClient | null = null
  private reconnectAttempts = 0
  private maxReconnectDelayMs = 60000
  private subscriptions: ReturnType<SimplePool['subscribeMany']>[] = []

  constructor() {
    this.pool = new SimplePool()
    this.relays = this.getRelayUrls()
  }

  private getRelayUrls(): string[] {
    // Ingest relays are deliberately decoupled from the publish path
    // (NOSTR_RELAY_URLS): dev/beta publish to the local mock relay while
    // ingesting from public ones, and Gamma commerce carries its own relay
    // set (e.g. wss://relay.conduit.market) that the publish defaults never
    // include. NOSTR_INGEST_RELAY_URLS wins; NOSTR_RELAY_URLS stays the
    // shared fallback for deployments that want one set everywhere.
    if (process.env.NOSTR_INGEST_RELAY_URLS) {
      return process.env.NOSTR_INGEST_RELAY_URLS.split(',').map(u => u.trim()).filter(Boolean)
    }
    if (process.env.NOSTR_RELAY_URLS) {
      return process.env.NOSTR_RELAY_URLS.split(',').map(u => u.trim()).filter(Boolean)
    }
    // Default public relays for remote offer ingestion
    return ['wss://ribo.nostria.app', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']
  }

  private getRelayLimit(): number {
    return parseInt(process.env.NOSTR_RATE_LIMIT_PER_RELAY ?? String(DEFAULT_PER_RELAY_LIMIT), 10)
  }

  private getAuthorLimit(): number {
    return parseInt(process.env.NOSTR_RATE_LIMIT_PER_AUTHOR ?? String(DEFAULT_PER_AUTHOR_LIMIT), 10)
  }

  /**
   * Start passive ingestion. No-op if NOSTR_INGEST_ENABLED !== 'true'.
   */
  async start(prisma: PrismaClient): Promise<void> {
    if (process.env.NOSTR_INGEST_ENABLED !== 'true') {
      console.log('[NostrSubscriber] disabled (NOSTR_INGEST_ENABLED !== true)')
      return
    }

    this.prisma = prisma
    this.running = true
    this.ownPubkey = process.env.NOSTR_PUBKEY ?? null

    // Initialize rate limiters per relay
    for (const relay of this.relays) {
      this.perRelayLimiters.set(relay, new RateLimiter(this.getRelayLimit()))
    }

    console.log(`[NostrSubscriber] starting — ${this.relays.length} relays, kinds [${NOSTR_KINDS.OFFER_NIP99}, ${NOSTR_KINDS.PRODUCT_COLLECTION}, ${NOSTR_KINDS.SHIPPING_OPTION}]`)

    try {
      await this.subscribe()
    } catch (err) {
      console.error('[NostrSubscriber] initial subscribe failed:', err)
      this.scheduleReconnect()
    }
  }

  private async subscribe(): Promise<void> {
    if (!this.running || !this.prisma) return

    // ADR-277 C5: also listen for foreign Gamma Collections/Shipping Options. Unlike offers,
    // there is no admin-review pipeline (no RemoteOfferCandidate-equivalent table) for these
    // yet — logged only, per the deliberately narrow C5 scope (full foreign-Collection display
    // is a follow-up, same footing as the Collections management UI itself).
    const filter = {
      kinds: [NOSTR_KINDS.OFFER_NIP99, NOSTR_KINDS.PRODUCT_COLLECTION, NOSTR_KINDS.SHIPPING_OPTION],
      limit: SUBSCRIPTION_BATCH_SIZE,
    }

    // Subscribe to all configured relays
    const sub = this.pool.subscribeMany(
      this.relays,
      filter,
      {
        onevent: (event: Event) => this.handleEvent(event),
        oneose: () => {
          console.log('[NostrSubscriber] end of stored events, listening for new ones')
        },
        onclose: (reasons: string[]) => {
          console.log('[NostrSubscriber] subscription closed:', reasons)
          if (this.running) this.scheduleReconnect()
        },
      },
    )

    this.subscriptions.push(sub)
    this.reconnectAttempts = 0
  }

  private async handleEvent(event: Event): Promise<void> {
    if (!this.prisma) return

    // SECURITY (pentest G3, 2026-09-17): events come from untrusted public
    // relays (this subscriber's whole purpose is remote-marketplace
    // ingestion) — a malicious/compromised relay could forward a forged
    // event impersonating a real seller's pubkey with manipulated
    // price/description. Must verify before anything derived from the event
    // (normalization, DB write) is trusted. "Don't trust, verify."
    if (!verifyEvent(event)) {
      console.error(`[SECURITY] NostrSubscriber rejected event ${event.id} with invalid signature (kind ${event.kind}, claimed pubkey ${event.pubkey})`)
      return
    }

    // Loop prevention: drop own events
    if (this.ownPubkey && event.pubkey === this.ownPubkey) return

    // Per-author rate limit
    let authorLimiter = this.perAuthorLimiters.get(event.pubkey)
    if (!authorLimiter) {
      authorLimiter = new RateLimiter(this.getAuthorLimit())
      this.perAuthorLimiters.set(event.pubkey, authorLimiter)
    }
    if (!authorLimiter.consume()) return

    // ADR-277 C5: foreign Collections/Shipping Options have no candidate-review table yet —
    // log-only (see filter comment above), no DB write, no admin approval flow.
    if (event.kind === NOSTR_KINDS.PRODUCT_COLLECTION || event.kind === NOSTR_KINDS.SHIPPING_OPTION) {
      const label = event.kind === NOSTR_KINDS.PRODUCT_COLLECTION ? 'Product Collection' : 'Shipping Option'
      const shippingRefs = event.kind === NOSTR_KINDS.PRODUCT_COLLECTION ? parseShippingOptionRefs(event.tags) : []
      console.log(`[NostrSubscriber] ingested foreign ${label} (kind ${event.kind}) from ${event.pubkey.slice(0, 8)}…: id=${event.id}${shippingRefs.length > 0 ? `, ${shippingRefs.length} shipping ref(s)` : ''}`)
      return
    }

    // Normalize
    const relayUrl = this.relays[0] // best-effort relay attribution
    const normalized = normalizeOfferEvent(event, relayUrl)
    if (!normalized) return // missing required fields

    try {
      // ADR-363 D4: dedup by addressable-event identity when the listing
      // carries a `d` tag — a re-published update (new event id, same `d`)
      // resolves to the SAME candidate row via the (remoteAuthor, remoteDTag)
      // compound unique instead of inserting a duplicate. Non-addressable
      // events keep the remoteEventId UNIQUE identity. ADR-423: an EXPIRED
      // row hit by a re-publish is re-queued to PENDING_REVIEW.
      const dTag = getDTag(event)
      await persistRemoteCandidate(this.prisma, event, normalized, dTag)
    } catch (err) {
      // Duplicate key or other DB error — silent skip
      // (UNIQUE constraint violation is expected for dedup)
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return

    this.reconnectAttempts++
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      this.maxReconnectDelayMs,
    )

    console.log(`[NostrSubscriber] reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`)

    setTimeout(() => {
      if (!this.running) return
      this.cleanupSubscriptions()
      this.subscribe().catch(err => {
        console.error('[NostrSubscriber] reconnect failed:', err)
        this.scheduleReconnect()
      })
    }, delay)
  }

  private cleanupSubscriptions(): void {
    for (const sub of this.subscriptions) {
      try { sub.close() } catch { /* ignore */ }
    }
    this.subscriptions = []
  }

  stop(): void {
    this.running = false
    this.cleanupSubscriptions()
    console.log('[NostrSubscriber] stopped')
  }

  /**
   * Run daily maintenance: expire old candidates + purge rejected/expired.
   * Call from a cron or interval in the server.
   */
  async runMaintenance(prisma: PrismaClient): Promise<{ expired: number; purged: number }> {
    const now = new Date()
    const purgeBefore = new Date(now.getTime() - PURGE_DAYS * 86400000)

    // Expire stale PENDING_REVIEW candidates
    const expired = await prisma.remoteOfferCandidate.updateMany({
      where: {
        status: 'PENDING_REVIEW',
        expiresAt: { lt: now },
      },
      data: { status: 'EXPIRED' },
    })

    // Purge old REJECTED/EXPIRED rows (GDPR retention limit)
    const purged = await prisma.remoteOfferCandidate.deleteMany({
      where: {
        status: { in: ['REJECTED', 'EXPIRED'] },
        reviewedAt: { lt: purgeBefore },
      },
    })

    if (expired.count > 0 || purged.count > 0) {
      console.log(`[NostrSubscriber] maintenance: expired=${expired.count}, purged=${purged.count}`)
    }

    return { expired: expired.count, purged: purged.count }
  }
}
