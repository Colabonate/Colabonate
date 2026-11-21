import { Router } from 'express'
import { verifyEvent } from 'nostr-tools'
import { nostrService } from '../services/nostr-relay'
import { validateCommerceEnvelope } from '../lib/enums'
import { decodeCursor, encodeCursor } from '../lib/pagination.js'
import { syncProductGammaTags } from '../services/gamma-category-map.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js'
import { resolveOfferSigningKey, hasSigningIdentityKey } from '../services/nostr-signing-identity.js'
import { readLnurlpDomain } from '../lib/lnAddressHandle.js'
import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * ADR-412 D1: publish (or re-publish) an Offer as Kind 30017/30402 and write the
 * resulting event id back to nostrEventId. Extracted so both the manual
 * `POST /api/nostr/offers` route AND the real create/edit paths
 * (apps/server/index.ts `POST`/`PATCH /api/offers`) share one implementation:
 * previously only the manual route existed and nothing in the app ever called
 * it, so offers were never actually published (ADR-412 Bug A).
 *
 * Best-effort: callers should fire-and-forget this and never let it fail the
 * HTTP response an offer create/edit already promises.
 */
export async function publishAndSyncOffer(prisma: PrismaClient, offerId: string): Promise<string | null> {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { offerMilestones: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!offer) return null
  if (offer.visibility === 'PRIVATE') return null // ADR-152: DM-only, never Kind 30402

  // Incident 2026-11-20 (ADR-412 amendment follow-up): REMOTE offers must
  // NEVER be (re-)published by us. They are foreign listings displayed
  // read-only (ADR-415); re-publishing one duplicates it under a
  // Colabonate-custodied signing key — with our `client` tag attached —
  // which is exactly the "carrier client" pattern ecosystem stats sites
  // exclude whole apps for. Choke-point guard so every caller (create/edit
  // wiring, manual route, backfill scripts) is covered.
  if (offer.source !== 'LOCAL') {
    console.log(
      `[Nostr] Skipping publish for ${offer.source} offer ${offer.id} — ` +
      `only LOCAL offers are published (incident 2026-11-20, ADR-412 amendment)`,
    )
    return null
  }

  const images: string[] = Array.isArray(offer.images)
    ? offer.images.filter((item): item is string => typeof item === 'string')
    : []

  await nostrService.connect()

  // ADR-412 D2: persistent per-entity signing key (Company, or the creator's
  // own listing key for individual sellers) instead of a fresh ephemeral one
  // per publish. Falls back to ephemeral when at-rest encryption isn't
  // configured (dev without NWC_SECRET_KEY), same fallback as Company/
  // Collection/ShippingOption.
  let signingKey: Uint8Array | undefined
  if (hasSigningIdentityKey()) {
    const identity = await resolveOfferSigningKey(prisma, { companyId: offer.companyId, creatorPubkey: offer.creatorPubkey })
    signingKey = identity.sk
    if (identity.isNew) {
      let profile: { name: string; picture?: string | null; nip05: string } | null = null
      if (offer.companyId) {
        const company = await prisma.company.findUnique({ where: { id: offer.companyId }, select: { name: true, logoUrl: true } })
        if (company) profile = { name: company.name, picture: company.logoUrl, nip05: `${offer.companyId}@${readLnurlpDomain()}` }
      } else {
        const user = await prisma.user.findUnique({ where: { pubkey: offer.creatorPubkey }, select: { id: true, name: true, picture: true } })
        if (user) profile = { name: user.name ?? 'Colabonate Seller', picture: user.picture, nip05: `${user.id}@${readLnurlpDomain()}` }
      }
      if (profile) await nostrService.publishEntityProfile(identity.sk, profile)
    }
  }

  const event = await nostrService.publishOffer({
    id: offer.id,
    title: offer.title,
    description: offer.description || undefined,
    priceSats: offer.priceSats,
    creatorPubkey: offer.creatorPubkey,
    location: offer.location || undefined,
    country: offer.country || undefined,
    city: offer.city || undefined,
    offerType: offer.offerType,
    ticketType: offer.ticketType,
    categoryCode: offer.categoryCode || undefined,
    gammaTags: offer.gammaTags.length > 0 ? offer.gammaTags : undefined,
    productType: offer.productType,
    physicalType: offer.physicalType,
    parentOfferId: offer.parentOfferId,
    specs: offer.specs,
    variantValues: offer.variantValues,
    stock: offer.stock,
    weight: offer.weight,
    weightUnit: offer.weightUnit,
    dimensions: offer.dimensions,
    dimensionsUnit: offer.dimensionsUnit,
    listingVisibility: offer.listingVisibility,
    shippingOptionRefs: offer.shippingOptionRefs,
    deliveryTimeDays: offer.deliveryTimeDays ?? undefined,
    deliveryCostSats: offer.deliveryCostSats ?? undefined,
    images: images.length > 0 ? images : undefined,
    milestones: offer.offerMilestones.length > 0
      ? offer.offerMilestones.map(m => ({ title: m.title, percentage: m.percentage }))
      : undefined,
    publishedAt: offer.publishedAt ? Math.floor(offer.publishedAt.getTime() / 1000) : undefined,
    // ADR-152: pass visibility so publishOffer() can filter PRIVATE offers
    visibility: offer.visibility,
  }, signingKey)

  if (!event) return null
  await prisma.offer.update({ where: { id: offer.id }, data: { nostrEventId: event.id } })
  if (offer.productId) {
    // ADR-277 D-6: keep the product's gamma-axis facet fresh, best-effort, must not
    // fail the publish response it's attached to.
    try {
      await syncProductGammaTags(prisma, offer.productId)
    } catch (syncError) {
      console.error('Failed to sync Product.gammaTags:', syncError)
    }
  }
  return event.id
}

function createNostrRouter(prisma: PrismaClient) {
const router = Router()

// Test nostr connection
router.get('/test', async (_req, res) => {
  try {
    await nostrService.connect()
    res.json({ status: 'connected', relays: ['wss://relay.damus.io'] })
  } catch (error) {
    res.status(500).json({ status: 'error', message: error instanceof Error ? error.message : 'Unknown error' })
  }
})

// Get offers by seller
router.get('/offers/:sellerPubkey', async (req, res) => {
  try {
    const { sellerPubkey } = req.params
    const offers = await nostrService.getOffersBySeller(sellerPubkey)
    res.json({ offers })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch offers' })
  }
})

// Re-publish offer (manual trigger – e.g. admin/ops backfill; fetches full offer from DB)
router.post('/offers', async (req, res) => {
  try {
    const { offerId } = req.body
    if (!offerId) return res.status(400).json({ error: 'offerId required' })

    const offer = await prisma.offer.findUnique({ where: { id: offerId }, select: { visibility: true } })
    if (!offer) return res.status(404).json({ error: 'Offer not found' })

    const eventId = await publishAndSyncOffer(prisma, offerId)

    if (eventId) {
      res.json({ success: true, event: { id: eventId } })
    } else if (offer.visibility === 'PRIVATE') {
      // ADR-152: PRIVATE offers are skipped, not an error
      res.json({
        success: false,
        skipped: true,
        reason: 'PRIVATE_OFFER_DM_ONLY',
        message: 'Private offers are not published as Kind 30402. They use NIP-17 encrypted DMs only.',
      })
    } else {
      res.status(500).json({ success: false, error: 'Failed to publish offer' })
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to publish offer' })
  }
})

// NIP-17: Get user's DM relay preferences (Kind 10050)
router.get('/dm/relays/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params
    const events = await nostrService.getEvents({
      kinds: [10050],
      authors: [pubkey],
      limit: 1,
    })

    // SECURITY (pentest G3, FU-720): a malicious/compromised relay could
    // serve a forged Kind 10050 event to redirect a victim's future DM
    // delivery — verify the signature before trusting relay content.
    const verified = events.filter(e => verifyEvent(e))
    if (verified.length > 0) {
      const relayList = JSON.parse(verified[0].content)
      res.json({ relays: relayList })
    } else {
      res.json({ relays: [] })
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch DM relays' })
  }
})

// NIP-17: Publish gift-wrapped DM (optional backend-assisted publishing)
router.post('/dm/publish', async (req, res) => {
  try {
    const { event, relayUrls } = req.body

    if (
      !event ||
      typeof event.id !== 'string' ||
      typeof event.pubkey !== 'string' ||
      typeof event.content !== 'string' ||
      typeof event.sig !== 'string' ||
      typeof event.kind !== 'number' ||
      typeof event.created_at !== 'number' ||
      !Array.isArray(event.tags)
    ) {
      return res.status(400).json({ error: 'Invalid gift-wrapped event format' })
    }

    // SECURITY (pentest G3, FU-718): the "relay will do cryptographic
    // verification" assumption is only true for real public relays — the
    // beta mock relay accepts any EVENT without checking the signature.
    if (!verifyEvent(event)) {
      return res.status(400).json({ error: 'Invalid event signature' })
    }

    const targetRelays = relayUrls && relayUrls.length > 0
      ? relayUrls
      : ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

    const published = await nostrService.publishEvent(event, targetRelays)
    
    if (published) {
      res.json({ success: true, eventId: event.id })
    } else {
      res.status(500).json({ success: false, error: 'Failed to publish to relays' })
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to publish DM' })
  }
})

// ADR-162 / NIP-51 (Phase 6, C-T8): mirror a user's trusted-arbiter follow-set
// (kind:30000, d=colabonate:trusted-arbiters) for fast lookup. The Nostr
// relay is the source of truth; this is a thin fetch+parse cache like the DM
// relay-list endpoint above.
const TRUSTED_ARBITER_SET_D = 'colabonate:trusted-arbiters'
router.get('/trusted-arbiters/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params
    const events = await nostrService.getEvents({
      kinds: [30000],
      authors: [pubkey],
      '#d': [TRUSTED_ARBITER_SET_D],
      limit: 1,
    })
    // SECURITY (pentest G3, FU-720): a forged event here would inject an
    // attacker-controlled arbiter into a user's dispute-resolution trust set
    // — the most consequential of the four relay-fetched-content endpoints.
    const verified = events.filter(e => verifyEvent(e))
    if (verified.length === 0) {
      return res.json({ pubkeys: [], listEventId: null })
    }
    const ev = verified[0]
    const pubkeys = ev.tags
      .filter(t => t[0] === 'p' && /^[0-9a-fA-F]{64}$/.test(t[1]))
      .map(t => t[1].toLowerCase())
    res.json({ pubkeys: [...new Set(pubkeys)], listEventId: ev.id })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch trusted arbiters' })
  }
})

// NIP-17: Fetch chat messages between two users
router.get('/dm/messages', async (req, res) => {
  try {
    const { pubkey, otherPubkey, since, limit } = req.query
    
    if (!pubkey || !otherPubkey) {
      return res.status(400).json({ error: 'Missing pubkey or otherPubkey parameter' })
    }
    
    const events = await nostrService.getEvents({
      kinds: [14, 15],
      '#p': [pubkey as string],
      since: since ? parseInt(since as string) : Math.floor(Date.now() / 1000) - 86400 * 7,
      limit: limit ? parseInt(limit as string) : 50,
    })
    
    // SECURITY (pentest G3, FU-720): verify signatures before trusting
    // relay-fetched message content.
    const messages = events
      .filter(e => verifyEvent(e))
      .filter(e => e.pubkey === otherPubkey || e.tags.some(t => t[0] === 'p' && t[1] === otherPubkey))
      .map(e => ({
        id: e.id,
        pubkey: e.pubkey,
        content: e.content,
        created_at: e.created_at,
        kind: e.kind,
      }))
    
    res.json({ messages })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch messages' })
  }
})

// ADR-107: NIP-B v2 — Client-signed event relay publishing
// Accepts a pre-signed Nostr event from the client and forwards it to the relay pool.
// This is the server-assisted fallback for when the client cannot reach the relay directly.
// The server verifies the event signature before publishing to prevent relay spam.
router.post('/relay-signed', async (req, res) => {
  try {
    const { event } = req.body as { event?: Record<string, unknown> }

    if (!event) {
      return res.status(400).json({ error: 'Missing event in request body' })
    }

    // Basic structural validation — relay will do cryptographic verification
    if (
      typeof event.id !== 'string' ||
      typeof event.pubkey !== 'string' ||
      typeof event.sig !== 'string' ||
      typeof event.kind !== 'number' ||
      typeof event.created_at !== 'number' ||
      !Array.isArray(event.tags)
    ) {
      return res.status(400).json({ error: 'Invalid Nostr event structure' })
    }

    // Only allow NIP-B + NIP-C + DAO-governance kinds via this endpoint
    // (rate-limit attack surface). 30020/30022 added 2026-09-18: the
    // Council verdict flow's redundant server-relay fallback
    // (publishSignedEventToServer in nostr-ticket.ts) was silently 403ing
    // on every single dispute-open (30020) and arbitration-verdict (30022)
    // event — the primary direct-to-relay publish still succeeded, but the
    // resilience backup for the DAO's decentralized documentation was dead.
    const ALLOWED_KINDS = [30020, 30022, 30407, 30408, 30414, 30415]
    if (!ALLOWED_KINDS.includes(event.kind as number)) {
      return res.status(403).json({
        error: `Kind ${event.kind} is not allowed via this endpoint. Allowed: Dispute [30020], DAO governance [30022], NIP-B [30407, 30408], NIP-C [30414, 30415]`,
      })
    }

    // Reject events older than 5 minutes (prevents replay attacks)
    const ageSeconds = Math.floor(Date.now() / 1000) - (event.created_at as number)
    if (ageSeconds > 300) {
      return res.status(400).json({ error: 'Event is too old (max 5 minutes)' })
    }

    const nostrEvent = event as Parameters<typeof nostrService.publishEvent>[0]
    // SECURITY (pentest G3, FU-718): the kind allowlist limits abuse surface
    // but does not authorize content — an unverified event of an allowed kind
    // could still carry forged content. Verify the signature before publishing.
    if (!verifyEvent(nostrEvent)) {
      return res.status(400).json({ error: 'Invalid event signature' })
    }

    const published = await nostrService.publishEvent(nostrEvent)

    if (published) {
      res.json({ success: true, eventId: event.id })
    } else {
      res.status(500).json({ success: false, error: 'Event was not accepted by any relay' })
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to publish signed event' })
  }
})

// ---------------------------------------------------------------------------
// ADR-152 §1.3 / Phase 1.3: DM-API für Privat-Offers
//
// These routes back the private-offer workflow (Phase 2 UI):
//   - POST /api/nostr/dm/publish-offer    — server-assisted publishing of a
//                                            pre-signed Gift Wrap to the relay pool
//   - GET  /api/nostr/dm/private-offers    — list a user's cached DmMessages
//   - GET  /api/nostr/dm/private-offers/:id — detail of a single DmMessage
//
// The server is a RELAY HELPER, not the source of truth: the relay stores the
// actual event, the DB row is a cache for inbox rendering and dispute audit.
// ---------------------------------------------------------------------------

// POST /api/nostr/dm/publish-offer
// Body: { event: NostrEvent, recipientPubkey: string, optional relayUrls: string[] }
// The event must be a client-signed Kind 1059 Gift Wrap targeted at recipientPubkey.
// The server forwards to its relay pool as a redundancy layer.
router.post('/dm/publish-offer', async (req, res) => {
  try {
    const { event, recipientPubkey, relayUrls } = req.body as {
      event?: Record<string, unknown>
      recipientPubkey?: string
      relayUrls?: string[]
    }

    if (
      !event ||
      typeof event.id !== 'string' ||
      typeof event.pubkey !== 'string' ||
      typeof event.content !== 'string' ||
      typeof event.sig !== 'string' ||
      typeof event.kind !== 'number' ||
      typeof event.created_at !== 'number' ||
      !Array.isArray(event.tags)
    ) {
      return res.status(400).json({ error: 'Invalid gift-wrapped event format' })
    }
    if (!recipientPubkey) {
      return res.status(400).json({ error: 'recipientPubkey is required' })
    }
    // Only Kind 1059 is accepted via this endpoint (NIP-17 gift wrap).
    if ((event.kind as number) !== 1059) {
      return res.status(403).json({ error: 'Only Kind 1059 (NIP-17 gift wrap) is accepted via this endpoint' })
    }
    // Reject events older than 5 minutes (replay protection)
    const ageSeconds = Math.floor(Date.now() / 1000) - (event.created_at as number)
    if (ageSeconds > 300) {
      return res.status(400).json({ error: 'Event is too old (max 5 minutes)' })
    }
    // Verify the event is addressed to the claimed recipient (the #p tag)
    const pTags = (event.tags as string[][]).filter(t => t[0] === 'p')
    if (!pTags.some(t => t[1] === recipientPubkey)) {
      return res.status(400).json({ error: 'Event #p tag does not match recipientPubkey' })
    }

    const nostrEvent = event as Parameters<typeof nostrService.publishEvent>[0]
    // SECURITY (pentest G3, FU-718): verify the signature before forwarding
    // to relays — mirrors the fix on /dm/publish and /relay-signed.
    if (!verifyEvent(nostrEvent)) {
      return res.status(400).json({ error: 'Invalid event signature' })
    }

    const targetRelays = relayUrls && relayUrls.length > 0
      ? relayUrls
      : ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

    const published = await nostrService.publishEvent(nostrEvent, targetRelays)

    if (published) {
      res.json({ success: true, eventId: event.id, relays: targetRelays })
    } else {
      res.status(500).json({ success: false, error: 'Failed to publish to any relay' })
    }
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to publish DM' })
  }
})

// GET /api/nostr/dm/private-offers
// Returns the cached DmMessage inbox rows for the authenticated user.
// SECURITY (pentest G3, 2026-09-17): this route has no auth or ownership
// check at all despite its own now-corrected comment — any unauthenticated
// caller could pass an arbitrary ownerPubkey and read that user's full
// decrypted NIP-17 DM inbox. requireAuth + an explicit ownership check
// closes it; same pattern as wallet.ts's resolveOwnUser().
// Cursor-paginated (newest first): pass `after` = pageInfo.endCursor of the
// previous response to fetch the next (older) page. `totalCount` is the real
// total number of inbox rows for the owner (respecting `since`).
router.get('/dm/private-offers', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const ownerPubkey = (req.query.ownerPubkey as string | undefined) || (req.query.pubkey as string | undefined) || req.authPubkey
    if (!ownerPubkey) {
      return res.status(400).json({ error: 'ownerPubkey (or pubkey) query parameter is required' })
    }
    if (!/^[0-9a-fA-F]{64}$/.test(ownerPubkey)) {
      return res.status(400).json({ error: 'ownerPubkey must be a 64-char hex string' })
    }
    if (ownerPubkey !== req.authPubkey) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot read another user\'s DM inbox' })
    }
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200)
    const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined
    const cursor = typeof req.query.after === 'string' ? decodeCursor(req.query.after) : null

    const baseWhere: Prisma.DmMessageWhereInput = {
      ownerPubkey,
      ...(since ? { createdAt: { gte: new Date(since * 1000) } } : {}),
    }
    let where: Prisma.DmMessageWhereInput = baseWhere
    if (cursor) {
      const cursorDate = new Date(cursor.sortKey)
      where = {
        AND: [
          baseWhere,
          {
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: cursor.id } },
            ],
          },
        ],
      }
    }

    const [rows, totalCount] = await Promise.all([
      prisma.dmMessage.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      prisma.dmMessage.count({ where: baseWhere }),
    ])

    const messages = rows.slice(0, limit)
    const last = messages[messages.length - 1]

    res.json({
      messages,
      totalCount,
      pageInfo: {
        hasNextPage: rows.length > limit,
        endCursor: last ? encodeCursor(last.id, last.createdAt.toISOString()) : null,
      },
    })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch inbox' })
  }
})

// GET /api/nostr/dm/private-offers/:id
// Returns a single DmMessage row by its cuid.
// SECURITY (pentest G3, 2026-09-17): previously had no ownership check at
// all — any cuid could be read by cycling/guessing ids. 404 (not 403) on a
// mismatch so the response doesn't confirm the id exists to a non-owner.
router.get('/dm/private-offers/:id', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id
    const message = await prisma.dmMessage.findUnique({ where: { id } })
    if (!message || message.ownerPubkey !== req.authPubkey) {
      return res.status(404).json({ error: 'DmMessage not found' })
    }
    res.json({ message })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch DmMessage' })
  }
})

// POST /api/nostr/dm/cache-message
// Allows the client to push a decrypted DmMessage into the server cache after
// unwrapping a Gift Wrap locally. This is the inbox-render helper.
// SECURITY (pentest G3, 2026-09-17, FU-719): previously accepted any
// ownerPubkey from an unauthenticated caller, letting anyone inject a
// fabricated (including forged commerce-envelope) message into another
// user's cached DM inbox. requireAuth + an explicit ownership check closes
// it, same pattern as the /dm/private-offers fix above (FU-715).
router.post('/dm/cache-message', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { ownerPubkey, peerPubkey, eventId, kind, payload, ticketId } = req.body as {
      ownerPubkey?: string
      peerPubkey?: string
      eventId?: string
      kind?: number
      payload?: string
      ticketId?: string
    }
    if (!ownerPubkey || !peerPubkey || !eventId || kind === undefined || !payload) {
      return res.status(400).json({ error: 'ownerPubkey, peerPubkey, eventId, kind, payload are required' })
    }
    if (!/^[0-9a-fA-F]{64}$/.test(ownerPubkey) || !/^[0-9a-fA-F]{64}$/.test(peerPubkey)) {
      return res.status(400).json({ error: 'ownerPubkey and peerPubkey must be 64-char hex strings' })
    }
    if (ownerPubkey !== req.authPubkey) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot write to another user\'s DM inbox' })
    }
    // ADR-161 / FU-08: hard validation gate at the DM consume boundary.
    // Commerce envelopes (JSON with a `type`) must pass the canonical schema;
    // malformed payloads are rejected instead of cached. Free-text passes through.
    try {
      validateCommerceEnvelope(payload)
    } catch (validationError) {
      console.warn('[dm/cache-message] envelope validation failed:', validationError)
      return res.status(400).json({
        error: 'Invalid commerce envelope payload',
        code: 'INVALID_ENVELOPE',
      })
    }
    const message = await prisma.dmMessage.upsert({
      where: { eventId },
      create: { ownerPubkey, peerPubkey, eventId, kind, payload, ticketId: ticketId ?? null },
      update: {}, // Idempotent: never overwrite
    })
    res.status(201).json({ message })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to cache DmMessage' })
  }
})

// Fetch Nostr Kind 0 profile metadata from relays by hex pubkey.
// Returns { name, picture, about, nip05, lud16 } or 404 if no Kind 0 found.
router.get('/profile/:hexPubkey', async (req, res) => {
  try {
    const { hexPubkey } = req.params
    if (!/^[0-9a-f]{64}$/i.test(hexPubkey)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'hexPubkey must be 64 hex characters' })
    }
    const events = await nostrService.getEvents(
      { kinds: [0], authors: [hexPubkey.toLowerCase()], limit: 1 },
      4000,
    )
    // SECURITY (pentest G3, FU-720): an unverified event here would let a
    // malicious relay impersonate anyone's name/picture/nip05/lud16.
    const verified = events.filter(e => verifyEvent(e))
    if (verified.length === 0) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'No Kind 0 profile found on relays for this pubkey' })
    }
    const mostRecent = verified.reduce((a, b) => (b.created_at > a.created_at ? b : a), verified[0])
    let content: Record<string, string> = {}
    try { content = JSON.parse(mostRecent.content) } catch { /* ignore */ }
    res.json({
      name: content.name ?? '',
      picture: content.picture ?? '',
      about: content.about ?? '',
      nip05: content.nip05 ?? '',
      lud16: content.lud16 ?? '',
      banner: content.banner ?? '',
    })
  } catch (err) {
    console.error('[nostr] GET /profile/:hexPubkey error:', err)
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch Nostr profile' })
  }
})

   return router
}

export { createNostrRouter }
