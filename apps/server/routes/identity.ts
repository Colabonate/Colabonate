import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { verifyEvent, type Event as NostrToolsEvent } from 'nostr-tools'
import type { ColPointsService } from '../services/colPointsService.js'
import { fetchReputationInput, computeReputationScore } from '../services/reputationService.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js'

// FU-749: the NIP-98 event cannot share the Authorization header with the session Bearer
// token (the `Nostr <base64>` and `Bearer` schemes are mutually exclusive — same constraint
// documented in middleware/require-admin.ts). The session therefore stays in Authorization
// and the NIP-98 signed event travels in this dedicated header.
export const NOSTR_AUTH_HEADER = 'x-nostr-auth'

interface NostrEvent {
  kind: number
  pubkey: string
  content: string
  tags: string[][]
  created_at?: number
  id?: string
  sig?: string
}

// NIP-98 auth events are single-use proofs; reject anything outside this freshness window
// (in seconds) to limit replay of a captured Authorization header.
const NIP98_MAX_AGE_SECONDS = 60

// Relay ownership verification (ADR-144, relaxed by ADR-379). The client publishes the
// missing Kind-0/credential immediately before calling /upgrade-l1, so we retry briefly to
// absorb relay propagation lag.
const L1_VERIFY_RETRIES = 3
const L1_VERIFY_RETRY_DELAY_MS = 1000
const L1_VERIFY_FETCH_TIMEOUT_MS = 2000

// Accepted credential kinds for the L1 identity credential (NIP-15 conflict dual-publish,
// ADR-101): legacy 30021 and NIP-compliant 30410. (Was 30405 pre-ADR-277 D0 — 30405 is now
// reserved exclusively for Gamma-Markets Product Collection, never a credential kind.)
const L1_CREDENTIAL_KINDS = [30021, 30410]

/** Fetches events matching a Nostr filter from a relay. Injected so it can be mocked in tests. */
export type RelayFetcher = (filter: { kinds: number[]; authors: string[] }, timeoutMs: number) => Promise<NostrEvent[]>

export interface L1OwnershipResult {
  verified: boolean
  reason?: 'kind0_missing' | 'credential_missing'
}

/**
 * Verifies that `nostrPubkey` actually published, on a relay, both:
 *   1. a validly signed Kind-0 profile (the L1 "Nostr Profile" requirement), and
 *   2. a Kind-30021/30410 credential with d-tag `identity-l1-<pubkey>`, validly signed.
 *
 * ADR-141 Issue 3 (self-claimed credential) is still closed by requiring the credential event.
 * ADR-379 relaxes ADR-144's extra `colabonate_pubkey === pubkey` binding inside Kind-0: an
 * existing profile the user already published with another client is adopted as-is, so importing
 * a Nostr profile no longer forces a destructive re-publish. Key ownership is already proven by
 * the NIP-98 signature (`authResult.event.pubkey === nostrPubkey`), and the protocol documents
 * `colabonate_pubkey` as a self-declared field that requires no verification
 * (docs/protocols/identity/identity-protocol.md §L1). Fail-closed: any missing/invalid event
 * returns `verified: false`. Retries with backoff to absorb propagation.
 */
export async function verifyL1Ownership(
  pubkey: string,
  nostrPubkey: string,
  fetchEvents: RelayFetcher,
): Promise<L1OwnershipResult> {
  const expectedDTag = `identity-l1-${pubkey}`

  for (let attempt = 0; attempt < L1_VERIFY_RETRIES; attempt++) {
    // Kind-0 profile signed by the signer. The content binding is not required (ADR-379).
    const kind0Events = await fetchEvents({ kinds: [0], authors: [nostrPubkey] }, L1_VERIFY_FETCH_TIMEOUT_MS)
    const validKind0 = kind0Events.find(ev =>
      ev.pubkey === nostrPubkey && verifyEvent(ev as unknown as NostrToolsEvent),
    )

    // Kind-30021/30410 credential addressed by d-tag, signed by nostrPubkey.
    const credEvents = await fetchEvents({ kinds: L1_CREDENTIAL_KINDS, authors: [nostrPubkey] }, L1_VERIFY_FETCH_TIMEOUT_MS)
    const validCredential = credEvents.find(ev =>
      ev.pubkey === nostrPubkey &&
      ev.tags.some(t => t[0] === 'd' && t[1] === expectedDTag) &&
      verifyEvent(ev as unknown as NostrToolsEvent),
    )

    if (validKind0 && validCredential) {
      return { verified: true }
    }

    // Not found yet — wait and retry (relay propagation lag), except after the last attempt.
    if (attempt < L1_VERIFY_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, L1_VERIFY_RETRY_DELAY_MS))
      continue
    }

    // Exhausted retries: report the most specific reason.
    if (!validKind0) {
      return { verified: false, reason: 'kind0_missing' }
    }
    return { verified: false, reason: 'credential_missing' }
  }

  return { verified: false, reason: 'kind0_missing' }
}

export function validateNip98Auth(authHeader: string, colabonatePubkey: string, method: string, path: string): { valid: boolean; event?: NostrEvent } {
  if (!authHeader.startsWith('Nostr ')) {
    return { valid: false }
  }

  try {
    const eventJson = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8')
    const event: NostrEvent = JSON.parse(eventJson)

    // CRITICAL: verify the cryptographic signature (and id hash) before trusting any field.
    // Without this, a forged JSON event with the right structure would pass (ADR-141 Issue 2).
    if (!verifyEvent(event as unknown as NostrToolsEvent)) {
      return { valid: false }
    }

    // Replay guard: the signed event must be recent (NIP-98 freshness).
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (typeof event.created_at !== 'number' || Math.abs(nowSeconds - event.created_at) > NIP98_MAX_AGE_SECONDS) {
      return { valid: false }
    }

    if (event.kind !== 22242) {
      return { valid: false }
    }

    const uTag = event.tags.find(t => t[0] === 'u')
    // NIP-98: clients SHOULD send the absolute URL in the `u` tag (the app has
    // done so since cb9a9c7); older builds sent the bare path. Normalize to the
    // pathname so both forms validate against the endpoint's relative `path`.
    const uPath = (() => {
      try {
        return new URL(uTag?.[1] ?? '').pathname
      } catch {
        return uTag?.[1]
      }
    })()
    if (!uTag || uPath !== path) {
      return { valid: false }
    }

    const methodTag = event.tags.find(t => t[0] === 'method')
    if (!methodTag || methodTag[1] !== method) {
      return { valid: false }
    }

    if (!event.content.startsWith(`colabonate-l1-upgrade:${colabonatePubkey}:`)) {
      return { valid: false }
    }

    return { valid: true, event }
  } catch {
    return { valid: false }
  }
}

export function createIdentityRouter(
  prisma: PrismaClient,
  colPointsService: ColPointsService,
  relayFetcher?: RelayFetcher,
) {
  const router = Router()

  // GET /api/identity/:pubkey
  router.get('/:pubkey', async (req, res) => {
    try {
      const { pubkey } = req.params
      const user = await prisma.user.findUnique({
        where: { pubkey },
        select: { pubkey: true, identityLevel: true, nostrPubkey: true, nip05: true, picture: true, name: true, about: true, banner: true, colPoints: true },
      })
      if (!user) {
        return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
      }

      const reviewCount = await prisma.review.count({ where: { revieweePubkey: pubkey } })
      const reputationInput = await fetchReputationInput(pubkey, prisma)
      const reputationScore = computeReputationScore(reputationInput)

      return res.json({ ...user, reputationScore, reviewCount })
    } catch (err) {
      console.error('[identity] GET /:pubkey error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
    }
  })

  // GET /api/identity/reviews/:pubkey
  router.get('/reviews/:pubkey', async (req, res) => {
    try {
      const { pubkey } = req.params
      const as = req.query.as === 'reviewer' ? 'reviewer' : 'reviewee'
      const where = as === 'reviewer'
        ? { reviewerPubkey: pubkey }
        : { revieweePubkey: pubkey }

      const reviews = await prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      })

      const averageStars = reviews.length > 0
        ? Math.round((reviews.reduce((sum, r) => sum + r.stars, 0) / reviews.length) * 10) / 10
        : 0

      return res.json({ reviews, averageStars, totalCount: reviews.length })
    } catch (err) {
      console.error('[identity] GET /reviews/:pubkey error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
    }
  })

  // POST /api/identity/upgrade-l1
  // FU-749: requires TWO independent credentials — the caller's session (Authorization: Bearer,
  // proves ownership of the Colabonate account `pubkey`) and a NIP-98 signed event
  // (X-Nostr-Auth, proves control of `nostrPubkey`). Neither alone is sufficient: the session
  // without NIP-98 would let a logged-in user bind a foreign Nostr key, and the NIP-98 without
  // the session (the pre-FU-749 state) let any keypair force-link itself to any account.
  router.post('/upgrade-l1', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      const { pubkey, nostrPubkey, nip05, picture } = req.body
      const authHeader = (req.headers[NOSTR_AUTH_HEADER] as string | undefined) ?? ''

      if (!pubkey || !nostrPubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'pubkey and nostrPubkey are required' })
      }

      // FU-749: the authenticated session must own the account being upgraded. Never trust the
      // body `pubkey` (pre-FU-749 it was taken at face value from an unauthenticated caller).
      if (pubkey !== req.authPubkey) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot upgrade another account' })
      }

      if (!/^[0-9a-f]{64}$/i.test(nostrPubkey)) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'nostrPubkey must be 64 hex characters' })
      }

      const authResult = validateNip98Auth(authHeader, pubkey, 'POST', '/api/identity/upgrade-l1')
      if (!authResult.valid) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: 'NIP-98 authorization required' })
      }

      if (authResult.event && authResult.event.pubkey !== nostrPubkey) {
        return res.status(400).json({ error: 'NOSTR_KEY_MISMATCH', message: 'Signed Nostr key does not match claimed nostrPubkey' })
      }

      const user = await prisma.user.findUnique({ where: { pubkey } })
      if (!user) {
        return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
      }

      if (user.identityLevel >= 1) {
        return res.status(400).json({ error: 'ALREADY_UPGRADED', message: 'User is already at Level 1 or higher' })
      }

      // ADR-144: verify the user actually published a Colabonate-linked credential on a relay.
      // Fail-closed — a missing/invalid credential blocks the upgrade. Skipped only when no
      // relay fetcher is wired (e.g. unit tests that exercise other branches).
      if (relayFetcher) {
        const ownership = await verifyL1Ownership(pubkey, nostrPubkey, relayFetcher)
        if (!ownership.verified) {
          return res.status(403).json({
            error: 'CREDENTIAL_NOT_VERIFIED',
            message: 'Could not verify your Nostr profile and Level 1 credential on the relay. Make sure both were published, then try again.',
            reason: ownership.reason,
          })
        }
      }

      const updated = await prisma.user.update({
        where: { pubkey },
        data: { identityLevel: 1, nostrPubkey, nip05: nip05 ?? null, picture: picture ?? null },
        select: { pubkey: true, identityLevel: true, nostrPubkey: true, nip05: true, picture: true, colPoints: true },
      })

      return res.json(updated)
    } catch (err) {
      console.error('[identity] POST /upgrade-l1 error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
    }
  })

  // POST /api/identity/sync-nostr-profile
  // Pulls the user's Kind 0 profile metadata from relays and persists the
  // display fields (picture, name, about, banner, nip05). First-sync-wins per
  // field: the server only fills a field when it is still null, so repeated
  // calls (or a caller passing someone else's nostrPubkey) cannot overwrite
  // existing values. Display-only metadata — no identityLevel changes here.
  router.post('/sync-nostr-profile', async (req, res) => {
    try {
      const { pubkey, nostrPubkey } = req.body

      if (!pubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'pubkey is required' })
      }

      const user = await prisma.user.findUnique({ where: { pubkey } })
      if (!user) {
        return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
      }

      // Resolve the Nostr key to look up: the L1-bound key always wins over
      // the body param once set, so a bound account cannot be redirected to a
      // stranger's Kind 0 by an unauthenticated caller.
      const bodyKey = typeof nostrPubkey === 'string' && /^[0-9a-f]{64}$/i.test(nostrPubkey)
        ? nostrPubkey.toLowerCase()
        : null
      const targetNostrPubkey = user.nostrPubkey ?? bodyKey

      if (!targetNostrPubkey) {
        return res.status(400).json({ error: 'NO_NOSTR_KEY', message: 'No Nostr pubkey available to sync from' })
      }

      if (!relayFetcher) {
        return res.status(503).json({ error: 'RELAY_UNAVAILABLE', message: 'Relay fetcher not configured' })
      }

      const payloadOf = () => ({
        pubkey: user.pubkey,
        identityLevel: user.identityLevel,
        nostrPubkey: user.nostrPubkey,
        nip05: user.nip05,
        picture: user.picture,
        name: user.name,
        about: user.about,
        banner: user.banner,
        colPoints: user.colPoints,
      })

      // Everything already synced — skip the relay round-trip.
      if (user.picture && user.name && user.banner && user.about && user.nip05) {
        const reviewCount = await prisma.review.count({ where: { revieweePubkey: pubkey } })
        const reputationInput = await fetchReputationInput(pubkey, prisma)
        const reputationScore = computeReputationScore(reputationInput)
        return res.json({ ...payloadOf(), synced: false, reputationScore, reviewCount })
      }

      const events = await relayFetcher({ kinds: [0], authors: [targetNostrPubkey] }, 3000)
      if (events.length === 0) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'No Kind 0 profile found on relays for this pubkey' })
      }
      const mostRecent = events.reduce((a, b) => ((b.created_at ?? 0) > (a.created_at ?? 0) ? b : a), events[0])
      let content: Record<string, string> = {}
      try { content = JSON.parse(mostRecent.content) } catch { /* ignore */ }

      // Fill-once: only fields still null in the DB, only non-empty strings.
      const data: { picture?: string; name?: string; about?: string; banner?: string; nip05?: string } = {}
      if (!user.picture && typeof content.picture === 'string' && content.picture) data.picture = content.picture
      const kind0Name = content.display_name || content.name
      if (!user.name && typeof kind0Name === 'string' && kind0Name) data.name = kind0Name
      if (!user.about && typeof content.about === 'string' && content.about) data.about = content.about
      if (!user.banner && typeof content.banner === 'string' && content.banner) data.banner = content.banner
      if (!user.nip05 && typeof content.nip05 === 'string' && content.nip05) data.nip05 = content.nip05

      if (Object.keys(data).length > 0) {
        const updated = await prisma.user.update({
          where: { pubkey },
          data,
          select: { pubkey: true, identityLevel: true, nostrPubkey: true, nip05: true, picture: true, name: true, about: true, banner: true, colPoints: true },
        })
        Object.assign(user, updated)
      }

      const reviewCount = await prisma.review.count({ where: { revieweePubkey: pubkey } })
      const reputationInput = await fetchReputationInput(pubkey, prisma)
      const reputationScore = computeReputationScore(reputationInput)
      return res.json({ ...payloadOf(), synced: true, reputationScore, reviewCount })
    } catch (err) {
      console.error('[identity] POST /sync-nostr-profile error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
    }
  })

  // POST /api/identity/upgrade-l1-mock
  // PHASE 3 MOCK: For testing without real Nostr credentials
  router.post('/upgrade-l1-mock', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Mock endpoints are disabled in production.' })
    }

    try {
      const { pubkey } = req.body

      if (!pubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'pubkey is required' })
      }

      const user = await prisma.user.findUnique({ where: { pubkey } })
      if (!user) {
        return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
      }

      if (user.identityLevel >= 1) {
        return res.status(400).json({ error: 'ALREADY_UPGRADED', message: 'User is already at Level 1 or higher' })
      }

      const updated = await prisma.user.update({
        where: { pubkey },
        data: {
          identityLevel: 1,
          nostrPubkey: user.nostrPubkey ?? `mock_nostr_${pubkey.slice(0, 16)}_pubkey`,
          nip05: user.nip05 ?? `${pubkey.slice(0, 8)}@colabonate.test`,
        },
        select: { pubkey: true, identityLevel: true, nostrPubkey: true, nip05: true, picture: true, colPoints: true },
      })

      return res.json(updated)
    } catch (err) {
      console.error('[identity] POST /upgrade-l1-mock error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
    }
  })

  // POST /api/identity/reset
  // Reset identity level to 0 (for testing)
  router.post('/reset', async (req, res) => {
    try {
      const { pubkey } = req.body

      if (!pubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'pubkey is required' })
      }

      const user = await prisma.user.findUnique({ where: { pubkey } })
      if (!user) {
        return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
      }

      const updated = await prisma.user.update({
        where: { pubkey },
        data: {
          identityLevel: 0,
          nostrPubkey: null,
          nip05: null,
        },
        select: { pubkey: true, identityLevel: true, nostrPubkey: true, nip05: true, picture: true, colPoints: true },
      })

      return res.json(updated)
    } catch (err) {
      console.error('[identity] POST /reset error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
    }
  })

  // POST /api/identity/upgrade-l2-mock
  // PHASE 3 MOCK: Real verifier pool logic = Phase 4
  router.post('/upgrade-l2-mock', async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Mock endpoints are disabled in production.' })
    }

    try {
      const { pubkey } = req.body

      if (!pubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'pubkey is required' })
      }

      const user = await prisma.user.findUnique({ where: { pubkey } })
      if (!user) {
        return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
      }

      if (user.identityLevel < 1) {
        return res.status(400).json({ error: 'LEVEL_REQUIREMENT', message: 'Identity Level 1 required for Level 2 upgrade' })
      }

      if (user.identityLevel >= 2) {
        return res.status(400).json({ error: 'ALREADY_UPGRADED', message: 'User is already at Level 2 or higher' })
      }

      const updated = await prisma.user.update({
        where: { pubkey },
        data: { identityLevel: 2 },
        select: { pubkey: true, identityLevel: true, nostrPubkey: true, nip05: true, picture: true, colPoints: true },
      })

      await colPointsService.awardPoints(pubkey, 50, 'HID_L2_UPGRADE')

      return res.json({ ...updated, colPoints: updated.colPoints + 50 })
    } catch (err) {
      console.error('[identity] POST /upgrade-l2-mock error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
    }
  })

  return router
}
