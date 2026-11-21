import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
const __rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
dotenv.config({ path: resolve(__rootDir, '.env') })

// Email transport self-check (logs once at boot so the operator sees which
// transport is active — RESEND_API_KEY value is redacted to last-4 only).
const resendKey = process.env.RESEND_API_KEY
const resendFrom = process.env.RESEND_FROM_EMAIL
const smtpHost = process.env.SMTP_HOST
if (resendKey) {
  console.log(`[boot] Email transport: Resend (key=…${resendKey.slice(-4)}, from=${resendFrom ?? 'Colabonate Team <noreply@agantila.com>'})`)
} else if (smtpHost) {
  console.log(`[boot] Email transport: SMTP (host=${smtpHost}, port=${process.env.SMTP_PORT ?? '587'})`)
} else {
  console.warn(`[boot] Email transport: NONE configured — magic-link login will fall back to dev debugLink in non-production. Set RESEND_API_KEY or SMTP_HOST in .env.`)
}
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma, type CooperationStatus } from '@prisma/client'
import { createNostrRouter, publishAndSyncOffer } from './routes/nostr.js'
import { createLnurlRouter } from './routes/auth.js'
import { nostrService, buildTicketStatusTags, buildTicketCreatedTags } from './services/nostr-relay.js'
import { resolveOfferSigningKey, hasSigningIdentityKey } from './services/nostr-signing-identity.js'
import { NOSTR_KINDS } from './services/kind-mapping.js'
import { createLightningRouter, registerInvoice, sweepExpiredInvoices } from './routes/lightning.js'
import { createProvider, type ProviderType } from '@col/payments'
import type { PaymentProvider } from '@col/payments'
import { NostrTicketListener } from './services/nostr-ticket-listener.js'
import { attachMockRelay } from './services/mock-relay.js'
import { ColPointsService } from './services/colPointsService.js'
import { formatVariantLabel, normalizeGammaTags } from '@col/nostr-schema'
import { createIdentityRouter } from './routes/identity.js'
import { createReviewsRouter } from './routes/reviews.js'
import { createAgentProfileRouter } from './routes/agent-profiles.js'
import { createAgentTaskRouter } from './routes/agent-tasks.js'
import { createAgentNetworkRouter } from './routes/agent-networks.js'
import { validateOrchestrationSteps, matchAgentsToOrchestration, collectAssigneeOfferPairs, type OrchestrationStep, type MilestoneAssigneeInput } from './services/agent-orchestration.js'
import { createWorkspaceRouter } from './routes/workspaces.js'
import { runAgentTaskMatcherTick } from './services/agent-task-matcher.js'
import { runWorkspaceExpirySweep } from './services/workspace-lifecycle.js'
import { computeAgentMarketplaceStats } from './services/agent-marketplace.js'
import { createCompanyRouter } from './routes/company.js'
import { createDeliveryTemplateRouter } from './routes/delivery-template.js'
import { createShippingOptionRouter } from './routes/shipping-option.js'
import { createCollectionRouter } from './routes/collection.js'
import { createBookableResourceRouter, createBookingRouter } from './routes/bookable-resource.js'
import { createCatalogRouter } from './routes/catalog.js'
import { createStandardCategoriesRouter, createCategorySeedRouter } from './routes/standard-categories.js'
import { createDaoRouter } from './routes/dao.js'
import { createDaoVotingRouter } from './routes/dao-voting.js'
import { createDisputeRouter } from './routes/dispute.js'
import { createTicketRouter } from './routes/tickets.js'
import { createRemoteOrdersRouter } from './routes/remote-orders.js'
import { createTicketCanvasRouter } from './routes/ticket-canvas.js'
import { createTicketAgentRunnerRouter } from './routes/ticket-agent-runner.js'
import { createPrivateVerdictRouter } from './routes/private-verdict.js'
import { createNotificationsRouter } from './routes/notifications.js'
import { createGdprRouter } from './routes/gdpr.js'
import { deleteUserAccount, DeletionBlockedError } from './services/account-deletion.js'
import { makeThumbsFromImages } from './lib/makeThumb.js'
import { createNostrAuthRouter } from './routes/auth-nostr.js'
import { createUploadRouter } from './routes/upload.js'
import { createWalletRouter } from './routes/wallet.js'
import { createAiConfigRouter } from './routes/ai-config.js'
import { createAiCreditsRouter } from './routes/ai-credits.js'
import { createAiGuestCreditsRouter } from './routes/ai-credits-guest.js'
import { createEscrowRouter } from './routes/escrow.js'
import { createEscrowTradeRouter } from './routes/escrow-trade.js'
import { createLNBitsWebhookRouter } from './routes/webhooks-lnbits.js'
import { createAlbyAuthRouter } from './routes/auth-alby.js'
import { createMetamaskAuthRouter } from './routes/auth-metamask.js'
import { createLnurlpRouter } from './routes/lnurlp.js'
import { createNip05Router } from './routes/nip05.js'
import { createEmailAuthRouter } from './routes/auth-email.js'
import { createContactRouter } from './routes/contact.js'
import { createFeedbackRouter } from './routes/feedback.js'
import { createNewsletterRouter } from './routes/newsletter.js'
import { runNewsletterMaintenance } from './services/newsletter.js'
import { createBetaRouter } from './routes/beta.js'
import { createAdminRouter } from './routes/admin.js'
import { createAdminMonetizationRouter } from './routes/admin-monetization.js'
import { requireFoundationAdminBySession } from './middleware/require-admin.js'
import { createSessionRouter } from './routes/auth-session.js'
import { createMcpRouter } from './routes/mcp.js'
import { requireAuth, validateToken, type AuthenticatedRequest } from './middleware/require-auth.js'
import { blockIfPaymentsPaused } from './middleware/payments-paused.js'
import { DEFAULT_LAUNCH_MAX_TX_SATS, rejectIfAboveLaunchCap, resolveLaunchMaxTxSats } from './lib/launch-tx-cap.js'
import type { AppRequest } from './types/express.js'
import { requireAdmin } from './middleware/require-admin.js'
import { unauthenticatedLimiter, authenticatedLimiter, searchLimiter, emailLimiter, emailAuthLimiter, healthLimiter } from './middleware/rate-limit.js'
import { SimplePool, type Filter } from 'nostr-tools'
import { fetchReputationInput, computeReputationScore } from './services/reputationService.js'
import { runAppealFinalizerTick } from './services/appeal-finalizer.js'
import { runEscrowTimeoutTick, computeEscrowPhaseAmounts } from './services/escrow-timeout.js'
import { reconcileHoldInvoiceStates } from './services/escrow-reconcile.js'
import { parsePagination, buildPaginatedResult } from './lib/pagination.js'
import { isValidCheckoutId } from './lib/ticket-quantity.js'
import { runTicketStockReleaseTick } from './services/ticketStock.js'
import { runPlatformFeeReconcileTick } from './services/platformFeeSettlement.js'
import { writeWithOutbox } from './lib/outbox.js'
import { canvasPublishGate, isCanvasHostedConfigured, parseCanvasConfig, readCanvasConfig, type CanvasConfig } from './lib/canvas-config.js'
import { enqueueCanvasProbe } from './services/canvas-probe.js'
import { enqueueCanvasLifecycleForTicket } from './services/canvas-lifecycle.js'
import { enqueueProvisioningOnPaid } from './services/canvas-provisioning.js'
import { syncAgentTaskFromTicketSafe } from './services/bounty-ticket.js'
import { NON_VARIATION_OFFER } from './lib/offer-filters.js'
import { resolveCategoryCode, DEFAULT_OFFER_CATEGORY_CODE } from './lib/category-code.js'
import { resolveOfferCountry } from './lib/offer-country.js'
import { buildCompanyProductData } from './lib/company-product.js'
import { isEscrowEnabled, rejectEscrowIfDisabled } from './lib/escrow-gate.js'
import { isCoopEscrowEnabled, rejectCoopEscrowIfDisabled } from './lib/coop-escrow-gate.js'
import { checkProductionEscrowGuard } from './lib/production-escrow-guard.js'
import { isBetaMode, isProductionDirectPayOnly } from './services/betaMode.js'
import { notifyTicketStatusChange, notifyCooperationStatusChange, notifyTicketCreated, createNotification, pruneNotifications } from './services/notifications.js'
import { hasSellerPaymentMethodConfigured, resolveSellerInvoice } from './services/sellerPaymentResolver.js'
import { checkDirectPayTicketNow, runDirectPayReconcileTick } from './services/directPaySettlement.js'
import { verifyPreimage } from './lib/preimage.js'
import { isInvoiceFresh } from './lib/invoiceFreshness.js'
import { canSelfReportPaid } from './lib/ticket-paid-guard.js'
import { requiresQualityApproval, shouldStampQualityApproval } from './lib/ticket-quality-gate.js'
import { getMeili } from './lib/meili.js'
import { OFFER_INDEX_ALIAS } from './services/search-config.js'
import { OfferStatusSchema, TicketStatusSchema, TradeVisibilitySchema, DisputeModeSchema, AllowedVisibilitySchema, BookingModeSchema, BookingPriceUnitSchema, AgentBillingModelSchema, CoopAgentSupervisionSchema, type AgentBillingModel, type CoopAgentSupervision } from './lib/enums.js'
import { OutboxWorker, syncCreatorOfferIndex } from './services/outbox-worker.js'
import { hasAlbyTokenKey } from './services/albyTokenCrypto.js'
import {
  isWalletModeStrategy,
  WALLET_MODE_STRATEGIES,
  getStrategyExplanations,
  getEffectiveStrategy,
} from './services/walletStrategy.js'
import { SubWalletService } from './services/subWallet.js'
import {
  getExchangeRates,
  warmExchangeRates,
  exchangeRatesCacheState,
  SUPPORTED_RATE_CURRENCIES,
} from './services/exchangeRates.js'
import { NostrSubscriber } from './services/nostr-subscriber.js'
import { runRemoteAutoApproveTick } from './services/remote-candidate-approval.js'
import { createRemoteCandidateRouter } from './routes/remote-candidate.js'
import { createAdminAgentProfilesRouter } from './routes/admin-agent-profiles.js'
import { createSearchRouter } from './routes/search.js'
import { createGammaTagsRouter } from './routes/gamma-tags.js'
import { createHealthRouter } from './routes/health.js'
import { createMetricsRouter } from './routes/metrics.js'
import { createPartnersRouter } from './routes/partners.js'
import { createStatsRouter } from './routes/stats.js'
import { createMapMarkersRouter } from './routes/map-markers.js'
import { cacheMiddleware, versionedListCache, invalidateListCache } from './middleware/cache.js'
import { cache } from './services/cache.js'
import { setupObservability, initOpenTelemetry } from './services/observability.js'
import { closeRedis } from './lib/redis.js'
import { geocodeCity } from './lib/geocode.js'
import { cooperationCanFullEdit, offerCanFullEdit } from './lib/coop-engagement.js'
import type { CooperationEngagementShape, OfferEngagementShape } from './lib/coop-engagement.js'

const outboxWorker = new OutboxWorker()
const nostrSubscriber = new NostrSubscriber()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
// ADR-396 D4 (FU-850): the sealed agent config (NIP-44 ciphertext that carries
// the seller's LLM API key) is never returned by generic offer reads, lists or
// includes. Only the owner-only GET /api/offers/:id/sealed-config and the PATCH
// merge opt back in with `omit: { agentConfigSealed: false }`. The cast keeps the
// plain `PrismaClient` type that the routers' signatures expect: results stay
// typed with the field, but it is `undefined` at runtime unless opted in.
const prisma = new PrismaClient({ adapter, omit: { offer: { agentConfigSealed: true } } }) as unknown as PrismaClient
// ADR-412 FU-948: inject prisma once so nostrService can resolve the stable
// platform signing key for Ticket/Cooperation/Milestone/Dispute mirror events.
nostrService.setPrisma(prisma)
const app = express()
// ADR-213 A1: The hop count must match the actual proxy chain.
// Beta chain: client → Cloudflare → cloudflared → nginx = 2 hops behind Express.
// cloudflared appends the real client IP as CF-Connecting-IP (last hop = nginx).
// Set TRUST_PROXY_HOPS to the number of reverse proxies in front of Express.
// `true` is deliberately avoided — it would let any client spoof X-Forwarded-For
// and defeat per-IP rate limits (per ADR-212 security decision).
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1)
app.set('trust proxy', TRUST_PROXY_HOPS)
const PORT = process.env.APP_PORT || 4001
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`
// ADR-212 P2: CORS allowlist — only the configured FRONTEND_URL can call us from a browser.
// The tunnel origin must match FRONTEND_URL (e.g. `https://colabonate.app`).
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${PORT}`
const CORS_ALLOWED = FRONTEND_URL.split(',').map(s => s.trim()).filter(Boolean)

const providerType = (process.env.PAYMENT_PROVIDER ?? 'lnbits') as ProviderType
const payments: PaymentProvider = createProvider(providerType, process.env as Record<string, string | undefined>)

const lightningRouter = createLightningRouter(payments, prisma)
const colPointsService = new ColPointsService(prisma)
const subWalletService = new SubWalletService(prisma, payments)

function parseCooperation<T extends { id: string }>(raw: T): T & { skills: unknown; images: unknown } {
  return {
    ...raw,
    skills: (() => { try { const s = (raw as Record<string, unknown>).skills; return s ? (typeof s === 'string' ? JSON.parse(s) : s) : null } catch { return null } })(),
    images: (() => { try { const i = (raw as Record<string, unknown>).images; return i ? (typeof i === 'string' ? JSON.parse(i) : i) : null } catch { return null } })(),
  } as T & { skills: unknown; images: unknown }
}

// ADR-331 D1: JSON-decode the per-step requiredCapabilities column for every
// milestone on a cooperation payload. The POST path stores it as a JSON string
// (matches the existing requiredSkills pattern on CooperationTemplate); the
// client wants a real string[]. Null is preserved as null. Mutates in place
// to keep the call sites readable — every cooperation-returning endpoint
// applies this just before serializing.
// ADR-332 D2: also decodes the nested CoopMilestoneStep.requiredCapabilities
// (same encoding, one level deeper).
function parseCoopMilestoneRequiredCapabilities(milestones: Array<Record<string, unknown>>): void {
  for (const m of milestones) {
    const raw = m.requiredCapabilities
    m.requiredCapabilities =
      raw == null
        ? null
        : (() => { try { const parsed = JSON.parse(String(raw)); return Array.isArray(parsed) ? parsed as string[] : null } catch { return null } })()
    if (Array.isArray(m.steps)) {
      for (const s of m.steps as Array<Record<string, unknown>>) {
        const stepRaw = s.requiredCapabilities
        s.requiredCapabilities =
          stepRaw == null
            ? null
            : (() => { try { const parsed = JSON.parse(String(stepRaw)); return Array.isArray(parsed) ? parsed as string[] : null } catch { return null } })()
      }
    }
  }
}

function parseJsonField(value: unknown): unknown[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return [] }
  }
  return []
}

function parseOfferImages<T extends { id: string }>(offer: T): T & { images: unknown[] } {
  const parsed = {
    ...offer,
    images: parseJsonField((offer as Record<string, unknown>).images),
  } as T & { images: unknown[] }
  // FU-233-D: server-only wallet credentials must never reach a client —
  // the sub-wallet ADMIN key authorizes payments (ADR-164). Escrow code
  // reads it from its own Prisma queries, never from serialized responses.
  delete (parsed as Record<string, unknown>).lightningSubWalletAdminKey
  delete (parsed as Record<string, unknown>).lightningSubWalletId
  return parsed
}

// ADR-212 P2: helmet adds baseline security headers (X-Frame-Options,
// X-Content-Type-Options, etc.). contentSecurityPolicy is left off until the Vite
// SPA / inline-asset impact is verified.
app.use(helmet({ contentSecurityPolicy: false }))
// Perf fix (2026-10-02): API responses carry base64-encoded images (`Offer.images`,
// `imageThumbs`) and were shipped completely uncompressed end to end (no gzip at
// Express, nginx proxy, or Caddy) — measured up to 18.6 MB for a single
// /api/offers?creatorPubkey= response. gzip typically shrinks base64 JSON by 60-70%.
app.use(compression())
// ADR-240 D1 / LUD-06: the self-serve LNURL-pay endpoints are fetched by
// browser-based wallet clients from arbitrary origins, so they must answer
// with `Access-Control-Allow-Origin: *`. They are public by design (anyone may
// pay a Lightning Address), GET-only, keyless and carry no session data, so the
// wildcard is safe here — a deliberate, path-scoped exception to the ADR-212 P2
// allowlist below. Mounted BEFORE the global CORS so this path's preflights are
// answered here instead of being denied by the allowlist.
app.use('/.well-known/lnurlp', cors({ origin: '*', credentials: false }))
// ADR-412 FU-947: NIP-05 (nostr.json) is fetched cross-origin by Nostr clients
// verifying a listing's identity, same public-by-design rationale as lnurlp above.
app.use('/.well-known/nostr.json', cors({ origin: '*', credentials: false }))
// ADR-212 P2: CORS allowlist (was `cors()` reflecting `*`).
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // curl / server-side / same-origin
    if (CORS_ALLOWED.includes(origin)) return cb(null, true)
    return cb(null, false)
  },
  credentials: true,
}))
setupObservability(app)
// ADR-227 D2 — mount /metrics BEFORE the rate limiter so a 15 s scrape cadence
// from VictoriaMetrics never hits the unauthenticatedLimiter bucket (which would
// throttle the entire IP for 1 min after ~5 scrapes).
app.use(createMetricsRouter())
// FU-748: /health gets its own dedicated budget (healthLimiter, 60/min/IP),
// path-scoped and mounted BEFORE the combined limiter — uptime monitors must
// neither drain the anonymous guest bucket nor be 429'd by it (same mounting
// discipline as ADR-227 D2's /metrics exemption; bounded rather than exempt
// because each probe pings Postgres/Redis/Meili). Path-scoping matters: a
// bare app.use(healthLimiter) would swallow API traffic into the health
// budget too.
app.use('/health', healthLimiter)
app.use(createHealthRouter(prisma))
// ADR-295 image-quality uplift: 1280×960/88% data-URLs (~0.3–1.5 MB each) in
// offer bodies (photos + rich-text inline images) — 512 KB was too small.
// 12 MB ≈ 5 photos + several inline description images + JSON overhead.
// Body parsing runs before auth; abuse surface is bounded by the ADR-122
// rate limiters and (in prod) nginx client_max_body_size.
app.use(express.json({ limit: '12mb' }))
// F-D2-04: Validate Bearer token FORMAT (not DB validity) before elevating to
// the authenticated rate-limit tier. Session tokens are randomBytes(32).toString('hex')
// = 64 lowercase hex chars. Garbage values like "Bearer null" or "Bearer 0" fail
// this check and fall through to the stricter unauthenticated limiter (60/min).
const SESSION_TOKEN_RE = /^[0-9a-f]{64}$/
const combinedRateLimiter = (req: AppRequest, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    if (SESSION_TOKEN_RE.test(token)) {
      return authenticatedLimiter(req, res, next)
    }
  }
  return unauthenticatedLimiter(req, res, next)
}
app.use(combinedRateLimiter)

// Mount routes (authenticatedLimiter applied to auth-required endpoints via require-auth middleware)
app.use('/api/nostr', createNostrRouter(prisma))
app.use('/api/auth/lnurl', createLnurlRouter(prisma))
app.use('/api/lightning', lightningRouter)
// ADR-240 D1: public LUD-16 Lightning Addresses (`<handle>@<domain>`). Root
// path is fixed by the spec, so this is not under /api.
app.use('/.well-known/lnurlp', createLnurlpRouter(prisma))
app.use('/.well-known/nostr.json', createNip05Router(prisma))
app.use('/api/identity', createIdentityRouter(prisma, colPointsService,
  (filter, timeoutMs) => nostrService.getEvents(filter, timeoutMs)))
app.use('/api/reviews', createReviewsRouter(prisma, colPointsService))
  app.use('/api/agent-profiles', requireAuth(prisma), createAgentProfileRouter(prisma))
// ADR-319: auth applied per-route inside the router (GET routes stay public,
// matching the ADR-303 public-read-tier direction), not at the mount level.
app.use('/api/agent-tasks', createAgentTaskRouter(prisma))
// ADR-328 D3/D4 (FU-484): Agent Network CRUD — same per-route auth as
// agent-tasks (public browse/Find, auth-gated write surface). companyId is
// deliberately absent (FU-495 / ADR-326 D10.7 owns it).
app.use('/api/agent-networks', createAgentNetworkRouter(prisma))
// ADR-311 D2: workspace lifecycle — all routes auth-gated inside the router
// (buyer-scoped runtime state, no public read tier).
app.use('/api/workspaces', createWorkspaceRouter(prisma))
app.use('/api/company', createCompanyRouter(prisma))
app.use('/api/delivery-templates', createDeliveryTemplateRouter(prisma))
app.use('/api/shipping-options', createShippingOptionRouter(prisma))
app.use('/api/collections', createCollectionRouter(prisma))
app.use('/api/resources', createBookableResourceRouter(prisma))
app.use('/api/bookings', createBookingRouter(prisma))
// ADR-340 D6: unified catalog router — mounts behind requireAuth (audit fix:
// /api/catalog writes were unauthenticated at this line prior to ADR-340).
// Public reads (?companyId= / ?ownerPubkey=) still work; writes per-route
// enforce per-type ownership (PRODUCT via Company, AGENT_SETUP via owner).
app.use('/api/catalog', requireAuth(prisma), createCatalogRouter(prisma))
app.use('/api/dao', createDaoRouter(prisma))
app.use('/api', createDaoVotingRouter(prisma, payments))
app.use('/api/standard-categories', createStandardCategoriesRouter(prisma))
app.use('/api/standard-categories/seed', createCategorySeedRouter(prisma))
app.use('/api/upload', requireAuth(prisma), createUploadRouter())
app.use('/api/wallet', requireAuth(prisma), createWalletRouter(prisma, payments))
app.use('/api/ai/config', requireAuth(prisma), createAiConfigRouter(prisma))
// ADR-384 D10: guest routes first — they must NOT sit behind requireAuth.
app.use('/api/ai/credits/guest', createAiGuestCreditsRouter(prisma))
app.use('/api/ai/credits', requireAuth(prisma), createAiCreditsRouter(prisma))
app.use('/api/webhooks', createLNBitsWebhookRouter(prisma, payments, nostrService))
app.use('/api', createEscrowRouter(prisma, payments))
app.use('/api', createEscrowTradeRouter(prisma))
app.use('/api', createDisputeRouter(prisma, payments))
app.use('/api', createPrivateVerdictRouter(prisma, payments))
app.use('/api/gdpr', createGdprRouter(prisma))
app.use('/api/auth/email', emailAuthLimiter, createEmailAuthRouter(prisma))
app.use('/api/auth/nostr', createNostrAuthRouter(prisma))
app.use('/api/auth/alby', createAlbyAuthRouter(prisma))
app.use('/api/auth/metamask', createMetamaskAuthRouter(prisma))
app.use('/api/contact', createContactRouter())
app.use('/api/feedback', emailLimiter, createFeedbackRouter(prisma))
app.use('/api/newsletter', createNewsletterRouter(prisma, emailLimiter))
app.use('/api/auth', createSessionRouter(prisma))
app.use('/api/mcp', createMcpRouter(prisma))

// Support tips — record & list recent donors
app.post('/api/support-tips', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { amountSats } = req.body as { amountSats?: unknown }
    if (typeof amountSats !== 'number' || amountSats <= 0) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'amountSats must be a positive number' })
      return
    }
    await prisma.supportTip.create({
      data: { pubkey: req.authPubkey!, amountSats },
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('[support-tips] POST error:', err)
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to record tip' })
  }
})

app.get('/api/support-tips/recent', async (_req, res) => {
  try {
    const tips = await prisma.supportTip.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    res.json(tips)
  } catch (err) {
    console.error('[support-tips] GET error:', err)
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch tips' })
  }
})
// ADR-197: Beta mode routes (demo wallet + demo payment). Public status + auth-gated pay/topup.
app.use('/api/beta', createBetaRouter(prisma))
// ADR-198 + ADR-273: Admin panel routes — Bearer-session auth + Foundation-DAO admin role check.
app.use('/api/admin', requireAuth(prisma), requireFoundationAdminBySession(prisma), createAdminRouter(prisma))
// ADR-402 Phase 2: admin entitlement write paths (AI credit grant/debit, MCP
// pass grant/shorten, trial reset, per-identity AI/MCP policy). Same admin gate.
app.use('/api/admin', requireAuth(prisma), requireFoundationAdminBySession(prisma), createAdminMonetizationRouter(prisma))
app.use('/api/search', searchLimiter, createSearchRouter(prisma))
app.use('/api/gamma-tags', createGammaTagsRouter(prisma))
// ADR-180: New Local Partners segment slider (Users + Companies)
app.use('/api/partners', createPartnersRouter(prisma))

// ADR-334 D1: ecosystem-wide aggregates for KPI strips (Home, CoopExplore,
// /search coop context). Public — same read-tier as /api/offers.
app.use('/api/stats', createStatsRouter(prisma))

// ADR-406 D6 (FU-913/FU-914/FU-915): viewport-aware marker source for the
// marketplace map. Public — same read-tier as /api/offers.
app.use('/api/map', createMapMarkersRouter(prisma))

// GET /api/companies – Public list of all active companies (for buy/vendors page)
app.get('/api/companies', cacheMiddleware(300), async (req, res) => {
  try {
    const { limit, cursor, includeCount } = parsePagination(req.query as Record<string, unknown>)
    const where: Record<string, unknown> = { isActive: true }

    if (cursor) {
      where.OR = [
        { createdAt: { lt: new Date(cursor.sortKey) } },
        { createdAt: new Date(cursor.sortKey), id: { lt: cursor.id } },
      ]
    }

    const [companies, totalCount] = await Promise.all([
      prisma.company.findMany({
        where,
        include: { catalogs: { where: { isActive: true }, select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      includeCount
        ? prisma.company.count({ where: { isActive: true } })
        : Promise.resolve(undefined),
    ])

    const parsed = companies.map(c => ({
      ...c,
      images: parseJsonField(c.images),
      businessFields: parseJsonField(c.businessFields),
    }))

    const result = buildPaginatedResult(
      parsed,
      limit,
      (c) => c.createdAt.toISOString(),
      totalCount,
    )

    // ADR-139 transition: emit both new edges shape and legacy flat array.
    // Remove `companies` field once all consumers (BuyVendors, BuyMap, etc.) read edges.
    res.json({ ...result, companies: result.edges.map(e => e.node) })
  } catch (error) {
    console.error('Failed to fetch companies:', error)
    res.status(500).json({ error: 'Failed to fetch companies' })
  }
})

// GET /api/offers – Active marketplace offers (cursor-paginated)
app.get('/api/offers', versionedListCache('offers', 30), async (req, res) => {
  try {
    const { creatorPubkey, category, offerType, status, country, source, parentOfferId, productType } = req.query
    const { limit, cursor, includeCount } = parsePagination(req.query as Record<string, unknown>)
    const where: Record<string, unknown> = {}
    if (creatorPubkey) where.creatorPubkey = creatorPubkey
    if (offerType) where.offerType = offerType
    if (status) where.status = status
    else if (!creatorPubkey) where.status = 'ACTIVE'
    if (category) where.category = category
    if (country) where.country = country
    if (source) where.source = source
    if (parentOfferId) where.parentOfferId = parentOfferId
    if (productType) {
      where.productType = productType
    } else if (!parentOfferId) {
      // ADR-270 D7: Browse surfaces show parents, never variation children.
      // { not: 'variation' } excludes NULLs (Prisma default), so use OR to
      // keep legacy offers that don't have productType set yet.
      where.OR = [{ productType: null }, { productType: { not: 'variation' } }]
    }
    // ADR-152 Phase 4.2: public marketplace browse hides offers whose creator
    // set their ProfileVisibility to PRIVATE. Exempted when a specific
    // creatorPubkey is requested so owner-self & vendor views keep working.
    if (!creatorPubkey) {
      where.creator = { profileVisibility: { not: 'PRIVATE' } }
      // ADR-284 D2: admin-blocked offers never appear in public browse — the
      // owner's own creatorPubkey-scoped view still shows them (marked
      // blocked) so a seller can see it happened.
      where.blockedAt = null
    }

    if (cursor) {
      const cursorDate = new Date(cursor.sortKey)
      where.OR = [
        { publishedAt: { lt: cursorDate } },
        { publishedAt: cursorDate, id: { lt: cursor.id } },
      ]
      if (where.status === undefined) where.status = 'ACTIVE'
    }

    const isSlim = req.query.slim === '1'

    const [offers, totalCount] = await Promise.all([
      isSlim
        ? prisma.offer.findMany({
            where,
            select: {
              id: true, title: true, category: true, imageThumbs: true,
              priceSats: true, categoryCode: true, offerType: true,
              country: true, companyId: true, creatorPubkey: true,
              publishedAt: true,
            },
            // nulls: 'last' — legacy offers without publishedAt must not push
            // freshly published ones out of the first page (Postgres defaults
            // to NULLS FIRST on DESC).
            orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
            take: limit + 1,
          })
        : prisma.offer.findMany({
            where,
            include: {
              creator: { select: { pubkey: true, lnAddress: true } },
              offerMilestones: { orderBy: { sortOrder: 'asc' } },
              company: { select: { id: true, name: true, logoUrl: true } },
              // ADR-315 D3: badge fields so MyAgents can render the chip on
              // the offer row; non-agent offers get null. capabilities +
              // reputationScore mirror /api/search's join so the sell-side
              // card can render capability chips (FU-468).
              agentProfile: { select: { id: true, name: true, isVerified: true, verifiedAt: true, capabilities: true, reputationScore: true } },
              // ADR-386: engagement probe for the COOP-network full-edit gate.
              _count: { select: { members: true, tickets: true } },
            },
            orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
            take: limit + 1,
          }),
      includeCount
        ? prisma.offer.count({ where })
        : Promise.resolve(undefined),
    ])

    const parsed = offers.map((o: any) => {
      // ADR-386: COOP-network full-edit gate. The engagement `_count` probe is
      // stripped so only the derived boolean ships.
      const canFullEdit = offerCanFullEdit(o as OfferEngagementShape)
      const raw = { ...parseOfferImages(o) }
      delete raw._count
      return { ...raw, canFullEdit }
    })

    const result = buildPaginatedResult(
      parsed,
      limit,
      (o) => (o.publishedAt ? o.publishedAt.toISOString() : new Date(0).toISOString()),
      totalCount,
    )

    res.json({ ...result, offers: result.edges.map(e => e.node) })
  } catch (error) {
    console.error('Failed to fetch offers:', error)
    res.status(500).json({ error: 'Failed to fetch offers' })
  }
})

app.get('/api/offers/count-by-category', async (req, res) => {
  try {
    const { offerType, country, q } = req.query
    // Mirror the /api/search filters so category badges match the result
    // list: same type/country/query narrowing and the same PRIVATE-profile
    // exclusion (ADR-152 Phase 4.2).
    const where: Record<string, unknown> = {
      status: 'ACTIVE',
      offerType: offerType ? String(offerType) : { not: 'COOP' },
      creator: { profileVisibility: { not: 'PRIVATE' } },
      blockedAt: null, // ADR-284 D2
      AND: [NON_VARIATION_OFFER], // ADR-270 D7
    }
    if (country) where.country = String(country)
    if (q) {
      where.OR = [
        { title: { contains: q as string, mode: 'insensitive' } },
        { description: { contains: q as string, mode: 'insensitive' } },
        { city: { contains: q as string, mode: 'insensitive' } },
        { region: { contains: q as string, mode: 'insensitive' } },
      ]
    }
    // ADR-380: categoryCode stays the single, authoritative category (ADR-277
    // D1) — Gamma-tagged offers are mapped onto it at ingest + by the backfill,
    // so a plain groupBy matches the list exactly (ADR-233 invariant). A query
    // OR-bridge over gammaTags was tried and reverted: multi-attribution made
    // the sidebar prefix-sum badges exceed the distinct result count
    // (services badge 267 vs 197 results, measured 2026-09-18).
    const counts = await prisma.offer.groupBy({
      by: ['categoryCode'],
      where,
      _count: true,
    })
    res.json({ counts })
  } catch (error) {
    console.error('Failed to fetch category counts:', error)
    res.status(500).json({ error: 'Failed to fetch counts' })
  }
})

// ADR-320 D5: public ecosystem KPIs. Dashboard UI is a separate follow-up
// (FU-387) — this is the read-only aggregation endpoint it would consume.
app.get('/api/agent-marketplace/stats', async (req, res) => {
  try {
    const stats = await computeAgentMarketplaceStats(prisma)
    res.json(stats)
  } catch (error) {
    console.error('Failed to compute agent marketplace stats:', error)
    res.status(500).json({ error: 'Failed to compute stats' })
  }
})

// GET /api/offers/:offerId/visitors – Visitors (chats) for an offer (seller view)
app.get('/api/offers/:offerId/visitors', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { offerId } = req.params
    const offer = await prisma.offer.findUnique({ where: { id: offerId } })
    if (!offer) return res.status(404).json({ error: 'Offer not found' })

    const loginPubkey = req.authPubkey!
    if (loginPubkey !== offer.creatorPubkey) {
      return res.status(403).json({ error: 'Not authorized' })
    }

    const since = Math.floor(Date.now() / 1000) - 86400 * 7

    const relayUrls = nostrService.getRelayUrls()
    const pool = nostrService.getPool()
    const events: any[] = []
    const seen = new Set<string>()

    const filters: Filter[] = [
      { kinds: [14], '#p': [loginPubkey], since, limit: 200 } as Filter,
      { kinds: [14], authors: [loginPubkey], since, limit: 200 } as Filter,
    ]

    await new Promise<void>((resolve) => {
      let closed = 0
      const onClose = () => { if (++closed >= filters.length) resolve() }
      const subs = filters.map(f => pool.subscribe(relayUrls, f, {
        onevent: (ev: any) => { if (!seen.has(ev.id)) { seen.add(ev.id); events.push(ev) } },
        onclose: onClose,
      }))
      setTimeout(() => { subs.forEach(s => s.close()); resolve() }, 5000)
    })

    const ticketIds = new Set<string>(events.map((e: any) => e.tags.find((t: any) => t[0] === 'ticket_id')?.[1]).filter(Boolean))
    ticketIds.add(offerId)

    const uniqueVisitors: Record<string, { pubkey: string; lastMessageAt: number; hasChat: boolean }> = {}
    for (const tid of ticketIds) {
      const msgs = events.filter((e: any) => e.tags.find((t: any) => t[0] === 'ticket_id')?.[1] === tid)
      const otherPubkeys = [...new Set(msgs.map((e: any) => e.pubkey).filter((pk: string) => pk !== loginPubkey))]
      for (const pk of otherPubkeys) {
        const last = msgs.filter((m: any) => m.pubkey === pk).sort((a: any, b: any) => b.created_at - a.created_at)[0]
        if (!uniqueVisitors[pk] || last.created_at > uniqueVisitors[pk].lastMessageAt) {
          uniqueVisitors[pk] = { pubkey: pk, lastMessageAt: last.created_at, hasChat: true }
        }
      }
    }

    const visitors = Object.values(uniqueVisitors).sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    res.json({ visitors })
  } catch (error) {
    console.error('Failed to fetch visitors:', error)
    res.status(500).json({ error: 'Failed to fetch visitors' })
  }
})

// GET /api/offers/:id – Single offer by ID
// ADR-396 D4 (FU-850): the only read path for the sealed agent config. The
// blob is sealed to the seller's own key (ADR-306), so only the creator can
// use it — for config injection into a booked workspace and for prefilling
// the edit wizard. Never cached (per-user, secret-bearing).
app.get('/api/offers/:id/sealed-config', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const offer = await prisma.offer.findUnique({
      where: { id: req.params.id },
      select: { creatorPubkey: true, offerType: true, agentConfigSealed: true },
    })
    if (!offer) return res.status(404).json({ error: 'NOT_FOUND' })
    if (offer.creatorPubkey !== req.authPubkey) return res.status(403).json({ error: 'FORBIDDEN' })
    res.setHeader('Cache-Control', 'no-store')
    return res.json({ agentConfigSealed: offer.agentConfigSealed ?? null })
  } catch (error) {
    console.error('Failed to fetch sealed config:', error)
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  }
})

// ADR-396 D3 (FU-851): the agent config pinned at booking. Injection into the
// booking's workspace / canvas runner reads THIS copy, so later offer edits
// only affect new bookings. Legacy tickets booked before the pin existed fall
// back to the offer's current seal (`pinned: false`). Seller-only: the blob
// is sealed to the seller's key and nobody else can use it.
app.get('/api/tickets/:id/agent-config-seal', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      select: { sellerPubkey: true, offerType: true, offerId: true, agentConfigSealedSnapshot: true, agentConfigHash: true },
    })
    if (!ticket) return res.status(404).json({ error: 'NOT_FOUND' })
    if (ticket.sellerPubkey !== req.authPubkey) return res.status(403).json({ error: 'FORBIDDEN' })
    if (ticket.offerType !== 'AGENT_SETUP') return res.status(400).json({ error: 'NOT_AGENT_SETUP' })
    res.setHeader('Cache-Control', 'no-store')
    if (ticket.agentConfigSealedSnapshot) {
      return res.json({ agentConfigSealed: ticket.agentConfigSealedSnapshot, agentConfigHash: ticket.agentConfigHash, pinned: true })
    }
    const offer = ticket.offerId
      ? await prisma.offer.findUnique({ where: { id: ticket.offerId }, select: { agentConfigSealed: true } })
      : null
    return res.json({ agentConfigSealed: offer?.agentConfigSealed ?? null, agentConfigHash: null, pinned: false })
  } catch (error) {
    console.error('Failed to fetch pinned agent config:', error)
    return res.status(500).json({ error: 'INTERNAL_ERROR' })
  }
})

app.get('/api/offers/:id', cacheMiddleware(300), async (req, res) => {
  try {
    const { id } = req.params
    const offer = await prisma.offer.findUnique({
      where: { id },
      include: {
        creator: { select: { pubkey: true, lnAddress: true } },
        offerMilestones: { orderBy: { sortOrder: 'asc' } },
        company: true,
        product: true,
        // ADR-315 D3: badge fields flow to the buyer-side detail too.
        // ADR-396 D2 (FU-849): public agent facts for the buyer-side Agent section.
        agentProfile: { select: { id: true, name: true, isVerified: true, verifiedAt: true, capabilities: true, tools: true, reputationScore: true, trustScore: true, requireHumanApproval: true, humanInLoop: true, isPioneer: true } },
      },
    })
    if (!offer) {
      return res.status(404).json({ error: 'Offer not found' })
    }
    // ADR-284 D2: this endpoint has no auth/ownership context to carve out an
    // owner-only exception, so a blocked offer 404s for every caller — as if
    // it doesn't exist. Also closes the direct-link purchase path (checkout
    // fetches the offer here first).
    if (offer.blockedAt) {
      return res.status(404).json({ error: 'Offer not found' })
    }

    let resolvedOffer: any = offer
    let variations: any[] = []

    if (offer.productType === 'variable') {
      // ADR-270 D2/D5: Parent catalogue node – fetch active variation children
      const childOffers = await prisma.offer.findMany({
        where: {
          parentOfferId: offer.id,
          listingVisibility: { not: 'hidden' },
        },
        include: {
          creator: { select: { pubkey: true, lnAddress: true } },
        },
        orderBy: [{ priceSats: 'asc' }, { id: 'asc' }],
      })
      variations = childOffers.map(c => parseOfferImages(c))
    } else if (offer.productType === 'variation' && offer.parentOfferId) {
      // ADR-270 D2: Child variation – inherit null fields from parent offer
      const parent = await prisma.offer.findUnique({
        where: { id: offer.parentOfferId },
        include: {
          company: true,
        },
      })
      if (parent) {
        resolvedOffer = {
          ...offer,
          category: offer.category ?? parent.category,
          categoryCode: offer.categoryCode || parent.categoryCode,
          subcategory: offer.subcategory ?? parent.subcategory,
          subcategoryCode: offer.subcategoryCode ?? parent.subcategoryCode,
          country: offer.country ?? parent.country,
          region: offer.region ?? parent.region,
          city: offer.city ?? parent.city,
          lat: offer.lat ?? parent.lat,
          lng: offer.lng ?? parent.lng,
          isRemote: offer.isRemote ?? parent.isRemote,
          language: offer.language ?? parent.language,
          deliveryTimeDays: offer.deliveryTimeDays ?? parent.deliveryTimeDays,
          deliveryCostSats: offer.deliveryCostSats ?? parent.deliveryCostSats,
          deliveryTemplateId: offer.deliveryTemplateId ?? parent.deliveryTemplateId,
          deliveryNotes: offer.deliveryNotes ?? parent.deliveryNotes,
          shippingOptionRefs: offer.shippingOptionRefs ?? parent.shippingOptionRefs,
          useEscrow: offer.useEscrow ?? parent.useEscrow,
          phase2WindowHours: offer.phase2WindowHours ?? parent.phase2WindowHours,
          visibility: offer.visibility ?? parent.visibility,
          disputeMode: offer.disputeMode ?? parent.disputeMode,
          allowedVisibility: offer.allowedVisibility ?? parent.allowedVisibility,
          companyId: offer.companyId ?? parent.companyId,
          company: offer.company ?? parent.company,
          parentOffer: {
            id: parent.id,
            title: parent.title,
            description: parent.description,
            variantAxes: parent.variantAxes,
            images: parseJsonField(parent.images),
          },
        }
      }
    }

    const parsed = parseOfferImages(resolvedOffer)
    res.json({ offer: { ...parsed, ...(variations.length > 0 ? { variations } : {}) } })
  } catch (error) {
    console.error('Failed to fetch offer:', error)
    res.status(500).json({ error: 'Failed to fetch offer' })
  }
})

// POST /api/offers – Create offer
// ADR-271: validate the bookable-resource offer fields (D5/D6). Returns the
// normalized values or a single error string for the 400 response.
function parseBookingOfferFields(raw: {
  resourceId?: unknown
  bookingMode?: unknown
  priceUnit?: unknown
  bookingMinUnits?: unknown
  bookingMaxUnits?: unknown
  confirmationWindowHours?: unknown
  autoConfirm?: unknown
}): { value: {
  resourceId: string | null
  bookingMode: 'DATE_RANGE' | 'SESSION' | null
  priceUnit: string | null
  bookingMinUnits: number | null
  bookingMaxUnits: number | null
  confirmationWindowHours: number
  autoConfirm: boolean
} } | { error: string } {
  if (raw.resourceId !== undefined && raw.resourceId !== null && typeof raw.resourceId !== 'string') {
    return { error: 'resourceId must be a string' }
  }
  let bookingMode: 'DATE_RANGE' | 'SESSION' | null = null
  if (raw.bookingMode !== undefined && raw.bookingMode !== null) {
    const parsed = BookingModeSchema.safeParse(raw.bookingMode)
    if (!parsed.success) return { error: 'bookingMode must be DATE_RANGE or SESSION' }
    bookingMode = parsed.data
  }
  if (bookingMode && !raw.resourceId) {
    return { error: 'bookingMode requires resourceId' }
  }
  let priceUnit: string | null = null
  if (raw.priceUnit !== undefined && raw.priceUnit !== null) {
    const parsed = BookingPriceUnitSchema.safeParse(raw.priceUnit)
    if (!parsed.success) return { error: 'priceUnit must be per_night|per_day|per_hour|per_seat|flat' }
    priceUnit = parsed.data
  }
  if (priceUnit && !bookingMode) {
    return { error: 'priceUnit requires bookingMode' }
  }
  const intField = (v: unknown, min: number, max: number): number | null | 'invalid' => {
    if (v === undefined || v === null) return null
    return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : 'invalid'
  }
  const bookingMinUnits = intField(raw.bookingMinUnits, 1, 365)
  if (bookingMinUnits === 'invalid') return { error: 'bookingMinUnits must be an integer 1–365' }
  const bookingMaxUnits = intField(raw.bookingMaxUnits, 1, 365)
  if (bookingMaxUnits === 'invalid') return { error: 'bookingMaxUnits must be an integer 1–365' }
  if (bookingMinUnits && bookingMaxUnits && bookingMinUnits > bookingMaxUnits) {
    return { error: 'bookingMinUnits cannot exceed bookingMaxUnits' }
  }
  const confirmationWindowHours = intField(raw.confirmationWindowHours, 1, 168)
  if (confirmationWindowHours === 'invalid') return { error: 'confirmationWindowHours must be an integer 1–168' }
  if (raw.autoConfirm !== undefined && typeof raw.autoConfirm !== 'boolean') {
    return { error: 'autoConfirm must be boolean' }
  }
  const autoConfirm = raw.autoConfirm === true
  if (autoConfirm && !bookingMode) {
    return { error: 'autoConfirm requires bookingMode (D5: instant confirmation needs a bookable offer)' }
  }
  return {
    value: {
      resourceId: (raw.resourceId as string | undefined | null) ?? null,
      bookingMode,
      priceUnit,
      bookingMinUnits,
      bookingMaxUnits,
      confirmationWindowHours: confirmationWindowHours ?? 24,
      autoConfirm,
    },
  }
}

// ADR-305 D3: shape-level validation for offerType = AGENT_SETUP. Does not
// touch the DB (agentProfileId ownership is checked by the caller, which has
// the prisma handle) — this only rejects malformed config/billing input.
function parseAgentSetupOfferFields(raw: {
  agentConfigSealed?: unknown
  agentConfigMeta?: unknown
  agentBillingModel?: unknown
}): { value: {
  agentConfigSealed: string | null
  agentConfigMeta: Record<string, unknown> | null
  agentBillingModel: AgentBillingModel | null
  // ADR-342 D1: the sanitized canvas config (null = provider 'none'/absent).
  canvas: CanvasConfig | null
} } | { error: string } {
  if (raw.agentConfigSealed !== undefined && raw.agentConfigSealed !== null) {
    if (typeof raw.agentConfigSealed !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.agentConfigSealed)) {
      return { error: 'agentConfigSealed must be a base64-encoded string' }
    }
  }
  let agentConfigMeta: Record<string, unknown> | null = null
  let canvas: CanvasConfig | null = null
  if (raw.agentConfigMeta !== undefined && raw.agentConfigMeta !== null) {
    if (typeof raw.agentConfigMeta !== 'object' || Array.isArray(raw.agentConfigMeta)) {
      return { error: 'agentConfigMeta must be an object' }
    }
    // Shallow copy — the PATCH path passes `existing.agentConfigMeta` through
    // here, and mutating it would strip the probe cache from the very object
    // the caller reads to restore it (ADR-342 D2).
    const meta = { ...(raw.agentConfigMeta as Record<string, unknown>) }
    if (
      meta.capabilities !== undefined
      && (!Array.isArray(meta.capabilities) || meta.capabilities.length === 0 || meta.capabilities.some((c) => typeof c !== 'string'))
    ) {
      return { error: 'agentConfigMeta.capabilities must be a non-empty array of strings' }
    }
    // ADR-342 D1: validate + sanitize the canvas sub-config. The sanitized
    // form replaces the client-sent object so server-managed probe fields
    // (probeStatus/probeAt) can never be forged past the D2 publish gate.
    const canvasParsed = parseCanvasConfig(meta.canvas)
    if ('error' in canvasParsed) return { error: canvasParsed.error }
    canvas = canvasParsed.value
    if (canvas) meta.canvas = canvas
    else delete meta.canvas
    // ADR-396 D2 (FU-849): public runtime disclosure for buyers — provider +
    // model name only (the key, server address and tools stay sealed).
    // ADR-409 D1: optional cosmetic providerLabel + catalogId so buyers see
    // "DeepSeek · deepseek-v4-flash" instead of the executor flavor. Still
    // sanitized to exactly these four fields so nothing else can ride along.
    if (meta.runtime !== undefined) {
      const rt = meta.runtime as { provider?: unknown; model?: unknown; providerLabel?: unknown; catalogId?: unknown } | null
      const provider = rt && typeof rt === 'object' ? rt.provider : undefined
      const model = rt && typeof rt === 'object' ? rt.model : undefined
      if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'ollama') {
        return { error: 'agentConfigMeta.runtime.provider must be one of openai|anthropic|ollama' }
      }
      if (typeof model !== 'string' || !model.trim() || model.length > 100) {
        return { error: 'agentConfigMeta.runtime.model must be a non-empty string (max 100 chars)' }
      }
      let providerLabel: string | undefined
      if (rt && typeof rt === 'object' && rt.providerLabel !== undefined && rt.providerLabel !== null) {
        if (typeof rt.providerLabel !== 'string' || !rt.providerLabel.trim() || rt.providerLabel.trim().length > 60) {
          return { error: 'agentConfigMeta.runtime.providerLabel must be a non-empty string (max 60 chars)' }
        }
        providerLabel = rt.providerLabel.trim()
      }
      let catalogId: string | undefined
      if (rt && typeof rt === 'object' && rt.catalogId !== undefined && rt.catalogId !== null) {
        if (typeof rt.catalogId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(rt.catalogId)) {
          return { error: 'agentConfigMeta.runtime.catalogId must be a slug (max 60 chars, lowercase)' }
        }
        catalogId = rt.catalogId
      }
      meta.runtime = { provider, model: model.trim(), ...(providerLabel ? { providerLabel } : {}), ...(catalogId ? { catalogId } : {}) }
    }
    agentConfigMeta = meta
  }
  let agentBillingModel: AgentBillingModel | null = null
  if (raw.agentBillingModel !== undefined && raw.agentBillingModel !== null) {
    const parsed = AgentBillingModelSchema.safeParse(raw.agentBillingModel)
    if (!parsed.success) return { error: 'agentBillingModel must be one of ONE_TIME|PER_HOUR|PER_TOKEN|SUBSCRIPTION' }
    agentBillingModel = parsed.data
  }
  return {
    value: {
      agentConfigSealed: (raw.agentConfigSealed as string | undefined) ?? null,
      agentConfigMeta,
      agentBillingModel,
      canvas,
    },
  }
}

// ADR-305 D6 / FU-394: format-only validation for the Persona Pack reference
// fields. No Blossom/IPFS/Nostr hosting integration exists in this repo, so
// the server never has the pack's actual bytes at offer-save time — it can
// only check internal consistency of what the caller sent (hash shape,
// version shape, hash/id implying a ref). Verifying the hash against real
// pack content is `@col/agent-persona`'s `verifyPersonaPackHash()`, run by
// whichever future loader actually fetches the pack (FU-394 follow-up, not
// this endpoint).
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function parsePersonaPackRefFields(raw: {
  personaPackRef?: unknown
  personaPackVersion?: unknown
  personaPackHash?: unknown
  personaId?: unknown
}): { error: string } | null {
  const hasRef = typeof raw.personaPackRef === 'string' && raw.personaPackRef.length > 0
  if (raw.personaPackRef !== undefined && raw.personaPackRef !== null && raw.personaPackRef !== '' && typeof raw.personaPackRef !== 'string') {
    return { error: 'personaPackRef must be a string' }
  }
  if (raw.personaPackHash !== undefined && raw.personaPackHash !== null && raw.personaPackHash !== '') {
    if (typeof raw.personaPackHash !== 'string' || !SHA256_HEX_RE.test(raw.personaPackHash)) {
      return { error: 'personaPackHash must be a 64-character hex SHA-256 digest' }
    }
    if (!hasRef) return { error: 'personaPackHash requires personaPackRef to be set' }
  }
  if (raw.personaPackVersion !== undefined && raw.personaPackVersion !== null && raw.personaPackVersion !== '') {
    if (typeof raw.personaPackVersion !== 'string' || !SEMVER_RE.test(raw.personaPackVersion)) {
      return { error: 'personaPackVersion must be a semver string (e.g. 1.0.0)' }
    }
  }
  if (raw.personaId !== undefined && raw.personaId !== null && raw.personaId !== '') {
    if (typeof raw.personaId !== 'string' || !raw.personaId.trim()) {
      return { error: 'personaId must be a non-empty string' }
    }
    if (!hasRef) return { error: 'personaId requires personaPackRef to be set' }
  }
  return null
}

app.post('/api/offers', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const {
      title, description, priceSats, category, categoryCode,
      offerType, ticketType, location, deliveryTimeDays, deliveryCostSats,
      deliveryNotes, images, companyId, productId, deliveryTemplateId,
      status, milestones, country, region, city, isRemote, language,
      lat, lng,
      visibility, disputeMode,
      allowedVisibility,
      productType, physicalType, parentOfferId, specs, stock,
      weight, weightUnit, dimensions, dimensionsUnit, listingVisibility,
      shippingOptionRefs, gammaTags,
      useEscrow, phase2WindowHours,
      networkType, membershipCriteria, maxMembers,
      variantAxes, variantValues, variations,
      resourceId, bookingMode, priceUnit, bookingMinUnits, bookingMaxUnits,
      confirmationWindowHours, autoConfirm,
      agentProfileId, agentConfigSealed, agentConfigMeta, agentBillingModel, agentWorkspaceTTL,
      estimatedWorkspaceHours,
      personaPackRef, personaPackVersion, personaPackHash, personaId,
      createProduct, catalogId,
    } = req.body

    if (!title) {
      return res.status(400).json({ error: 'title is required' })
    }

    // Category consistency (ADR-380 invariant): every written categoryCode
    // must be a real StandardCategory slug, otherwise the listing is invisible
    // to category filters and badge sums drift from distinct results.
    const categoryResolution = await resolveCategoryCode(prisma, categoryCode)
    if (!categoryResolution.ok) {
      return res.status(400).json({ error: categoryResolution.message, code: 'INVALID_CATEGORY_CODE' })
    }

    // ADR-420: Offer.country always holds an ISO alpha-2 code (or null), whatever
    // the client sent (code, free-text name, or only the `location` text).
    const countryResolution = resolveOfferCountry(country, location)
    if (!countryResolution.ok) {
      return res.status(400).json({ error: countryResolution.message, code: 'INVALID_COUNTRY' })
    }
    const resolvedCountry = countryResolution.country ?? null

    // ADR-305 D3: AGENT_SETUP offers book a specific AgentProfile and skip the
    // human-delivery fields (deliveryTemplateId/deliveryTimeDays/deliveryCostSats,
    // productId — irrelevant for agents; ticketType is always SMART_ORDER, V1
    // has no agent milestones).
    const agentSetupParsed = parseAgentSetupOfferFields({ agentConfigSealed, agentConfigMeta, agentBillingModel })
    if ('error' in agentSetupParsed) {
      return res.status(400).json({ error: agentSetupParsed.error })
    }
    const personaPackError = parsePersonaPackRefFields({ personaPackRef, personaPackVersion, personaPackHash, personaId })
    if (personaPackError) {
      return res.status(400).json({ error: personaPackError.error })
    }
    // ADR-326 D10.4 (FU-493): an AGENT_SETUP offer's companyId is DERIVED from
    // its AgentProfile, never accepted independently — the same agent must
    // not appear company-branded on one listing and personal on another.
    // Populated inside the AGENT_SETUP branch below; stays undefined for
    // every other offerType, where the FU-491 client-companyId path applies.
    let resolvedCompanyId: string | null | undefined
    if (offerType === 'AGENT_SETUP') {
      if (!agentProfileId || typeof agentProfileId !== 'string') {
        return res.status(400).json({ error: 'agentProfileId is required for AGENT_SETUP offers' })
      }
      const agentProfile = await prisma.agentProfile.findUnique({ where: { id: agentProfileId } })
      if (!agentProfile || agentProfile.ownerPubkey !== req.authPubkey) {
        return res.status(400).json({ error: 'agentProfileId must reference one of your own agent profiles' })
      }
      resolvedCompanyId = agentProfile.companyId
      if (!agentSetupParsed.value.agentConfigMeta || !agentSetupParsed.value.agentConfigMeta.capabilities) {
        return res.status(400).json({ error: 'agentConfigMeta.capabilities is required for AGENT_SETUP offers' })
      }
      if (ticketType && ticketType !== 'SMART_ORDER') {
        return res.status(400).json({ error: 'AGENT_SETUP offers must use ticketType SMART_ORDER' })
      }
      if (deliveryTemplateId || deliveryTimeDays || deliveryCostSats || productId) {
        return res.status(400).json({ error: 'deliveryTemplateId, deliveryTimeDays, deliveryCostSats and productId are not applicable to AGENT_SETUP offers' })
      }
    } else if (agentProfileId) {
      return res.status(400).json({ error: 'agentProfileId is only valid for AGENT_SETUP offers' })
    }

    // ADR-271: bookable-resource linking + booking pricing units
    const bookingParsed = parseBookingOfferFields({ resourceId, bookingMode, priceUnit, bookingMinUnits, bookingMaxUnits, confirmationWindowHours, autoConfirm })
    if ('error' in bookingParsed) {
      return res.status(400).json({ error: bookingParsed.error })
    }
    if (bookingParsed.value.resourceId) {
      const resource = await prisma.bookableResource.findUnique({ where: { id: bookingParsed.value.resourceId } })
      if (!resource || resource.ownerPubkey !== req.authPubkey) {
        return res.status(400).json({ error: 'resourceId must reference one of your own bookable resources' })
      }
      if (bookingParsed.value.bookingMode === 'DATE_RANGE' && resource.kind !== 'SPACE') {
        return res.status(400).json({ error: 'bookingMode DATE_RANGE requires a SPACE resource' })
      }
      if (bookingParsed.value.bookingMode === 'SESSION' && resource.kind !== 'SESSION') {
        return res.status(400).json({ error: 'bookingMode SESSION requires a SESSION resource' })
      }
      // ADR-369: OPEN SESSION resources (time blocks) are priced per hour —
      // a per_seat/per_day/night tariff has no duration semantics there.
      if (bookingParsed.value.bookingMode === 'SESSION'
        && resource.kind === 'SESSION' && resource.bookingStyle === 'OPEN'
        && bookingParsed.value.priceUnit !== 'per_hour') {
        return res.status(400).json({ error: 'SESSION resources with bookingStyle OPEN require priceUnit per_hour' })
      }
    }

    // ADR-326 D10.1 (FU-491): companyId was previously accepted verbatim from
    // any authenticated client with no ownership check, letting a user
    // attach an offer to a company they don't own. Same validate-by-lookup
    // pattern as agentProfileId/resourceId above. Skipped for AGENT_SETUP —
    // resolvedCompanyId is already derived from the AgentProfile above (FU-493).
    if (resolvedCompanyId === undefined) {
      if (companyId) {
        const company = await prisma.company.findUnique({ where: { id: companyId } })
        if (!company || company.ownerPubkey !== req.authPubkey) {
          return res.status(400).json({ error: 'companyId must reference your own company' })
        }
      }
      resolvedCompanyId = companyId ?? null
    }

    // ADR-395: company products. `productId` links a new listing to an existing
    // product (previously accepted unchecked); `createProduct` creates the
    // Product row in the same transaction — the catalog is optional.
    let resolvedProductId: string | null = null
    let productToCreate: { companyId: string; catalogId: string | null; standardCategoryId: string | null } | null = null
    if (productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: {
          companyId: true,
          company: { select: { ownerPubkey: true } },
          catalog: { select: { companyId: true, company: { select: { ownerPubkey: true } } } },
        },
      })
      const productOwner = product?.company?.ownerPubkey ?? product?.catalog?.company?.ownerPubkey
      if (!product || productOwner !== req.authPubkey) {
        return res.status(400).json({ error: 'productId must reference one of your own products' })
      }
      resolvedProductId = productId
      resolvedCompanyId = product.companyId ?? product.catalog?.companyId ?? resolvedCompanyId
    } else if (createProduct === true) {
      if (offerType !== 'PRODUCT' && offerType !== 'ITEM') {
        return res.status(400).json({ error: 'createProduct is only valid for PRODUCT and ITEM offers' })
      }
      if (!resolvedCompanyId) {
        const ownCompany = await prisma.company.findUnique({ where: { ownerPubkey: req.authPubkey! }, select: { id: true } })
        resolvedCompanyId = ownCompany?.id ?? null
      }
      if (!resolvedCompanyId) {
        return res.status(400).json({
          error: 'COMPANY_REQUIRED',
          message: 'Products belong to a company. Create your company profile before adding products.',
        })
      }
      let catalogStandardCategoryId: string | null = null
      if (catalogId) {
        const catalog = await prisma.catalog.findUnique({
          where: { id: catalogId },
          select: { companyId: true, catalogType: true, standardCategoryId: true },
        })
        if (!catalog || catalog.catalogType !== 'PRODUCT' || catalog.companyId !== resolvedCompanyId) {
          return res.status(400).json({ error: "catalogId must reference one of your company's product catalogs" })
        }
        catalogStandardCategoryId = catalog.standardCategoryId
      }
      const offerCategory = categoryResolution.categoryCode
        ? await prisma.standardCategory.findUnique({ where: { slug: categoryResolution.categoryCode }, select: { id: true } })
        : null
      productToCreate = {
        companyId: resolvedCompanyId,
        catalogId: catalogId || null,
        standardCategoryId: offerCategory?.id ?? catalogStandardCategoryId,
      }
    } else if (catalogId) {
      return res.status(400).json({ error: 'catalogId requires createProduct or productId' })
    }

    // ADR-270 D3: Matrix limits (max 3 axes, 12 values each, 100 combinations)
    if (variantAxes) {
      if (!Array.isArray(variantAxes) || variantAxes.length > 3) {
        return res.status(400).json({ error: 'variantAxes must be an array of at most 3 axes' })
      }
      for (const axis of variantAxes) {
        if (!axis.name || !Array.isArray(axis.values) || axis.values.length > 12) {
          return res.status(400).json({ error: `Axis "${axis?.name}" must have between 1 and 12 values` })
        }
      }
    }
    if (variations) {
      if (!Array.isArray(variations) || variations.length > 100) {
        return res.status(400).json({ error: 'variations count cannot exceed 100 combinations' })
      }
    }

    if (rejectEscrowIfDisabled(req, res)) return

    const statusParsed = OfferStatusSchema.safeParse(status ?? 'DRAFT')
    if (!statusParsed.success) {
      return res.status(400).json({ error: 'invalid status', details: statusParsed.error.issues })
    }
    const validStatus = statusParsed.data

    // ADR-152: validate TradeVisibility + DisputeMode (default PUBLIC = no breaking change)
    const visParsed = TradeVisibilitySchema.safeParse(visibility ?? 'PUBLIC')
    if (!visParsed.success) {
      return res.status(400).json({ error: 'invalid visibility', details: visParsed.error.issues })
    }
    const dmParsed = DisputeModeSchema.safeParse(disputeMode ?? 'PUBLIC')
    if (!dmParsed.success) {
      return res.status(400).json({ error: 'invalid disputeMode', details: dmParsed.error.issues })
    }
    const visibilityParsed = AllowedVisibilitySchema.safeParse(allowedVisibility)
    if (!visibilityParsed.success) {
      return res.status(400).json({ error: 'invalid allowedVisibility', details: visibilityParsed.error.issues })
    }
    const validAllowedVisibility = visibilityParsed.data ?? [0]

    const creatorPubkey = req.authPubkey!

    // ADR-253: a published (ACTIVE) direct-pay listing needs a resolvable
    // seller payment method — otherwise every buyer hits
    // SELLER_UNCONFIGURED at checkout. Escrow listings are exempt.
    if (validStatus === 'ACTIVE' && !(useEscrow ?? false)) {
      const configured = await hasSellerPaymentMethodConfigured(prisma, creatorPubkey)
      if (!configured) {
        return res.status(422).json({
          error: 'SELLER_PAYMENT_NOT_CONFIGURED',
          message: 'Please add a Lightning address or an NWC wallet in Settings before publishing an offer.',
        })
      }
    }

    // ADR-306 D5: a published (ACTIVE) AGENT_SETUP offer must carry a sealed
    // config — DRAFT keeps the field optional while the owner is still
    // building it in the client-side config editor.
    if (offerType === 'AGENT_SETUP' && validStatus === 'ACTIVE' && !agentSetupParsed.value.agentConfigSealed) {
      return res.status(400).json({ error: 'agentConfigSealed is required to publish an AGENT_SETUP offer as ACTIVE' })
    }

    // ADR-342 D2 (P1): publish gate for canvas-configured setups — the async
    // health probe must have confirmed the doop-local instance first (direct
    // POST-ACTIVE with doop-local therefore always fails here; clients save
    // DRAFT, wait for the probe, then PATCH to ACTIVE). Structured `code`
    // per the PAYMENTS.md error contract — branch on code, not error text.
    if (offerType === 'AGENT_SETUP' && validStatus === 'ACTIVE') {
      const canvasGate = canvasPublishGate(agentSetupParsed.value.agentConfigMeta)
      if (canvasGate) {
        return res.status(400).json({ error: canvasGate.error, code: canvasGate.code })
      }
    }

    // ADR-342 D2: a freshly saved doop-local canvas starts 'unchecked'; the
    // outbox probe enqueued after create flips it to ok/unreachable async.
    if (agentSetupParsed.value.canvas?.provider === 'doop-local' && agentSetupParsed.value.agentConfigMeta) {
      agentSetupParsed.value.agentConfigMeta.canvas = { ...agentSetupParsed.value.canvas, probeStatus: 'unchecked' }
    }

    const imageThumbs = images ? (await makeThumbsFromImages(images) ?? undefined) : undefined

    let resolvedLat: number | null = typeof lat === 'number' ? lat : null
    let resolvedLng: number | null = typeof lng === 'number' ? lng : null
    if (resolvedLat === null && (city || resolvedCountry)) {
      const coords = await geocodeCity(city, resolvedCountry)
      if (coords) { resolvedLat = coords.lat; resolvedLng = coords.lng }
    }

    const offerData = {
      title,
      description,
      priceSats: priceSats || 0,
      category,
      categoryCode: categoryResolution.categoryCode || DEFAULT_OFFER_CATEGORY_CODE,
      creatorPubkey,
      offerType: offerType || 'PRODUCT',
      ticketType: ticketType || 'SMART_ORDER',
      location,
      deliveryTimeDays,
      deliveryCostSats,
      deliveryNotes,
      images: images || undefined,
      imageThumbs,
      companyId: resolvedCompanyId,
      productId: resolvedProductId,
      deliveryTemplateId,
      status: validStatus,
      publishedAt: validStatus === 'ACTIVE' ? new Date() : undefined,
      country: resolvedCountry,
      region,
      city,
      lat: resolvedLat,
      lng: resolvedLng,
      isRemote: isRemote ?? false,
      language,
      source: 'LOCAL',
      visibility: visParsed.data,
      disputeMode: dmParsed.data,
      allowedVisibility: validAllowedVisibility,
      productType: productType || null,
      physicalType: physicalType || null,
      parentOfferId: parentOfferId || null,
      specs: specs || undefined,
      stock: stock ?? undefined,
      weight: weight || null,
      weightUnit: weightUnit || null,
      dimensions: dimensions || null,
      dimensionsUnit: dimensionsUnit || null,
      listingVisibility: listingVisibility || 'on-sale',
      shippingOptionRefs: shippingOptionRefs || undefined,
      // ADR-277 D3/E1: seller-entered Gamma `t` tags, normalized the same way
      // as ingest/publish so the three never drift.
      gammaTags: Array.isArray(gammaTags) ? normalizeGammaTags(gammaTags) : [],
      useEscrow: useEscrow ?? false,
      phase2WindowHours:
        typeof phase2WindowHours === 'number' && Number.isInteger(phase2WindowHours) && phase2WindowHours >= 1 && phase2WindowHours <= 168
          ? phase2WindowHours
          : 24,
      // Network-type cooperation membership config (coopType=network). Null for
      // plain offers. networkType normalized to lowercase 'open'|'closed'.
      networkType: networkType === 'closed' ? 'closed' : networkType === 'open' ? 'open' : null,
      membershipCriteria: membershipCriteria || null,
      maxMembers: typeof maxMembers === 'number' && maxMembers > 0 ? Math.floor(maxMembers) : null,
      // ADR-270: Product attributes & variant matrix
      variantAxes: variantAxes || undefined,
      variantValues: variantValues || undefined,
      // ADR-271: bookable-resource linking + booking pricing units
      resourceId: bookingParsed.value.resourceId,
      bookingMode: bookingParsed.value.bookingMode,
      priceUnit: bookingParsed.value.priceUnit,
      bookingMinUnits: bookingParsed.value.bookingMinUnits,
      bookingMaxUnits: bookingParsed.value.bookingMaxUnits,
      confirmationWindowHours: bookingParsed.value.confirmationWindowHours,
      autoConfirm: bookingParsed.value.autoConfirm,
      // ADR-305 D2/D6: agent-setup fields — undefined (not null) for non-agent
      // offers so Prisma leaves them out of the insert entirely.
      agentProfileId: offerType === 'AGENT_SETUP' ? agentProfileId : undefined,
      agentConfigSealed: agentSetupParsed.value.agentConfigSealed ?? undefined,
      agentConfigMeta: agentSetupParsed.value.agentConfigMeta ?? undefined,
      agentBillingModel: agentSetupParsed.value.agentBillingModel ?? undefined,
      agentWorkspaceTTL: typeof agentWorkspaceTTL === 'number' && agentWorkspaceTTL > 0 ? Math.floor(agentWorkspaceTTL) : undefined,
      // FU-376 (revised 2026-08-29): seller-declared typical work duration —
      // the basis for the buyer's mandatory initial funding at workspace
      // initiation (computeMandatoryInitialFundingSats). No Foundation
      // subsidy exists; this number directly determines what gets charged.
      estimatedWorkspaceHours: typeof estimatedWorkspaceHours === 'number' && estimatedWorkspaceHours > 0 ? estimatedWorkspaceHours : undefined,
      personaPackRef: personaPackRef || undefined,
      personaPackVersion: personaPackVersion || undefined,
      personaPackHash: personaPackHash || undefined,
      personaId: personaId || undefined,
    }

    const offer = await prisma.$transaction(async (tx) => {
      // ADR-395: the Product row is created first so the offer (and every
      // variation child) links to it inside the same transaction.
      let linkedProductId = resolvedProductId
      if (productToCreate) {
        const product = await tx.product.create({
          data: buildCompanyProductData({
            ...productToCreate,
            name: title,
            description,
            priceSats,
            stock,
            images,
            gammaTags: offerData.gammaTags,
            productType,
            physicalType,
            specs,
            variantAxes,
            weight,
            weightUnit,
            dimensions,
            dimensionsUnit,
            listingVisibility,
          }),
          select: { id: true },
        })
        linkedProductId = product.id
      }
      const linkedOfferData = { ...offerData, productId: linkedProductId }
      const created = await writeWithOutbox(
        tx,
        'offer',
        '',
        'upsert',
        linkedOfferData,
        (id) => tx.offer.create({ data: { ...linkedOfferData, id } as Parameters<typeof tx.offer.create>[0]['data'] }),
      )
      // ADR-342 D2: async health probe for doop-local canvas instances.
      if (agentSetupParsed.value.canvas?.provider === 'doop-local') {
        await enqueueCanvasProbe(tx, created.id)
      }
      if (milestones && milestones.length > 0) {
        await tx.offerMilestone.createMany({
          data: milestones.map((m: { title: string; description?: string; percentage: number; sortOrder?: number }, i: number) => ({
            offerId: created.id,
            title: m.title,
            description: m.description,
            percentage: m.percentage,
            sortOrder: m.sortOrder ?? i,
          })),
        })
      }

      // ADR-270 D2/D3: If child variations provided, create child Offer records
      if (variations && Array.isArray(variations) && variations.length > 0) {
        for (const v of variations) {
          const vThumbs = v.images ? (await makeThumbsFromImages(v.images) ?? undefined) : undefined
          const childTitle = v.title || `${title} - ${formatVariantLabel(v.variantValues)}`
          const childData = {
            title: childTitle,
            description,
            priceSats: typeof v.priceSats === 'number' ? v.priceSats : priceSats || 0,
            category,
            categoryCode: categoryCode || 'services/other',
            gammaTags: offerData.gammaTags,
            creatorPubkey,
            offerType: offerType || 'PRODUCT',
            ticketType: ticketType || 'SMART_ORDER',
            location,
            deliveryTimeDays,
            deliveryCostSats,
            deliveryNotes,
            images: v.images || images || undefined,
            imageThumbs: vThumbs ?? imageThumbs,
            companyId: resolvedCompanyId,
            productId: linkedProductId,
            deliveryTemplateId,
            status: validStatus,
            publishedAt: validStatus === 'ACTIVE' ? new Date() : undefined,
            country: resolvedCountry,
            region,
            city,
            lat: resolvedLat,
            lng: resolvedLng,
            isRemote: isRemote ?? false,
            language,
            source: 'LOCAL',
            visibility: visParsed.data,
            disputeMode: dmParsed.data,
            allowedVisibility: validAllowedVisibility,
            productType: 'variation',
            physicalType: physicalType || 'physical',
            parentOfferId: created.id,
            specs: specs || undefined,
            stock: typeof v.stock === 'number' ? v.stock : (stock ?? undefined),
            weight: weight || null,
            weightUnit: weightUnit || null,
            dimensions: dimensions || null,
            dimensionsUnit: dimensionsUnit || null,
            listingVisibility: v.listingVisibility || 'on-sale',
            shippingOptionRefs: shippingOptionRefs || undefined,
            useEscrow: useEscrow ?? false,
            phase2WindowHours: typeof phase2WindowHours === 'number' ? phase2WindowHours : 24,
            variantValues: v.variantValues || undefined,
          }
          await writeWithOutbox(
            tx,
            'offer',
            '',
            'upsert',
            childData,
            (childId) => tx.offer.create({ data: { ...childData, id: childId } as Parameters<typeof tx.offer.create>[0]['data'] }),
          )
        }
      }

      return created
    })

    // ADR-420: drop the cached offer + list pages BEFORE answering. The client
    // refetches the moment it gets this response; invalidating afterwards let that
    // refetch read the stale 5 min `/api/offers/:id` entry.
    await Promise.all([
      invalidateListCache('offers'),
      cache.invalidateByPattern(`/api/offers/${offer.id}?*`),
    ]).catch(err => console.warn('[cache] offer invalidation failed:', err))

    res.json({ success: true, offer })

    // ADR-164 / PROB-003 B-α: provision an isolated sub-wallet for PRIVATE
    // offers when the owner's strategy resolves to CUSTODIAL. Best-effort,
    // fire-and-forget — must never break offer creation.
    if (visParsed.data === 'PRIVATE') {
      subWalletService
        .provisionPrivateTrade({ kind: 'offer', tradeId: offer.id, ownerPubkey: creatorPubkey })
        .then(r => {
          if (!r.provisioned) console.warn(`[B-α] offer ${offer.id}: ${r.reason}`)
        })
        .catch(err => console.error(`[B-α] offer ${offer.id} sub-wallet provisioning failed:`, err))
    }

    // ADR-412 D1: publish ACTIVE+PUBLIC offers to Nostr (Kind 30017/30402).
    // Previously nothing in the create/edit lifecycle ever called this:
    // offers were never broadcast at all (ADR-412 Bug A). Fire-and-forget,
    // must never fail or delay offer creation. PRIVATE is also enforced
    // inside publishAndSyncOffer (ADR-152), checked here too to skip the
    // DB round-trip for the common non-ACTIVE-draft case.
    if (validStatus === 'ACTIVE' && visParsed.data !== 'PRIVATE') {
      publishAndSyncOffer(prisma, offer.id).catch(err =>
        console.error(`[ADR-412] Failed to publish offer ${offer.id} to Nostr:`, err))
    }

  } catch (error) {
    console.error('Failed to create offer:', error)
    res.status(500).json({ error: 'Failed to create offer' })
  }
})

// PATCH /api/offers/:id – Update offer
app.patch('/api/offers/:id', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const {
      title, description, priceSats, category, categoryCode,
      offerType, ticketType, location, deliveryTimeDays, deliveryCostSats,
      deliveryNotes, images, companyId, productId, deliveryTemplateId,
      status, milestones, country, region, city, isRemote, language,
      lat, lng,
      visibility, disputeMode,
      productType, physicalType, parentOfferId, specs, stock,
      weight, weightUnit, dimensions, dimensionsUnit, listingVisibility,
      shippingOptionRefs, gammaTags,
      useEscrow, phase2WindowHours,
      networkType, membershipCriteria, maxMembers,
      variantAxes, variantValues, variations,
      resourceId, bookingMode, priceUnit, bookingMinUnits, bookingMaxUnits,
      confirmationWindowHours, autoConfirm,
      agentProfileId, agentConfigSealed, agentConfigMeta, agentBillingModel, agentWorkspaceTTL,
      estimatedWorkspaceHours,
      personaPackRef, personaPackVersion, personaPackHash, personaId,
    } = req.body

    // ADR-396 D4: opt back in — the ACTIVE publish gate below merges the stored seal.
    const existing = await prisma.offer.findUnique({ where: { id }, omit: { agentConfigSealed: false } })
    if (!existing) {
      return res.status(404).json({ error: 'Offer not found' })
    }

    // Security fix (found 2026-08-26, no prior ADR/FU covered this): this
    // route had NO ownership check at all — any authenticated pubkey could
    // PATCH any other user's offer (price, status, description, everything).
    // Mirrors the DELETE handler's equivalent check below.
    if (existing.creatorPubkey !== req.authPubkey) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not own this offer' })
    }

    // ADR-386 D5: COOP-network full-form edits (visibility/disputeMode/companyId
    // — fields the lightweight NetworkEditDialog never sends) are only accepted
    // while the network is still unengaged (no member of any status, no ticket).
    const isNetworkFullEditPayload = visibility !== undefined || disputeMode !== undefined || companyId !== undefined
    if (existing.offerType === 'COOP' && existing.status !== 'DRAFT' && isNetworkFullEditPayload) {
      const engagementProbe = await prisma.offer.findUnique({
        where: { id },
        include: { _count: { select: { members: true, tickets: true } } },
      })
      if (!engagementProbe || !offerCanFullEdit(engagementProbe as unknown as OfferEngagementShape)) {
        return res.status(409).json({
          error: 'This network already has members or activity and can no longer be edited through the full form',
          code: 'NETWORK_ENGAGED',
        })
      }
    }

    // Category consistency: same slug validation as POST — an explicit null
    // clears the field, undefined skips it (helper short-circuits, no query).
    const categoryResolution = await resolveCategoryCode(prisma, categoryCode)
    if (!categoryResolution.ok || categoryResolution.categoryCode === null) {
      return res.status(400).json({
        error: categoryResolution.ok
          ? 'Offer.categoryCode is required and cannot be cleared'
          : categoryResolution.message,
        code: 'INVALID_CATEGORY_CODE',
      })
    }

    // ADR-420: same ISO normalization as POST; an edited `location` text also
    // refreshes the column when no explicit country is sent (undefined = untouched).
    const countryResolution = resolveOfferCountry(country, location)
    if (!countryResolution.ok) {
      return res.status(400).json({ error: countryResolution.message, code: 'INVALID_COUNTRY' })
    }
    const patchCountry = countryResolution.country

    // ADR-305 D3: same AGENT_SETUP validation as creation, applied to the
    // resulting (merged) offerType so a PATCH can't slip an unvalidated
    // agent config onto an existing AGENT_SETUP offer.
    const resultingOfferType = offerType !== undefined ? offerType : existing.offerType
    const agentSetupParsed = parseAgentSetupOfferFields({
      agentConfigSealed: agentConfigSealed !== undefined ? agentConfigSealed : existing.agentConfigSealed,
      agentConfigMeta: agentConfigMeta !== undefined ? agentConfigMeta : existing.agentConfigMeta,
      agentBillingModel: agentBillingModel !== undefined ? agentBillingModel : existing.agentBillingModel,
    })
    if ('error' in agentSetupParsed) {
      return res.status(400).json({ error: agentSetupParsed.error })
    }
    const personaPackErrorPatch = parsePersonaPackRefFields({
      personaPackRef: personaPackRef !== undefined ? personaPackRef : existing.personaPackRef,
      personaPackVersion: personaPackVersion !== undefined ? personaPackVersion : existing.personaPackVersion,
      personaPackHash: personaPackHash !== undefined ? personaPackHash : existing.personaPackHash,
      personaId: personaId !== undefined ? personaId : existing.personaId,
    })
    if (personaPackErrorPatch) {
      return res.status(400).json({ error: personaPackErrorPatch.error })
    }
    // ADR-326 D10.4 (FU-493): same derivation as create — populated below
    // whenever the resulting offer is AGENT_SETUP, regardless of whether
    // this particular PATCH touches agentProfileId.
    let resolvedCompanyId: string | null | undefined
    if (resultingOfferType === 'AGENT_SETUP') {
      const resultingAgentProfileId = agentProfileId !== undefined ? agentProfileId : existing.agentProfileId
      if (!resultingAgentProfileId) {
        return res.status(400).json({ error: 'agentProfileId is required for AGENT_SETUP offers' })
      }
      const resultingAgentProfile = await prisma.agentProfile.findUnique({ where: { id: resultingAgentProfileId } })
      if (!resultingAgentProfile || resultingAgentProfile.ownerPubkey !== req.authPubkey) {
        return res.status(400).json({ error: 'agentProfileId must reference one of your own agent profiles' })
      }
      resolvedCompanyId = resultingAgentProfile.companyId
      if (!agentSetupParsed.value.agentConfigMeta || !agentSetupParsed.value.agentConfigMeta.capabilities) {
        return res.status(400).json({ error: 'agentConfigMeta.capabilities is required for AGENT_SETUP offers' })
      }
      const resultingTicketType = ticketType !== undefined ? ticketType : existing.ticketType
      if (resultingTicketType !== 'SMART_ORDER') {
        return res.status(400).json({ error: 'AGENT_SETUP offers must use ticketType SMART_ORDER' })
      }
    } else if (agentProfileId) {
      return res.status(400).json({ error: 'agentProfileId is only valid for AGENT_SETUP offers' })
    }

    // ADR-342 D2: the canvas probe cache (probeStatus/probeAt) is
    // server-managed — parsing strips it from the merged meta, so restore it
    // from the stored offer when the canvas binding (provider + instanceUrl
    // + canvasId) is unchanged; a changed/new doop-local binding resets to
    // 'unchecked' and gets re-probed asynchronously (P1: never inline here).
    const existingCanvas = readCanvasConfig(existing.agentConfigMeta)
    let canvasProbeNeeded = false
    if (agentSetupParsed.value.canvas && agentSetupParsed.value.agentConfigMeta) {
      const newCanvas = agentSetupParsed.value.canvas
      const unchanged = existingCanvas?.provider === newCanvas.provider
        && existingCanvas?.instanceUrl === newCanvas.instanceUrl
        && existingCanvas?.canvasId === newCanvas.canvasId
      if (unchanged) {
        agentSetupParsed.value.agentConfigMeta.canvas = {
          ...newCanvas,
          ...(existingCanvas!.probeStatus ? { probeStatus: existingCanvas!.probeStatus } : {}),
          ...(existingCanvas!.probeAt ? { probeAt: existingCanvas!.probeAt } : {}),
        }
      } else if (newCanvas.provider === 'doop-local') {
        agentSetupParsed.value.agentConfigMeta.canvas = { ...newCanvas, probeStatus: 'unchecked' as const }
        canvasProbeNeeded = true
      }
    }

    // ADR-271: booking fields — patched values merge onto the existing offer
    // (null clears back to a non-bookable plain offer).
    const bookingParsed = parseBookingOfferFields({
      resourceId: resourceId !== undefined ? resourceId : existing.resourceId,
      bookingMode: bookingMode !== undefined ? bookingMode : existing.bookingMode,
      priceUnit: priceUnit !== undefined ? priceUnit : existing.priceUnit,
      bookingMinUnits: bookingMinUnits !== undefined ? bookingMinUnits : existing.bookingMinUnits,
      bookingMaxUnits: bookingMaxUnits !== undefined ? bookingMaxUnits : existing.bookingMaxUnits,
      confirmationWindowHours: confirmationWindowHours !== undefined ? confirmationWindowHours : existing.confirmationWindowHours,
      autoConfirm: autoConfirm !== undefined ? autoConfirm : existing.autoConfirm,
    })
    if ('error' in bookingParsed) {
      return res.status(400).json({ error: bookingParsed.error })
    }
    if (bookingParsed.value.resourceId) {
      const resource = await prisma.bookableResource.findUnique({ where: { id: bookingParsed.value.resourceId } })
      if (!resource || resource.ownerPubkey !== req.authPubkey) {
        return res.status(400).json({ error: 'resourceId must reference one of your own bookable resources' })
      }
      if (bookingParsed.value.bookingMode === 'DATE_RANGE' && resource.kind !== 'SPACE') {
        return res.status(400).json({ error: 'bookingMode DATE_RANGE requires a SPACE resource' })
      }
      if (bookingParsed.value.bookingMode === 'SESSION' && resource.kind !== 'SESSION') {
        return res.status(400).json({ error: 'bookingMode SESSION requires a SESSION resource' })
      }
      // ADR-369: OPEN SESSION resources (time blocks) are priced per hour —
      // a per_seat/per_day/night tariff has no duration semantics there.
      if (bookingParsed.value.bookingMode === 'SESSION'
        && resource.kind === 'SESSION' && resource.bookingStyle === 'OPEN'
        && bookingParsed.value.priceUnit !== 'per_hour') {
        return res.status(400).json({ error: 'SESSION resources with bookingStyle OPEN require priceUnit per_hour' })
      }
    }

    // ADR-326 D10.1 (FU-491): same companyId ownership validation as create.
    // Skipped for AGENT_SETUP — resolvedCompanyId is already derived above (FU-493).
    if (resolvedCompanyId === undefined && companyId !== undefined) {
      if (companyId) {
        const company = await prisma.company.findUnique({ where: { id: companyId } })
        if (!company || company.ownerPubkey !== req.authPubkey) {
          return res.status(400).json({ error: 'companyId must reference your own company' })
        }
      }
    }

    // ADR-270 D3: Matrix limits
    if (variantAxes) {
      if (!Array.isArray(variantAxes) || variantAxes.length > 3) {
        return res.status(400).json({ error: 'variantAxes must be an array of at most 3 axes' })
      }
      for (const axis of variantAxes) {
        if (!axis.name || !Array.isArray(axis.values) || axis.values.length > 12) {
          return res.status(400).json({ error: `Axis "${axis?.name}" must have between 1 and 12 values` })
        }
      }
    }
    if (variations) {
      if (!Array.isArray(variations) || variations.length > 100) {
        return res.status(400).json({ error: 'variations count cannot exceed 100 combinations' })
      }
    }

    if (rejectEscrowIfDisabled(req, res)) return

    let validStatus: string | undefined
    if (status !== undefined) {
      const parsed = OfferStatusSchema.safeParse(status)
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid status', details: parsed.error.issues })
      }
      validStatus = parsed.data
    }

    // ADR-152: optional visibility + disputeMode update (validated only if present)
    if (visibility !== undefined) {
      const parsed = TradeVisibilitySchema.safeParse(visibility)
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid visibility', details: parsed.error.issues })
      }
    }
    if (disputeMode !== undefined) {
      const parsed = DisputeModeSchema.safeParse(disputeMode)
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid disputeMode', details: parsed.error.issues })
      }
    }

    // ADR-253: the resulting state (after this patch) must not be an ACTIVE
    // direct-pay listing with no resolvable seller payment method — same
    // rule as offer-creation, applied to the merged result so it also
    // catches "already ACTIVE, seller since disconnected their only rail".
    const resultingStatus = validStatus ?? existing.status
    const resultingUseEscrow = useEscrow !== undefined ? Boolean(useEscrow) : existing.useEscrow
    if (resultingStatus === 'ACTIVE' && !resultingUseEscrow) {
      const configured = await hasSellerPaymentMethodConfigured(prisma, existing.creatorPubkey)
      if (!configured) {
        return res.status(422).json({
          error: 'SELLER_PAYMENT_NOT_CONFIGURED',
          message: 'Please add a Lightning address or an NWC wallet in Settings before publishing an offer.',
        })
      }
    }

    // ADR-306 D5: same rule as creation, applied to the merged result so a
    // PATCH can't flip an existing AGENT_SETUP offer to ACTIVE while leaving
    // (or clearing) an empty sealed config.
    if (resultingOfferType === 'AGENT_SETUP' && resultingStatus === 'ACTIVE' && !agentSetupParsed.value.agentConfigSealed) {
      return res.status(400).json({ error: 'agentConfigSealed is required to publish an AGENT_SETUP offer as ACTIVE' })
    }

    // ADR-342 D2 (P1): publish gate for canvas-configured setups — the probe
    // cache restored above lets an unchanged, already-probed canvas through;
    // anything else fails with a structured `code` (PAYMENTS.md contract).
    if (resultingOfferType === 'AGENT_SETUP' && resultingStatus === 'ACTIVE') {
      const canvasGate = canvasPublishGate(agentSetupParsed.value.agentConfigMeta)
      if (canvasGate) {
        return res.status(400).json({ error: canvasGate.error, code: canvasGate.code })
      }
    }

    const newImageThumbs = images !== undefined
      ? await makeThumbsFromImages(images)
      : undefined

    // auto-geocode if city/country changed but no explicit lat/lng provided
    let patchLat: number | null | undefined = lat !== undefined ? (typeof lat === 'number' ? lat : null) : undefined
    let patchLng: number | null | undefined = lng !== undefined ? (typeof lng === 'number' ? lng : null) : undefined
    if (patchLat === undefined && (city !== undefined || patchCountry !== undefined)) {
      const geocity = city ?? existing.city
      const geocountry = patchCountry === undefined ? existing.country : patchCountry
      const coords = await geocodeCity(geocity, geocountry)
      if (coords) { patchLat = coords.lat; patchLng = coords.lng }
    }

    const updateData: Record<string, unknown> = {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(priceSats !== undefined && { priceSats }),
      ...(category !== undefined && { category }),
      ...(categoryResolution.categoryCode !== undefined && { categoryCode: categoryResolution.categoryCode }),
      ...(offerType !== undefined && { offerType }),
      ...(ticketType !== undefined && { ticketType }),
      ...(location !== undefined && { location }),
      ...(deliveryTimeDays !== undefined && { deliveryTimeDays }),
      ...(deliveryCostSats !== undefined && { deliveryCostSats }),
      ...(deliveryNotes !== undefined && { deliveryNotes }),
      ...(images !== undefined && { images }),
      ...(images !== undefined && { imageThumbs: newImageThumbs }),
      // ADR-326 D10.4 (FU-493): AGENT_SETUP always writes the derived value
      // (keeps the offer in sync even if only the AgentProfile's companyId
      // changed elsewhere); every other offerType keeps the plain
      // partial-update semantics on the client-sent + ownership-validated value.
      ...(resultingOfferType === 'AGENT_SETUP'
        ? { companyId: resolvedCompanyId }
        : (companyId !== undefined && { companyId })),
      ...(productId !== undefined && { productId }),
      ...(deliveryTemplateId !== undefined && { deliveryTemplateId }),
      ...(validStatus !== undefined && {
        status: validStatus,
        publishedAt: validStatus === 'ACTIVE' && !existing.publishedAt ? new Date() : existing.publishedAt,
      }),
      ...(patchCountry !== undefined && { country: patchCountry }),
      ...(region !== undefined && { region }),
      ...(city !== undefined && { city }),
      ...(patchLat !== undefined && { lat: patchLat }),
      ...(patchLng !== undefined && { lng: patchLng }),
      ...(isRemote !== undefined && { isRemote }),
      ...(language !== undefined && { language }),
      ...(visibility !== undefined && { visibility }),
      ...(disputeMode !== undefined && { disputeMode }),
      ...(productType !== undefined && { productType }),
      ...(physicalType !== undefined && { physicalType }),
      ...(parentOfferId !== undefined && { parentOfferId }),
      ...(specs !== undefined && { specs }),
      ...(stock !== undefined && { stock }),
      ...(weight !== undefined && { weight }),
      ...(weightUnit !== undefined && { weightUnit }),
      ...(dimensions !== undefined && { dimensions }),
      ...(dimensionsUnit !== undefined && { dimensionsUnit }),
      ...(listingVisibility !== undefined && { listingVisibility }),
      ...(shippingOptionRefs !== undefined && { shippingOptionRefs }),
      ...(gammaTags !== undefined && { gammaTags: Array.isArray(gammaTags) ? normalizeGammaTags(gammaTags) : [] }),
      ...(useEscrow !== undefined && { useEscrow: Boolean(useEscrow) }),
      ...(phase2WindowHours !== undefined && {
        phase2WindowHours:
          typeof phase2WindowHours === 'number' && Number.isInteger(phase2WindowHours) && phase2WindowHours >= 1 && phase2WindowHours <= 168
            ? phase2WindowHours
            : 24,
      }),
      ...(networkType !== undefined && {
        networkType: networkType === 'closed' ? 'closed' : networkType === 'open' ? 'open' : null,
      }),
      ...(membershipCriteria !== undefined && { membershipCriteria: membershipCriteria || null }),
      ...(maxMembers !== undefined && {
        maxMembers: typeof maxMembers === 'number' && maxMembers > 0 ? Math.floor(maxMembers) : null,
      }),
      ...(variantAxes !== undefined && { variantAxes }),
      ...(variantValues !== undefined && { variantValues }),
      // ADR-271: booking fields (merged values; always present on a booking patch)
      ...(resourceId !== undefined || bookingMode !== undefined || priceUnit !== undefined
        || bookingMinUnits !== undefined || bookingMaxUnits !== undefined
        || confirmationWindowHours !== undefined || autoConfirm !== undefined
        ? {
            resourceId: bookingParsed.value.resourceId,
            bookingMode: bookingParsed.value.bookingMode,
            priceUnit: bookingParsed.value.priceUnit,
            bookingMinUnits: bookingParsed.value.bookingMinUnits,
            bookingMaxUnits: bookingParsed.value.bookingMaxUnits,
            confirmationWindowHours: bookingParsed.value.confirmationWindowHours,
            autoConfirm: bookingParsed.value.autoConfirm,
          }
        : {}),
      // ADR-305 D2/D6: agent-setup fields (patched only when explicitly sent)
      ...(agentProfileId !== undefined && { agentProfileId }),
      ...(agentConfigSealed !== undefined && { agentConfigSealed }),
      // ADR-342 D1/D2: store the SANITIZED meta (parse output), never the raw
      // client object — otherwise a forged canvas.probeStatus would reach the
      // DB and bypass the publish gate.
      ...(agentConfigMeta !== undefined && { agentConfigMeta: agentSetupParsed.value.agentConfigMeta }),
      ...(agentBillingModel !== undefined && { agentBillingModel }),
      ...(agentWorkspaceTTL !== undefined && { agentWorkspaceTTL }),
      ...(estimatedWorkspaceHours !== undefined && {
        estimatedWorkspaceHours: typeof estimatedWorkspaceHours === 'number' && estimatedWorkspaceHours > 0 ? estimatedWorkspaceHours : null,
      }),
      ...(personaPackRef !== undefined && { personaPackRef }),
      ...(personaPackVersion !== undefined && { personaPackVersion }),
      ...(personaPackHash !== undefined && { personaPackHash }),
      ...(personaId !== undefined && { personaId }),
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await writeWithOutbox(
        tx,
        'offer',
        id,
        'upsert',
        { ...existing, ...updateData },
        () => tx.offer.update({ where: { id }, data: updateData as Parameters<typeof tx.offer.update>[0]['data'] }),
      )
      // ADR-342 D2: re-probe when the doop-local canvas binding changed.
      if (canvasProbeNeeded) {
        await enqueueCanvasProbe(tx, id)
      }
      if (milestones) {
        await tx.offerMilestone.deleteMany({ where: { offerId: id } })
        if (milestones.length > 0) {
          await tx.offerMilestone.createMany({
            data: milestones.map((m: { title: string; description?: string; percentage: number; sortOrder?: number }, i: number) => ({
              offerId: id,
              title: m.title,
              description: m.description,
              percentage: m.percentage,
              sortOrder: m.sortOrder ?? i,
            })),
          })
        }
      }

      // ADR-270 D3: Variation reconciliation for variable offers
      if (variations && Array.isArray(variations)) {
        const existingChildren = await tx.offer.findMany({ where: { parentOfferId: id } })
        const matchedChildIds = new Set<string>()

        for (const v of variations) {
          const childTitle = v.title || `${(updateData.title as string) ?? existing.title} - ${formatVariantLabel(v.variantValues)}`
          const matched = existingChildren.find(c =>
            (v.id && c.id === v.id) ||
            (v.variantValues && c.variantValues && JSON.stringify(v.variantValues) === JSON.stringify(c.variantValues))
          )

          if (matched) {
            matchedChildIds.add(matched.id)
            const childUpdateData: Record<string, unknown> = {
              title: childTitle,
              priceSats: typeof v.priceSats === 'number' ? v.priceSats : matched.priceSats,
              stock: typeof v.stock === 'number' ? v.stock : matched.stock,
              listingVisibility: v.listingVisibility || 'on-sale',
              status: validStatus ?? existing.status,
              ...(v.images !== undefined && { images: v.images }),
              ...(v.variantValues !== undefined && { variantValues: v.variantValues }),
            }
            await writeWithOutbox(
              tx,
              'offer',
              matched.id,
              'upsert',
              { ...matched, ...childUpdateData },
              () => tx.offer.update({ where: { id: matched.id }, data: childUpdateData as Parameters<typeof tx.offer.update>[0]['data'] }),
            )
          } else {
            const vThumbs = v.images ? (await makeThumbsFromImages(v.images) ?? undefined) : undefined
            const childData = {
              title: childTitle,
              description: (updateData.description as string) ?? existing.description,
              priceSats: typeof v.priceSats === 'number' ? v.priceSats : ((updateData.priceSats as number) ?? existing.priceSats ?? 0),
              category: (updateData.category as string) ?? existing.category,
              categoryCode: (updateData.categoryCode as string) ?? existing.categoryCode ?? 'services/other',
              creatorPubkey: existing.creatorPubkey,
              offerType: (updateData.offerType as string) ?? existing.offerType ?? 'PRODUCT',
              ticketType: (updateData.ticketType as any) ?? existing.ticketType ?? 'SMART_ORDER',
              location: (updateData.location as string) ?? existing.location,
              deliveryTimeDays: (updateData.deliveryTimeDays as number) ?? existing.deliveryTimeDays,
              deliveryCostSats: (updateData.deliveryCostSats as number) ?? existing.deliveryCostSats,
              deliveryNotes: (updateData.deliveryNotes as string) ?? existing.deliveryNotes,
              images: v.images || (updateData.images as any) || existing.images || undefined,
              imageThumbs: vThumbs,
              companyId: (updateData.companyId as string) ?? existing.companyId,
              productId: (updateData.productId as string) ?? existing.productId,
              deliveryTemplateId: (updateData.deliveryTemplateId as string) ?? existing.deliveryTemplateId,
              status: validStatus ?? existing.status,
              publishedAt: (validStatus ?? existing.status) === 'ACTIVE' ? new Date() : undefined,
              country: (updateData.country as string) ?? existing.country,
              region: (updateData.region as string) ?? existing.region,
              city: (updateData.city as string) ?? existing.city,
              lat: updateData.lat !== undefined ? (updateData.lat as number | null) : existing.lat,
              lng: updateData.lng !== undefined ? (updateData.lng as number | null) : existing.lng,
              isRemote: (updateData.isRemote as boolean) ?? existing.isRemote,
              language: (updateData.language as string) ?? existing.language,
              source: 'LOCAL',
              visibility: (updateData.visibility as any) ?? existing.visibility,
              disputeMode: (updateData.disputeMode as any) ?? existing.disputeMode,
              allowedVisibility: (updateData.allowedVisibility as any) ?? existing.allowedVisibility,
              productType: 'variation',
              physicalType: (updateData.physicalType as string) ?? existing.physicalType ?? 'physical',
              parentOfferId: id,
              specs: updateData.specs ?? existing.specs ?? undefined,
              stock: typeof v.stock === 'number' ? v.stock : undefined,
              listingVisibility: v.listingVisibility || 'on-sale',
              shippingOptionRefs: updateData.shippingOptionRefs ?? existing.shippingOptionRefs ?? undefined,
              useEscrow: (updateData.useEscrow as boolean) ?? existing.useEscrow,
              phase2WindowHours: (updateData.phase2WindowHours as number) ?? existing.phase2WindowHours ?? 24,
              variantValues: v.variantValues || undefined,
            }
            await writeWithOutbox(
              tx,
              'offer',
              '',
              'upsert',
              childData,
              (childId) => tx.offer.create({ data: { ...childData, id: childId } as Parameters<typeof tx.offer.create>[0]['data'] }),
            )
          }
        }

        // Removed combinations: hide if any ticket exists, otherwise delete
        for (const child of existingChildren) {
          if (!matchedChildIds.has(child.id)) {
            const ticketCount = await tx.ticket.count({ where: { offerId: child.id } })
            if (ticketCount > 0) {
              await tx.offer.update({ where: { id: child.id }, data: { listingVisibility: 'hidden', status: 'CANCELLED' } })
            } else {
              await writeWithOutbox(tx, 'offer', child.id, 'delete', { id: child.id }, () => tx.offer.delete({ where: { id: child.id } }))
            }
          }
        }
      }

      return result
    })

    // ADR-420: invalidate BEFORE answering (see POST) — the client refetches on this response.
    await Promise.all([
      invalidateListCache('offers'),
      cache.invalidateByPattern(`/api/offers/${id}?*`),
    ]).catch(err => console.warn('[cache] offer invalidation failed:', err))

    res.json({ success: true, offer: updated })

    // ADR-412 D1: re-publish/sync the Nostr listing on edit (title/price/
    // images/category changes, or a DRAFT→ACTIVE status transition). Skips
    // PRIVATE (ADR-152, also enforced inside publishAndSyncOffer) and
    // non-ACTIVE offers (nothing to broadcast yet). Fire-and-forget.
    if (updated.status === 'ACTIVE' && updated.visibility !== 'PRIVATE') {
      publishAndSyncOffer(prisma, updated.id).catch(err =>
        console.error(`[ADR-412] Failed to re-publish offer ${updated.id} to Nostr:`, err))
    }

  } catch (error) {
    console.error('Failed to update offer:', error)
    res.status(500).json({ error: 'Failed to update offer' })
  }
})

// DELETE /api/offers/:id – Delete offer
app.delete('/api/offers/:id', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const existing = await prisma.offer.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Offer not found' })
    }
    // Security fix (found 2026-08-26, same class as the PATCH handler above):
    // no ownership check meant any authenticated pubkey could delete any
    // other user's offer.
    if (existing.creatorPubkey !== req.authPubkey) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'You do not own this offer' })
    }
    await prisma.$transaction(async (tx) => {
      // ADR-270 Consequences: Deletion is a graph operation across parent and variation children
      if (existing.productType === 'variable') {
        const children = await tx.offer.findMany({ where: { parentOfferId: id } })
        for (const child of children) {
          const tc = await tx.ticket.count({ where: { offerId: child.id } })
          if (tc > 0) {
            await tx.offer.update({ where: { id: child.id }, data: { status: 'CANCELLED', listingVisibility: 'hidden' } })
          } else {
            await writeWithOutbox(tx, 'offer', child.id, 'delete', { id: child.id }, () => tx.offer.delete({ where: { id: child.id } }))
          }
        }
      }

      const parentTc = await tx.ticket.count({ where: { offerId: id } })
      if (parentTc > 0) {
        await tx.offer.update({ where: { id }, data: { status: 'CANCELLED', listingVisibility: 'hidden' } })
      } else {
        await writeWithOutbox(tx, 'offer', id, 'delete', { id }, () => tx.offer.delete({ where: { id } }))
      }
    })
    res.json({ success: true })

    // ADR-412: NIP-09 delete the Nostr listing when the offer was actually
    // removed (not just soft-cancelled above, where the row, and its
    // nostrEventId, still exists). Fire-and-forget, best-effort.
    if (existing.nostrEventId && hasSigningIdentityKey()) {
      resolveOfferSigningKey(prisma, { companyId: existing.companyId, creatorPubkey: existing.creatorPubkey })
        .then(identity => nostrService.publishDeletion(existing.nostrEventId!, 'Offer deleted', identity.sk))
        .catch(err => console.error(`[ADR-412] Failed to publish offer deletion for ${id}:`, err))
    }

    await Promise.all([
      invalidateListCache('offers'),
      cache.invalidateByPattern(`/api/offers/${id}?*`),
    ])
  } catch (error) {
    console.error('Failed to delete offer:', error)
    res.status(500).json({ error: 'Failed to delete offer' })
  }
})

// ─── Network Membership (ADR-212) ──────────────────────────────────────────
// Offer.offerType='COOP' networks: open → join is immediate; closed → creates
// a PENDING request the owner (creatorPubkey) reviews via accept/decline.

// POST /api/offers/:id/join – Join an open network, or request to join a closed one
app.post('/api/offers/:id/join', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const { message } = req.body
    const pubkey = req.authPubkey!

    const offer = await prisma.offer.findUnique({ where: { id } })
    if (!offer) return res.status(404).json({ error: 'Offer not found' })
    if (offer.offerType !== 'COOP') return res.status(400).json({ error: 'Not a network' })
    if (offer.creatorPubkey === pubkey) return res.status(400).json({ error: 'Cannot join your own network' })

    const member = await prisma.$transaction(async (tx) => {
      const existing = await tx.offerMember.findUnique({ where: { offerId_pubkey: { offerId: id, pubkey } } })
      if (existing && (existing.status === 'ACTIVE' || existing.status === 'PENDING')) {
        throw new Error(existing.status === 'ACTIVE' ? 'ALREADY_MEMBER' : 'ALREADY_PENDING')
      }

      const nextStatus = offer.networkType === 'closed' ? 'PENDING' : 'ACTIVE'
      if (nextStatus === 'ACTIVE' && offer.maxMembers) {
        const activeCount = await tx.offerMember.count({ where: { offerId: id, status: 'ACTIVE' } })
        if (activeCount >= offer.maxMembers) throw new Error('NETWORK_FULL')
      }

      return existing
        ? tx.offerMember.update({ where: { id: existing.id }, data: { status: nextStatus, message: message || null } })
        : tx.offerMember.create({ data: { offerId: id, pubkey, status: nextStatus, message: message || null } })
    })

    res.json({ success: true, member })
  } catch (error: any) {
    if (error?.message === 'ALREADY_MEMBER') return res.status(409).json({ error: 'You are already a member' })
    if (error?.message === 'ALREADY_PENDING') return res.status(409).json({ error: 'Your request is already pending' })
    if (error?.message === 'NETWORK_FULL') return res.status(409).json({ error: 'Network is full' })
    console.error('Failed to join network:', error)
    res.status(500).json({ error: 'Failed to join network' })
  }
})

// POST /api/offers/:id/leave – Withdraw a pending request, or leave as an active member
app.post('/api/offers/:id/leave', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const pubkey = req.authPubkey!

    const existing = await prisma.offerMember.findUnique({ where: { offerId_pubkey: { offerId: id, pubkey } } })
    if (!existing || (existing.status !== 'ACTIVE' && existing.status !== 'PENDING')) {
      return res.status(404).json({ error: 'No active membership or pending request found' })
    }

    await prisma.offerMember.update({ where: { id: existing.id }, data: { status: 'REMOVED' } })
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to leave network:', error)
    res.status(500).json({ error: 'Failed to leave network' })
  }
})

// GET /api/offers/:id/members – List all membership rows (any status; frontend filters per view)
app.get('/api/offers/:id/members', async (req, res) => {
  try {
    const { id } = req.params
    const members = await prisma.offerMember.findMany({
      where: { offerId: id },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ members })
  } catch (error) {
    console.error('Failed to fetch network members:', error)
    res.status(500).json({ error: 'Failed to fetch network members' })
  }
})

// POST /api/offers/:id/members/:memberId/accept – Owner accepts a pending join request
app.post('/api/offers/:id/members/:memberId/accept', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id, memberId } = req.params
    const offer = await prisma.offer.findUnique({ where: { id } })
    if (!offer) return res.status(404).json({ error: 'Offer not found' })
    if (offer.creatorPubkey !== req.authPubkey) return res.status(403).json({ error: 'Only the network owner can accept requests' })

    const member = await prisma.offerMember.findUnique({ where: { id: memberId } })
    if (!member || member.offerId !== id) return res.status(404).json({ error: 'Request not found' })
    if (member.status !== 'PENDING') return res.status(409).json({ error: 'Request is not pending' })

    if (offer.maxMembers) {
      const activeCount = await prisma.offerMember.count({ where: { offerId: id, status: 'ACTIVE' } })
      if (activeCount >= offer.maxMembers) return res.status(409).json({ error: 'Network is full' })
    }

    const updated = await prisma.offerMember.update({ where: { id: memberId }, data: { status: 'ACTIVE' } })
    res.json({ success: true, member: updated })
  } catch (error) {
    console.error('Failed to accept member:', error)
    res.status(500).json({ error: 'Failed to accept member' })
  }
})

// POST /api/offers/:id/members/:memberId/decline – Owner declines a pending join request
app.post('/api/offers/:id/members/:memberId/decline', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id, memberId } = req.params
    const offer = await prisma.offer.findUnique({ where: { id } })
    if (!offer) return res.status(404).json({ error: 'Offer not found' })
    if (offer.creatorPubkey !== req.authPubkey) return res.status(403).json({ error: 'Only the network owner can decline requests' })

    const member = await prisma.offerMember.findUnique({ where: { id: memberId } })
    if (!member || member.offerId !== id) return res.status(404).json({ error: 'Request not found' })
    if (member.status !== 'PENDING') return res.status(409).json({ error: 'Request is not pending' })

    const updated = await prisma.offerMember.update({ where: { id: memberId }, data: { status: 'DECLINED' } })
    res.json({ success: true, member: updated })
  } catch (error) {
    console.error('Failed to decline member:', error)
    res.status(500).json({ error: 'Failed to decline member' })
  }
})

// POST /api/offers/:id/members/:memberId/remove – Owner removes an active member
app.post('/api/offers/:id/members/:memberId/remove', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id, memberId } = req.params
    const offer = await prisma.offer.findUnique({ where: { id } })
    if (!offer) return res.status(404).json({ error: 'Offer not found' })
    if (offer.creatorPubkey !== req.authPubkey) return res.status(403).json({ error: 'Only the network owner can remove members' })

    const member = await prisma.offerMember.findUnique({ where: { id: memberId } })
    if (!member || member.offerId !== id) return res.status(404).json({ error: 'Member not found' })
    if (member.status !== 'ACTIVE') return res.status(409).json({ error: 'Member is not active' })

    const updated = await prisma.offerMember.update({ where: { id: memberId }, data: { status: 'REMOVED' } })
    res.json({ success: true, member: updated })
  } catch (error) {
    console.error('Failed to remove member:', error)
    res.status(500).json({ error: 'Failed to remove member' })
  }
})

// DELETE /api/tickets/wipe – Full DB wipe (simulator/dev only path)
// In production: requires NIP-98 admin auth (requireAdmin). In dev: WIPE_SECRET header is **required** (no
// empty-secret bypass — ADR-212 P3 closed that gap so the route is never anonymously reachable).
// Deletion order respects FK dependencies: children before parents.
app.delete('/api/tickets/wipe',
  (req: AppRequest, res: express.Response, next: express.NextFunction) => {
    if (process.env.NODE_ENV === 'production') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return requireAdmin(prisma)(req as any, res, next)
    }
    const secret = process.env.WIPE_SECRET
    if (!secret) {
      res.status(503).json({ error: 'WIPE_SECRET is not configured; wipe is disabled in non-production environments' })
      return
    }
    if (req.headers['x-wipe-secret'] !== secret) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    next()
  },
  async (_req, res) => {
    try {
      await prisma.coopMilestoneMessage.deleteMany({})
      await prisma.coopMilestoneApplication.deleteMany({})
      await prisma.coopMilestone.deleteMany({})
      await prisma.cooperation.deleteMany({})

      await prisma.colPointsEvent.deleteMany({})
      await prisma.milestone.deleteMany({})
      await prisma.review.deleteMany({})
      await prisma.ticket.deleteMany({})

      await prisma.offerMilestone.deleteMany({})
      await prisma.offer.deleteMany({})

      // FU-159-B: the wipe bypasses the outbox — purge the Meilisearch offer
      // index directly so stale docs (incl. titles) can't survive in
      // /api/search/suggest, which serves Meili hits without rehydration.
      const meili = getMeili()
      if (meili) {
        try {
          await meili.index(OFFER_INDEX_ALIAS).deleteAllDocuments()
        } catch (e) {
          console.error('[wipe] meili deleteAllDocuments failed:', e)
        }
      }

      res.json({ success: true, message: 'Database wiped' })
    } catch (error) {
      console.error('Failed to wipe database:', error)
      res.status(500).json({ error: 'Failed to wipe database', details: error instanceof Error ? error.message : 'Unknown error' })
    }
  },
)

// GET /api/tickets – User's tickets (cursor-paginated)
// ADR-204: supports ?cooperationId=<id> to fetch the ticket for a cooperation.
app.get('/api/tickets', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const pubkey = req.authPubkey!
    const { limit, cursor, includeCount } = parsePagination(req.query as Record<string, unknown>)
    const { cooperationId, checkoutId } = req.query as { cooperationId?: string; checkoutId?: string }

    // ADR-394 FU-840: order-level view of one cart checkout — every ticket the
    // CALLER bought in that checkout (a partial failure shows as fewer tickets
    // than cart lines). Buyer-scoped: the id is a random grouping key, never an
    // access token.
    if (typeof checkoutId === 'string' && checkoutId) {
      if (!isValidCheckoutId(checkoutId)) {
        return res.status(400).json({ error: 'Invalid checkoutId', code: 'BAD_REQUEST' })
      }
      const tickets = await prisma.ticket.findMany({
        where: { checkoutId, buyerPubkey: pubkey },
        include: { offer: { select: { id: true, title: true, priceSats: true, images: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 200,
      })
      const parsed = tickets.map(({ agentRunnerSealed: _ars, ...t }) => ({
        ...t,
        offer: t.offer ? parseOfferImages(t.offer) : undefined,
      }))
      const totalSats = parsed.reduce((sum, t) => sum + (t.amountSats ?? 0), 0)
      return res.json({
        checkoutId,
        tickets: parsed,
        total: parsed.length,
        totalSats,
        edges: parsed.map((node) => ({ node, cursor: new Date(node.createdAt).toISOString() })),
      })
    }

    // ADR-204: if querying by cooperationId, return that ticket directly.
    // ADR-411: party-gated — only the cooperation's initiator/partner (or the
    // ticket's buyer/seller) may read it; the row carries buyer PII
    // (deliveryAddress), preimages and the Cashu token.
    if (cooperationId) {
      const ticket = await prisma.ticket.findUnique({
        where: { cooperationId },
        include: { offer: { select: { id: true, title: true, priceSats: true, images: true } } },
      })
      if (!ticket) return res.json({ tickets: [], total: 0, edges: [] })
      const cooperation = await prisma.cooperation.findUnique({
        where: { id: cooperationId },
        select: { initiatorPubkey: true, partnerPubkey: true },
      })
      const isParty =
        ticket.buyerPubkey === pubkey ||
        ticket.sellerPubkey === pubkey ||
        cooperation?.initiatorPubkey === pubkey ||
        cooperation?.partnerPubkey === pubkey
      if (!isParty) {
        return res.status(403).json({ error: 'You are not a party of this ticket', code: 'FORBIDDEN' })
      }
      const { agentRunnerSealed: _ars, ...publicTicket } = ticket
      const parsed = { ...publicTicket, offer: ticket.offer ? parseOfferImages(ticket.offer) : undefined }
      return res.json({ tickets: [parsed], total: 1, edges: [{ node: parsed, cursor: new Date(ticket.createdAt).toISOString() }] })
    }

    const where: Record<string, unknown> = {
      OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }],
    }

    if (cursor) {
      const cursorDate = new Date(cursor.sortKey)
      where.AND = [
        { OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }] },
        {
          OR: [
            { createdAt: { lt: cursorDate } },
            { createdAt: cursorDate, id: { lt: cursor.id } },
          ],
        },
      ]
      delete where.OR
    }

    const [tickets, totalCount] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: {
          offer: { select: { id: true, title: true, priceSats: true, images: true } },
          milestones: { orderBy: { id: 'asc' } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      includeCount
        ? prisma.ticket.count({ where: { OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }] } })
        : Promise.resolve(undefined),
    ])

    const parsed = tickets.map(t => {
      const { agentRunnerSealed: _ars, ...publicTicket } = t
      return { ...publicTicket, offer: t.offer ? parseOfferImages(t.offer) : null }
    })

    const result = buildPaginatedResult(
      parsed,
      limit,
      (t) => t.createdAt.toISOString(),
      totalCount,
    )

    res.json({ ...result, tickets: result.edges.map(e => e.node) })
  } catch (error) {
    console.error('Failed to fetch tickets:', error)
    res.status(500).json({ error: 'Failed to fetch tickets' })
  }
})

// GET /api/tickets/:id – Single ticket
app.get('/api/tickets/:id', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        offer: true,
        milestones: { orderBy: { id: 'asc' } },
        // ADR-372 D3: expose the 1:1 hosted-canvas fee row so the ticket page
        // can render the fee status/amount (and, later, a confirm action for
        // the abandoned-checkout edge case). No key material lives on the row.
        platformFee: true,
      },
    })
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' })
    }

    // Auth: buyer, seller, OR the accepted mutual arbiter (Phase 2.8).
    // The arbiter is the only third party who needs read access — for
    // the verdict-submission flow. Nominated-but-not-accepted arbiters
    // are NOT allowed (they can browse via their own /api/tickets/:id
    // listing, not via this endpoint).
    const isParty =
      ticket.buyerPubkey === req.authPubkey || ticket.sellerPubkey === req.authPubkey
    let isAcceptedArbiter = false
    if (!isParty && ticket.disputeMode === 'PRIVATE') {
      const arbiter = await prisma.privateArbiter.findFirst({
        where: {
          ticketId: id,
          arbiterPubkey: req.authPubkey,
          acceptedAt: { not: null },
        },
        select: { id: true },
      })
      isAcceptedArbiter = !!arbiter
    }
    if (!isParty && !isAcceptedArbiter) {
      return res.status(403).json({ error: 'Not authorized to view this ticket' })
    }

    // ADR-342 D3/D5 (Phase B) + ADR-370 D2 (Phase 1): for hosted-canvas setups
    // the ticket response carries the provisioning snapshot so the ticket UI
    // can render the button states (pending/failed/ready) without a second
    // request. Since Phase 1 the binding lives on the TICKET itself (snapshotted
    // at purchase, auto-provisioned at PAID) — workspaceCanvas is present even
    // with NO Workspace row (fix G2, canvas-only setups). Legacy pre-Phase-1
    // tickets fall back to the Workspace binding. buyerAccess 'none' is still
    // reported — the UI shows the neutral "private canvas" note (D4a/F1).
    let workspaceCanvas: {
      provider: 'doop-hosted'
      provisioningStatus: string | null
      canvasId: string | null
      buyerAccess: string | null
    } | null = null
    if (isParty && ticket.offerType === 'AGENT_SETUP') {
      // The ticket row is a full findUnique — its Phase-1 canvas columns are
      // already on the object; prefer them, fall back to the Workspace.
      const binding =
        ticket.canvasProvider === 'doop-hosted'
          ? {
              provisioningStatus: ticket.canvasProvisioningStatus,
              canvasId: ticket.canvasId,
              buyerAccess: ticket.canvasBuyerAccess,
            }
          : await prisma.workspace.findUnique({
              where: { ticketId: id },
              select: { canvasProvider: true, canvasProvisioningStatus: true, canvasId: true, canvasBuyerAccess: true },
            }).then((ws) =>
              ws?.canvasProvider === 'doop-hosted'
                ? { provisioningStatus: ws.canvasProvisioningStatus, canvasId: ws.canvasId, buyerAccess: ws.canvasBuyerAccess }
                : null,
            )
      if (binding) {
        workspaceCanvas = {
          provider: 'doop-hosted',
          provisioningStatus: binding.provisioningStatus,
          // The buyer never sees the canvasId without access (defense in
          // depth — the canvas-url route enforces the same rule).
          canvasId: ticket.buyerPubkey === req.authPubkey && binding.buyerAccess === 'none' ? null : binding.canvasId,
          buyerAccess: binding.buyerAccess,
        }
      }
    }

    // ADR-370 D6 (Phase 2): the doop-local binding rendered from the TICKET
    // snapshot (instanceUrl/canvasId — captured at purchase) so the post-
    // purchase card is immune to later offer edits (G3 client half). The
    // workspaceCanvas above only covers doop-hosted.
    let ticketCanvas: {
      provider: 'doop-local'
      instanceUrl: string | null
      canvasId: string | null
    } | null = null
    if (isParty && ticket.offerType === 'AGENT_SETUP' && ticket.canvasProvider === 'doop-local') {
      ticketCanvas = {
        provider: 'doop-local',
        instanceUrl: ticket.canvasInstanceUrl ?? null,
        canvasId: ticket.canvasId ?? null,
      }
    }

    // Surface the dispute's outcome + arbitrator reasoning to buyer/seller
    // once resolved — previously only visible on the Council-only dispute
    // page, so a disputant never learned WHY a verdict went the way it did
    // (found 2026-09-18 while verifying the DAO process communicates
    // fairly, not just functions). Scoped to disputed tickets only.
    let disputeResolution: { outcome: string; reasoning: string | null; resolvedAt: string | null } | null = null
    if (isParty && ticket.disputeReason && (ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED')) {
      const resolvedDispute = await prisma.dispute.findFirst({
        where: { ticketId: id, status: 'RESOLVED' },
        orderBy: { resolvedAt: 'desc' },
        include: { verdicts: { orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      if (resolvedDispute?.outcome) {
        disputeResolution = {
          outcome: resolvedDispute.outcome,
          reasoning: resolvedDispute.verdicts[0]?.reasoning ?? null,
          resolvedAt: resolvedDispute.resolvedAt?.toISOString() ?? null,
        }
      }
    }

    // ADR-204: build response — omit offer for cooperation tickets (offer is
    // nullable). Strip the Phase-1 ticket canvas columns from the raw spread:
    // workspaceCanvas / ticketCanvas above are the ONLY sanctioned canvas
    // surfaces (they apply the buyerAccess='none' canvasId redaction);
    // leaking the raw columns would bypass that defense-in-depth.
    const {
      offer: _offer,
      canvasProvider: _canvasProvider,
      canvasInstanceUrl: _canvasInstanceUrl,
      canvasId: _rawCanvasId,
      canvasBuyerAccess: _canvasBuyerAccess,
      canvasProvisioningStatus: _canvasProvisioningStatus,
      agentRunnerSealed: _agentRunnerSealed,
      cashuToken: _cashuToken,
      ...ticketBase
    } = ticket as Record<string, unknown>
    res.json({
      ticket: {
        ...ticketBase,
        ...(_offer ? { offer: parseOfferImages(_offer as { id: string }) } : {}),
        ...(workspaceCanvas ? { workspaceCanvas } : {}),
        ...(ticketCanvas ? { ticketCanvas } : {}),
        ...(disputeResolution ? { disputeResolution } : {}),
        // ADR-399 D3: the delivered Cashu token only reaches the two parties.
        ...(isParty && _cashuToken ? { cashuToken: _cashuToken } : {}),
      },
      viewerRole: isAcceptedArbiter ? 'arbiter' : (ticket.buyerPubkey === req.authPubkey ? 'buyer' : 'seller'),
    })
  } catch (error) {
    console.error('Failed to fetch ticket:', error)
    res.status(500).json({ error: 'Failed to fetch ticket' })
  }
})

// PATCH /api/tickets/:id – Update ticket status
app.patch('/api/tickets/:id', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const { status } = req.body
    if (!status) {
      return res.status(400).json({ error: 'status is required' })
    }

    const parsed = TicketStatusSchema.safeParse(status)
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid status', details: parsed.error.issues })
    }
    const validStatus = parsed.data

    // Only a participant (buyer or seller) may change a ticket's status.
    const existing = await prisma.ticket.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Ticket not found' })
    }
    const authPubkey = req.authPubkey!
    if (authPubkey !== existing.buyerPubkey && authPubkey !== existing.sellerPubkey) {
      return res.status(403).json({ error: 'Only the buyer or seller may update this ticket' })
    }

    if (!canSelfReportPaid({
      fromStatus: existing.status,
      toStatus: validStatus,
      directPayRail: existing.directPayRail,
      sellerPubkey: existing.sellerPubkey,
      authPubkey,
    })) {
      return res.status(403).json({
        error: 'PAID_TRANSITION_NOT_ALLOWED',
        message: 'This ticket can only be marked PAID through a verified payment confirmation.',
      })
    }

    // ADR-308 D2 Stage 2 (Quality Gate): a buyer cannot self-complete a
    // ticket whose AgentProfile opted into human-in-the-loop review until
    // the seller has done so.
    const qualityGateInput = {
      toStatus: validStatus,
      qualityGateRequired: existing.qualityGateRequired,
      qualityApprovedAt: existing.qualityApprovedAt,
      sellerPubkey: existing.sellerPubkey,
      authPubkey,
    }
    if (requiresQualityApproval(qualityGateInput)) {
      return res.status(409).json({
        error: 'QUALITY_REVIEW_PENDING',
        message: 'The seller must review the agent output before this ticket can be marked complete.',
      })
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        status: validStatus,
        ...(shouldStampQualityApproval(qualityGateInput) && { qualityApprovedAt: new Date() }),
      },
      include: { offer: true, milestones: { orderBy: { id: 'asc' } } },
    })

    // ADR-374: server-backed in-app notification for the non-acting party
    // (best-effort — a notification write never fails the status change).
    notifyTicketStatusChange(prisma, {
      ticketId: ticket.id,
      fromStatus: existing.status,
      toStatus: ticket.status,
      buyerPubkey: ticket.buyerPubkey,
      sellerPubkey: ticket.sellerPubkey,
      actingPubkey: authPubkey,
      offerTitle: ticket.offer?.title,
      detail: {
        offerType: ticket.offerType ?? undefined,
        ticketType: ticket.ticketType ?? undefined,
        amountSats: ticket.amountSats ?? undefined,
        escrowStatus: ticket.escrowStatus ?? undefined,
        updatedAt: ticket.updatedAt ? ticket.updatedAt.toISOString() : undefined,
      },
    }).catch((err) => console.error('[notifications] ticket-status failed:', err instanceof Error ? err.message : err))

    // ADR-370 D2 (fix G2): the CASHU seller self-report PAID path is the one
    // first-PAID entrance that bypasses confirmPaymentByHash — enqueue the
    // ticket-anchored canvas provisioning here too (idempotent, no-op unless
    // the ticket carries a doop-hosted snapshot that is not already in flight).
    if (validStatus === 'PAID') {
      enqueueProvisioningOnPaid(prisma, id).catch((err) =>
        console.error('[canvas-provision] enqueue on self-report PAID failed:', err instanceof Error ? err.message : err),
      )
    }

    // ADR-397 D4: a bounty ticket drives its bounty (PAID → IN_PROGRESS,
    // COMPLETED → COMPLETED). Idempotent, never fails the status change.
    if (ticket.agentTaskId) syncAgentTaskFromTicketSafe(prisma, id)

    // ADR-353: terminal ticket states freeze the hosted canvas read-only
    // (reopen unlocks). Async via outbox — never blocks the status change.
    await enqueueCanvasLifecycleForTicket(prisma, id, existing.status, validStatus).catch((err) =>
      console.error('[canvas-lifecycle] enqueue after ticket PATCH failed:', err instanceof Error ? err.message : err),
    )

    // Publish Kind 30408 (Ticket Status Update). Two paths, identical tags (ADR-106/107, 142/143):
    // 1. Server ephemeral-key publish (fallback) — fire-and-forget.
    // 2. nostrEventTemplate for the acting party to sign with their real key on the client.
    // ADR-204: offer relation is nullable (cooperation tickets have no offer)
    const ticketAny = ticket as Record<string, unknown>
    const totalSats = ticket.amountSats ?? (ticketAny.offer as { priceSats?: number } | null)?.priceSats ?? 0
    const { phase1, phase2, phase3 } = computeEscrowPhaseAmounts(totalSats)
    const statusEventInput = {
      id: ticket.id,
      status: ticket.status,
      buyerPubkey: ticket.buyerPubkey,
      sellerPubkey: ticket.sellerPubkey,
      // ADR-204: offerId may be null for cooperation tickets
      offerId: ticket.offerId ?? undefined,
      offerType: ticket.offerType || undefined,
      invoice: ticket.lightningInvoice || undefined,
      paymentHash: ticket.paymentHash || undefined,
      preimage: ticket.preimage || undefined,
      amountSats: totalSats,
      escrowStatus: ticket.escrowStatus || undefined,
      escrowPhase1Preimage: ticket.escrowPhase1Preimage,
      escrowPhase2Preimage: ticket.escrowPhase2Preimage,
      escrowPhase3Preimage: ticket.escrowPhase3Preimage,
      escrowPhase1Amount: phase1,
      escrowPhase2Amount: phase2,
      escrowPhase3Amount: phase3,
      visibility: (ticket.visibility === 'PRIVATE' ? 1 : 0) as 0 | 1 | 2,
    }
    nostrService
      .publishTicketStatus(statusEventInput)
      .catch(err => console.error('[Nostr] Failed to publish Kind 30408 (TicketStatus):', err))

    const nostrEventTemplate = {
      kind: NOSTR_KINDS.TICKET_STATUS_NEW,
      pubkey: authPubkey,  // the acting party signs (buyer or seller)
      created_at: Math.floor(Date.now() / 1000),
      tags: buildTicketStatusTags(statusEventInput),
      content: '',
    }

    const { agentRunnerSealed: _arsPatch, ...publicPatchedTicket } = ticket
    res.json({ ticket: publicPatchedTicket, nostrEventTemplate })
  } catch (error) {
    console.error('Failed to update ticket:', error)
    res.status(500).json({ error: 'Failed to update ticket' })
  }
})

// GET /api/tickets/:id/payment-status — buyer / seller / accepted mutual arbiter only (ADR-212 P2).
app.get('/api/tickets/:id/payment-status', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const ticket = await prisma.ticket.findUnique({ where: { id } })
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' })
    }
    let isParty = ticket.buyerPubkey === req.authPubkey || ticket.sellerPubkey === req.authPubkey
    if (!isParty && ticket.disputeMode === 'PRIVATE') {
      const arbiter = await prisma.privateArbiter.findFirst({
        where: { ticketId: id, arbiterPubkey: req.authPubkey!, acceptedAt: { not: null } },
        select: { id: true },
      })
      isParty = !!arbiter
    }
    if (!isParty) {
      return res.status(403).json({ error: 'Not authorized to view this ticket status' })
    }
    // ADR-399 D2: a Direct-Pay LN ticket is checked at the seller's own rail
    // (LUD-21 / NWC / Alby), throttled per ticket, so the buyer no longer needs a
    // preimage for the page to notice the payment.
    let current = ticket
    const settled = await checkDirectPayTicketNow(prisma, ticket, { nostrService })
    if (settled.length > 0) {
      current = (await prisma.ticket.findUnique({ where: { id } })) ?? ticket
    }
    // ADR-241 D6 (closes ADR-209 D1 poll bug): the client checks `data.paid` —
    // it never had that field, so the "Paid" badge never flipped via this path.
    const paid = !['PENDING', 'CANCELLED'].includes(current.status)
    res.json({
      status: current.status,
      paymentHash: current.paymentHash,
      paid,
      rail: current.directPayRail ?? (current.escrowEnabled ? 'ESCROW' : null),
      cashuTokenSentAt: current.cashuTokenSentAt?.toISOString() ?? null,
    })
  } catch (error) {
    console.error('Failed to fetch payment status:', error)
    res.status(500).json({ error: 'Failed to fetch payment status' })
  }
})

// POST /api/tickets – ADR-179 Fix A: structured error responses (WALLET_REQUIRED 400,
// PAYMENT_UPSTREAM_ERROR 502, DB_ERROR 500) instead of a swallowed generic 500.
// Handler lives in routes/tickets.ts so it can be unit-tested with a mocked
// payments provider and a hand-rolled Prisma stub.
app.use('/api/tickets', requireAuth(prisma), createTicketRouter(prisma, payments, { baseUrl: BASE_URL }))
// ADR-342 D4/D5 (Phase B): hosted-canvas SSO bridge (canvas-url, canvas-retry).
app.use('/api/tickets', requireAuth(prisma), createTicketCanvasRouter(prisma))
// ADR-370 D4 (Phase 4b, FU-673): canvas-agent-runner persona relay
// (agent-runner-key, agent-runner-config) — seller-scoped.
app.use('/api/tickets', requireAuth(prisma), createTicketAgentRunnerRouter(prisma))
app.use('/api/remote-orders', createRemoteOrdersRouter(prisma))

// ADR-374: server-backed in-app notifications (feed + mark read/archive).
app.use('/api/notifications', requireAuth(prisma), createNotificationsRouter(prisma))

// GET /api/cooperations – List cooperations for authenticated user (cursor-paginated)
app.get('/api/cooperations', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const pubkey = req.authPubkey!
    const { limit, cursor, includeCount } = parsePagination(req.query as Record<string, unknown>)
    const baseWhere = { OR: [{ initiatorPubkey: pubkey }, { partnerPubkey: pubkey }] }

    let where: Record<string, unknown> = { ...baseWhere }
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

    const [cooperations, totalCount] = await Promise.all([
      prisma.cooperation.findMany({
        where,
        include: {
          milestones: {
            orderBy: { milestoneIndex: 'asc' },
            include: {
              steps: { orderBy: { stepIndex: 'asc' } },
              // ADR-386: engagement probe for the full-edit gate.
              _count: { select: { applications: true, messages: true } },
            },
          },
          // ADR-386: engagement probes (applications / tickets / workspaces).
          _count: { select: { milestoneApplications: true, tickets: true, workspaces: true } },
          escrowTrade: { select: { id: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      includeCount
        ? prisma.cooperation.count({ where: baseWhere })
        : Promise.resolve(undefined),
    ])

    const result = buildPaginatedResult(
      cooperations.map(c => {
        // ADR-331 D1: JSON-decode requiredCapabilities per milestone before
        // parseCooperation runs (which only handles top-level JSON columns).
        parseCoopMilestoneRequiredCapabilities(c.milestones as unknown as Array<Record<string, unknown>>)
        // ADR-386: owner-only full-edit gate. The engagement probes are stripped
        // from the response so only the derived boolean ships.
        const canFullEdit = c.initiatorPubkey === pubkey
          && cooperationCanFullEdit(c as unknown as CooperationEngagementShape)
        const { _count, escrowTrade, ...raw } = c
        void _count
        void escrowTrade
        return { ...parseCooperation(raw), canFullEdit }
      }),
      limit,
      (c) => c.createdAt.toISOString(),
      totalCount,
    )

    res.json({ ...result, cooperations: result.edges.map(e => e.node) })
  } catch (error) {
    console.error('Failed to fetch cooperations:', error)
    res.status(500).json({ error: 'Failed to fetch cooperations' })
  }
})

// GET /api/cooperations/discover – Public cooperations for marketplace (cursor-paginated)
// ADR-301: cache the public discover list. The /api/offers endpoint uses
// versionedListCache('offers', 30) for the same reason — without it, every
// home-page load hits Postgres with the full include-joins query (milestones,
// _count). Pre-D2 index + pre-D3 cache, the live timed 3-4 s per call.
app.get('/api/cooperations/discover', versionedListCache('cooperations', 30), async (req, res) => {
  try {
    const { q, cooperationType, status } = req.query
    const { limit, cursor, includeCount } = parsePagination(req.query as Record<string, unknown>)
    const where: Record<string, unknown> = { status: 'OPEN' }
    if (cooperationType) where.cooperationType = cooperationType
    if (status) where.status = status
    if (q) {
      where.OR = [
        { title: { contains: q as string } },
        { description: { contains: q as string } },
      ]
    }

    if (cursor) {
      const cursorDate = new Date(cursor.sortKey)
      where.AND = [
        ...(where.OR ? [{ OR: where.OR }] : []),
        {
          OR: [
            { createdAt: { lt: cursorDate } },
            { createdAt: cursorDate, id: { lt: cursor.id } },
          ],
        },
      ]
      if (where.OR) delete where.OR
    }

    const [cooperations, totalCount] = await Promise.all([
      // ADR-376 D3: explicit select (was implicit-all-columns via `include`)
      // — drops the base64-heavy `images` column in favor of the slim
      // `imageThumbs` sibling (closes FU-301-D; measured 1.7 MB/10 rows with
      // the old shape), and, as a side effect of enumerating fields
      // explicitly, stops shipping payment/escrow-internal columns
      // (lightningInvoice/paymentHash/escrowSubWalletId) that this public,
      // unauthenticated browse endpoint never needed to expose. The 3 client
      // consumers of this endpoint (Home, useCooperationsDiscover,
      // useCoopExploreData) all map through coopToCoopItem, which reads none
      // of the dropped fields.
      prisma.cooperation.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          initiatorPubkey: true,
          partnerPubkey: true,
          cooperationType: true,
          partnerMode: true,
          budgetSats: true,
          timeline: true,
          skills: true,
          status: true,
          categoryCode: true,
          imageThumbs: true,
          deadline: true,
          requirements: true,
          isAgentOrchestration: true,
          agentSupervision: true,
          companyId: true,
          visibility: true,
          disputeMode: true,
          ticketType: true,
          createdAt: true,
          updatedAt: true,
          milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } },
          _count: { select: { milestoneApplications: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      includeCount
        ? prisma.cooperation.count({ where: { status: (status as CooperationStatus) || 'OPEN' } })
        : Promise.resolve(undefined),
    ])

    const result = buildPaginatedResult(
      cooperations.map(c => {
        // ADR-331 D1: JSON-decode requiredCapabilities per milestone.
        parseCoopMilestoneRequiredCapabilities(c.milestones as unknown as Array<Record<string, unknown>>)
        return c
      }),
      limit,
      (c) => c.createdAt.toISOString(),
      totalCount,
    )

    res.json({ ...result, cooperations: result.edges.map(e => e.node) })
  } catch (error) {
    console.error('Failed to fetch cooperations:', error)
    res.status(500).json({ error: 'Failed to fetch cooperations' })
  }
})

// GET /api/cooperations/by-pubkey/:pubkey – Public, visibility-gated cooperations for a
// profile page (ADR-367 D8/D9, closes FU-650). Unlike GET /api/cooperations (session-scoped
// to the caller), this answers "show me pubkey X's cooperations" for an arbitrary visitor.
// Two independent gates, mirroring GET /api/user/:pubkey/profile's existing PUBLIC-only
// disclosure policy: (1) the target pubkey's own User.profileVisibility must be PUBLIC —
// PSEUDO_PRIVATE/PRIVATE profiles return an empty list rather than leaking initiator/partner
// matches; (2) only Cooperation.visibility === 'PUBLIC' (ADR-152 tiered visibility) and
// non-DRAFT rows are ever returned, regardless of the profile's own visibility — a PRIVATE
// trade never surfaces on a public profile even for an otherwise-PUBLIC user.
app.get('/api/cooperations/by-pubkey/:pubkey', async (req, res) => {
  try {
    const { pubkey } = req.params
    const { limit, cursor, includeCount } = parsePagination(req.query as Record<string, unknown>)

    const user = await prisma.user.findUnique({ where: { pubkey }, select: { profileVisibility: true } })
    if (!user || (user.profileVisibility && user.profileVisibility !== 'PUBLIC')) {
      const empty = buildPaginatedResult([] as Array<{ id: string; createdAt: Date }>, limit, (c) => c.createdAt.toISOString(), includeCount ? 0 : undefined)
      return res.json({ ...empty, cooperations: [] })
    }

    const baseWhere: Prisma.CooperationWhereInput = {
      OR: [{ initiatorPubkey: pubkey }, { partnerPubkey: pubkey }],
      visibility: 'PUBLIC',
      status: { not: 'DRAFT' },
    }

    let where: Record<string, unknown> = { ...baseWhere }
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

    const [cooperations, totalCount] = await Promise.all([
      prisma.cooperation.findMany({
        where,
        include: {
          milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      includeCount
        ? prisma.cooperation.count({ where: baseWhere })
        : Promise.resolve(undefined),
    ])

    const result = buildPaginatedResult(
      cooperations.map(c => {
        parseCoopMilestoneRequiredCapabilities(c.milestones as unknown as Array<Record<string, unknown>>)
        return parseCooperation(c)
      }),
      limit,
      (c) => c.createdAt.toISOString(),
      totalCount,
    )

    res.json({ ...result, cooperations: result.edges.map(e => e.node) })
  } catch (error) {
    console.error('Failed to fetch cooperations by pubkey:', error)
    res.status(500).json({ error: 'Failed to fetch cooperations' })
  }
})

// GET /api/cooperations/applications/mine – All applications by authenticated user
app.get('/api/cooperations/applications/mine', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const pubkey = req.authPubkey!

    const applications = await prisma.coopMilestoneApplication.findMany({
      where: { applicantPubkey: pubkey },
      include: {
        cooperation: { include: { milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } } } },
        milestone: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ applications })
  } catch (error) {
    console.error('Failed to fetch applications:', error)
    res.status(500).json({ error: 'Failed to fetch applications' })
  }
})

// ADR-212 P0: only the cooperation's initiator (the buyer who funds escrow) may call this.
// ADR-252 D2: gated by the mainnet payments kill switch — this creates a NEW hold invoice.
app.post('/api/cooperations/:id/fund-escrow', requireAuth(prisma), blockIfPaymentsPaused, async (req: AuthenticatedRequest, res) => {
  try {
    // ADR-255 D4: closes the Cooperation-escrow custodial gap — this route
    // creates a real hold on the legacy platform payments backend.
    if (rejectCoopEscrowIfDisabled(req, res)) return

    const { id } = req.params

    const cooperation = await prisma.cooperation.findUnique({ where: { id } })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }
    // ADR-212 P0: ownership check — only the initiator may fund.
    if (req.authPubkey !== cooperation.initiatorPubkey) {
      return res.status(403).json({ error: 'Only the initiator may fund the escrow' })
    }
    if (cooperation.status !== 'ACCEPTED') {
      return res.status(409).json({ error: `Cooperation must be ACCEPTED to fund escrow, current status: ${cooperation.status}` })
    }
    if (cooperation.lightningInvoice && cooperation.paymentHash) {
      return res.json({
        success: true,
        paymentHash: cooperation.paymentHash,
        invoice: cooperation.lightningInvoice,
        amountSats: cooperation.budgetSats,
        alreadyCreated: true,
      })
    }

    // ADR-252 D2 / FU-655: launch-phase per-transaction cap.
    if (rejectIfAboveLaunchCap(res, cooperation.budgetSats)) return

    const webhookUrl = `${BASE_URL}/api/webhooks/lnbits`

    const invoiceResult = await payments.createInvoice(
      cooperation.budgetSats,
      `Escrow: ${cooperation.title}`,
      webhookUrl,
    )
    const paymentHash = invoiceResult.paymentHash
    const invoice = invoiceResult.bolt11

    // ADR-204 Phase 1: create or reuse a Ticket for this cooperation.
    // Initiator = buyer (funds escrow), partner = seller (delivers work).
    // Idempotent: if a ticket already exists, reuse it.
    const existingTicket = await prisma.ticket.findUnique({ where: { cooperationId: id } })

    let ticket = existingTicket
    if (!ticket) {
      ticket = await prisma.ticket.create({
        data: {
          // No offerId — this is a cooperation-only ticket (ADR-204)
          cooperationId: id,
          buyerPubkey: cooperation.initiatorPubkey,
          sellerPubkey: cooperation.partnerPubkey || cooperation.initiatorPubkey,
          status: 'PENDING',
          amountSats: cooperation.budgetSats,
          lightningInvoice: invoice,
          paymentHash,
          ticketType: cooperation.ticketType, // ADR-329 D4: mirrors the cooperation's payment structure (amends ADR-204)
          escrowStatus: 'FUNDED',   // Funds are in the invoice, pending webhook confirmation
          escrowEnabled: true,
          // ADR-253/FU-253-E: cooperation escrow runs unconditionally on the
          // legacy custodial hold-invoice stack today (no ESCROW_ENABLED gate
          // here, no ICP canister wiring — see payment-architecture.md).
          escrowProvider: 'CUSTODIAL_LEGACY',
          escrowSubWalletId: cooperation.escrowSubWalletId ?? undefined,
          visibility: cooperation.visibility,
          disputeMode: cooperation.disputeMode,
          daoId: 'colabonate-foundation',
        },
      })
      console.log(`[FundEscrow] Created ticket ${ticket.id} for cooperation ${id}`)

      // ADR-411: parity with offer tickets (routes/tickets.ts) — the partner
      // (seller) is notified that a cooperation ticket now awaits them. The
      // self-trade guard inside notifyTicketCreated skips the fallback
      // seller==initiator case.
      notifyTicketCreated(prisma, {
        ticketId: ticket.id,
        sellerPubkey: ticket.sellerPubkey,
        buyerPubkey: ticket.buyerPubkey,
        offerTitle: cooperation.title,
      }).catch(err => console.error('[notifications] coop ticket created notify failed:', err))
    }

    await prisma.cooperation.update({
      where: { id },
      data: {
        lightningInvoice: invoice,
        paymentHash,
        escrowStatus: 'FUNDED',
      },
    })

    // ADR-204: publish Kind 30407 (CoopTicketCreated) via Nostr.
    // FU-204-C: clients subscribe to Kind 30407 with ticket_type=cooperation.
    const ticketEventInput = {
      id: ticket.id,
      cooperationId: id,
      buyerPubkey: cooperation.initiatorPubkey,
      sellerPubkey: cooperation.partnerPubkey || cooperation.initiatorPubkey,
      status: ticket.status,
      ticketType: 'cooperation',
      visibility: (cooperation.visibility === 'PUBLIC' ? 0 : 1) as 0 | 1 | 2,
    }
    const nostrEventTemplate = {
      kind: NOSTR_KINDS.TICKET_CREATED_NEW,
      pubkey: cooperation.initiatorPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: buildTicketCreatedTags(ticketEventInput),
      content: '',
    }
    nostrService.publishTicketCreated(ticketEventInput).catch(err =>
      console.error('[Nostr] Failed to publish Kind 30407 (CoopTicketCreated):', err),
    )

    registerInvoice(paymentHash, invoice, cooperation.budgetSats, `Escrow: ${cooperation.title}`)
    console.log(`[FundEscrow] Created invoice for cooperation ${id}: ${paymentHash}`)

    res.json({
      success: true,
      paymentHash,
      invoice,
      amountSats: cooperation.budgetSats,
      ticketId: ticket.id,
      nostrEventTemplate,
    })
  } catch (error) {
    console.error('Failed to create escrow invoice:', error)
    res.status(500).json({ error: 'Failed to create escrow invoice' })
  }
})

// ADR-212 P0: only the cooperation's initiator may trigger a milestone payout invoice.
app.post('/api/cooperations/:id/milestones/:mid/release-payment', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    // ADR-255 D4: same gate as fund-escrow above — this route also creates a
    // real invoice on the legacy custodial platform payments backend.
    if (rejectCoopEscrowIfDisabled(req, res)) return

    const { id, mid } = req.params

    const milestone = await prisma.coopMilestone.findUnique({ where: { id: mid }, include: { cooperation: true } })
    if (!milestone || milestone.cooperationId !== id) {
      return res.status(404).json({ error: 'Milestone not found' })
    }
    // ADR-212 P0: ownership check — only the cooperation initiator may release payment.
    if (req.authPubkey !== milestone.cooperation.initiatorPubkey) {
      return res.status(403).json({ error: 'Only the initiator may release milestone payment' })
    }
    if (milestone.status !== 'COMPLETED') {
      return res.status(409).json({ error: `Milestone must be COMPLETED to release payment, current status: ${milestone.status}` })
    }

    if (milestone.lightningInvoice && milestone.paymentHash) {
      registerInvoice(
        milestone.paymentHash,
        milestone.lightningInvoice,
        milestone.amountSats,
        `Release: ${milestone.title}`,
      )
      return res.json({
        success: true,
        paymentHash: milestone.paymentHash,
        invoice: milestone.lightningInvoice,
        amountSats: milestone.amountSats,
        alreadyCreated: true,
      })
    }

    // ADR-252 D2 / FU-655: launch-phase per-transaction cap.
    if (rejectIfAboveLaunchCap(res, milestone.amountSats)) return

    const webhookUrl = `${BASE_URL}/api/webhooks/lnbits`

    const invoiceResult = await payments.createInvoice(
      milestone.amountSats,
      `Release: ${milestone.title} (${milestone.cooperation.title})`,
      webhookUrl,
    )
    const paymentHash = invoiceResult.paymentHash
    const invoice = invoiceResult.bolt11
    registerInvoice(paymentHash, invoice, milestone.amountSats, `Release: ${milestone.title}`)

    await prisma.coopMilestone.update({
      where: { id: mid },
      data: { lightningInvoice: invoice, paymentHash },
    })

    console.log(`[ReleasePayment] Created invoice for milestone ${mid}: ${paymentHash} (${milestone.amountSats} sats)`)

    res.json({
      success: true,
      paymentHash,
      invoice,
      amountSats: milestone.amountSats,
    })
  } catch (error) {
    console.error('Failed to create milestone release invoice:', error)
    res.status(500).json({ error: 'Failed to create milestone release invoice' })
  }
})

// Direct-pay for Cooperation milestones (ADR-253 Stufe 1, non-custodial): when
// escrow is unavailable the initiator pays the partner's OWN rail (LN address /
// NWC / Alby, or a P2PK-locked Cashu token) — the platform never holds the
// funds. Payment may happen at any point before the milestone is DISPUTED
// (upfront, on completion, or after approval); proof is stored as
// CoopMilestone.paidAt/paidRail and drives the Nostr `released` flag.
async function loadDirectPayMilestone(req: AuthenticatedRequest, res: express.Response) {
  if (isCoopEscrowEnabled()) {
    res.status(409).json({ error: 'USE_ESCROW', message: 'This deployment uses escrow for cooperation payments.' })
    return null
  }
  const { id, mid } = req.params
  const milestone = await prisma.coopMilestone.findUnique({ where: { id: mid }, include: { cooperation: true } })
  if (!milestone || milestone.cooperationId !== id) {
    res.status(404).json({ error: 'Milestone not found' })
    return null
  }
  return milestone
}

type DirectPayMilestone = NonNullable<Awaited<ReturnType<typeof loadDirectPayMilestone>>>

// Re-publish Kind 30415 once a payment lands AFTER the milestone was already
// approved, so relays never keep a stale released=false for a paid milestone.
function republishMilestoneIfAccepted(m: DirectPayMilestone) {
  if (m.status !== 'ACCEPTED') return
  nostrService.publishMilestoneEvent({
    id: m.id,
    cooperationId: m.cooperationId,
    milestoneIndex: m.milestoneIndex,
    initiatorPubkey: m.cooperation.initiatorPubkey,
    partnerPubkey: m.partnerPubkey || m.cooperation.partnerPubkey || '',
    title: m.title,
    status: m.status,
    amountSats: m.amountSats,
    evidence: m.evidence || undefined,
    released: true,
    visibility: m.cooperation.visibility,
  }).catch(err => console.error('[Nostr] Failed to re-publish Kind 30415 after direct payment:', err))
}

app.post('/api/cooperations/:id/milestones/:mid/pay-direct', requireAuth(prisma), blockIfPaymentsPaused, async (req: AuthenticatedRequest, res) => {
  try {
    const milestone = await loadDirectPayMilestone(req, res)
    if (!milestone) return
    if (req.authPubkey !== milestone.cooperation.initiatorPubkey) {
      return res.status(403).json({ error: 'Only the initiator may pay a milestone' })
    }
    if (milestone.paidAt) {
      return res.status(409).json({ error: 'ALREADY_PAID', message: 'This milestone has already been paid.' })
    }
    if (milestone.status === 'DISPUTED') {
      return res.status(409).json({ error: 'MILESTONE_DISPUTED', message: 'Resolve the dispute before paying this milestone.' })
    }
    const payee = milestone.partnerPubkey || milestone.cooperation.partnerPubkey
    if (!payee) {
      return res.status(409).json({ error: 'NO_PARTNER', message: 'This milestone has no partner to pay yet.' })
    }
    if (rejectIfAboveLaunchCap(res, milestone.amountSats)) return

    if (milestone.lightningInvoice && milestone.paymentHash && isInvoiceFresh(milestone.lightningInvoice)) {
      return res.json({ success: true, rail: 'LN', paymentHash: milestone.paymentHash, invoice: milestone.lightningInvoice, amountSats: milestone.amountSats, alreadyCreated: true })
    }

    const resolution = await resolveSellerInvoice(prisma, payee, milestone.amountSats, `Milestone: ${milestone.title} (${milestone.cooperation.title})`)
    if (!resolution.ok) {
      return res.status(422).json({ error: 'PARTNER_PAYMENT_NOT_CONFIGURED', message: 'The partner has not set up a way to receive payments yet (Lightning address, NWC, Alby or Cashu).' })
    }
    if (resolution.rail === 'CASHU') {
      // No invoice/preimage on this rail — the initiator locks a token to the
      // partner's pubkey client-side and the partner confirms receipt.
      return res.json({ success: true, rail: 'CASHU', cashu: resolution.cashu, amountSats: milestone.amountSats })
    }
    if (resolution.rail !== 'LN') {
      return res.status(422).json({ error: 'PARTNER_RAIL_UNSUPPORTED', message: "The partner's payment method is not available for cooperation payments." })
    }
    const { bolt11, paymentHash } = resolution.invoice
    await prisma.coopMilestone.update({ where: { id: milestone.id }, data: { lightningInvoice: bolt11, paymentHash } })
    res.json({ success: true, rail: 'LN', paymentHash, invoice: bolt11, amountSats: milestone.amountSats })
  } catch (error) {
    console.error('Failed to create direct milestone invoice:', error)
    res.status(502).json({ error: 'PAYMENT_UPSTREAM_ERROR', message: "Could not get an invoice from the partner's wallet. Try again shortly." })
  }
})

app.post('/api/cooperations/:id/milestones/:mid/confirm-direct-payment', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { preimage } = req.body as { preimage?: string }
    if (!preimage) return res.status(400).json({ error: 'preimage is required' })
    const milestone = await loadDirectPayMilestone(req, res)
    if (!milestone) return
    if (req.authPubkey !== milestone.cooperation.initiatorPubkey) {
      return res.status(403).json({ error: 'Only the initiator may confirm this payment' })
    }
    if (!milestone.paymentHash || !verifyPreimage(preimage, milestone.paymentHash)) {
      return res.status(400).json({ error: 'PREIMAGE_MISMATCH' })
    }
    if (!milestone.paidAt) {
      await prisma.coopMilestone.update({ where: { id: milestone.id }, data: { paidAt: new Date(), paidRail: 'LN_PREIMAGE' } })
      await prisma.coopMilestoneMessage.create({
        data: { milestoneId: milestone.id, authorPubkey: req.authPubkey!, action: 'PAID_DIRECT', message: `Paid ${milestone.amountSats} sats directly to the partner` },
      })
      // ADR-411: parity with the escrow/settlement rail — the partner is
      // told their milestone was paid (best-effort).
      {
        const partner = milestone.partnerPubkey || milestone.cooperation.partnerPubkey
        if (partner && partner !== milestone.cooperation.initiatorPubkey) {
          createNotification(prisma, {
            ownerPubkey: partner,
            type: 'cooperation',
            title: 'Milestone payment received',
            message: `${milestone.cooperation.title}: milestone paid (${milestone.amountSats} sats)`,
            relatedId: milestone.cooperationId,
            actionUrl: `/coop/${milestone.cooperationId}`,
            meta: { event: 'milestone_paid', milestoneId: milestone.id, amountSats: milestone.amountSats, role: 'partner' },
          }).catch(err => console.error('[notifications] direct-pay notify failed:', err))
        }
      }
      republishMilestoneIfAccepted(milestone)
    }
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to confirm direct milestone payment:', error)
    res.status(500).json({ error: 'Failed to confirm payment' })
  }
})

// Cashu rail: the initiator posts the P2PK-locked token (spendable only by the
// partner's key, so safe to show on the milestone thread) for the partner to
// redeem; the partner then confirms receipt below.
app.post('/api/cooperations/:id/milestones/:mid/cashu-token', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { token } = req.body as { token?: string }
    if (typeof token !== 'string' || !/^cashu[AB][A-Za-z0-9_\-=]{20,20000}$/.test(token)) {
      return res.status(400).json({ error: 'INVALID_TOKEN', message: 'That does not look like a Cashu token.' })
    }
    const milestone = await loadDirectPayMilestone(req, res)
    if (!milestone) return
    if (req.authPubkey !== milestone.cooperation.initiatorPubkey) {
      return res.status(403).json({ error: 'Only the initiator may send a payment token' })
    }
    if (milestone.paidAt) return res.status(409).json({ error: 'ALREADY_PAID' })
    await prisma.coopMilestoneMessage.create({
      data: { milestoneId: milestone.id, authorPubkey: req.authPubkey!, action: 'CASHU_TOKEN', message: token },
    })
    // ADR-411: parity with the ticket-side Cashu delivery notice
    // (routes/tickets.ts) — the partner must know a token is waiting.
    {
      const partner = milestone.partnerPubkey || milestone.cooperation.partnerPubkey
      if (partner && partner !== milestone.cooperation.initiatorPubkey) {
        createNotification(prisma, {
          ownerPubkey: partner,
          type: 'cooperation',
          title: 'Cashu payment token delivered',
          message: `${milestone.cooperation.title}: open the cooperation and redeem the token, then confirm receipt.`,
          relatedId: milestone.cooperationId,
          actionUrl: `/coop/${milestone.cooperationId}`,
          meta: { event: 'milestone_cashu_token', milestoneId: milestone.id, amountSats: milestone.amountSats, role: 'partner' },
        }).catch(err => console.error('[notifications] cashu token notify failed:', err))
      }
    }
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to post cashu token:', error)
    res.status(500).json({ error: 'Failed to post token' })
  }
})

// Partner attests they received the payment (Cashu token redeemed, or settled
// outside Colabonate). The milestone's partner is the only party who can vouch
// for receipt, so this is the proof on rails with no preimage.
app.post('/api/cooperations/:id/milestones/:mid/confirm-received', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const milestone = await loadDirectPayMilestone(req, res)
    if (!milestone) return
    const partner = milestone.partnerPubkey || milestone.cooperation.partnerPubkey
    if (!partner || req.authPubkey !== partner) {
      return res.status(403).json({ error: 'Only the partner may confirm receipt' })
    }
    if (!milestone.paidAt) {
      await prisma.coopMilestone.update({ where: { id: milestone.id }, data: { paidAt: new Date(), paidRail: 'PARTNER_CONFIRMED' } })
      await prisma.coopMilestoneMessage.create({
        data: { milestoneId: milestone.id, authorPubkey: req.authPubkey!, action: 'PAID_CONFIRMED', message: `Partner confirmed receipt of ${milestone.amountSats} sats` },
      })
      // ADR-411: the initiator learns their milestone payment was received.
      if (milestone.cooperation.partnerPubkey !== milestone.cooperation.initiatorPubkey) {
        createNotification(prisma, {
          ownerPubkey: milestone.cooperation.initiatorPubkey,
          type: 'cooperation',
          title: 'Partner confirmed milestone payment',
          message: `${milestone.cooperation.title}: receipt of ${milestone.amountSats} sats confirmed`,
          relatedId: milestone.cooperationId,
          actionUrl: `/coop/${milestone.cooperationId}`,
          meta: { event: 'milestone_receipt_confirmed', milestoneId: milestone.id, amountSats: milestone.amountSats, role: 'initiator' },
        }).catch(err => console.error('[notifications] receipt confirm notify failed:', err))
      }
      republishMilestoneIfAccepted(milestone)
    }
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to confirm receipt:', error)
    res.status(500).json({ error: 'Failed to confirm receipt' })
  }
})

// ADR-212 P0: only the ticket's buyer may create a payout invoice.
app.post('/api/tickets/:id/release-payment', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params

    const ticket = await prisma.ticket.findUnique({ where: { id }, include: { offer: true } })
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' })
    }
    // ADR-212 P0: ownership check — only the ticket buyer may release payment.
    if (req.authPubkey !== ticket.buyerPubkey) {
      return res.status(403).json({ error: 'Only the buyer may release ticket payment' })
    }
    if (ticket.status !== 'IN_PROGRESS') {
      return res.status(409).json({ error: `Ticket must be IN_PROGRESS to release payment, current status: ${ticket.status}` })
    }

    // ADR-255 D7: this route creates a platform-custodial payout invoice — only
    // meaningful for an escrow ticket, where Phase-1 funds were held back and
    // need releasing. A non-escrow (direct-pay LN/CASHU/DEMO) ticket already
    // paid the seller directly at checkout; nothing is held back here, so
    // creating (or re-paying) an invoice would silently charge the buyer a
    // second time. Confirming receipt for a non-escrow ticket is a plain
    // PATCH /api/tickets/:id { status: 'COMPLETED' } — no payment involved.
    if (!ticket.escrowEnabled) {
      return res.status(409).json({
        error: 'RELEASE_PAYMENT_NOT_APPLICABLE',
        message: 'This ticket has no held funds to release — confirm receipt instead.',
      })
    }

    if (ticket.lightningInvoice && ticket.paymentHash) {
      return res.json({
        success: true,
        paymentHash: ticket.paymentHash,
        invoice: ticket.lightningInvoice,
        amountSats: ticket.amountSats || (ticket.offer?.priceSats ?? 0),
        alreadyCreated: true,
      })
    }

    const amountSats = ticket.amountSats || (ticket.offer?.priceSats ?? 0)
    // ADR-252 D2 / FU-655: launch-phase per-transaction cap.
    if (rejectIfAboveLaunchCap(res, amountSats)) return
    const webhookUrl = `${BASE_URL}/api/webhooks/lnbits`

    const invoiceResult = await payments.createInvoice(
      amountSats,
      `Release: ${ticket.offer?.title ?? 'Ticket'}`,
      webhookUrl,
    )
    const paymentHash = invoiceResult.paymentHash
    const invoice = invoiceResult.bolt11

    await prisma.ticket.update({
      where: { id },
      data: { lightningInvoice: invoice, paymentHash },
    })

    // ADR-241 D3: register so /api/beta/demo-pay and the invoice poll can find this hash.
    registerInvoice(paymentHash, invoice, amountSats, `Release: ${ticket.offer?.title ?? 'Ticket'}`)

    console.log(`[ReleasePayment] Created invoice for ticket ${id}: ${paymentHash} (${amountSats} sats)`)

    res.json({
      success: true,
      paymentHash,
      invoice,
      amountSats,
    })
  } catch (error) {
    console.error('Failed to create ticket release invoice:', error)
    res.status(500).json({ error: 'Failed to create ticket release invoice' })
  }
})

// ADR-212 P0: ownership-gated. Caller must be the cooperation's initiator or partner.
// ADR-411: shared transition map for cooperation status writes — used by both
// PATCH /api/cooperations/:id/status and the generic PATCH /api/cooperations/:id
// (which previously accepted an unvalidated `status` bypassing this map).
function coopStatusTransitions(): Record<string, string[]> {
  return {
    DRAFT: ['OPEN', 'CANCELLED'],
    OPEN: ['ACCEPTED', 'CANCELLED'],
    // Direct-pay coops (escrow off, e.g. production): there is no funding
    // step, so work may start straight from ACCEPTED — money moves per
    // milestone via /milestones/:mid/pay-direct instead.
    ACCEPTED: isCoopEscrowEnabled() ? ['PAID', 'CANCELLED'] : ['IN_PROGRESS', 'CANCELLED'],
    PAID: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
    COMPLETED: [],
    DISPUTED: ['IN_PROGRESS', 'CANCELLED'],
    CANCELLED: [],
  }
}

app.patch('/api/cooperations/:id/status', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    const validTransitions = coopStatusTransitions()

    const cooperation = await prisma.cooperation.findUnique({ where: { id } })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }

    // ADR-212 P0: only the initiator or accepted partner may change cooperation status.
    const callerPubkey = req.authPubkey!
    const isInitiator = callerPubkey === cooperation.initiatorPubkey
    const isPartner = !!(cooperation.partnerPubkey && callerPubkey === cooperation.partnerPubkey)
    if (!isInitiator && !isPartner) {
      return res.status(403).json({ error: 'Only the initiator or partner may update this cooperation status' })
    }

    const allowed = validTransitions[cooperation.status] || []
    if (!allowed.includes(status)) {
      return res.status(409).json({ error: `Cannot transition from ${cooperation.status} to ${status}` })
    }

    // FU-562 (ADR-329 D3 gap): a SMART_ORDER cooperation saved as DRAFT gets
    // zero CoopMilestone rows (POST only generates the canonical 25/50/25 set
    // when status !== 'DRAFT') — the first non-DRAFT status transition is the
    // only remaining place that can materialize them before the cooperation
    // goes live with nothing for escrow to release against.
    let generateSmartOrderPhases = false
    if (cooperation.status === 'DRAFT' && status === 'OPEN') {
      if (!cooperation.title) {
        return res.status(400).json({ error: 'Title is required before publishing' })
      }
      if (!cooperation.budgetSats || cooperation.budgetSats <= 0) {
        return res.status(400).json({ error: 'Budget must be greater than 0 before publishing' })
      }
      if (cooperation.ticketType === 'SMART_ORDER') {
        // Same floor as FU-505's POST-time check — a budget below this rounds
        // the Completion phase to 0 sats.
        if (cooperation.budgetSats < 4) {
          return res.status(400).json({ error: 'Smart Order budget must be at least 4 sats so all three phases receive a non-zero amount', code: 'BUDGET_TOO_LOW_FOR_SMART_ORDER' })
        }
        const existingPhaseCount = await prisma.coopMilestone.count({ where: { cooperationId: id } })
        generateSmartOrderPhases = existingPhaseCount === 0
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const coop = await tx.cooperation.update({
        where: { id },
        data: { status },
      })
      if (generateSmartOrderPhases) {
        // Mirrors the POST /api/cooperations generation exactly (same
        // rounding, Completion absorbs the remainder).
        const startSats = Math.round(coop.budgetSats * 0.25)
        const progressSats = Math.round(coop.budgetSats * 0.5)
        await tx.coopMilestone.createMany({
          data: [
            { cooperationId: id, milestoneIndex: 1, title: 'Start', amountSats: startSats, status: 'PENDING' },
            { cooperationId: id, milestoneIndex: 2, title: 'Progress', amountSats: progressSats, status: 'PENDING' },
            { cooperationId: id, milestoneIndex: 3, title: 'Completion', amountSats: coop.budgetSats - startSats - progressSats, status: 'PENDING' },
          ],
        })
      }
      return tx.cooperation.findUniqueOrThrow({
        where: { id },
        include: { milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } } },
      })
    })

    // Guard against ever announcing a DRAFT (not reachable today — DRAFT is never
    // a valid transition target above — but this must check the POST-transition
    // status, not the pre-transition one, or the DRAFT→OPEN publish itself gets
    // silently skipped, which is exactly the transition that needs announcing.
    if (updated.status !== 'DRAFT') {
      nostrService.publishCooperationProposal({
        id: updated.id,
        type: 'status_update' as 'proposal',
        initiatorPubkey: updated.initiatorPubkey,
        partnerPubkey: updated.partnerPubkey || '',
        title: updated.title,
        budgetSats: updated.budgetSats,
        timeline: updated.timeline || undefined,
        status: updated.status,
        cooperationType: updated.cooperationType || undefined,
        content: updated.description || undefined,
      }).catch(err => console.error('[Nostr] Failed to publish Kind 30414 (StatusUpdate):', err))
    }

    console.log(`[Cooperation] Status update: ${id} ${cooperation.status} → ${status}`)

    // ADR-374: server-backed in-app notification for the non-acting party
    // (best-effort — a notification write never fails the status change).
    notifyCooperationStatusChange(prisma, {
      cooperationId: updated.id,
      fromStatus: cooperation.status,
      toStatus: updated.status,
      initiatorPubkey: updated.initiatorPubkey,
      partnerPubkey: updated.partnerPubkey,
      actingPubkey: callerPubkey,
      title: updated.title,
    }).catch((err) => console.error('[notifications] cooperation-status failed:', err instanceof Error ? err.message : err))

    // ADR-301: bust the discover-list cache so the new status is visible on the
    // home slider on the next page load (not after the 30s client staleTime).
    await invalidateListCache('cooperations').catch(() => {/* swallow */})

    // ADR-331 D1: parse requiredCapabilities before serialization.
    parseCoopMilestoneRequiredCapabilities(updated.milestones as unknown as Array<Record<string, unknown>>)
    res.json({ cooperation: parseCooperation(updated) })
  } catch (error) {
    console.error('Failed to update cooperation status:', error)
    res.status(500).json({ error: 'Failed to update cooperation status' })
  }
})

// =============================================================================
// ADR-112: CooperationTemplate CRUD
// =============================================================================

const MOCK_TEMPLATES = [
  {
    id: 'mock-1',
    name: 'Standard Project Collaboration',
    description: 'For typical freelance or joint development projects.',
    cooperationType: 'TRANSACTIONAL',
    timelinePreset: '1month',
    requiredSkills: [],
    defaultMilestones: [
      { title: 'Planning & Setup', percentage: 20 },
      { title: 'Core Development', percentage: 50 },
      { title: 'Testing & Review', percentage: 20 },
      { title: 'Deployment & Handover', percentage: 10 },
    ],
    categoryCode: 'services/development',
    isPublic: true,
    createdByPubkey: 'SYSTEM',
    companyId: null,
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
  },
  {
    id: 'mock-2',
    name: 'Joint Production Partnership',
    description: 'For craftspeople or manufacturers building together.',
    cooperationType: 'PRODUCTION',
    timelinePreset: '3months',
    requiredSkills: [],
    defaultMilestones: [
      { title: 'Design & Prototyping', percentage: 30 },
      { title: 'Production', percentage: 50 },
      { title: 'Quality Check & Delivery', percentage: 20 },
    ],
    categoryCode: 'goods',
    isPublic: true,
    createdByPubkey: 'SYSTEM',
    companyId: null,
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
  },
  {
    id: 'mock-3',
    name: 'Open Tender Call',
    description: 'Publish an open call for proposals with a submission deadline.',
    cooperationType: 'TENDER',
    timelinePreset: '2weeks',
    requiredSkills: [],
    defaultMilestones: [
      { title: 'Proposal Review', percentage: 10 },
      { title: 'Project Execution', percentage: 70 },
      { title: 'Final Delivery', percentage: 20 },
    ],
    categoryCode: 'services',
    isPublic: true,
    createdByPubkey: 'SYSTEM',
    companyId: null,
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
  },
  {
    id: 'mock-4',
    name: 'Skill Exchange (Barter)',
    description: 'Exchange services without monetary transactions — value for value.',
    cooperationType: 'BARTER',
    timelinePreset: '2weeks',
    requiredSkills: [],
    defaultMilestones: [
      { title: 'Define Exchange Terms', percentage: 20 },
      { title: 'Party A delivers', percentage: 40 },
      { title: 'Party B delivers', percentage: 40 },
    ],
    categoryCode: 'services',
    isPublic: true,
    createdByPubkey: 'SYSTEM',
    companyId: null,
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
  },
]

function serializeTemplate(t: any) {
  return {
    ...t,
    requiredSkills: typeof t.requiredSkills === 'string' ? JSON.parse(t.requiredSkills) : (t.requiredSkills ?? []),
    defaultMilestones: typeof t.defaultMilestones === 'string' ? JSON.parse(t.defaultMilestones) : (t.defaultMilestones ?? []),
    budgetRange: typeof t.budgetRange === 'string' ? JSON.parse(t.budgetRange) : (t.budgetRange ?? null),
    images: typeof t.images === 'string' ? JSON.parse(t.images) : (t.images ?? []),
  }
}

app.get('/api/cooperation-templates', async (req, res) => {
  try {
    const { pubkey, companyId } = req.query
    const where: any = {
      OR: [
        { isPublic: true },
        ...(pubkey ? [{ createdByPubkey: pubkey as string }] : []),
        ...(companyId ? [{ companyId: companyId as string }] : []),
      ],
    }
    const dbTemplates = await prisma.cooperationTemplate.findMany({ where, orderBy: { createdAt: 'asc' } })
    const merged = [
      ...MOCK_TEMPLATES,
      ...dbTemplates.map(serializeTemplate),
    ]
    res.json({ templates: merged })
  } catch (error) {
    console.error('Failed to fetch cooperation templates:', error)
    res.status(500).json({ error: 'Failed to fetch cooperation templates' })
  }
})

app.post('/api/cooperation-templates', async (req, res) => {
  try {
    const { name, description, cooperationType, budgetRange, timelinePreset, requiredSkills, defaultMilestones, categoryCode, terms, images, isPublic, createdByPubkey, companyId, isAgentOrchestration, orchestrationSteps } = req.body
    if (!name || !cooperationType || !createdByPubkey) {
      return res.status(400).json({ error: 'Missing required fields: name, cooperationType, createdByPubkey' })
    }
    const templateCategoryResolution = await resolveCategoryCode(prisma, categoryCode)
    if (!templateCategoryResolution.ok) {
      return res.status(400).json({ error: templateCategoryResolution.message, code: 'INVALID_CATEGORY_CODE' })
    }
    // ADR-310 D1: orchestration templates carry a validated pipeline instead
    // of (or alongside) the plain defaultMilestones percentage list.
    let validatedSteps: OrchestrationStep[] | null = null
    if (isAgentOrchestration) {
      const result = validateOrchestrationSteps(orchestrationSteps)
      if ('error' in result) return res.status(400).json({ error: result.error })
      validatedSteps = result.steps
    }
    const template = await prisma.cooperationTemplate.create({
      data: {
        name,
        description: description || null,
        cooperationType,
        budgetRange: budgetRange ? JSON.stringify(budgetRange) : null,
        timelinePreset: timelinePreset || null,
        requiredSkills: Array.isArray(requiredSkills) ? JSON.stringify(requiredSkills) : null,
        defaultMilestones: Array.isArray(defaultMilestones) ? JSON.stringify(defaultMilestones) : null,
        categoryCode: templateCategoryResolution.categoryCode || null,
        terms: terms || null,
        images: Array.isArray(images) ? JSON.stringify(images) : null,
        isPublic: isPublic ?? false,
        createdByPubkey,
        companyId: companyId || null,
        isAgentOrchestration: Boolean(isAgentOrchestration),
        orchestrationSteps: validatedSteps ? (validatedSteps as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    })
    res.status(201).json({ template: serializeTemplate(template) })
  } catch (error) {
    console.error('Failed to create cooperation template:', error)
    res.status(500).json({ error: 'Failed to create cooperation template' })
  }
})

// FU-483 (ADR-328 D2): same matching as below, but for the Coop Guide's
// ad-hoc Agent Orchestration flow — the pipeline is authored live in the
// Details step and previewed before a CooperationTemplate (or Cooperation)
// exists at all, so there's no :id to look up yet. matchAgentsToOrchestration
// is already step-array-generic (not template-coupled), so this reuses it
// directly instead of requiring a throwaway template to be saved first.
app.post('/api/cooperation-templates/match-agents', async (req, res) => {
  try {
    const { orchestrationSteps } = req.body
    const validated = validateOrchestrationSteps(orchestrationSteps)
    if ('error' in validated) return res.status(400).json({ error: validated.error })
    const matches = await matchAgentsToOrchestration(prisma, validated.steps)
    res.json({ matches })
  } catch (error) {
    console.error('Failed to match agents to ad-hoc orchestration steps:', error)
    res.status(500).json({ error: 'Failed to match agents to orchestration steps' })
  }
})

// ADR-310 D4: for an agent-orchestration template, return the top-ranked
// public AgentProfiles per pipeline step (capability-gated, reputation +
// price ranked). Public read — same tier as the ADR-313 discovery endpoints,
// no buyer-specific data involved.
app.get('/api/cooperation-templates/:id/match-agents', async (req, res) => {
  try {
    const { id } = req.params
    const mock = MOCK_TEMPLATES.find(t => t.id === id)
    const dbTemplate = mock ? null : await prisma.cooperationTemplate.findUnique({ where: { id } })
    if (!mock && !dbTemplate) return res.status(404).json({ error: 'Template not found' })
    const template: any = mock ?? serializeTemplate(dbTemplate)
    if (!template.isAgentOrchestration || !Array.isArray(template.orchestrationSteps) || template.orchestrationSteps.length === 0) {
      return res.status(400).json({ error: 'Template is not an agent-orchestration template' })
    }
    const validated = validateOrchestrationSteps(template.orchestrationSteps)
    if ('error' in validated) return res.status(400).json({ error: `Template has an invalid pipeline: ${validated.error}` })
    const matches = await matchAgentsToOrchestration(prisma, validated.steps)
    res.json({ templateId: id, matches })
  } catch (error) {
    console.error('Failed to match agents to orchestration template:', error)
    res.status(500).json({ error: 'Failed to match agents to orchestration template' })
  }
})

app.get('/api/cooperation-templates/:id', async (req, res) => {
  try {
    const { id } = req.params
    const mock = MOCK_TEMPLATES.find(t => t.id === id)
    if (mock) return res.json({ template: mock })
    const template = await prisma.cooperationTemplate.findUnique({ where: { id } })
    if (!template) return res.status(404).json({ error: 'Template not found' })
    res.json({ template: serializeTemplate(template) })
  } catch (error) {
    console.error('Failed to fetch cooperation template:', error)
    res.status(500).json({ error: 'Failed to fetch cooperation template' })
  }
})

app.patch('/api/cooperation-templates/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (MOCK_TEMPLATES.find(t => t.id === id)) {
      return res.status(403).json({ error: 'System templates cannot be modified' })
    }
    const { name, description, cooperationType, budgetRange, timelinePreset, requiredSkills, defaultMilestones, categoryCode, terms, images, isPublic, isAgentOrchestration, orchestrationSteps } = req.body
    let validatedSteps: OrchestrationStep[] | undefined
    if (orchestrationSteps !== undefined) {
      const result = validateOrchestrationSteps(orchestrationSteps)
      if ('error' in result) return res.status(400).json({ error: result.error })
      validatedSteps = result.steps
    }
    const templateCategoryResolution = await resolveCategoryCode(prisma, categoryCode)
    if (!templateCategoryResolution.ok) {
      return res.status(400).json({ error: templateCategoryResolution.message, code: 'INVALID_CATEGORY_CODE' })
    }
    const template = await prisma.cooperationTemplate.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(cooperationType !== undefined && { cooperationType }),
        ...(budgetRange !== undefined && { budgetRange: JSON.stringify(budgetRange) }),
        ...(timelinePreset !== undefined && { timelinePreset }),
        ...(requiredSkills !== undefined && { requiredSkills: JSON.stringify(requiredSkills) }),
        ...(defaultMilestones !== undefined && { defaultMilestones: JSON.stringify(defaultMilestones) }),
        ...(templateCategoryResolution.categoryCode !== undefined && { categoryCode: templateCategoryResolution.categoryCode }),
        ...(terms !== undefined && { terms }),
        ...(images !== undefined && { images: JSON.stringify(images) }),
        ...(isPublic !== undefined && { isPublic }),
        ...(isAgentOrchestration !== undefined && { isAgentOrchestration: Boolean(isAgentOrchestration) }),
        ...(validatedSteps !== undefined && { orchestrationSteps: validatedSteps as unknown as Prisma.InputJsonValue }),
      },
    })
    res.json({ template: serializeTemplate(template) })
  } catch (error) {
    console.error('Failed to update cooperation template:', error)
    res.status(500).json({ error: 'Failed to update cooperation template' })
  }
})

app.delete('/api/cooperation-templates/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (MOCK_TEMPLATES.find(t => t.id === id)) {
      return res.status(403).json({ error: 'System templates cannot be deleted' })
    }
    await prisma.cooperationTemplate.delete({ where: { id } })
    res.json({ success: true })
  } catch (error) {
    console.error('Failed to delete cooperation template:', error)
    res.status(500).json({ error: 'Failed to delete cooperation template' })
  }
})

app.post('/api/cooperations', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { title, description, partnerPubkey, cooperationType, partnerMode, budgetSats, priceSats, timeline, skills, categoryCode, images, deadline, requirements, milestones: milestonesInput, status: requestStatus, visibility, disputeMode, ticketType, agentSupervision: agentSupervisionInput, companyId } = req.body

    const initiatorPubkey = req.authPubkey!
    const budget = budgetSats ?? priceSats ?? 0
    if (!title) {
      return res.status(400).json({ error: 'Missing required fields: title' })
    }
    if (requestStatus !== 'DRAFT' && budget <= 0) {
      return res.status(400).json({ error: 'Budget must be greater than 0' })
    }

    // ADR-329 D4: payment structure — TicketType vocabulary, coop subset.
    const coopTicketType = ticketType ?? 'MILESTONE'
    if (coopTicketType !== 'SMART_ORDER' && coopTicketType !== 'MILESTONE') {
      return res.status(400).json({ error: 'Invalid ticketType', code: 'INVALID_TICKET_TYPE', details: 'ticketType must be SMART_ORDER or MILESTONE' })
    }
    // FU-505 (ADR-329 reviewer P3): the canonical 25/50/25 split rounds a
    // sub-4-sat budget down to a 0-sat phase (e.g. budget=2 → 1/1/0) — the
    // Completion phase would never have anything to release. 4 is the exact
    // minimum at which Math.round(b*0.25) + Math.round(b*0.5) < b holds, so
    // every phase is guaranteed >= 1 sat. Client-authored milestones hit the
    // same rounding (buildCoopPayload), so this applies regardless of who
    // computed the percentages.
    if (coopTicketType === 'SMART_ORDER' && requestStatus !== 'DRAFT' && budget > 0 && budget < 4) {
      return res.status(400).json({ error: 'Smart Order budget must be at least 4 sats so all three phases receive a non-zero amount', code: 'BUDGET_TOO_LOW_FOR_SMART_ORDER' })
    }

    // Category consistency (ADR-380 invariant): same slug validation as the
    // offer routes — cooperations are discoverable via categoryCode too.
    const coopCategoryResolution = await resolveCategoryCode(prisma, categoryCode)
    if (!coopCategoryResolution.ok) {
      return res.status(400).json({ error: coopCategoryResolution.message, code: 'INVALID_CATEGORY_CODE' })
    }

    // ADR-152: validate TradeVisibility + DisputeMode (default PUBLIC)
    const visParsed = TradeVisibilitySchema.safeParse(visibility ?? 'PUBLIC')
    if (!visParsed.success) {
      return res.status(400).json({ error: 'invalid visibility', details: visParsed.error.issues })
    }
    const dmParsed = DisputeModeSchema.safeParse(disputeMode ?? 'PUBLIC')
    if (!dmParsed.success) {
      return res.status(400).json({ error: 'invalid disputeMode', details: dmParsed.error.issues })
    }

    // ADR-310 D2: orchestration milestones may each carry a matched/chosen
    // AgentProfile — validated before the Cooperation is created so a bad id
    // never leaves behind an orphaned, milestone-less Cooperation row.
    if (Array.isArray(milestonesInput) && milestonesInput.length > 0) {
      // ADR-332 D2: step-level assignees are validated alongside the legacy
      // milestone-level ones — one shared id pool, one 400 on any bad id.
      type MilestoneWithSteps = { assigneeAgentProfileId?: string; steps?: Array<{ assigneeAgentProfileId?: string }> }
      const assigneeIds = [...new Set(milestonesInput.flatMap((m: MilestoneWithSteps) => [
        ...(m.assigneeAgentProfileId ? [m.assigneeAgentProfileId] : []),
        ...(Array.isArray(m.steps) ? m.steps.map(s => s.assigneeAgentProfileId) : []),
      ]).filter((x): x is string => Boolean(x)))]
      if (assigneeIds.length > 0) {
        const validAssignees = await prisma.agentProfile.findMany({ where: { id: { in: assigneeIds }, isPublic: true }, select: { id: true } })
        const validAssigneeIds = new Set(validAssignees.map(a => a.id))
        const invalid = assigneeIds.filter(id => !validAssigneeIds.has(id))
        if (invalid.length > 0) {
          return res.status(400).json({ error: `Unknown or non-public assigneeAgentProfileId: ${invalid.join(', ')}` })
        }
      }

      // ADR-352 D1a: a milestone/step assigneeOfferId must resolve to a
      // specific, active AGENT_SETUP offer actually owned by the same
      // assigneeAgentProfileId — this is what the execution Workspace (D1)
      // anchors to, so a bad or mismatched id must never leave behind an
      // orphaned Cooperation row.
      const { pairs: assigneeOfferPairs, orphaned: orphanedAssigneeOffers } = collectAssigneeOfferPairs(milestonesInput as MilestoneAssigneeInput[])
      if (orphanedAssigneeOffers.length > 0) {
        return res.status(400).json({ error: `assigneeOfferId requires assigneeAgentProfileId to also be set: ${orphanedAssigneeOffers.join(', ')}` })
      }
      if (assigneeOfferPairs.length > 0) {
        const offerIds = [...new Set(assigneeOfferPairs.map(p => p.offerId))]
        const offers = await prisma.offer.findMany({
          where: { id: { in: offerIds } },
          select: { id: true, agentProfileId: true, offerType: true, status: true },
        })
        const offerById = new Map(offers.map(o => [o.id, o]))
        const invalidOffers = assigneeOfferPairs.filter(p => {
          const offer = offerById.get(p.offerId)
          return !offer || offer.agentProfileId !== p.agentProfileId || offer.offerType !== 'AGENT_SETUP' || offer.status !== 'ACTIVE'
        })
        if (invalidOffers.length > 0) {
          return res.status(400).json({ error: `Unknown, mismatched, or inactive assigneeOfferId: ${[...new Set(invalidOffers.map(p => p.offerId))].join(', ')}` })
        }
      }
    }

    // ADR-331 D1: validate `agentSupervision` (nullable — null is the human-
    // orchestration or non-agent case, server treats null as 'human' on resume).
    // Zod parse happens here so a malformed value 400s BEFORE we create the
    // Cooperation + CoopMilestone rows; mirrors ADR-312 D6's
    // AgentBillingModelSchema pattern.
    let agentSupervision: CoopAgentSupervision | null = null
    if (agentSupervisionInput !== undefined && agentSupervisionInput !== null) {
      const parsed = CoopAgentSupervisionSchema.safeParse(agentSupervisionInput)
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid agentSupervision', details: parsed.error.issues })
      }
      agentSupervision = parsed.data
    }

    // FU-511 (ADR-331 K): same validate-by-lookup pattern as Offer.companyId
    // (ADR-326 D10.1 / FU-491) — accept the client's companyId only after
    // confirming the caller actually owns that company.
    let resolvedCompanyId: string | null = null
    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId } })
      if (!company || company.ownerPubkey !== initiatorPubkey) {
        return res.status(400).json({ error: 'companyId must reference your own company' })
      }
      resolvedCompanyId = companyId
    }

    await prisma.user.upsert({ where: { pubkey: initiatorPubkey }, update: {}, create: { pubkey: initiatorPubkey } })
    if (partnerPubkey) {
      await prisma.user.upsert({ where: { pubkey: partnerPubkey }, update: {}, create: { pubkey: partnerPubkey } })
    }

    // ADR-376 D3 (closes FU-301-D): same makeThumbsFromImages() helper as
    // Offer (index.ts:1069) — Cooperation.images stays the raw JSON-string
    // column, imageThumbs is the new slim, browse-list-safe sibling.
    const cooperationImageThumbs = Array.isArray(images) && images.length > 0
      ? (await makeThumbsFromImages(images) ?? undefined)
      : undefined

    const cooperation = await prisma.cooperation.create({
      data: {
        title,
        description,
        initiatorPubkey,
        partnerPubkey: partnerPubkey || null,
        cooperationType: cooperationType || null,
        partnerMode: partnerMode || 'WHOLE',
        budgetSats: budget,
        timeline: timeline || null,
        skills: Array.isArray(skills) ? JSON.stringify(skills) : null,
        categoryCode: coopCategoryResolution.categoryCode || null,
        images: Array.isArray(images) && images.length > 0 ? JSON.stringify(images) : null,
        imageThumbs: cooperationImageThumbs,
        deadline: deadline ? new Date(deadline) : null,
        requirements: requirements || null,
        status: requestStatus || 'OPEN',
        // ADR-152: trade visibility + dispute mode (default PUBLIC)
        visibility: visParsed.data,
        disputeMode: dmParsed.data,
        ticketType: coopTicketType,
        companyId: resolvedCompanyId,
      },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } } },
    })

    // Create milestones (frontend sends percentage; convert to amountSats from budget)
    if (Array.isArray(milestonesInput) && milestonesInput.length > 0) {
      await prisma.coopMilestone.createMany({
        data: milestonesInput.map((m: { title: string; description?: string; amountSats?: number; percentage?: number; dueDate?: string; assigneeAgentProfileId?: string; assigneeOfferId?: string; requiredCapabilities?: string[] }, i: number) => ({
          cooperationId: cooperation.id,
          milestoneIndex: i + 1,
          title: m.title,
          description: m.description,
          amountSats: m.amountSats ?? (m.percentage != null ? Math.round(budget * m.percentage / 100) : 0),
          dueDate: m.dueDate ? new Date(m.dueDate) : null,
          status: 'PENDING',
          assigneeAgentProfileId: m.assigneeAgentProfileId || null,
          // ADR-352 D1a: already validated above against assigneeAgentProfileId.
          assigneeOfferId: m.assigneeOfferId || null,
          // ADR-331 D1: snapshot per-step capabilities (JSON-encoded). Only
          // meaningful when assigneeAgentProfileId is also set — but the
          // server doesn't enforce that pairing (the wizard does via
          // validateDetails), so a future flow could attach capabilities
          // without an assignee (or vice versa) without breaking the schema.
          requiredCapabilities: Array.isArray(m.requiredCapabilities)
            ? JSON.stringify(m.requiredCapabilities)
            : null,
        })),
      })
      // ADR-332 D2: nested pipeline steps — one CoopMilestoneStep row per
      // authored step inside its parent milestone. The milestone keeps the
      // money (amountSats above); the step carries the capability + agent
      // assignment. createMany doesn't return rows, so parent ids are
      // re-fetched by index (they were just written with milestoneIndex i+1,
      // same order as milestonesInput).
      const stepBatches = milestonesInput
        .map((m: { steps?: Array<{ title: string; requiredCapabilities?: string[]; assigneeAgentProfileId?: string; assigneeOfferId?: string }> }, i: number) => ({ m, i }))
        .filter(({ m }) => Array.isArray(m.steps) && m.steps.length > 0)
      if (stepBatches.length > 0) {
        const created = await prisma.coopMilestone.findMany({
          where: { cooperationId: cooperation.id },
          orderBy: { milestoneIndex: 'asc' },
          select: { id: true, milestoneIndex: true },
        })
        const idByIndex = new Map(created.map(c => [c.milestoneIndex, c.id]))
        await prisma.coopMilestoneStep.createMany({
          data: stepBatches.flatMap(({ m, i }) =>
            (m.steps as Array<{ title: string; requiredCapabilities?: string[]; assigneeAgentProfileId?: string; assigneeOfferId?: string }>).map((s, j) => ({
              milestoneId: idByIndex.get(i + 1)!,
              stepIndex: j + 1,
              title: s.title,
              requiredCapabilities: Array.isArray(s.requiredCapabilities) ? JSON.stringify(s.requiredCapabilities) : null,
              assigneeAgentProfileId: s.assigneeAgentProfileId || null,
              // ADR-352 D1a: already validated above against assigneeAgentProfileId.
              assigneeOfferId: s.assigneeOfferId || null,
            })),
          ),
        })
      }
    } else if (coopTicketType === 'SMART_ORDER' && requestStatus !== 'DRAFT') {
      // ADR-329 D3: Smart Order without authored milestones gets the 3
      // canonical phases Start 25% / Progress 50% / Completion 25% — same
      // CoopMilestone machinery as custom milestones. Generated at submit only:
      // a DRAFT (budget possibly 0) must not freeze placeholder phases that a
      // resumed draft would then count as authored content (plan rule R2).
      // Completion absorbs the rounding remainder so the phases sum exactly
      // to the budget.
      const startSats = Math.round(budget * 0.25)
      const progressSats = Math.round(budget * 0.5)
      await prisma.coopMilestone.createMany({
        data: [
          { cooperationId: cooperation.id, milestoneIndex: 1, title: 'Start', amountSats: startSats, status: 'PENDING' },
          { cooperationId: cooperation.id, milestoneIndex: 2, title: 'Progress', amountSats: progressSats, status: 'PENDING' },
          { cooperationId: cooperation.id, milestoneIndex: 3, title: 'Completion', amountSats: budget - startSats - progressSats, status: 'PENDING' },
        ],
      })
    }

    // ADR-328 D4: snapshot isAgentOrchestration from the milestones we just
    // wrote. Same rule as the migration's backfill — 'true' iff any milestone
    // of this cooperation carries an assigneeAgentProfileId. Derived on the
    // server (not trusted from the client) so the flag can't lie; API never
    // exposes CoopMilestone.assigneeAgentProfileId reassignment (only POST
    // /api/cooperations sets it), so this is write-once — no recompute helper.
    // ADR-332 D2: the derivation reads BOTH levels — legacy milestone-level
    // assignees and nested step-level assignees — so legacy and new rows are
    // indistinguishable.
    const isAgentOrchestration = Array.isArray(milestonesInput)
      && milestonesInput.some((m: { assigneeAgentProfileId?: string; steps?: Array<{ assigneeAgentProfileId?: string }> }) =>
        Boolean(m.assigneeAgentProfileId)
        || (Array.isArray(m.steps) && m.steps.some(s => Boolean(s.assigneeAgentProfileId))))
    // ADR-331 D1: snapshot agentSupervision alongside isAgentOrchestration.
    // Server-derived: only persisted when this is actually an agent
    // orchestration (mirrors FU-505's isAgentOrchestration write-once
    // discipline — a mismatched client value would silently drop). For
    // executor='human' cooperations the field stays null and the resume
    // path treats null as 'human'.
    if (isAgentOrchestration || agentSupervision) {
      await prisma.cooperation.update({
        where: { id: cooperation.id },
        data: {
          ...(isAgentOrchestration && { isAgentOrchestration: true }),
          ...(agentSupervision && { agentSupervision }),
        },
      })
    }

    const cooperationWithMilestones = await prisma.cooperation.findUnique({
      where: { id: cooperation.id },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } } },
    })

    const isPrivateCoop = cooperation.visibility === 'PRIVATE'

    // Publish Kind 30414 (proposal) via server ephemeral key — skip for drafts.
    // ADR-152 / Plan Phase 3.2: publishCooperationProposal itself skips the
    // public publish for PRIVATE cooperations (DM-only via NIP-17).
    if (cooperation.status !== 'DRAFT') {
      nostrService.publishCooperationProposal({
        id: cooperation.id,
        type: 'proposal',
        initiatorPubkey: cooperation.initiatorPubkey,
        partnerPubkey: cooperation.partnerPubkey || '',
        title: cooperation.title,
        budgetSats: cooperation.budgetSats,
        timeline: cooperation.timeline || undefined,
        status: cooperation.status,
        cooperationType: cooperation.cooperationType || undefined,
        skills: Array.isArray(skills) ? skills : undefined,
        content: cooperation.description || undefined,
        visibility: cooperation.visibility,
      }).catch(err => console.error('[Nostr] Failed to publish Kind 30414 (CooperationProposal):', err))
    }

    // For PRIVATE cooperations, persist a DmMessage inbox row so the partner
    // sees the proposal in their NIP-17 inbox (mirrors private-offer delivery,
    // Plan Phase 2.2 / 3.2). Peer = initiator (the proposal's source). The
    // dual-signature NIP-C agreement is replicated client-side as a Kind 14 DM.
    if (cooperation.status !== 'DRAFT' && isPrivateCoop && cooperation.partnerPubkey) {
      const coopDmPayload = JSON.stringify({
        type: 'cooperation_proposal',
        cooperationId: cooperation.id,
        title: cooperation.title,
        budgetSats: cooperation.budgetSats,
        initiatorPubkey: cooperation.initiatorPubkey,
        partnerPubkey: cooperation.partnerPubkey,
        timestamp: Math.floor(Date.now() / 1000),
      })
      prisma.dmMessage.upsert({
        where: { eventId: `coop-proposal:${cooperation.id}:${cooperation.partnerPubkey}` },
        create: {
          ownerPubkey: cooperation.partnerPubkey,
          peerPubkey: cooperation.initiatorPubkey,
          eventId: `coop-proposal:${cooperation.id}:${cooperation.partnerPubkey}`,
          kind: 14,
          payload: coopDmPayload,
          visibility: 'PRIVATE',
        },
        update: {},
      }).catch(err => console.error('[private-coop] Failed to write proposal DmMessage:', err))
    }

    // Build unsigned event template for client-side signing — skip for drafts.
    // PRIVATE cooperations get a Kind-14 DM template (NIP-17), PUBLIC ones the
    // addressable Kind 30414 template (ADR-107 NIP-07 signing).
    const proposalTemplate = cooperation.status !== 'DRAFT' && isPrivateCoop ? {
      kind: 14,
      pubkey: cooperation.initiatorPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', cooperation.id],
        ['type', 'proposal'],
        ['cooperation', cooperation.id],
        ['initiator', cooperation.initiatorPubkey],
        ...(cooperation.partnerPubkey ? [['partner', cooperation.partnerPubkey], ['p', cooperation.partnerPubkey]] : []),
        ...(cooperation.cooperationType ? [['cooperation_type', cooperation.cooperationType]] : []),
        ['title', cooperation.title],
        ['budget', cooperation.budgetSats.toString(), 'sats'],
        ['status', 'OPEN'],
        ['ticket_type', 'cooperation'],
        ['visibility', 'PRIVATE'],
      ],
      content: cooperation.description || '',
    } : cooperation.status !== 'DRAFT' ? {
      kind: 30414,
      pubkey: cooperation.initiatorPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', cooperation.id],
        ['type', 'proposal'],
        ['cooperation', cooperation.id],
        ['initiator', cooperation.initiatorPubkey],
        ...(cooperation.partnerPubkey ? [['partner', cooperation.partnerPubkey]] : []),
        ...(cooperation.cooperationType ? [['cooperation_type', cooperation.cooperationType]] : []),
        ['title', cooperation.title],
        ['budget', cooperation.budgetSats.toString(), 'sats'],
        ['status', 'OPEN'],
        ['ticket_type', 'cooperation'],
      ],
      content: cooperation.description || '',
    } : undefined

    // ADR-331 D1: parse requiredCapabilities before serialization.
    parseCoopMilestoneRequiredCapabilities(cooperationWithMilestones!.milestones as unknown as Array<Record<string, unknown>>)
    res.json({
      success: true,
      cooperation: parseCooperation(cooperationWithMilestones!),
      ...(proposalTemplate ? { nostrEventTemplate: proposalTemplate } : {}),
    })

    // ADR-301: bust the discover-list cache so the new cooperation shows up
    // on the home slider on the next page load (not after the 30s client
    // staleTime). Without this, the operator sees the "publish didn't work"
    // false-alarm because the home slider's React Query cache stays valid for
    // 30 s post-publish. Belt-and-braces: the client-side invalidateQueries
    // (apps/colabonate-app/src/routes/coop/CoopGuide.tsx) covers the same
    // ground on the client; this covers other clients (curl, mobile app,
    // direct browser back-button navigation).
    invalidateListCache('cooperations').catch(() => {/* swallow */})

    // ADR-164 / PROB-003 B-α: provision an isolated sub-wallet for PRIVATE
    // cooperations when the initiator's strategy resolves to CUSTODIAL.
    // Best-effort, fire-and-forget — must never break cooperation creation.
    if (isPrivateCoop) {
      subWalletService
        .provisionPrivateTrade({ kind: 'cooperation', tradeId: cooperation.id, ownerPubkey: initiatorPubkey })
        .then(r => {
          if (!r.provisioned) console.warn(`[B-α] cooperation ${cooperation.id}: ${r.reason}`)
        })
        .catch(err => console.error(`[B-α] cooperation ${cooperation.id} sub-wallet provisioning failed:`, err))
    }
  } catch (error) {
    console.error('Failed to create cooperation:', error)
    res.status(500).json({ error: 'Failed to create cooperation' })
  }
})

// GET /api/cooperations/:id — Auth: optional (ADR-303 D9 public read tier).
// PUBLIC cooperations are readable anonymously (they are listed anonymously by
// /api/cooperations/discover already); milestone applications/messages are
// personal data and stay behind auth — anonymous callers get them stripped.
// PRIVATE cooperations are only visible to the initiator / partner (ADR-212 P2).
  app.get('/api/cooperations/:id', async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params
      const cooperation = await prisma.cooperation.findUnique({
        where: { id },
        include: {
          milestones: {
            orderBy: { milestoneIndex: 'asc' },
            include: {
              applications: { orderBy: { createdAt: 'desc' } },
              messages: { orderBy: { createdAt: 'asc' } },
              // ADR-332 D2: nested pipeline steps (agent flows) — needed by
              // the CoopGuide resume effect and the client milestone display.
              steps: { orderBy: { stepIndex: 'asc' } },
              // ADR-331 D5.1: only the companyId is needed by the CoopGuide
              // resume effect to recover the Corporate role (D5). Select
              // (not include) keeps the payload minimal — no extra fields
              // leak. The cooperation's own visibility filter already
              // gates this endpoint, so this is not a privacy expansion.
              assigneeAgentProfile: { select: { companyId: true } },
            },
          },
          // ADR-386: engagement probes for the full-edit gate (owner-only).
          _count: { select: { milestoneApplications: true, tickets: true, workspaces: true } },
          escrowTrade: { select: { id: true } },
        },
      })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }
    // Optional auth: resolve the caller only when a Bearer token is present.
    let callerPubkey: string | null = null
    const authHeader = req.headers.authorization
    if (authHeader?.startsWith('Bearer ')) {
      const session = await validateToken(prisma, authHeader.slice(7))
      callerPubkey = session?.pubkey ?? null
    }
    const isInitiator = callerPubkey === cooperation.initiatorPubkey
    const isPartner = !!(cooperation.partnerPubkey && callerPubkey === cooperation.partnerPubkey)
    const isPrivate = cooperation.visibility === 'PRIVATE'
    if (isPrivate && !isInitiator && !isPartner) {
      return res.status(callerPubkey ? 403 : 401).json({ error: 'Not authorized to view this cooperation' })
    }
    if (!callerPubkey) {
      // Anonymous read: strip applications/messages (applicant pubkeys,
      // motivations, negotiation chat) — discovery fields stay public.
      for (const m of cooperation.milestones) {
        ;(m as { applications?: unknown[] }).applications = []
        ;(m as { messages?: unknown[] }).messages = []
      }
    }
    // ADR-331 D1: JSON-decode per-step requiredCapabilities so the client
    // gets a real string[]. The column is nullable + JSON-encoded at write
    // time (see POST /api/cooperations); parseCooperation only handles
    // top-level JSON-string columns, so this is a per-milestone inline pass.
    parseCoopMilestoneRequiredCapabilities(cooperation.milestones as unknown as Array<Record<string, unknown>>)
    // ADR-386: owner-only full-edit gate; strip the engagement probes so only
    // the derived boolean ships to the client.
    const canFullEdit = isInitiator
      && cooperationCanFullEdit(cooperation as unknown as CooperationEngagementShape)
    const { _count, escrowTrade, ...rawCooperation } = cooperation
    void _count
    void escrowTrade
    res.json({ cooperation: { ...parseCooperation(rawCooperation), canFullEdit } })
  } catch (error) {
    console.error('Failed to fetch cooperation:', error)
    res.status(500).json({ error: 'Failed to fetch cooperation' })
  }
})

app.post('/api/cooperations/:id/accept', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const partnerPubkey = req.authPubkey!

    const cooperation = await prisma.cooperation.findUnique({ where: { id } })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }
    if (cooperation.status !== 'OPEN') {
      return res.status(409).json({ error: 'Cooperation is not open for acceptance' })
    }
    if (cooperation.initiatorPubkey === partnerPubkey) {
      return res.status(400).json({ error: 'Initiator cannot accept their own cooperation' })
    }
    if (cooperation.partnerPubkey && cooperation.partnerPubkey !== partnerPubkey) {
      return res.status(409).json({ error: 'Cooperation already has a partner' })
    }

    await prisma.user.upsert({
      where: { pubkey: partnerPubkey },
      update: {},
      // ADR-240 A4: never synthesize a black-hole Lightning address — a partner
      // account starts without one and sets a real rail (profile address, NWC,
      // Cashu or Alby) in Settings. Placeholders made the publish gate accept
      // unpayable listings (FU-754 class).
      create: { pubkey: partnerPubkey, lnAddress: null },
    })

    const updated = await prisma.cooperation.update({
      where: { id },
      data: { partnerPubkey, status: 'ACCEPTED' },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } } },
    })

    // Publish Kind 30414 (acceptance) via server ephemeral key
    nostrService.publishCooperationProposal({
      id: updated.id,
      type: 'acceptance',
      initiatorPubkey: updated.initiatorPubkey,
      partnerPubkey: updated.partnerPubkey || '',
      title: updated.title,
      budgetSats: updated.budgetSats,
      timeline: updated.timeline || undefined,
      status: 'ACCEPTED',
      cooperationType: updated.cooperationType || undefined,
      content: updated.description || undefined,
    }).catch(err => console.error('[Nostr] Failed to publish Kind 30414 (Acceptance):', err))

    // ADR-411: the partner accepted → the initiator must see it in the feed
    // (parity with PATCH /api/cooperations/:id/status).
    notifyCooperationStatusChange(prisma, {
      cooperationId: updated.id,
      fromStatus: 'PENDING',
      toStatus: 'ACCEPTED',
      initiatorPubkey: updated.initiatorPubkey,
      partnerPubkey: updated.partnerPubkey,
      actingPubkey: partnerPubkey,
      title: updated.title,
    }).catch(err => console.error('[notifications] coop accept notify failed:', err))

    const acceptanceTemplate: { kind: number; pubkey: string; created_at: number; tags: string[][]; content: string } = {
      kind: 30414,
      pubkey: partnerPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', updated.id],
        ['type', 'acceptance'],
        ['cooperation', updated.id],
        ['initiator', updated.initiatorPubkey],
        ['partner', partnerPubkey],
        ...(updated.cooperationType ? [['cooperation_type', updated.cooperationType]] : []),
        ['title', updated.title],
        ['budget', updated.budgetSats.toString(), 'sats'],
        ['status', 'ACCEPTED'],
        ['ticket_type', 'cooperation'],
      ],
      content: '',
    }

    res.json({
      success: true,
      cooperation: (() => {
        // ADR-331 D1: parse requiredCapabilities before serialization.
        parseCoopMilestoneRequiredCapabilities(updated.milestones as unknown as Array<Record<string, unknown>>)
        return parseCooperation(updated)
      })(),
      nostrEventTemplate: acceptanceTemplate,
    })
  } catch (error) {
    console.error('Failed to accept cooperation:', error)
    res.status(500).json({ error: 'Failed to accept cooperation' })
  }
})

app.post('/api/cooperations/:id/cancel', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const cooperation = await prisma.cooperation.findUnique({ where: { id } })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }
    if (cooperation.status === 'COMPLETED' || cooperation.status === 'CANCELLED') {
      return res.status(409).json({ error: 'Cannot cancel this cooperation' })
    }
    const updated = await prisma.cooperation.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } } },
    })
    // ADR-301: bust the discover-list cache so the cancelled cooperation disappears from the home slider immediately.
    await invalidateListCache('cooperations').catch(() => {/* swallow */})
    // ADR-411: cancellations must reach the counterparty's feed.
    notifyCooperationStatusChange(prisma, {
      cooperationId: updated.id,
      fromStatus: cooperation.status,
      toStatus: 'CANCELLED',
      initiatorPubkey: updated.initiatorPubkey,
      partnerPubkey: updated.partnerPubkey,
      actingPubkey: req.authPubkey!,
      title: updated.title,
    }).catch(err => console.error('[notifications] coop cancel notify failed:', err))
    // ADR-331 D1: parse requiredCapabilities before serialization.
    parseCoopMilestoneRequiredCapabilities(updated.milestones as unknown as Array<Record<string, unknown>>)
    res.json({ success: true, cooperation: parseCooperation(updated) })
  } catch (error) {
    console.error('Failed to cancel cooperation:', error)
    res.status(500).json({ error: 'Failed to cancel cooperation' })
  }
})

app.patch('/api/cooperations/:id', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const { title, description, budgetSats, timeline, skills, images, deadline, requirements, status, categoryCode, cooperationType, partnerMode, ticketType, companyId, visibility, disputeMode, milestones: milestonesInput } = req.body

    const existing = await prisma.cooperation.findUnique({ where: { id } })
    if (!existing) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }

    if (existing.initiatorPubkey !== req.authPubkey) {
      return res.status(403).json({ error: 'Only the initiator can update the cooperation' })
    }

    // ADR-386 D5/D6: the full-form edit payload (milestones / companyId /
    // visibility / disputeMode — fields the lightweight detail dialog never
    // sends) is only accepted while the cooperation is still unengaged. The
    // re-check runs here so a race (someone applied since the client read
    // `canFullEdit`) cannot slip a full edit past the gate.
    const isFullEditPayload = milestonesInput !== undefined
      || companyId !== undefined
      || visibility !== undefined
      || disputeMode !== undefined
    if (existing.status !== 'DRAFT' && isFullEditPayload) {
      const engagementProbe = await prisma.cooperation.findUnique({
        where: { id },
        include: {
          milestones: {
            include: {
              steps: true,
              _count: { select: { applications: true, messages: true } },
            },
          },
          _count: { select: { milestoneApplications: true, tickets: true, workspaces: true } },
          escrowTrade: { select: { id: true } },
        },
      })
      if (!engagementProbe || !cooperationCanFullEdit(engagementProbe as unknown as CooperationEngagementShape)) {
        return res.status(409).json({
          error: 'This cooperation already has activity and can no longer be edited through the full form',
          code: 'COOPERATION_ENGAGED',
        })
      }
    }

    // ADR-386 D6 (closes the PATCH half of FU-591): same validate-by-lookup as
    // POST — the client's companyId is accepted only for one of the caller's own
    // companies; an explicit falsy value clears the snapshot.
    let resolvedCompanyId: string | null | undefined
    if (companyId !== undefined) {
      if (companyId) {
        const company = await prisma.company.findUnique({ where: { id: companyId } })
        if (!company || company.ownerPubkey !== req.authPubkey) {
          return res.status(400).json({ error: 'companyId must reference your own company' })
        }
        resolvedCompanyId = companyId
      } else {
        resolvedCompanyId = null
      }
    }

    // ADR-386 D6: visibility/disputeMode are full-form fields — validated with
    // the same enums POST uses.
    let resolvedVisibility: ReturnType<typeof TradeVisibilitySchema.parse> | undefined
    if (visibility !== undefined) {
      const parsed = TradeVisibilitySchema.safeParse(visibility)
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid visibility', details: parsed.error.issues })
      }
      resolvedVisibility = parsed.data
    }
    let resolvedDisputeMode: ReturnType<typeof DisputeModeSchema.parse> | undefined
    if (disputeMode !== undefined) {
      const parsed = DisputeModeSchema.safeParse(disputeMode)
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid disputeMode', details: parsed.error.issues })
      }
      resolvedDisputeMode = parsed.data
    }

    // ADR-329 D4: payment structure — TicketType vocabulary, coop subset.
    // Metadata-only: a PATCH never creates or removes CoopMilestone rows —
    // only FU-504 below updates the amounts on the 3 canonical SMART_ORDER
    // rows that already exist, in place.
    if (ticketType !== undefined && ticketType !== 'SMART_ORDER' && ticketType !== 'MILESTONE') {
      return res.status(400).json({ error: 'Invalid ticketType', code: 'INVALID_TICKET_TYPE', details: 'ticketType must be SMART_ORDER or MILESTONE' })
    }

    // ADR-411: a `status` in the generic edit payload is a real status write —
    // validate it against the same transition map as the /status route
    // (previously any string was persisted unchecked and unannounced).
    if (status !== undefined && status !== existing.status) {
      const allowed = coopStatusTransitions()[existing.status] || []
      if (!allowed.includes(status)) {
        return res.status(409).json({
          error: `Cannot transition from ${existing.status} to ${status}`,
          code: 'INVALID_STATUS_TRANSITION',
        })
      }
    }

    // Category consistency: same slug validation as cooperation creation —
    // an explicit null clears the field, undefined skips it.
    const coopCategoryResolution = await resolveCategoryCode(prisma, categoryCode)
    if (!coopCategoryResolution.ok) {
      return res.status(400).json({ error: coopCategoryResolution.message, code: 'INVALID_CATEGORY_CODE' })
    }

    // FU-504 (ADR-329 reviewer P3): budgetSats funds escrow at the NEW amount,
    // but the 3 canonical CoopMilestone phases (Start/Progress/Completion)
    // were left at their original amounts — "phases sum == budgetSats" broke
    // silently. Recalculate in place while every phase is still PENDING
    // (nothing has been released yet); once any phase has moved on, reject
    // the budget change instead of rewriting money that's already in flight.
    const resolvedTicketType = ticketType ?? existing.ticketType
    // ADR-386 D6: a full-form SMART_ORDER replace regenerates the 3 phases
    // itself, so the FU-505 floor must be enforced here too (the FU-504 branch
    // below is suppressed when milestones arrive).
    if (resolvedTicketType === 'SMART_ORDER' && Array.isArray(milestonesInput) && milestonesInput.length > 0) {
      const resolvedBudgetForPhases = budgetSats !== undefined ? budgetSats : existing.budgetSats
      if (resolvedBudgetForPhases < 4) {
        return res.status(400).json({ error: 'Smart Order budget must be at least 4 sats so all three phases receive a non-zero amount', code: 'BUDGET_TOO_LOW_FOR_SMART_ORDER' })
      }
    }
    let smartOrderPhaseUpdate: { milestoneIndex: number; amountSats: number }[] | null = null
    if (budgetSats !== undefined && budgetSats !== existing.budgetSats && resolvedTicketType === 'SMART_ORDER'
      && !(Array.isArray(milestonesInput) && milestonesInput.length > 0)) {
      const phases = await prisma.coopMilestone.findMany({ where: { cooperationId: id }, orderBy: { milestoneIndex: 'asc' } })
      if (phases.length === 3) {
        if (phases.some(p => p.status !== 'PENDING')) {
          return res.status(400).json({
            error: 'Cannot change budget after a Smart Order phase has left PENDING',
            code: 'BUDGET_LOCKED_PHASE_IN_PROGRESS',
          })
        }
        if (budgetSats < 4) {
          return res.status(400).json({ error: 'Smart Order budget must be at least 4 sats so all three phases receive a non-zero amount', code: 'BUDGET_TOO_LOW_FOR_SMART_ORDER' })
        }
        const startSats = Math.round(budgetSats * 0.25)
        const progressSats = Math.round(budgetSats * 0.5)
        smartOrderPhaseUpdate = [
          { milestoneIndex: 1, amountSats: startSats },
          { milestoneIndex: 2, amountSats: progressSats },
          { milestoneIndex: 3, amountSats: budgetSats - startSats - progressSats },
        ]
      }
      // phases.length === 0 (a still-unpublished SMART_ORDER draft, FU-547
      // territory — no phases exist yet, nothing to recalculate here) falls
      // through untouched; any other count is not a canonical set this route
      // knows how to rebalance, so it's also left untouched rather than guessed at.
    }

    // ADR-376 D3: regenerate thumbnails whenever images change (same
    // conditional-await pattern as the Offer PATCH route, index.ts:1505).
    const patchImageThumbs = images !== undefined
      ? await makeThumbsFromImages(images)
      : undefined

    const updated = await prisma.$transaction(async (tx) => {
      const coop = await tx.cooperation.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(description !== undefined && { description }),
          ...(budgetSats !== undefined && { budgetSats }),
          ...(timeline !== undefined && { timeline }),
          ...(skills !== undefined && { skills: Array.isArray(skills) ? JSON.stringify(skills) : skills }),
          ...(images !== undefined && { images: Array.isArray(images) && images.length > 0 ? JSON.stringify(images) : null }),
          // Json? fields need Prisma.DbNull, not plain `null`, to clear the
          // column — unlike the String? `images` field right above.
          ...(images !== undefined && { imageThumbs: patchImageThumbs === null ? Prisma.DbNull : patchImageThumbs }),
          ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
          ...(requirements !== undefined && { requirements }),
          ...(coopCategoryResolution.categoryCode !== undefined && { categoryCode: coopCategoryResolution.categoryCode }),
          ...(cooperationType !== undefined && { cooperationType }),
          ...(partnerMode !== undefined && { partnerMode }),
          ...(status !== undefined && { status }),
          ...(ticketType !== undefined && { ticketType }),
          ...(companyId !== undefined && { companyId: resolvedCompanyId }),
          ...(resolvedVisibility !== undefined && { visibility: resolvedVisibility }),
          ...(resolvedDisputeMode !== undefined && { disputeMode: resolvedDisputeMode }),
        },
      })
      // ADR-386 D6 / closes FU-597: full-form milestone replace. Reachable only
      // for unengaged, non-agent cooperations (D5/D7), so no application /
      // message / step rows exist to preserve. `percentage` is converted from
      // the (possibly new) budget exactly like POST /api/cooperations.
      if (Array.isArray(milestonesInput) && milestonesInput.length > 0) {
        await tx.coopMilestone.deleteMany({ where: { cooperationId: id } })
        const resolvedBudget = budgetSats !== undefined ? budgetSats : existing.budgetSats
        await tx.coopMilestone.createMany({
          data: milestonesInput.map((m: { title: string; description?: string; amountSats?: number; percentage?: number; dueDate?: string }, i: number) => ({
            cooperationId: id,
            milestoneIndex: i + 1,
            title: m.title,
            description: m.description ?? null,
            amountSats: m.amountSats ?? (m.percentage != null ? Math.round(resolvedBudget * m.percentage / 100) : 0),
            dueDate: m.dueDate ? new Date(m.dueDate) : null,
            status: 'PENDING',
          })),
        })
      }
      if (smartOrderPhaseUpdate) {
        for (const phase of smartOrderPhaseUpdate) {
          await tx.coopMilestone.updateMany({
            where: { cooperationId: id, milestoneIndex: phase.milestoneIndex },
            data: { amountSats: phase.amountSats },
          })
        }
      }
      return tx.cooperation.findUniqueOrThrow({
        where: { id },
        include: { milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } } },
      })
    })

    // ADR-411: a status write through the generic edit route is announced and
    // notified exactly like PATCH /:id/status (initiator-only route, so the
    // non-acting party is the partner when present).
    if (status !== undefined && status !== existing.status) {
      nostrService.publishCooperationProposal({
        id: updated.id,
        type: 'status_update' as 'proposal',
        initiatorPubkey: updated.initiatorPubkey,
        partnerPubkey: updated.partnerPubkey || '',
        title: updated.title,
        budgetSats: updated.budgetSats,
        timeline: updated.timeline || undefined,
        status: updated.status,
        cooperationType: updated.cooperationType || undefined,
        content: updated.description || undefined,
      }).catch(err => console.error('[Nostr] Failed to publish Kind 30414 (StatusUpdate):', err))

      notifyCooperationStatusChange(prisma, {
        cooperationId: updated.id,
        fromStatus: existing.status,
        toStatus: updated.status,
        initiatorPubkey: updated.initiatorPubkey,
        partnerPubkey: updated.partnerPubkey,
        actingPubkey: req.authPubkey!,
        title: updated.title,
      }).catch(err => console.error('[notifications] coop edit-status notify failed:', err))
    }

    // ADR-301: bust the discover-list cache so edited cooperations show up on the home slider immediately.
    await invalidateListCache('cooperations').catch(() => {/* swallow */})
    // ADR-331 D1: parse requiredCapabilities before serialization.
    parseCoopMilestoneRequiredCapabilities(updated.milestones as unknown as Array<Record<string, unknown>>)
    res.json({ success: true, cooperation: parseCooperation(updated) })
  } catch (error) {
    console.error('Failed to update cooperation:', error)
    res.status(500).json({ error: 'Failed to update cooperation' })
  }
})

app.patch('/api/cooperations/:id/milestones/:mid', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id, mid } = req.params
    const { status, evidence, message } = req.body
    const callerPubkey = req.authPubkey!

    const VALID_MILESTONE_TRANSITIONS: Record<string, string[]> = {
      PENDING: ['IN_PROGRESS', 'DISPUTED'],
      IN_PROGRESS: ['COMPLETED', 'DISPUTED'],
      COMPLETED: ['ACCEPTED', 'DISPUTED', 'IN_PROGRESS'],
      ACCEPTED: [],
      DISPUTED: ['PENDING', 'COMPLETED'],
    }

    const milestone = await prisma.coopMilestone.findUnique({ where: { id: mid } })
    if (!milestone || milestone.cooperationId !== id) {
      return res.status(404).json({ error: 'Milestone not found' })
    }

    const cooperation = await prisma.cooperation.findUnique({ where: { id } })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }

    const validTargets = VALID_MILESTONE_TRANSITIONS[milestone.status] || []

    // Idempotent re-publish path: the webhook may already have set the milestone
    // to ACCEPTED when a release-payment was confirmed. The real app and the
    // simulator still want to call this endpoint to trigger the Kind 30415 event.
    // This must run before the transition check, otherwise ACCEPTED → ACCEPTED
    // would be rejected as an invalid transition.
    if (milestone.status === status && status === 'ACCEPTED') {
      const milestoneMessages = await prisma.coopMilestoneMessage.findMany({
        where: { milestoneId: mid },
        orderBy: { createdAt: 'asc' },
      })

      // ADR-157 Phase 3.4: address the milestone's own partner (PER_MILESTONE
      // multi-party), falling back to the global cooperation partner.
      const idemMilestonePartner = milestone.partnerPubkey || cooperation.partnerPubkey || ''

      nostrService.publishMilestoneEvent({
        id: milestone.id,
        cooperationId: id,
        milestoneIndex: milestone.milestoneIndex,
        initiatorPubkey: cooperation.initiatorPubkey,
        partnerPubkey: idemMilestonePartner,
        title: milestone.title,
        status: milestone.status,
        amountSats: milestone.amountSats,
        evidence: milestone.evidence || undefined,
        released: isCoopEscrowEnabled() || !!milestone.paidAt,
        visibility: cooperation.visibility,
      }).catch(err => console.error('[Nostr] Failed to publish Kind 30415 (MilestoneEvent):', err))

      const milestoneTemplate: { kind: number; pubkey: string; created_at: number; tags: string[][]; content: string } = {
        kind: 30415,
        pubkey: callerPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', `${id}-${milestone.milestoneIndex}`],
          ['cooperation', id],
          ['milestone', milestone.id],
          ['milestone_index', milestone.milestoneIndex.toString()],
          ['initiator', cooperation.initiatorPubkey],
          ...(idemMilestonePartner ? [['partner', idemMilestonePartner]] : []),
          ['title', milestone.title],
          ['status', milestone.status],
          ['amount', milestone.amountSats.toString(), 'sats'],
          ...(milestone.evidence ? [['evidence', milestone.evidence]] : []),
        ],
        content: '',
      }

      const allMilestones = await prisma.coopMilestone.findMany({ where: { cooperationId: id } })
      const allAccepted = allMilestones.every(m => m.status === 'ACCEPTED')

      return res.json({
        success: true,
        milestone,
        messages: milestoneMessages,
        nostrEventTemplate: milestoneTemplate,
        cooperationCompleted: allAccepted,
      })
    }

    if (!validTargets.includes(status)) {
      return res.status(400).json({ error: `Invalid milestone transition: ${milestone.status} → ${status}`, validTargets })
    }

    // ADR-352 D4 (closes FU-514): a milestone with nested pipeline steps only
    // becomes confirmable once every one of its steps has been marked
    // COMPLETED via POST /api/workspaces/:id/steps/:stepId/complete. Simplest,
    // least-surprising default (no partial/majority rule). Milestones with no
    // steps (ordinary human-MILESTONE cooperations) are unaffected.
    if (status === 'COMPLETED') {
      const steps = await prisma.coopMilestoneStep.findMany({ where: { milestoneId: mid }, select: { status: true } })
      if (steps.length > 0 && steps.some(s => s.status !== 'COMPLETED')) {
        return res.status(409).json({ error: 'All pipeline steps must be COMPLETED before the milestone can be marked COMPLETED', code: 'STEPS_INCOMPLETE' })
      }
    }

    if (callerPubkey) {
      const isInitiator = callerPubkey === cooperation.initiatorPubkey
      const isPartner = callerPubkey === cooperation.partnerPubkey || callerPubkey === milestone.partnerPubkey
      if (status === 'IN_PROGRESS' && milestone.status === 'COMPLETED' && isInitiator) {
        // Initiator declining completed work — allowed
      } else if (['IN_PROGRESS', 'COMPLETED'].includes(status) && !isPartner) {
        return res.status(403).json({ error: 'Only the partner can update milestone work status' })
      }
      if (status === 'ACCEPTED' && !isInitiator) {
        return res.status(403).json({ error: 'Only the initiator can approve and release milestone payment' })
      }
    }

    const actionMap: Record<string, string> = {
      IN_PROGRESS: milestone.status === 'COMPLETED' ? 'DECLINED' : 'STARTED',
      COMPLETED: 'COMPLETED',
      ACCEPTED: 'APPROVED',
      DISPUTED: 'DISPUTED',
    }

    const updated = await prisma.coopMilestone.update({
      where: { id: mid },
      data: {
        status: status as any,
        evidence: evidence || undefined,
        completedAt: status === 'COMPLETED' ? new Date() : (status === 'IN_PROGRESS' && milestone.status === 'COMPLETED' ? null : undefined),
      },
    })

    if (message || status) {
      await prisma.coopMilestoneMessage.create({
        data: {
          milestoneId: mid,
          authorPubkey: callerPubkey || cooperation.initiatorPubkey,
          action: actionMap[status] || status,
          message: message || undefined,
        },
      })
    }

    const milestoneMessages = await prisma.coopMilestoneMessage.findMany({
      where: { milestoneId: mid },
      orderBy: { createdAt: 'asc' },
    })

    // ADR-157 Phase 3.4: address the milestone's own partner (PER_MILESTONE
    // multi-party), falling back to the global cooperation partner.
    const milestonePartner = updated.partnerPubkey || cooperation.partnerPubkey || ''

    // Publish Kind 30415 via server ephemeral key
    nostrService.publishMilestoneEvent({
      id: updated.id,
      cooperationId: id,
      milestoneIndex: updated.milestoneIndex,
      initiatorPubkey: cooperation.initiatorPubkey,
      partnerPubkey: milestonePartner,
      title: updated.title,
      status: updated.status,
      amountSats: updated.amountSats,
      evidence: updated.evidence || undefined,
      // Escrow: approval IS the release. Direct-pay: only once the partner was
      // actually paid (paidAt), so relays never announce an unpaid release.
      released: status === 'ACCEPTED' && (isCoopEscrowEnabled() || !!updated.paidAt),
      visibility: cooperation.visibility,
    }).catch(err => console.error('[Nostr] Failed to publish Kind 30415 (MilestoneEvent):', err))

    // ADR-204: publish Kind 30408 for the cooperation ticket on milestone transitions.
    // FU-204-C: clients subscribe to Kind 30408 with ticket_type=cooperation.
    const coopTicket = await prisma.ticket.findUnique({ where: { cooperationId: id } })
    if (coopTicket) {
      const ticketStatus = status === 'ACCEPTED' ? 'IN_PROGRESS'
        : status === 'COMPLETED' ? 'IN_PROGRESS'
        : status === 'DISPUTED' ? 'DISPUTED'
        : status === 'IN_PROGRESS' ? 'IN_PROGRESS'
        : coopTicket.status
      const updatedTicket = await prisma.ticket.update({
        where: { id: coopTicket.id },
        data: { status: ticketStatus },
      })
      nostrService.publishTicketStatus({
        id: updatedTicket.id,
        cooperationId: id,
        status: ticketStatus,
        buyerPubkey: updatedTicket.buyerPubkey,
        sellerPubkey: updatedTicket.sellerPubkey,
        escrowStatus: updatedTicket.escrowStatus ?? undefined,
        visibility: updatedTicket.visibility === 'PRIVATE' ? 1 : 0,
      }).catch(err => console.error('[Nostr] Failed to publish Kind 30408 (CoopTicket milestone transition):', err))
    }

    // Build milestone template for client NIP-07 signing
    const milestoneTemplate: { kind: number; pubkey: string; created_at: number; tags: string[][]; content: string } = {
      kind: 30415,
      pubkey: callerPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', `${id}-${updated.milestoneIndex}`],
        ['cooperation', id],
        ['milestone', updated.id],
        ['milestone_index', updated.milestoneIndex.toString()],
        ['initiator', cooperation.initiatorPubkey],
        ...(milestonePartner ? [['partner', milestonePartner]] : []),
        ['title', updated.title],
        ['status', updated.status],
        ['amount', updated.amountSats.toString(), 'sats'],
        ...(updated.evidence ? [['evidence', updated.evidence]] : []),
      ],
      content: '',
    }

    // Auto-update cooperation status if all milestones ACCEPTED
    const allMilestones = await prisma.coopMilestone.findMany({ where: { cooperationId: id } })
    const allAccepted = allMilestones.every(m => m.status === 'ACCEPTED')
    if (allAccepted) {
      await prisma.cooperation.update({ where: { id }, data: { status: 'COMPLETED' } })
    }

    res.json({
      success: true,
      milestone: updated,
      messages: milestoneMessages,
      nostrEventTemplate: milestoneTemplate,
      cooperationCompleted: allAccepted,
    })
  } catch (error) {
    console.error('Failed to update milestone:', error)
    res.status(500).json({ error: 'Failed to update milestone' })
  }
})

app.post('/api/cooperations/:id/milestones/:mid/apply', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id, mid } = req.params
    const { message } = req.body
    const applicantPubkey = req.authPubkey!

    const cooperation = await prisma.cooperation.findUnique({ where: { id } })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }
    if (cooperation.status !== 'OPEN') {
      return res.status(409).json({ error: 'Cooperation is not open for applications' })
    }
    if (cooperation.cooperationType !== 'TENDER' && cooperation.partnerMode !== 'PER_MILESTONE') {
      return res.status(400).json({ error: 'Applications are only available for tender or per-milestone cooperations' })
    }

    const milestone = await prisma.coopMilestone.findUnique({ where: { id: mid } })
    if (!milestone || milestone.cooperationId !== id) {
      return res.status(404).json({ error: 'Milestone not found' })
    }

    await prisma.user.upsert({ where: { pubkey: applicantPubkey }, update: {}, create: { pubkey: applicantPubkey } })

    const application = await prisma.coopMilestoneApplication.create({
      data: {
        cooperationId: id,
        milestoneId: mid,
        applicantPubkey,
        message: message || null,
      },
    })

    res.json({ success: true, application })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Application already exists for this milestone' })
    }
    console.error('Failed to apply for milestone:', error)
    res.status(500).json({ error: 'Failed to apply for milestone' })
  }
})

// GET /api/cooperations/:id/milestones/:mid/applications — initiator or per-milestone partner only (ADR-212 P2).
// Applications expose applicant pubkeys; without auth an attacker can list all applicants for any open tender.
app.get('/api/cooperations/:id/milestones/:mid/applications', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id, mid } = req.params

    const cooperation = await prisma.cooperation.findUnique({ where: { id } })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }
    if (req.authPubkey !== cooperation.initiatorPubkey) {
      return res.status(403).json({ error: 'Only the initiator may list applications' })
    }

    const applications = await prisma.coopMilestoneApplication.findMany({
      where: { cooperationId: id, milestoneId: mid },
      orderBy: { createdAt: 'desc' },
    })

    res.json({ applications })
  } catch (error) {
    console.error('Failed to fetch milestone applications:', error)
    res.status(500).json({ error: 'Failed to fetch milestone applications' })
  }
})

// ADR-212 P0: only the cooperation's initiator may accept an application.
app.post('/api/cooperations/:id/milestones/:mid/applications/:appId/accept', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id, mid, appId } = req.params

    const cooperation = await prisma.cooperation.findUnique({ where: { id } })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }
    // ADR-212 P0: ownership check — only the initiator may accept an application.
    if (req.authPubkey !== cooperation.initiatorPubkey) {
      return res.status(403).json({ error: 'Only the initiator may accept applications' })
    }
    if (cooperation.status !== 'OPEN') {
      return res.status(409).json({ error: 'Cooperation is not open' })
    }

    const application = await prisma.coopMilestoneApplication.findUnique({ where: { id: appId } })
    if (!application || application.cooperationId !== id || application.milestoneId !== mid) {
      return res.status(404).json({ error: 'Application not found' })
    }
    if (application.status !== 'PENDING') {
      return res.status(409).json({ error: 'Application is not pending' })
    }

    await prisma.$transaction([
      prisma.coopMilestoneApplication.update({
        where: { id: appId },
        data: { status: 'ACCEPTED' },
      }),
      prisma.coopMilestone.update({
        where: { id: mid },
        data: { partnerPubkey: application.applicantPubkey },
      }),
      prisma.coopMilestoneApplication.updateMany({
        where: {
          cooperationId: id,
          milestoneId: mid,
          id: { not: appId },
        },
        data: { status: 'DECLINED' },
      }),
    ])

    const allMilestones = await prisma.coopMilestone.findMany({ where: { cooperationId: id } })
    const allHavePartners = allMilestones.every(m => m.partnerPubkey !== null)
    if (allHavePartners) {
      await prisma.cooperation.update({ where: { id }, data: { status: 'ACCEPTED' } })
    }

    const updatedCooperation = await prisma.cooperation.findUnique({
      where: { id },
      include: { milestones: { orderBy: { milestoneIndex: 'asc' }, include: { steps: { orderBy: { stepIndex: 'asc' } } } } },
    })

    // ADR-331 D1: parse requiredCapabilities before serialization.
    if (updatedCooperation) {
      parseCoopMilestoneRequiredCapabilities(updatedCooperation.milestones as unknown as Array<Record<string, unknown>>)
    }
    res.json({ success: true, cooperation: updatedCooperation ? parseCooperation(updatedCooperation) : null })
  } catch (error) {
    console.error('Failed to accept application:', error)
    res.status(500).json({ error: 'Failed to accept application' })
  }
})

// ADR-212 P0: only the cooperation's initiator may decline an application.
// Loads the parent cooperation to authorize before mutating the application row.
app.post('/api/cooperations/:id/milestones/:mid/applications/:appId/decline', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id, mid, appId } = req.params

    const cooperation = await prisma.cooperation.findUnique({ where: { id } })
    if (!cooperation) {
      return res.status(404).json({ error: 'Cooperation not found' })
    }
    // ADR-212 P0: ownership check.
    if (req.authPubkey !== cooperation.initiatorPubkey) {
      return res.status(403).json({ error: 'Only the initiator may decline applications' })
    }

    const application = await prisma.coopMilestoneApplication.findUnique({ where: { id: appId } })
    if (!application || application.cooperationId !== id || application.milestoneId !== mid) {
      return res.status(404).json({ error: 'Application not found' })
    }
    if (application.status !== 'PENDING') {
      return res.status(409).json({ error: 'Application is not pending' })
    }

    await prisma.coopMilestoneApplication.update({
      where: { id: appId },
      data: { status: 'DECLINED' },
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Failed to decline application:', error)
    res.status(500).json({ error: 'Failed to decline application' })
  }
})

// ─── Milestone create endpoint ────────────────────────────────────────────────
// ADR-411: these legacy routes were unauthenticated — anyone could create
// milestones on any ticket and PATCH a ticket to COMPLETED (+ COL points).
// Party-gated now (buyer/seller of the parent ticket only).
app.post('/api/milestones', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId, title, description, amountSats } = req.body
    if (!ticketId || !title) {
      return res.status(400).json({ error: 'Missing required fields', code: 'BAD_REQUEST' })
    }
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { buyerPubkey: true, sellerPubkey: true } })
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found', code: 'NOT_FOUND' })
    }
    if (ticket.buyerPubkey !== req.authPubkey && ticket.sellerPubkey !== req.authPubkey) {
      return res.status(403).json({ error: 'Only the ticket parties may manage milestones', code: 'FORBIDDEN' })
    }
    const milestone = await prisma.milestone.create({
      data: { ticketId, title, description, amountSats },
    })
    res.json({ success: true, milestone })
  } catch (error) {
    console.error('Failed to create milestone:', error)
    res.status(500).json({ error: 'Failed to create milestone', code: 'INTERNAL' })
  }
})

// Milestone update endpoint
app.patch('/api/milestones/:id', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params
    const { status } = req.body as { status: string }

    const milestone = await prisma.milestone.findUnique({ where: { id }, include: { ticket: { select: { buyerPubkey: true, sellerPubkey: true } } } })
    if (!milestone) {
      return res.status(404).json({ error: 'Milestone not found', code: 'NOT_FOUND' })
    }
    if (milestone.ticket.buyerPubkey !== req.authPubkey && milestone.ticket.sellerPubkey !== req.authPubkey) {
      return res.status(403).json({ error: 'Only the ticket parties may manage milestones', code: 'FORBIDDEN' })
    }

    const updated = await prisma.milestone.update({
      where: { id },
      data: { status: status as any, completedAt: status === 'COMPLETED' ? new Date() : undefined },
    })

    // If all milestones completed → auto-complete the ticket
    const allMilestones = await prisma.milestone.findMany({ where: { ticketId: milestone.ticketId } })
    const allDone = allMilestones.every(m => (m.id === id ? status === 'COMPLETED' : m.status === 'COMPLETED'))
    if (allDone) {
      await prisma.ticket.update({ where: { id: milestone.ticketId }, data: { status: 'COMPLETED' } })
      await colPointsService.awardPoints(milestone.ticket.sellerPubkey, 10, 'TICKET_COMPLETED_SELLER', milestone.ticketId)
      await colPointsService.awardPoints(milestone.ticket.buyerPubkey, 5, 'TICKET_COMPLETED_BUYER', milestone.ticketId)
    }

    res.json({ success: true, milestone: updated, ticketCompleted: allDone })
  } catch (error) {
    console.error('Failed to update milestone:', error)
    res.status(500).json({ error: 'Failed to update milestone' })
  }
})

// =============================================================================
// User Profile API (Public Profile Page)
// =============================================================================

app.get('/api/user/:pubkey/profile', async (req, res) => {
  try {
    const { pubkey } = req.params
    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: {
        pubkey: true,
        lnAddress: true,
        identityLevel: true,
        colPoints: true,
        profileVisibility: true,
        walletModeStrategy: true,
        picture: true,
        name: true,
        about: true,
        banner: true,
        nip05: true,
      },
    })

    if (!user) {
      return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
    }

    const visibility = user.profileVisibility || 'PUBLIC'

    if (visibility === 'PRIVATE') {
      return res.json({
        pubkey: user.pubkey,
        identityLevel: user.identityLevel,
        visibility: 'PRIVATE',
      })
    }

    // Nostr Kind 0 display metadata is identity-revealing: full access only
    // for PUBLIC profiles. PSEUDO_PRIVATE keeps stats/reviews but hides the
    // person behind them (same policy as name/company).
    const showProfileMeta = visibility === 'PUBLIC'

    const reviewCount = await prisma.review.count({ where: { revieweePubkey: pubkey } })
    const reputationInput = await fetchReputationInput(pubkey, prisma)
    const reputationScore = computeReputationScore(reputationInput)

    const [offersCreated, completedAsBuyer, completedAsSeller, acceptedTickets] = await Promise.all([
      prisma.offer.count({ where: { creatorPubkey: pubkey } }),
      prisma.ticket.count({ where: { buyerPubkey: pubkey, status: 'COMPLETED' } }),
      prisma.ticket.count({ where: { sellerPubkey: pubkey, status: 'COMPLETED' } }),
      prisma.ticket.count({ where: { OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }], status: { in: ['COMPLETED', 'ACCEPTED', 'PAID', 'IN_PROGRESS'] } } }),
    ])

    const completedTickets = completedAsBuyer + completedAsSeller
    const completionRate = acceptedTickets > 0 ? Math.round((completedTickets / acceptedTickets) * 100) : null

    let company: { id: string; name: string; logoUrl: string | null; city: string | null } | null = null
    if (visibility === 'PUBLIC') {
      const companyRecord = await prisma.company.findFirst({
        where: { ownerPubkey: pubkey, isActive: true },
        select: { id: true, name: true, logoUrl: true, city: true },
      })
      company = companyRecord
    }

    return res.json({
      pubkey: user.pubkey,
      lnAddress: visibility === 'PUBLIC' ? user.lnAddress : null,
      identityLevel: user.identityLevel,
      colPoints: user.colPoints,
      picture: showProfileMeta ? user.picture : null,
      name: showProfileMeta ? user.name : null,
      about: showProfileMeta ? user.about : null,
      banner: showProfileMeta ? user.banner : null,
      nip05: showProfileMeta ? user.nip05 : null,
      reputationScore,
      reviewCount,
      stats: {
        offersCreated,
        completedTickets,
        completionRate,
        completedAsBuyer,
        completedAsSeller,
      },
      company,
      visibility,
      walletModeStrategy: user.walletModeStrategy,
    })
  } catch (error) {
    console.error('Failed to fetch user profile:', error)
    res.status(500).json({ error: 'Failed to fetch user profile' })
  }
})

// ── Remote Offer Candidates (ADR-139 Phase 5) ───────────────────────────
app.use('/api/admin/remote-candidates', createRemoteCandidateRouter(prisma))

// ── Agent Profile Verification (ADR-315 D3) ─────────────────────────────
app.use('/api/admin/agent-profiles', createAdminAgentProfilesRouter(prisma))

// ── GDPR Account Deletion (admin-triggered, ADR-156) ─────────────────────
// Self-service path: POST /api/gdpr/delete-account (see routes/gdpr.ts).
// This admin path is for hard cases (regulator request, support) and uses
// NIP-98 admin auth (requireAdmin) like /api/tickets/wipe.
app.post('/api/admin/gdpr/delete-user', requireAdmin(prisma), async (req, res) => {
  try {
    const adminPubkey = (req as AuthenticatedRequest & { adminPubkey?: string }).adminPubkey!
    const { userPubkey, legalBasis } = req.body as { userPubkey?: string; legalBasis?: string }
    if (!userPubkey || !/^[0-9a-fA-F]{64}$/.test(userPubkey)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'userPubkey (64-char hex) required' })
    }
    const result = await deleteUserAccount(prisma, userPubkey, {
      trigger: 'ADMIN',
      adminPubkey,
    })
    // Also record an AdminAuditLog entry (existing audit model).
    await prisma.adminAuditLog.create({
      data: {
        adminPubkey,
        action: 'GDPR_DELETE_USER',
        targetId: userPubkey,
        payload: JSON.stringify({ deletionId: result.deletionId, legalBasis: legalBasis ?? 'admin-triggered', counts: result.counts }),
      },
    }).catch(e => console.error('[admin/gdpr] AdminAuditLog write failed:', e))
    res.json(result)
  } catch (err) {
    if (err instanceof DeletionBlockedError) {
      return res.status(409).json({ error: 'DELETION_BLOCKED', blockers: err.blockers, message: err.message })
    }
    console.error('[admin/gdpr/delete-user] Error:', err)
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Deletion failed' })
  }
})

app.patch('/api/user/:pubkey/wallet-strategy', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { pubkey } = req.params
    const { walletModeStrategy } = req.body as { walletModeStrategy?: string }

    if (req.authPubkey !== pubkey) {
      return res.status(403).json({ error: 'You can only change your own wallet-mode strategy' })
    }
    if (!isWalletModeStrategy(walletModeStrategy)) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `walletModeStrategy must be one of: ${WALLET_MODE_STRATEGIES.join(', ')}`,
      })
    }

    // ADR-253: a real production host is Direct-Pay only — there is no
    // custodial wallet/sub-wallet to route private trades through, so the
    // custodial strategies are not selectable there.
    const directPayOnly = isProductionDirectPayOnly()
    if (directPayOnly && walletModeStrategy !== 'NONCUSTODIAL_ONLY') {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'This deployment is Direct-Pay only (ADR-253) — only NONCUSTODIAL_ONLY is available.',
      })
    }

    const user = await prisma.user.update({
      where: { pubkey },
      data: { walletModeStrategy },
      select: { pubkey: true, walletModeStrategy: true },
    })
    const explanations = getStrategyExplanations(directPayOnly)
    res.json({
      success: true,
      walletModeStrategy: user.walletModeStrategy,
      explanation: explanations.find(e => e.strategy === user.walletModeStrategy) ?? explanations[0],
    })
  } catch (error) {
    console.error('[wallet-strategy] Error:', error)
    res.status(500).json({ error: 'Failed to update wallet-mode strategy' })
  }
})

app.get('/api/user/:pubkey/wallet-strategy', async (req, res) => {
  // Returns the effective strategy + the explanations for the settings radio
  // group. On a Direct-Pay-only host (ADR-253) the list holds the single
  // non-custodial option and a stored custodial strategy is normalised away.
  // No auth gate: the explanations are static; the user's own strategy is
  // already exposed via /profile. (Mirrors the visibility route pattern.)
  try {
    const { pubkey } = req.params
    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: { walletModeStrategy: true },
    })
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
    const directPayOnly = isProductionDirectPayOnly()
    res.json({
      walletModeStrategy: getEffectiveStrategy(user.walletModeStrategy, directPayOnly),
      explanations: getStrategyExplanations(directPayOnly),
    })
  } catch (error) {
    console.error('[wallet-strategy GET] Error:', error)
    res.status(500).json({ error: 'Failed to fetch wallet-mode strategy' })
  }
})

// ── ADR-235: account-level fiat display preference ────────────────────────
// Mirrors the per-preference pattern (wallet-strategy / categories / visibility).
// Sats stay the single source of truth; this column only selects which fiat
// currency is shown next to sats amounts. Derived from the rate service so the
// two server-side lists cannot drift; keep the pair in sync with the client
// registry `apps/colabonate-app/src/config/currencies.ts`.
const SUPPORTED_FIAT_CURRENCIES: readonly string[] =
  SUPPORTED_RATE_CURRENCIES.map(c => c.toUpperCase())

app.get('/api/user/:pubkey/currency', async (req, res) => {
  // Public read (mirrors wallet-strategy GET, which is also unauthenticated):
  // lets a freshly-logged-in device hydrate its local pref before other data
  // loads. Not part of the /profile response — this endpoint is the only read.
  try {
    const { pubkey } = req.params
    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: { preferredFiatCurrency: true },
    })
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
    res.json({ preferredFiatCurrency: user.preferredFiatCurrency })
  } catch (error) {
    console.error('[user currency GET] Error:', error)
    res.status(500).json({ error: 'Failed to fetch user currency preference' })
  }
})

app.patch('/api/user/:pubkey/currency', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { pubkey } = req.params
    const { preferredFiatCurrency } = req.body as { preferredFiatCurrency?: string }

    if (req.authPubkey !== pubkey) {
      return res.status(403).json({ error: 'You can only change your own currency preference' })
    }
    if (
      typeof preferredFiatCurrency !== 'string' ||
      !SUPPORTED_FIAT_CURRENCIES.includes(preferredFiatCurrency)
    ) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `preferredFiatCurrency must be one of: ${SUPPORTED_FIAT_CURRENCIES.join(', ')}`,
      })
    }

    const user = await prisma.user.update({
      where: { pubkey },
      data: { preferredFiatCurrency },
      select: { pubkey: true, preferredFiatCurrency: true },
    })
    res.json({ success: true, preferredFiatCurrency: user.preferredFiatCurrency })
  } catch (error) {
    console.error('[user currency PATCH] Error:', error)
    res.status(500).json({ error: 'Failed to update user currency preference' })
  }
})

app.get('/api/exchange-rates', async (_req, res) => {
  // Public, cacheable proxy for BTC↔fiat rates (ADR-235 D3). Hides CoinGecko
  // behind the server and serves a stale value on short upstream outages.
  try {
    const result = await getExchangeRates()
    res.set('Cache-Control', 'public, max-age=30')
    res.json(result)
  } catch (error) {
    console.error('[exchange-rates GET] Error:', error)
    res.status(503).json({ error: 'RATES_UNAVAILABLE', message: 'Exchange rates temporarily unavailable' })
  }
})

// ADR-342 Phase B follow-up: public, non-secret capability flag. The wizard
// labels the hosted canvas by it; the publish gate (400 CANVAS_HOSTED_
// UNAVAILABLE) stays the actual enforcement — this only fixes the UI copy.
app.get('/api/canvas/hosted-status', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ available: isCanvasHostedConfigured() })
})

app.get('/api/user/:pubkey/categories', async (req, res) => {
  try {
    const { pubkey } = req.params
    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: { categoryCodes: true },
    })
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'User not found' })
    res.json({ categoryCodes: user.categoryCodes })
  } catch (error) {
    console.error('[user categories GET] Error:', error)
    res.status(500).json({ error: 'Failed to fetch user categories' })
  }
})

app.patch('/api/user/:pubkey/categories', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { pubkey } = req.params
    const { categoryCodes } = req.body as { categoryCodes?: unknown }

    if (req.authPubkey !== pubkey) {
      return res.status(403).json({ error: 'You can only change your own categories' })
    }
    if (!Array.isArray(categoryCodes) || categoryCodes.some(c => typeof c !== 'string') || categoryCodes.length > 20) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'categoryCodes must be a string array (max 20 entries)' })
    }

    const user = await prisma.user.update({
      where: { pubkey },
      data: { categoryCodes },
      select: { pubkey: true, categoryCodes: true },
    })

    res.json({ success: true, categoryCodes: user.categoryCodes })
  } catch (error) {
    console.error('[user categories PATCH] Error:', error)
    res.status(500).json({ error: 'Failed to update user categories' })
  }
})

app.patch('/api/user/:pubkey/visibility', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
  try {
    const { pubkey } = req.params
    const { profileVisibility } = req.body

    if (req.authPubkey !== pubkey) {
      return res.status(403).json({ error: 'You can only change your own profile visibility' })
    }

    if (!['PUBLIC', 'PSEUDO_PRIVATE', 'PRIVATE'].includes(profileVisibility)) {
      return res.status(400).json({ error: 'Invalid visibility value. Must be PUBLIC, PSEUDO_PRIVATE, or PRIVATE' })
    }

    const before = await prisma.user.findUnique({
      where: { pubkey },
      select: { profileVisibility: true },
    })

    const user = await prisma.user.update({
      where: { pubkey },
      data: { profileVisibility },
      select: { pubkey: true, profileVisibility: true },
    })

    // ADR-159 §D3: keep the global search index in sync with profile visibility
    // (purge on PRIVATE, re-index when becoming public again).
    await syncCreatorOfferIndex(prisma, pubkey, before?.profileVisibility ?? 'PUBLIC', user.profileVisibility)

    res.json({ success: true, profileVisibility: user.profileVisibility })
  } catch (error) {
    console.error('Failed to update profile visibility:', error)
    res.status(500).json({ error: 'Failed to update profile visibility' })
  }
})

// ADR-253 / Product-Launch Sub-Plan 01 §1.3 — hard boot guard, checked BEFORE
// app.listen(): a real production host (not the declared beta deployment)
// must never have either custodial escrow flag on. Unlike the soft warning
// canaries further below (which run inside the listen callback, after the
// port is already bound and accepting connections — too late for a
// fail-loud gate), this matches the three existing synchronous production
// guards in this file / packages/payments (LNBits keys, LND creds, webhook
// secret): refuse before the port ever opens, instead of silently exposing
// custodial money-movement code with no non-custodial replacement wired in.
const escrowGuardViolation = checkProductionEscrowGuard({
  nodeEnv: process.env.NODE_ENV,
  isBetaMode: isBetaMode(),
  escrowEnabled: isEscrowEnabled(),
  coopEscrowEnabled: isCoopEscrowEnabled(),
})
if (escrowGuardViolation) {
  console.error(`[boot] FATAL: ${escrowGuardViolation.message}`)
  process.exit(1)
}

const httpServer = app.listen(Number(PORT), '0.0.0.0', () => {
  initOpenTelemetry().catch(e => console.error('[Observability] OTel init failed:', e))
  console.log(`Server running on ${BASE_URL}`)
  console.log(`LNURL Auth endpoint: ${BASE_URL}/api/auth/lnurl`)
  console.log(`Nostr API: ${BASE_URL}/api/nostr`)

  // ADR-227 D5 — boot canary. Grep-able in `docker logs PROD_HOST_REDACTEDuction-server-1`
  // and documented in docs/PRODUCTION-SERVER.md. Logged as `[boot] …` to match
  // the existing email-transport canary at index.ts:9-18.
  if (process.env.METRICS_ENABLED === 'true') {
    const scrapeUrl = process.env.VM_SCRAPE_URL ?? `http://server:${process.env.APP_PORT ?? '4001'}/metrics`
    console.log(`[boot] Observability: /metrics endpoint enabled, VictoriaMetrics scrape target = ${scrapeUrl}`)
  } else {
    console.warn('[boot] Observability: METRICS_ENABLED is not "true" — VictoriaMetrics scrape will 404. Set METRICS_ENABLED=true in .env.production (ADR-227).')
  }

  // ADR-252 D2 — boot canary. Loud on purpose: a forgotten PAYMENTS_PAUSED=true
  // surviving a restart would silently block every new ticket/escrow/fund-escrow
  // request while looking like a healthy boot otherwise.
  if (process.env.PAYMENTS_PAUSED === 'true' || process.env.PAYMENTS_PAUSED === '1') {
    console.warn(`[boot] PAYMENTS KILL SWITCH ACTIVE — new tickets/escrow/fund-escrow are blocked (reason: ${process.env.PAYMENTS_PAUSED_REASON || 'not set'}). Unset PAYMENTS_PAUSED to resume.`)
  }

  // ADR-252 D2 / FU-655 — boot canary for the launch-phase transaction cap.
  // Loud when disabled: LAUNCH_MAX_TX_SATS=0 must never survive into a
  // production restart unnoticed.
  const launchCap = resolveLaunchMaxTxSats()
  if (launchCap === null) {
    console.warn('[boot] LAUNCH TX CAP DISABLED (LAUNCH_MAX_TX_SATS=0) — no per-transaction sats limit is enforced. Never run production this way (ADR-252 D2).')
  } else {
    console.log(`[boot] Launch tx cap: ${launchCap} sats per transaction (LAUNCH_MAX_TX_SATS, default ${launchCap === DEFAULT_LAUNCH_MAX_TX_SATS ? 'applies' : 'overridden'})`)
  }

  // ADR-252 D7 / FU-252-A — boot canary. CRITICAL logs (settle-then-DB-crash
  // races in dispute/escrow/appeal-finalizer/escrow-timeout) are only useful
  // if someone is actually watching for them.
  if (process.env.RESEND_API_KEY && process.env.CRITICAL_ALERT_EMAIL) {
    console.log(`[boot] CRITICAL-log alerting: enabled → ${process.env.CRITICAL_ALERT_EMAIL}`)
  } else {
    console.warn('[boot] CRITICAL-log alerting: NOT configured — set RESEND_API_KEY + CRITICAL_ALERT_EMAIL, otherwise money-safety CRITICAL logs are console-only (ADR-252 D7).')
  }

  // ADR-228 D7 — boot canary. Never logs ciphertext or last-4; counts only.
  if (hasAlbyTokenKey()) {
    prisma.albyOauthToken.findMany({ select: { encryptedRefresh: true, expiresAt: true } })
      .then(rows => {
        const rowsWithRefresh = rows.filter(r => r.encryptedRefresh !== null).length
        const rowsWithMissingExpires = rows.filter(r => r.expiresAt === null).length
        console.log(`[boot] alby:    crypto=ok tokenRows=${rows.length} rowsWithRefresh=${rowsWithRefresh} rowsWithMissingExpires=${rowsWithMissingExpires}`)
      })
      .catch(err => console.error('[boot] alby:    crypto=ok tokenRows=? (DB query failed)', err instanceof Error ? err.message : err))
  } else {
    console.warn('[boot] alby:    crypto=MISSING — ALBY_TOKEN_ENCRYPTION_KEY is not set. Alby OAuth wallet features will fail closed (ADR-228 D3).')
  }

  // FU-330 — boot canary for the Alby OAuth *client* configuration. Distinct
  // from the token-encryption-key check above: the crypto key can be present
  // while ALBY_CLIENT_ID / ALBY_REDIRECT_URI are missing (the exact gap that
  // produces /login/alby/error?code=SERVER_ERROR — the initiate handler in
  // auth-alby.ts bails immediately when either is unset).
  // Never logs ALBY_CLIENT_SECRET or token ciphertext; client_id shown as
  // last-4 only, matching the canary format in PRODUCTION-SERVER.md §Secrets.
  if (process.env.ALBY_CLIENT_ID && process.env.ALBY_REDIRECT_URI) {
    const id = process.env.ALBY_CLIENT_ID
    const masked = id.length >= 4 ? `…${id.slice(-4)}` : '****'
    console.log(`[boot] alby:    oauth=ok client_id=${masked} redirect_uri=${process.env.ALBY_REDIRECT_URI}`)
  } else {
    const missing: string[] = []
    if (!process.env.ALBY_CLIENT_ID) missing.push('ALBY_CLIENT_ID')
    if (!process.env.ALBY_CLIENT_SECRET) missing.push('ALBY_CLIENT_SECRET')
    if (!process.env.ALBY_REDIRECT_URI) missing.push('ALBY_REDIRECT_URI')
    console.warn(`[boot] alby:    oauth=MISSING — ${missing.join(', ')} unset in .env.production. /api/auth/alby will return SERVER_ERROR (auth-alby.ts). Set them per PRODUCTION-SERVER.md §Secrets (FU-330).`)
  }

  // ADR-235 D3 — boot canary for the exchange-rate proxy. Warm the cache
  // best-effort and log the result so operators see whether the public
  // `/api/exchange-rates` endpoint will answer fresh or fall back to a retry on
  // first request. Non-fatal: the route is self-healing.
  warmExchangeRates()
    .then(() => {
      const state = exchangeRatesCacheState()
      console.log(`[boot] exchange-rates: warm=${state.warm} ageMs=${state.ageMs ?? 'n/a'} provider=CoinGecko`)
    })
    .catch(() => console.warn('[boot] exchange-rates: warm FAILED — first request will retry upstream'))

  // Get relay URLs for ticket listener (same logic as NostrRelayService)
  const relayUrls = process.env.NOSTR_RELAY_URLS
    ? process.env.NOSTR_RELAY_URLS.split(',').map(url => url.trim())
    : process.env.NODE_ENV === 'production'
      ? ['wss://ribo.nostria.app', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']
      : [`ws://localhost:${PORT}`]  // Mock Relay for development

  const ticketListener = new NostrTicketListener(prisma, colPointsService, relayUrls)
  ticketListener.start()

  if (process.env.SEARCH_BACKEND !== 'database') {
    outboxWorker.start(prisma)
    console.log('[OutboxWorker] started (SEARCH_BACKEND=meilisearch)')
  }

  // Start NostrSubscriber (passive ingestion, feature-flagged)
  nostrSubscriber.start(prisma).catch(e => console.error('[NostrSubscriber] start failed:', e))

  // Daily maintenance for remote offer candidates (expire + purge)
  setInterval(() => {
    nostrSubscriber.runMaintenance(prisma).catch(e => console.error('[NostrSubscriber] maintenance failed:', e))
  }, 24 * 60 * 60 * 1000).unref()

  // ADR-423: remote-candidate auto-approval tick. Settings are read fresh on
  // every run — immediate mode (remoteCandidatesAutoApprove) drains the whole
  // pending queue, timer mode (remoteCandidatesAutoApproveDays) everything
  // older than N days; both off → no-op.
  runRemoteAutoApproveTick(prisma).catch(e => console.error('[RemoteAutoApprove] boot scan failed:', e))
  const remoteAutoApproveTickMs = Number(process.env.REMOTE_AUTO_APPROVE_TICK_MS ?? 15 * 60_000)
  setInterval(() => {
    runRemoteAutoApproveTick(prisma).catch(e => console.error('[RemoteAutoApprove] tick failed:', e))
  }, remoteAutoApproveTickMs).unref()

  // ADR-400: daily newsletter maintenance — purge signups that never confirmed
  // within the TTL. CONFIRMED / UNSUBSCRIBED rows are kept (suppression list).
  runNewsletterMaintenance(prisma)
    .then(r => { if (r.pendingPurged > 0 || r.suppressionRestored > 0) console.log(`[Newsletter] maintenance: pendingPurged=${r.pendingPurged} suppressionRestored=${r.suppressionRestored}`) })
    .catch(e => console.error('[Newsletter] maintenance boot scan failed:', e))
  setInterval(() => {
    runNewsletterMaintenance(prisma)
      .then(r => { if (r.pendingPurged > 0 || r.suppressionRestored > 0) console.log(`[Newsletter] maintenance: pendingPurged=${r.pendingPurged} suppressionRestored=${r.suppressionRestored}`) })
      .catch(e => console.error('[Newsletter] maintenance failed:', e))
  }, 24 * 60 * 60 * 1000).unref()

  runAppealFinalizerTick(prisma, payments).catch(e => console.error('[AppealFinalizer] boot scan failed:', e))
  const tickMs = Number(process.env.APPEAL_FINALIZER_TICK_MS ?? 10 * 60_000)
  setInterval(() => {
    runAppealFinalizerTick(prisma, payments).catch(e => console.error('[AppealFinalizer] tick failed:', e))
  }, tickMs).unref()

  // ADR-184: escrow phase-timeout and auto-release worker
  runEscrowTimeoutTick(prisma, payments).catch(e => console.error('[EscrowTimeout] boot scan failed:', e))
  const escrowTimeoutTickMs = Number(process.env.ESCROW_TIMEOUT_TICK_MS ?? 10 * 60_000)
  setInterval(() => {
    runEscrowTimeoutTick(prisma, payments).catch(e => console.error('[EscrowTimeout] tick failed:', e))
  }, escrowTimeoutTickMs).unref()

  // Hold-invoice reconciliation backstop: catches tickets whose buyer paid
  // but whose client never polled again to confirm it (see escrow-reconcile.ts).
  reconcileHoldInvoiceStates(prisma, payments).catch(e => console.error('[EscrowReconcile] boot scan failed:', e))
  const escrowReconcileTickMs = Number(process.env.ESCROW_RECONCILE_TICK_MS ?? 2 * 60_000)
  setInterval(() => {
    reconcileHoldInvoiceStates(prisma, payments).catch(e => console.error('[EscrowReconcile] tick failed:', e))
  }, escrowReconcileTickMs).unref()

  setInterval(async () => {
    try {
      const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
      if (result.count > 0) {
        console.log(`[SessionCleanup] Deleted ${result.count} expired sessions`)
      }
    } catch (e) {
      console.error('[SessionCleanup] failed:', e)
    }
  }, 6 * 60 * 60 * 1000).unref()

  // ADR-319 D3/D1: auto-apply matching (autoApply=true AgentProfiles against
  // OPEN tasks) + deadline expiry, every 5 min per the ADR's own text.
  runAgentTaskMatcherTick(prisma).catch(e => console.error('[AgentTaskMatcher] boot scan failed:', e))
  const agentTaskMatcherTickMs = Number(process.env.AGENT_TASK_MATCHER_TICK_MS ?? 5 * 60_000)
  setInterval(() => {
    runAgentTaskMatcherTick(prisma).catch(e => console.error('[AgentTaskMatcher] tick failed:', e))
  }, agentTaskMatcherTickMs).unref()

  // ADR-311 D2: Completed → Expired workspace sweep (Offer.agentWorkspaceTTL
  // retention window). Hourly is plenty — the TTL is measured in days.
  runWorkspaceExpirySweep(prisma).catch(e => console.error('[WorkspaceExpiry] boot sweep failed:', e))
  setInterval(() => {
    runWorkspaceExpirySweep(prisma).catch(e => console.error('[WorkspaceExpiry] sweep failed:', e))
  }, 60 * 60 * 1000).unref()

  // ADR-374 FU-696: notification retention sweep (archived > 30d, read > 180d).
  // Daily is plenty — retention is measured in weeks.
  pruneNotifications(prisma).catch(e => console.error('[NotificationPrune] boot sweep failed:', e))
  const notificationPruneTickMs = Number(process.env.NOTIFICATION_PRUNE_TICK_MS ?? 24 * 60 * 60_000)
  setInterval(() => {
    pruneNotifications(prisma).catch(e => console.error('[NotificationPrune] sweep failed:', e))
  }, notificationPruneTickMs).unref()

  // ADR-394 FU-841: return stock reserved by cancelled tickets and by unpaid
  // tickets whose LN invoice expired (or Cashu/DEMO tickets past the max age).
  const stockReleaseTickMs = Number(process.env.STOCK_RELEASE_TICK_MS ?? 5 * 60_000)
  runTicketStockReleaseTick(prisma).catch(e => console.error('[TicketStock] boot sweep failed:', e))
  setInterval(() => {
    runTicketStockReleaseTick(prisma).catch(e => console.error('[TicketStock] tick failed:', e))
  }, stockReleaseTickMs).unref()

  // ADR-394 FU-838: server-side settlement of the hosted-canvas fee LN leg
  // (own hub via NWC lookup_invoice, or LUD-21 verify) + two-confirm healing.
  // ADR-399 D2: Direct-Pay LN tickets the buyer paid without self-confirming.
  const directPayReconcileTickMs = Number(process.env.DIRECT_PAY_RECONCILE_TICK_MS ?? 60_000)
  setInterval(() => {
    runDirectPayReconcileTick(prisma, { nostrService }).catch(e => console.error('[DirectPayReconcile] tick failed:', e))
  }, directPayReconcileTickMs).unref()
  const feeReconcileTickMs = Number(process.env.PLATFORM_FEE_RECONCILE_TICK_MS ?? 2 * 60_000)
  runPlatformFeeReconcileTick(prisma, { nostrService }).catch(e => console.error('[PlatformFeeReconcile] boot scan failed:', e))
  setInterval(() => {
    runPlatformFeeReconcileTick(prisma, { nostrService }).catch(e => console.error('[PlatformFeeReconcile] tick failed:', e))
  }, feeReconcileTickMs).unref()

  // SECURITY (pentest G3, FU-710): storedInvoices (in-memory, unauthenticated
  // POST /invoice) is bounded per-write (see registerInvoice's own TTL sweep +
  // size cap), but this periodic tick also reclaims memory during a lull after
  // a flood, without relying on new invoice creation to trigger cleanup.
  const invoiceSweepTickMs = Number(process.env.STORED_INVOICE_SWEEP_TICK_MS ?? 10 * 60_000)
  setInterval(() => {
    const removed = sweepExpiredInvoices()
    if (removed > 0) console.log(`[InvoiceSweep] Removed ${removed} expired in-memory invoice entries`)
  }, invoiceSweepTickMs).unref()
})

// Mock relay: attached by default in dev. In production it can be enabled with
// NOSTR_MOCK_RELAY_ENABLED=true (e.g. the beta, which runs on a LAN where public
// mainnet relays are slow/unreachable → bounded publishes fail fast against the
// local in-memory relay instead). Pair with NOSTR_RELAY_URLS=ws://localhost:4001.
if (process.env.NODE_ENV !== 'production' || process.env.NOSTR_MOCK_RELAY_ENABLED === 'true') {
  attachMockRelay(httpServer)
}

async function shutdown(): Promise<void> {
  nostrSubscriber.stop()
  try {
    await outboxWorker.stopAndDrain(prisma)
  } catch (e) {
    console.error('[shutdown] outbox drain failed:', e)
  }
  try {
    await closeRedis()
  } catch (e) {
    console.error('[shutdown] redis close failed:', e)
  }
  try {
    await prisma.$disconnect()
  } finally {
    process.exit(0)
  }
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
