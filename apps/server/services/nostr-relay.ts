import { SimplePool, type Filter, type Event, generateSecretKey, finalizeEvent } from 'nostr-tools'
import { createRumor, createSeal, wrapEvent } from 'nostr-tools/nip59'
import {
  NOSTR_KINDS,
  KIND_MAPPING,
  isKindConflicted,
  OFFER_KINDS,
  COMPANY_KINDS,
  TICKET_CREATED_KINDS,
  TICKET_STATUS_KINDS,
  CREDENTIAL_KINDS,
  REVIEW_KINDS,
  COOPERATION_PROPOSAL_KINDS,
  MILESTONE_KINDS,
  NOSTR_CLIENT_TAG,
} from './kind-mapping'
import {
  buildTicketCreatedTags, buildTicketStatusTags,
  buildCooperationProposalTags, buildMilestoneTags,
  buildMarketSpecOrderTags, buildMarketSpecReceiptTags,
  shouldCoEmit,
  buildProductListingTags, PRODUCT_TYPES, PHYSICAL_TYPES, LISTING_VISIBILITIES,
  buildCollectionTags, buildShippingOptionTags,
} from '@col/nostr-schema'
import type { ProductType, PhysicalType, ListingVisibility, ProductSpec, ShippingOptionTagInput } from '@col/nostr-schema'
import { tagsForCategoryCode } from './gamma-category-map.js'
import { getOrCreatePlatformSigningKey, hasSigningIdentityKey } from './nostr-signing-identity.js'
import type { PrismaClient } from '@prisma/client'

function asProductType(v: string | null | undefined): ProductType | undefined {
  return v && (PRODUCT_TYPES as readonly string[]).includes(v) ? (v as ProductType) : undefined
}

function asPhysicalType(v: string | null | undefined): PhysicalType | undefined {
  return v && (PHYSICAL_TYPES as readonly string[]).includes(v) ? (v as PhysicalType) : undefined
}

function asListingVisibility(v: string | null | undefined): ListingVisibility | undefined {
  return v && (LISTING_VISIBILITIES as readonly string[]).includes(v) ? (v as ListingVisibility) : undefined
}

function asSpecs(v: unknown): ProductSpec[] | undefined {
  if (!Array.isArray(v)) return undefined
  const specs = v.filter((s): s is ProductSpec =>
    !!s && typeof s === 'object' && typeof (s as ProductSpec).key === 'string' && typeof (s as ProductSpec).value === 'string')
  return specs.length > 0 ? specs : undefined
}

function asVariantValues(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const entries = Object.entries(v as Record<string, unknown>).filter(([, val]) => typeof val === 'string') as Array<[string, string]>
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

// ADR-155/277 C4: Offer.shippingOptionRefs is a Json column shaped like
// ShippingOptionRef[] = [{kind, pubkey, d, extraCost?}] — validate before trusting it as input
// to buildProductListingTags (the builder emits one `shipping_option` tag per entry verbatim).
function asShippingOptionRefs(v: unknown): Array<{ kind: 30406 | 30405; pubkey: string; d: string; extraCost?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const refs = v.filter((r): r is { kind: 30406 | 30405; pubkey: string; d: string; extraCost?: string } =>
    !!r && typeof r === 'object'
    && (r.kind === 30406 || r.kind === 30405)
    && typeof r.pubkey === 'string' && typeof r.d === 'string')
  return refs.length > 0 ? refs : undefined
}

/**
 * NostrRelayService - Service for publishing and subscribing to Nostr events
 * 
 * Relay Configuration:
 * - Uses NOSTR_RELAY_URLS environment variable if set (comma-separated)
 * - Development default: ws://localhost:4001 (Mock Relay via index.ts:592)
 * - Production default: wss://ribo.nostria.app, wss://relay.damus.io, wss://nos.lol, wss://relay.primal.net
 * 
 * Mock Relay (development):
 * - In-memory relay attached to Express server (apps/server/services/mock-relay.ts)
 * - No external dependency required for local development
 * - Events stored in memory, forwarded between WebSocket connections
 * - Automatically started via attachMockRelay(httpServer) in index.ts:592
 */
export class NostrRelayService {
  private pool: SimplePool
  public relays: string[]
  private _lastEventTimestamp: string | null = null
  // ADR-412 FU-948: stable platform-level signing identity for bidirectional
  // transaction mirror events (Ticket/Cooperation/Milestone/Dispute), where
  // no single party owns the record. Injected once at startup via setPrisma()
  // so the ~18 existing call sites across index.ts/escrow-timeout.ts/
  // paymentConfirmation.ts/platformFeeSettlement.ts/dispute.ts don't each
  // need to resolve and pass it in, unlike the per-entity Offer/Company key
  // (D2), there is exactly one platform key, cached after first resolution.
  private prisma: PrismaClient | null = null
  private platformSigningKey: Uint8Array | null = null

  constructor() {
    this.pool = new SimplePool()
    this.relays = this.getRelayUrls()
  }

  /** Call once at server startup so publish* methods can resolve the platform signing key. */
  setPrisma(prisma: PrismaClient): void {
    this.prisma = prisma
  }

  /** Resolves (and caches) the stable platform signing key. Falls back to undefined (caller uses an ephemeral key) when prisma hasn't been injected or at-rest encryption isn't configured (dev without NWC_SECRET_KEY). */
  private async getPlatformKey(): Promise<Uint8Array | undefined> {
    if (this.platformSigningKey) return this.platformSigningKey
    if (!this.prisma || !hasSigningIdentityKey()) return undefined
    const identity = await getOrCreatePlatformSigningKey(this.prisma)
    this.platformSigningKey = identity.sk
    return identity.sk
  }

  getPool(): SimplePool {
    return this.pool
  }

  getRelayUrls(): string[] {
    // Check environment variable first
    if (process.env.NOSTR_RELAY_URLS) {
      return process.env.NOSTR_RELAY_URLS.split(',').map(url => url.trim())
    }

    // Use defaults based on environment
    const isProd = process.env.NODE_ENV === 'production'
    // ADR-412 D3: production default covers the relays the target NIP-99
    // marketplaces actually read, verified live 2026-10-02. Conduit's
    // Marketplace page reads ONLY relay.conduit.market; Shopstr's search
    // relays are ditto.pub/plebeian.market/gulugulu.moe + the profile relay
    // purplepag.es (needed for the Kind-0 profiles this ADR also adds).
    return isProd
      ? [
          'wss://ribo.nostria.app',
          'wss://relay.damus.io',
          'wss://nos.lol',
          'wss://relay.primal.net',
          'wss://relay.conduit.market',
          'wss://relay.nostr.net',
          'wss://relay.plebeian.market',
          'wss://relay.ditto.pub',
          'wss://relay.gulugulu.moe',
          'wss://purplepag.es',
        ]
      : ['ws://localhost:4001']  // Mock Relay for development (attached in index.ts:592)
  }

  /**
   * Relays used for READS (getEvents): the configured set plus a public-relay
   * fallback. In dev the configured set is the local mock relay, which only
   * holds events published through this server — public network state we read
   * (Kind 0 profile metadata, NIP-10050 DM relay lists, trusted-arbiter sets)
   * exists ONLY on public relays. Publishing keeps using `relays` alone, so no
   * dev events leak to mainnet and the beta stack stays bounded-local (ADR-239).
   * Override the public fallback via NOSTR_READ_RELAY_URLS (comma-separated).
   */
  getReadRelayUrls(): string[] {
    const publicRead = (process.env.NOSTR_READ_RELAY_URLS
      ? process.env.NOSTR_READ_RELAY_URLS.split(',').map(u => u.trim())
      : ['wss://ribo.nostria.app', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']
    ).filter(Boolean)
    return [...new Set([...this.relays, ...publicRead])]
  }

  /**
   * Best-effort "warm the first relay" check, NOT a precondition for publishing.
   * Found live 2026-10-02 (ADR-412 production rollout): every `publish*` call
   * actually goes through `publishBounded()`, which tries every configured
   * relay independently via `Promise.allSettled` and tolerates any single
   * relay being down. This method used to `throw` when only `relays[0]`
   * failed to connect, aborting the entire publish before `publishBounded`
   * ever ran, turning one flaky relay (e.g. a transient Cloudflare 530 on
   * `ribo.nostria.app`) into a full outage, even though the other 9
   * configured relays were reachable. Now logs and returns instead.
   */
  async connect(): Promise<void> {
    try {
      await this.pool.ensureRelay(this.relays[0])
      console.log('Connected to Nostr relay:', this.relays[0], process.env.NODE_ENV === 'production' ? '(production)' : '(mock relay)')
    } catch (error) {
      console.warn('Could not warm the first configured relay (non-fatal, publishBounded tries all relays independently):', this.relays[0], error)
    }
  }

  async publishOffer(offer: {
    id: string
    title: string
    description?: string
    priceSats: number
    creatorPubkey: string
    location?: string
    country?: string
    city?: string
    offerType?: string
    ticketType?: string
    categoryCode?: string
    gammaTags?: string[]
    deliveryTimeDays?: number
    deliveryCostSats?: number
    images?: string[]
    milestones?: Array<{ title: string; percentage: number }>
    publishedAt?: number
    allowedVisibility?: unknown[]
    // ADR-156/172/173/270 enrichment — previously built by
    // buildProductListingTags() but never wired into this publish path.
    productType?: string | null
    physicalType?: string | null
    parentOfferId?: string | null
    specs?: unknown
    variantValues?: unknown
    stock?: number | null
    weight?: string | null
    weightUnit?: string | null
    dimensions?: string | null
    dimensionsUnit?: string | null
    listingVisibility?: string | null
    // ADR-155/277 C4: ShippingOptionRef[] — was built by buildProductListingTags but never
    // read from the DB column and passed through this publish path until now.
    shippingOptionRefs?: unknown
    // ADR-152: PRIVATE offers are DM-only (NIP-17). They MUST NOT be
    // published as Kind 30402 / 30017 (NIP-99 / NIP-15 marketplace).
    visibility?: 'PUBLIC' | 'PRIVATE'
  }, signingKey?: Uint8Array): Promise<Event | null> {
    // ADR-152: Skip publish for PRIVATE offers. PRIVATE offers travel
    // exclusively via NIP-17 encrypted DMs — a public Kind 30402 event
    // would leak metadata (seller pubkey, timestamp, category) and
    // defeat the privacy guarantee.
    if (offer.visibility === 'PRIVATE') {
      console.log(
        `[Nostr] Skipping publish for PRIVATE offer ${offer.id} — ` +
        `private offers use NIP-17 DM only (ADR-152)`,
      )
      return null
    }
    try {
      // ADR-412 D2: use the caller-resolved persistent per-entity signing
      // key when provided (routes resolve it via nostr-signing-identity.ts),
      // falling back to a one-off ephemeral key only when no persistent
      // identity was resolved (e.g. NWC_SECRET_KEY unset in dev).
      const sk = signingKey ?? generateSecretKey()

      const timestamp = offer.publishedAt ?? Math.floor(Date.now() / 1000)

      const tags: string[][] = [
        ['d', offer.id],
        ['title', offer.title],
        ['price', offer.priceSats.toString(), 'sats'],
        ['seller', offer.creatorPubkey],
        ['published_at', timestamp.toString()],
        // ADR-412 amendment 2026-11-20: publishing-client attribution. Optional
        // in NIP-99, but ecosystem stats (nostrolo.gy "Who publishes") group
        // listings by this tag — omitting it counted all our listings as
        // "untagged" and hid Colabonate as a publishing app. Same array feeds
        // both the legacy (30017) and NIP-99 (30402) finalizeEvent calls.
        ['client', NOSTR_CLIENT_TAG],
      ]

      if (offer.offerType) tags.push(['offer_type', offer.offerType.toLowerCase()])
      if (offer.ticketType) tags.push(['ticket_type', offer.ticketType.toLowerCase()])
      if (offer.categoryCode) {
        tags.push(['category', offer.categoryCode])
      }
      // ADR-277 D6: emit one real Gamma `t` tag per entry in offer.gammaTags.
      // Offers with no explicit tags fall back to the D3 seed map keyed off
      // categoryCode, so no listing loses its `t` tag in the transition.
      const gammaTags = offer.gammaTags && offer.gammaTags.length > 0
        ? offer.gammaTags
        : (offer.categoryCode ? tagsForCategoryCode(offer.categoryCode) : [])
      for (const tag of gammaTags) tags.push(['t', tag])

      // Delegate ADR-156/172/173/270 product enrichment (type, variation
      // parent-ref, specs/attributes, stock, weight/dim, visibility) to the
      // shared builder — the single source of truth also used by the client
      // signer — instead of the ad-hoc tags above. `d`/`title`/`price` are
      // dropped since this function already built its own above; `category`/
      // `t`/`image` are likewise left out of the builder call (undefined
      // inputs below) so they aren't emitted twice.
      const enrichmentTags = buildProductListingTags({
        d: offer.id,
        title: offer.title,
        price: offer.priceSats.toString(),
        currency: 'sats',
        type: asProductType(offer.productType),
        physicalType: asPhysicalType(offer.physicalType),
        parentRef: offer.parentOfferId ? { pubkey: offer.creatorPubkey, d: offer.parentOfferId } : undefined,
        specs: asSpecs(offer.specs),
        variantValues: asVariantValues(offer.variantValues),
        stock: offer.stock ?? undefined,
        weight: offer.weight ?? undefined,
        weightUnit: offer.weightUnit ?? undefined,
        dim: offer.dimensions ?? undefined,
        dimUnit: offer.dimensionsUnit ?? undefined,
        listingVisibility: asListingVisibility(offer.listingVisibility),
        shippingOptionRefs: asShippingOptionRefs(offer.shippingOptionRefs),
      })
      for (const tag of enrichmentTags) {
        if (tag[0] === 'd' || tag[0] === 'title' || tag[0] === 'price') continue
        tags.push(tag)
      }

      if (offer.deliveryTimeDays != null) tags.push(['delivery_time_days', offer.deliveryTimeDays.toString()])
      if (offer.deliveryCostSats != null) tags.push(['delivery_cost_sats', offer.deliveryCostSats.toString()])
      if (offer.images && offer.images.length > 0) {
        for (const url of offer.images) tags.push(['image', url])
      }
      if (offer.milestones && offer.milestones.length > 0) {
        const milestonesPayload = offer.milestones.map(m => ({ title: m.title, pct: m.percentage }))
        tags.push(['milestones', JSON.stringify(milestonesPayload)])
      }
      if (offer.location) tags.push(['location', offer.location])
      if (offer.country) tags.push(['country', offer.country])
      if (offer.city) tags.push(['city', offer.city])
      if (offer.allowedVisibility && offer.allowedVisibility.length > 0) {
        tags.push(['allowed_visibility', ...offer.allowedVisibility.map(String)])
      }

      const eventLegacy = finalizeEvent(
        {
          kind: NOSTR_KINDS.OFFER_LEGACY,
          created_at: timestamp,
          tags,
          content: offer.description || '',
        },
        sk
      )

      const eventNip99 = finalizeEvent(
        {
          kind: NOSTR_KINDS.OFFER_NIP99,
          created_at: timestamp,
          tags,
          content: offer.description || '',
        },
        sk
      )

      const allPublishedLegacy = await this.publishBounded(eventLegacy)
      const allPublishedNip99 = await this.publishBounded(eventNip99)

      if (allPublishedLegacy.every(result => result) && allPublishedNip99.every(result => result)) {
        console.log('Offer dual-published to Nostr:', { legacy: eventLegacy.id, nip99: eventNip99.id }, process.env.NODE_ENV === 'production' ? '(production relays)' : '(mock relay)')
      } else {
        console.warn('Offer partially published (some relays may not have received both kinds)')
      }

      return eventNip99
    } catch (error) {
      console.error('Failed to publish offer to Nostr:', error)
      return null
    }
  }

  /**
   * ADR-412 D2: publish a standard Kind 0 profile for a persistent per-entity
   * listing signing key, the first time that key is created, so external
   * NIP-99 clients (Conduit, Shopstr, Plebeian Market) can resolve a real
   * merchant name/picture instead of an anonymous pubkey. Best-effort;
   * never blocks the listing publish it accompanies.
   */
  async publishEntityProfile(signingKey: Uint8Array, profile: { name: string; picture?: string | null; about?: string | null; nip05?: string | null }): Promise<Event | null> {
    try {
      const content = JSON.stringify({
        name: profile.name,
        ...(profile.picture ? { picture: profile.picture } : {}),
        ...(profile.about ? { about: profile.about } : {}),
        // ADR-412 FU-947: verifiable via GET /.well-known/nostr.json?name=<id>
        ...(profile.nip05 ? { nip05: profile.nip05 } : {}),
      })
      const event = finalizeEvent(
        { kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content },
        signingKey,
      )
      await this.publishBounded(event)
      return event
    } catch (error) {
      console.error('Failed to publish entity Kind 0 profile to Nostr:', error)
      return null
    }
  }

  /**
   * ADR-277 Phase C (D5/D10): publish a Kind 30405 Gamma Product Collection. One `a` tag per
   * resolved product ref is required by the spec (D10, corrects ADR-173's one-sided design) —
   * callers resolve productRefs/shippingOptionRefs before calling this (see routes/collection.ts
   * for the Product→Offer selection rule). No legacy kind — 30405 has no pre-ADR-277 twin, so
   * this is a single-kind publish, unlike publishOffer's dual-publish.
   */
  async publishProductCollection(collection: {
    id: string
    d: string
    title: string
    summary?: string | null
    image?: string | null
    location?: string | null
    geohash?: string | null
    productRefs: Array<{ pubkey: string; d: string }>
    shippingOptionRefs?: Array<{ pubkey: string; d: string }>
  }, signingKey?: Uint8Array): Promise<Event | null> {
    try {
      // ADR-412 D2: persistent per-company signing key (see publishOffer).
      const sk = signingKey ?? generateSecretKey()
      const timestamp = Math.floor(Date.now() / 1000)

      const tags = buildCollectionTags({
        d: collection.d,
        title: collection.title,
        productRefs: collection.productRefs,
        image: collection.image ?? undefined,
        summary: collection.summary ?? undefined,
        location: collection.location ?? undefined,
        geohash: collection.geohash ?? undefined,
        shippingOptionRefs: collection.shippingOptionRefs,
      })

      const event = finalizeEvent(
        { kind: NOSTR_KINDS.PRODUCT_COLLECTION, created_at: timestamp, tags, content: collection.summary || '' },
        sk,
      )

      const published = await this.publishBounded(event)
      if (published.some(result => result)) {
        console.log('Product Collection published to Nostr:', event.id, process.env.NODE_ENV === 'production' ? '(production relays)' : '(mock relay)')
      } else {
        console.warn('Product Collection publish failed on all relays:', collection.id)
      }

      return event
    } catch (error) {
      console.error('Failed to publish Product Collection to Nostr:', error)
      return null
    }
  }

  /** ADR-277 Phase C (D5): publish a Kind 30406 Gamma Shipping Option. Single-kind, no legacy twin. */
  async publishShippingOption(option: ShippingOptionTagInput & { id: string }, signingKey?: Uint8Array): Promise<Event | null> {
    try {
      // ADR-412 D2: persistent per-company signing key (see publishOffer).
      const sk = signingKey ?? generateSecretKey()
      const timestamp = Math.floor(Date.now() / 1000)

      const tags = buildShippingOptionTags(option)
      const event = finalizeEvent(
        { kind: NOSTR_KINDS.SHIPPING_OPTION, created_at: timestamp, tags, content: '' },
        sk,
      )

      const published = await this.publishBounded(event)
      if (published.some(result => result)) {
        console.log('Shipping Option published to Nostr:', event.id, process.env.NODE_ENV === 'production' ? '(production relays)' : '(mock relay)')
      } else {
        console.warn('Shipping Option publish failed on all relays:', option.id)
      }

      return event
    } catch (error) {
      console.error('Failed to publish Shipping Option to Nostr:', error)
      return null
    }
  }

  /**
   * NIP-09 deletion request (Kind 5), used when a Collection/Shipping Option is deactivated or
   * removed. Caveat (FU-277-C, unresolved, pre-existing across every publisher in this file):
   * every publish here signs with a fresh ephemeral key rather than a persistent per-company
   * key, so this deletion's pubkey will not match the original event's pubkey — strict relays
   * that enforce NIP-09's same-author rule will not honor it. Best-effort, consistent with the
   * rest of this service's existing key-handling, not a new regression.
   */
  async publishDeletion(eventId: string, reason?: string, signingKey?: Uint8Array): Promise<Event | null> {
    try {
      // ADR-412 D2: pass the SAME persistent key used for the original event
      // when known. NIP-09 requires the deletion to share the original
      // event's author, which a fresh ephemeral key here never did (FU-277-C
      // neighbor bug, same root cause). Falls back to ephemeral when the
      // caller has no persistent identity to pass (best-effort, unchanged
      // from prior behavior).
      const sk = signingKey ?? generateSecretKey()
      const timestamp = Math.floor(Date.now() / 1000)
      const event = finalizeEvent(
        { kind: 5, created_at: timestamp, tags: [['e', eventId]], content: reason ?? '' },
        sk,
      )
      await this.publishBounded(event)
      return event
    } catch (error) {
      console.error('Failed to publish NIP-09 deletion to Nostr:', error)
      return null
    }
  }

  async publishCompany(company: {
    id: string
    name: string
    description?: string
    address?: string
    city?: string
    zipCode?: string
    country?: string
    coopRadius?: number
    businessFields?: string[]
    logoUrl?: string
    bannerUrl?: string
    images?: string[]
    website?: string
    email?: string
    phone?: string
    socialLinks?: { twitter?: string; nostr?: string }
    openingHours?: Record<string, string | null>
    terms?: string
    ownerPubkey: string
  }, signingKey?: Uint8Array): Promise<Event | null> {
    try {
      // ADR-412 D2: persistent per-company signing key (see publishOffer).
      const sk = signingKey ?? generateSecretKey()

      const tags: string[][] = [
        ['d', company.id],
        ['name', company.name],
      ]

      if (company.address) tags.push(['address', company.address])
      if (company.city) tags.push(['city', company.city])
      if (company.zipCode) tags.push(['zip', company.zipCode])
      if (company.country) tags.push(['country', company.country])
      if (company.coopRadius) tags.push(['radius', company.coopRadius.toString(), 'coop'])
      if (company.businessFields && company.businessFields.length > 0) {
        tags.push(['fields', ...company.businessFields])
      }
      if (company.logoUrl) tags.push(['logo', company.logoUrl])
      if (company.bannerUrl) tags.push(['banner', company.bannerUrl])
      if (company.images && company.images.length > 0) {
        tags.push(['images', ...company.images])
      }
      if (company.website) tags.push(['website', company.website])
      if (company.email) tags.push(['email', company.email])
      if (company.phone) tags.push(['phone', company.phone])
      if (company.socialLinks?.twitter) tags.push(['twitter', company.socialLinks.twitter])
      if (company.socialLinks?.nostr) tags.push(['nostr', company.socialLinks.nostr])

      const content = JSON.stringify({
        description: company.description || '',
        opening_hours: company.openingHours || null,
        terms: company.terms || '',
      })

      const timestamp = Math.floor(Date.now() / 1000)

      const eventLegacy = finalizeEvent(
        {
          kind: NOSTR_KINDS.COMPANY_LEGACY,
          created_at: timestamp,
          tags,
          content,
        },
        sk
      )

      const eventNew = finalizeEvent(
        {
          kind: NOSTR_KINDS.COMPANY_NEW,
          created_at: timestamp,
          tags,
          content,
        },
        sk
      )

      const allPublishedLegacy = await this.publishBounded(eventLegacy)
      const allPublishedNew = await this.publishBounded(eventNew)

      if (allPublishedLegacy.every(result => result) && allPublishedNew.every(result => result)) {
        console.log('Company dual-published to Nostr:', { legacy: eventLegacy.id, new: eventNew.id }, process.env.NODE_ENV === 'production' ? '(production relays)' : '(mock relay)')
      } else {
        console.warn('Company partially published (some relays may not have received both kinds)')
      }

      return eventNew
    } catch (error) {
      console.error('Failed to publish company to Nostr:', error)
      return null
    }
  }

  async publishTicketCreated(ticket: {
    id: string
    // ADR-204: xor — cooperation tickets have no offerId; offer tickets have no cooperationId.
    offerId?: string
    cooperationId?: string
    buyerPubkey: string
    sellerPubkey: string
    status: string
    offerType?: string
    ticketType?: string
    content?: string
    visibility?: 0 | 1 | 2
    payloadCommitment?: string
  }): Promise<Event | null> {
    try {
      // ADR-412 FU-948: stable platform key (see getPlatformKey), not a fresh
      // ephemeral one per call, so a ticket's lifecycle events share one
      // addressable (kind, pubkey, d) coordinate.
      const sk = (await this.getPlatformKey()) ?? generateSecretKey()

      const tags = buildTicketCreatedTags(ticket)

      const content = ticket.content || ''

      const timestamp = Math.floor(Date.now() / 1000)

      const eventLegacy = finalizeEvent(
        {
          kind: NOSTR_KINDS.TICKET_CREATED_LEGACY,
          created_at: timestamp,
          tags,
          content,
        },
        sk
      )

      const eventNew = finalizeEvent(
        {
          kind: NOSTR_KINDS.TICKET_CREATED_NEW,
          created_at: timestamp,
          tags,
          content,
        },
        sk
      )

      const allPublishedLegacy = await this.publishBounded(eventLegacy)
      const allPublishedNew = await this.publishBounded(eventNew)

      if (allPublishedLegacy.every(result => result) && allPublishedNew.every(result => result)) {
        console.log('TicketCreated dual-published to Nostr:', { legacy: eventLegacy.id, new: eventNew.id })
      } else {
        console.warn('TicketCreated partially published (some relays may not have received both kinds)')
      }

      await this.coEmitMarketSpecEvents({
        ticketId: ticket.id,
        status: ticket.status,
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        offerId: ticket.offerId,
        cooperationId: ticket.cooperationId,
        visibility: ticket.visibility,
        eventType: 'created',
      })

      return eventNew
    } catch (error) {
      console.error('Failed to publish ticket created to Nostr:', error)
      return null
    }
  }

  async publishTicketStatus(ticket: {
    id: string
    status: string
    buyerPubkey: string
    sellerPubkey: string
    // ADR-204: xor — cooperation tickets have no offerId; offer tickets have no cooperationId.
    offerId?: string
    cooperationId?: string
    offerType?: string
    invoice?: string
    paymentHash?: string
    preimage?: string
    paymentType?: string
    amountSats?: number
    escrowStatus?: string
    escrowPhase1Preimage?: string | null
    escrowPhase2Preimage?: string | null
    escrowPhase3Preimage?: string | null
    escrowPhase1Amount?: number
    escrowPhase2Amount?: number
    escrowPhase3Amount?: number
    content?: string
    visibility?: 0 | 1 | 2
  }): Promise<Event | null> {
    try {
      // ADR-412 FU-948: stable platform key, see publishTicketCreated.
      const sk = (await this.getPlatformKey()) ?? generateSecretKey()

      const tags = buildTicketStatusTags(ticket)

      const content = ticket.content || ''

      const timestamp = Math.floor(Date.now() / 1000)

      const eventLegacy = finalizeEvent(
        {
          kind: NOSTR_KINDS.TICKET_STATUS_LEGACY,
          created_at: timestamp,
          tags,
          content,
        },
        sk
      )

      const eventNew = finalizeEvent(
        {
          kind: NOSTR_KINDS.TICKET_STATUS_NEW,
          created_at: timestamp,
          tags,
          content,
        },
        sk
      )

      const allPublishedLegacy = await this.publishBounded(eventLegacy)
      const allPublishedNew = await this.publishBounded(eventNew)

      if (allPublishedLegacy.every(result => result) && allPublishedNew.every(result => result)) {
        console.log('TicketStatus dual-published to Nostr:', { legacy: eventLegacy.id, new: eventNew.id })
      } else {
        console.warn('TicketStatus partially published (some relays may not have received both kinds)')
      }

      await this.coEmitMarketSpecEvents({
        ticketId: ticket.id,
        status: ticket.status,
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        offerId: ticket.offerId,
        cooperationId: ticket.cooperationId,
        amountSats: ticket.amountSats,
        preimage: ticket.preimage,
        paymentType: ticket.paymentType,
        visibility: ticket.visibility,
        eventType: 'status',
      }).catch(err => console.error('[Nostr] coEmitMarketSpecEvents failed:', err))

      return eventNew
    } catch (error) {
      console.error('Failed to publish ticket status to Nostr:', error)
      return null
    }
  }

  async publishCooperationProposal(cooperation: {
    id: string
    type: 'proposal' | 'acceptance'
    initiatorPubkey: string
    partnerPubkey: string
    title: string
    budgetSats: number
    timeline?: string
    status: string
    cooperationType?: string
    skills?: string[]
    content?: string
    // ADR-152 / Plan Phase 3.2: PRIVATE cooperations travel exclusively via
    // NIP-17 encrypted DMs (Kind 14). They MUST NOT be published as a public
    // Kind 30414 / legacy event — that would leak initiator/partner pubkeys,
    // budget and timeline to public relays and defeat the privacy guarantee.
    visibility?: 'PUBLIC' | 'PRIVATE'
  }): Promise<Event | null> {
    // ADR-152: Skip public publish for PRIVATE cooperations (mirrors
    // publishOffer). The dual-signature NIP-C agreement is replicated as a
    // Kind 14 DM via the client (signAndPublishCooperationProposal).
    if (cooperation.visibility === 'PRIVATE') {
      console.log(
        `[Nostr] Skipping publish for PRIVATE cooperation ${cooperation.id} — ` +
        `private cooperations use NIP-17 DM only (ADR-152, Plan Phase 3.2)`,
      )
      return null
    }
    try {
      // ADR-412 FU-948: stable platform key, see publishTicketCreated.
      const sk = (await this.getPlatformKey()) ?? generateSecretKey()

      const tags = buildCooperationProposalTags({
        cooperationId: cooperation.id,
        type: cooperation.type,
        initiatorPubkey: cooperation.initiatorPubkey,
        partnerPubkey: cooperation.partnerPubkey,
        title: cooperation.title,
        budgetSats: cooperation.budgetSats,
        status: cooperation.status,
        timeline: cooperation.timeline,
        cooperationType: cooperation.cooperationType,
        skills: cooperation.skills,
      })

      const timestamp = Math.floor(Date.now() / 1000)

      const eventLegacy = finalizeEvent(
        {
          kind: NOSTR_KINDS.COOPERATION_PROPOSAL_LEGACY,
          created_at: timestamp,
          tags,
          content: cooperation.content || '',
        },
        sk
      )

      const eventNew = finalizeEvent(
        {
          kind: NOSTR_KINDS.COOPERATION_PROPOSAL_NEW,
          created_at: timestamp,
          tags,
          content: cooperation.content || '',
        },
        sk
      )

      const allPublishedLegacy = await this.publishBounded(eventLegacy)
      const allPublishedNew = await this.publishBounded(eventNew)

      if (allPublishedLegacy.every(result => result) && allPublishedNew.every(result => result)) {
        console.log('CooperationProposal dual-published to Nostr:', { legacy: eventLegacy.id, new: eventNew.id })
      } else {
        console.warn('CooperationProposal partially published (some relays may not have received both kinds)')
      }

      return eventNew
    } catch (error) {
      console.error('Failed to publish cooperation proposal to Nostr:', error)
      return null
    }
  }

  async publishMilestoneEvent(milestone: {
    id: string
    cooperationId: string
    milestoneIndex: number
    initiatorPubkey: string
    partnerPubkey: string
    title: string
    status: string
    amountSats: number
    evidence?: string
    released?: boolean
    content?: string
    // ADR-152 / Plan Phase 3.3: PRIVATE cooperations' milestones travel via
    // NIP-17 DM only — never as a public Kind 30415 event.
    visibility?: 'PUBLIC' | 'PRIVATE'
  }): Promise<Event | null> {
    // ADR-152: skip public publish for PRIVATE cooperations (mirrors
    // publishOffer / publishCooperationProposal).
    if (milestone.visibility === 'PRIVATE') {
      console.log(
        `[Nostr] Skipping publish for PRIVATE milestone ${milestone.id} — ` +
        `private cooperations use NIP-17 DM only (ADR-152, Plan Phase 3.3)`,
      )
      return null
    }
    try {
      // ADR-412 FU-948: stable platform key, see publishTicketCreated.
      const sk = (await this.getPlatformKey()) ?? generateSecretKey()

      const tags = buildMilestoneTags({
        cooperationId: milestone.cooperationId,
        milestoneId: milestone.id,
        milestoneIndex: milestone.milestoneIndex,
        initiatorPubkey: milestone.initiatorPubkey,
        partnerPubkey: milestone.partnerPubkey,
        title: milestone.title,
        status: milestone.status,
        amountSats: milestone.amountSats,
        evidence: milestone.evidence,
        released: milestone.released,
      })

      const timestamp = Math.floor(Date.now() / 1000)

      const eventLegacy = finalizeEvent(
        {
          kind: NOSTR_KINDS.MILESTONE_LEGACY,
          created_at: timestamp,
          tags,
          content: milestone.content || '',
        },
        sk
      )

      const eventNew = finalizeEvent(
        {
          kind: NOSTR_KINDS.MILESTONE_NEW,
          created_at: timestamp,
          tags,
          content: milestone.content || '',
        },
        sk
      )

      const allPublishedLegacy = await this.publishBounded(eventLegacy)
      const allPublishedNew = await this.publishBounded(eventNew)

      if (allPublishedLegacy.every(result => result) && allPublishedNew.every(result => result)) {
        console.log('MilestoneEvent dual-published to Nostr:', { legacy: eventLegacy.id, new: eventNew.id })
      } else {
        console.warn('MilestoneEvent partially published (some relays may not have received both kinds)')
      }

      return eventNew
    } catch (error) {
      console.error('Failed to publish milestone event to Nostr:', error)
      return null
    }
  }

  async publishDispute(dispute: {
    id: string
    ticketId: string
    ticketType?: string
    daoId: string
    reason: string
    details?: string
    openedByPubkey: string
    buyerPubkey?: string
    sellerPubkey?: string
  }): Promise<Event | null> {
    try {
      // ADR-412 FU-948: stable platform key, see publishTicketCreated.
      const sk = (await this.getPlatformKey()) ?? generateSecretKey()

      const tags: string[][] = [
        ['d', dispute.id],
        ['ticket', dispute.ticketId],
        ['reason', dispute.reason],
        ['dao_id', dispute.daoId],
        ['opened_by', dispute.openedByPubkey],
      ]

      if (dispute.ticketType) tags.push(['ticket_type', dispute.ticketType])
      if (dispute.buyerPubkey) tags.push(['p', dispute.buyerPubkey])
      if (dispute.sellerPubkey) tags.push(['p', dispute.sellerPubkey])

      const content = JSON.stringify({
        dispute_id: dispute.id,
        ticket_id: dispute.ticketId,
        dao_id: dispute.daoId,
        reason: dispute.reason,
        details: dispute.details || '',
        opened_by: dispute.openedByPubkey,
      })

      const timestamp = Math.floor(Date.now() / 1000)

      const eventLegacy = finalizeEvent(
        { kind: NOSTR_KINDS.DISPUTE_LEGACY, created_at: timestamp, tags, content },
        sk
      )

      const eventNew = finalizeEvent(
        { kind: NOSTR_KINDS.DISPUTE_NEW, created_at: timestamp, tags, content },
        sk
      )

      const allPublishedLegacy = await this.publishBounded(eventLegacy)
      const allPublishedNew = await this.publishBounded(eventNew)

      if (allPublishedLegacy.every(result => result) && allPublishedNew.every(result => result)) {
        console.log('Dispute dual-published to Nostr:', { legacy: eventLegacy.id, new: eventNew.id })
      } else {
        console.warn('Dispute partially published (some relays may not have received both kinds)')
      }

      return eventNew
    } catch (error) {
      console.error('Failed to publish dispute to Nostr:', error)
      return null
    }
  }

  subscribeToOffers(filters: {
    sellerPubkey?: string
    search?: string
    maxPrice?: number
  }, callback: (event: Event) => void): () => void {
    const filter: Filter = {
      kinds: [...OFFER_KINDS],
    }

    console.warn('[NIP-15 CONFLICT] Subscribing to conflicted kinds:', OFFER_KINDS, '- Use OFFER_KINDS (30402) for NIP-compliant queries')

    if (filters.sellerPubkey) {
      filter.authors = [filters.sellerPubkey]
    }

    const sub = this.pool.subscribeMany(this.relays, filter, {
      onevent: (event) => {
        if (filters.maxPrice) {
          const priceTag = event.tags.find((t) => t[0] === 'price')
          const price = priceTag ? parseInt(priceTag[1]) : Infinity
          if (price <= filters.maxPrice) {
            callback(event)
          }
        } else {
          callback(event)
        }
      },
    })

    return () => sub.close()
  }

  async getOffersBySeller(sellerPubkey: string): Promise<Event[]> {
    return new Promise((resolve) => {
      const events: Event[] = []
      const filter: Filter = {
        kinds: [...OFFER_KINDS],
        authors: [sellerPubkey],
      }

      console.warn('[NIP-15 CONFLICT] Querying conflicted kinds for offers:', OFFER_KINDS)

      const sub = this.pool.subscribeMany(this.relays, filter, {
        onevent: (event) => {
          events.push(event)
        },
        oneose: () => {
          resolve(events)
        },
      })

      setTimeout(() => {
        sub.close()
        resolve(events)
      }, 5000)
    })
  }

  async getEvents(filter: Filter, timeoutMs: number = 5000): Promise<Event[]> {
    return new Promise((resolve) => {
      const events: Event[] = []
      const sub = this.pool.subscribeMany(this.getReadRelayUrls(), filter, {
        onevent: (event) => {
          events.push(event)
        },
        oneose: () => {
          resolve(events)
        },
      })

      setTimeout(() => {
        sub.close()
        resolve(events)
      }, timeoutMs)
    })
  }

  async publishEvent(event: Event, relayUrls?: string[]): Promise<boolean> {
    try {
      const results = await this.publishBounded(event, 4000, relayUrls)
      const succeeded = results.filter(Boolean).length
      this._lastEventTimestamp = new Date().toISOString()
      return succeeded > 0
    } catch (error) {
      console.error('Failed to publish event:', error)
      return false
    }
  }

  /**
   * Publish an event to all relays with a bounded timeout (default 4 s). Slow or
   * unreachable relays no longer keep the promise pending indefinitely —
   * otherwise the fire-and-forget callers (`.catch()`) accumulate dangling
   * WebSocket connections that exhaust libuv's thread pool and stall the event
   * loop (observed on the beta LAN: public mainnet relay TLS handshakes hung,
   * blocking webhook / fund-escrow / invoice routes for 60 s+). Returns one
   * boolean per relay (true = the relay accepted the event within the timeout).
   */
  private publishBounded(event: Event, timeoutMs = 4000, relayUrls?: string[]): Promise<boolean[]> {
    const target = relayUrls && relayUrls.length > 0 ? relayUrls : this.relays
    const pubs = this.pool.publish(target, event)
    return new Promise<boolean[]>((resolve) => {
      let done = false
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve(pubs.map(() => false)) }
      }, timeoutMs)
      Promise.allSettled(pubs).then(results => {
        if (!done) {
          done = true
          clearTimeout(timer)
          resolve(results.map(r => r.status === 'fulfilled' ? Boolean(r.value) : false))
        }
      })
    })
  }

  close(): void {
    this.pool.close(this.relays)
  }

  private async coEmitMarketSpecEvents(params: {
    ticketId: string
    status: string
    buyerPubkey: string
    sellerPubkey: string
    // ADR-204: xor — cooperation tickets have no offerId; offer tickets have no cooperationId.
    // Co-emit (NIP-115) is skipped for cooperation tickets since it targets marketplace listings.
    offerId?: string
    cooperationId?: string
    amountSats?: number
    preimage?: string
    paymentType?: string
    visibility?: 0 | 1 | 2
    eventType: 'created' | 'status'
  }): Promise<void> {
    try {
      // ADR-204: skip NIP-115 co-emit for cooperation tickets (market-spec is for listings)
      if (!shouldCoEmit(params.visibility) || params.cooperationId) return

      const senderSk = generateSecretKey()
      const timestamp = Math.floor(Date.now() / 1000)
      const recipients = [params.buyerPubkey, params.sellerPubkey]
      const allPubs: Promise<unknown>[] = []

      const orderTags = buildMarketSpecOrderTags({
        ticketId: params.ticketId,
        status: params.status,
        sellerPubkey: params.sellerPubkey,
        buyerPubkey: params.buyerPubkey,
        offerId: params.offerId,
        amountSats: params.amountSats,
        subject: params.eventType === 'created' ? 'order-info' : 'order-status',
      })

      if (orderTags) {
        const orderRumor = createRumor({
          kind: NOSTR_KINDS.MARKET_SPEC_ORDER,
          created_at: timestamp,
          tags: orderTags,
          content: '',
        }, senderSk)

        for (const recipient of recipients) {
          const seal = createSeal(orderRumor, senderSk, recipient)
          const wrapSk = generateSecretKey()
          const giftWrap = wrapEvent(seal, wrapSk, recipient)
          allPubs.push(...this.pool.publish(this.relays, giftWrap))
        }
      }

      if (params.preimage) {
        const receiptTags = buildMarketSpecReceiptTags({
          ticketId: params.ticketId,
          sellerPubkey: params.sellerPubkey,
          buyerPubkey: params.buyerPubkey,
          paymentType: params.paymentType,
          proof: params.preimage,
          amountSats: params.amountSats,
        })

        const receiptRumor = createRumor({
          kind: NOSTR_KINDS.MARKET_SPEC_RECEIPT,
          created_at: timestamp,
          tags: receiptTags,
          content: '',
        }, senderSk)

        for (const recipient of recipients) {
          const seal = createSeal(receiptRumor, senderSk, recipient)
          const wrapSk = generateSecretKey()
          const giftWrap = wrapEvent(seal, wrapSk, recipient)
          allPubs.push(...this.pool.publish(this.relays, giftWrap))
        }
      }

      // Bounded: gift-wrap publishes to slow relays must not stall the event loop.
      await Promise.race([
        Promise.allSettled(allPubs),
        new Promise<void>(r => setTimeout(r, 4000)),
      ])
      console.log('Market-spec co-emission published for ticket:', params.ticketId)
    } catch (error) {
      console.warn('Market-spec co-emission failed (non-blocking):', error)
    }
  }

  connectedRelayCount(): number {
    return this.relays.length
  }

  lastEventTimestamp(): string | null {
    return this._lastEventTimestamp
  }
}

// Singleton instance - reads relay URLs from environment on initialization
export const nostrService = new NostrRelayService()

// ---------------------------------------------------------------------------
// Ticket event tag builders (Kind 30407/30408) now live in @col/nostr-schema (ADR-150),
// the single source of truth shared by the server publish path and the client signer.
// Re-exported here so existing importers (index.ts, the checkout-tags test) keep their
// import path. market-spec vocabulary (a/item/order/payment) per ADR-142/143/149.
// ---------------------------------------------------------------------------

export { buildTicketCreatedTags, buildTicketStatusTags }
export type { TicketCreatedTagInput, TicketStatusTagInput } from '@col/nostr-schema'
