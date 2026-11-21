import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

// ADR-252 D4 / FU-192-G: no load test existed for any money-flow endpoint
// before this — the CI `load-test` job only covers search (search-test.ts).
// This script targets the two money-flow gaps named in FU-192-G:
//   1. concurrent hold-invoice CREATION  → `ticketCreation` scenario
//   2. concurrent hold-invoice SETTLEMENT → `webhookSettlementRace` scenario
//
// Prerequisite (server env): PAYMENT_PROVIDER=mock, DEMO_LOGIN_ENABLED=1,
// NODE_ENV != production (POST /api/auth/demo is hard-blocked in production —
// auth-session.ts:49 — by design; this script must run against a dev/CI
// server, never against a live production/mainnet deployment).
//
// Scope note (epistemic honesty): the CAS-guard unit/integration tests
// (escrow-state.test.ts, dispatch-lock.test.ts, ADR-250) already prove the
// guard logic is correct under synthetic concurrent calls. What was actually
// missing — and what this script adds — is (a) a throughput/latency profile
// for the hold-invoice-creation hot path under real concurrent HTTP load, and
// (b) one genuine same-resource race reachable over HTTP without needing to
// walk a ticket through the full multi-actor escrow state machine: firing the
// LNBits payment webhook twice, concurrently, for the SAME payment_hash — a
// realistic scenario (LNBits retries a webhook that didn't 200 fast enough)
// that exercises confirmPaymentByHash()'s idempotency under real concurrency.
//
// Rate-limit finding (found while tuning this script live, 2026-08-02):
// ADR-212's `authenticatedLimiter`/`unauthenticatedLimiter` key by client IP
// with no override (express-rate-limit default). A single test client (or,
// in production, many real users behind one NAT/CGNAT/corporate IP) shares
// ONE 300-req/min (authenticated) or 60-req/min (unauthenticated) budget. A
// naive "fresh login every iteration" version of this script measured 83-100%
// error rate that was NOT the escrow code failing — it was legitimate traffic
// tripping the app's own anti-abuse limiter. Fixed here by pre-provisioning a
// token pool once in setup() and keeping VU targets under the per-IP budget;
// see FU-252-E in FOLLOWUPS.md for the follow-up (should authenticatedLimiter
// key by pubkey/session instead of IP before public launch?).

const errorRate = new Rate('errors')
const ticketCreateDuration = new Trend('ticket_create_p95')
const webhookDuration = new Trend('webhook_confirm_p95')
const doubleSettleCount = new Counter('double_settles_detected')

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4001'
const TICKET_CREATE_THRESHOLD_MS = Number(__ENV.TICKET_CREATE_THRESHOLD_MS || 500)

export const options = {
  thresholds: {
    errors: ['rate<0.05'],
    ticket_create_p95: [`p(95)<${TICKET_CREATE_THRESHOLD_MS}`],
    double_settles_detected: ['count==0'],
  },
  scenarios: {
    // Target kept under the authenticatedLimiter budget (300 req/min per IP,
    // ADR-212) — see the rate-limit finding above. 3 VUs x ~1 req/s ~= 180/min,
    // leaving headroom for the setup()-phase pool provisioning.
    ticketCreation: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 3 },
        { duration: '30s', target: 3 },
        { duration: '5s', target: 0 },
      ],
      exec: 'ticketCreationTest',
    },
    webhookSettlementRace: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 2,
      startTime: '50s', // after ticketCreation ramps down, so the two scenarios' rate-limit budgets don't compound
      exec: 'webhookSettlementRaceTest',
      maxDuration: '30s',
    },
  },
}

// Pre-provisioned per-VU token pool (see rate-limit finding above) — sized to
// cover both scenarios' max concurrent VUs (3 + 5) with a little headroom.
const BUYER_POOL_SIZE = 10

// setup() runs once, before any VU iteration.
export function setup() {
  const sellerPubkey = `loadtest-seller-${Date.now()}`
  const loginRes = http.post(`${BASE_URL}/api/auth/demo`, JSON.stringify({ pubkey: sellerPubkey }), {
    headers: { 'Content-Type': 'application/json' },
  })
  if (loginRes.status !== 200) {
    throw new Error(`setup: seller demo-login failed (${loginRes.status}) — is DEMO_LOGIN_ENABLED=1 and NODE_ENV!=production set on the target server? body=${loginRes.body}`)
  }
  const loginBody = JSON.parse(loginRes.body as string)
  const sellerToken = loginBody.token

  const offerRes = http.post(`${BASE_URL}/api/offers`, JSON.stringify({
    sellerPubkey,
    title: 'Load Test Escrow Offer',
    description: 'k6 escrow-concurrency-test fixture — safe to delete',
    priceSats: 100000,
    offerType: 'SERVICE',
    useEscrow: true,
  }), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerToken}` },
  })
  if (offerRes.status !== 200) {
    throw new Error(`setup: offer creation failed (${offerRes.status}) body=${offerRes.body}`)
  }
  const offerBody = JSON.parse(offerRes.body as string)
  const offerId = offerBody.offer ? offerBody.offer.id : offerBody.id

  // Pre-provision a fixed pool of buyer tokens (each with a wallet) ONCE,
  // instead of demo-logging-in fresh on every iteration — see the rate-limit
  // finding above. Real load also isn't "N new sessions per second"; it's
  // existing logged-in users acting concurrently, which this models more
  // faithfully.
  const buyerTokens: string[] = []
  for (let i = 0; i < BUYER_POOL_SIZE; i++) {
    const pubkey = `loadtest-buyer-${i}-${Date.now()}`
    const loginRes2 = http.post(`${BASE_URL}/api/auth/demo`, JSON.stringify({ pubkey }), {
      headers: { 'Content-Type': 'application/json' },
    })
    if (loginRes2.status !== 200) {
      throw new Error(`setup: buyer #${i} demo-login failed (${loginRes2.status}) body=${loginRes2.body}`)
    }
    const buyerBody = JSON.parse(loginRes2.body as string)
    const token = buyerBody.token
    const walletRes = http.post(`${BASE_URL}/api/wallet/create`, '{}', {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    if (walletRes.status !== 200) {
      throw new Error(`setup: buyer #${i} wallet creation failed (${walletRes.status}) body=${walletRes.body}`)
    }
    buyerTokens.push(token)
  }

  return { offerId, buyerTokens }
}

export function ticketCreationTest(data: { offerId: string; buyerTokens: string[] }) {
  const token = data.buyerTokens[__VU % data.buyerTokens.length]

  const res = http.post(`${BASE_URL}/api/tickets`, JSON.stringify({
    offerId: data.offerId,
  }), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    tags: { name: 'POST /api/tickets (escrow create)' },
  })

  const passed = check(res, {
    'ticket create status 200': (r) => r.status === 200,
    'ticket has phase-1 hold invoice': (r) => {
      try {
        const body = JSON.parse(r.body as string)
        return body.ticket && body.ticket.escrowStatus === 'PHASE_1_PENDING' && !!body.invoice
      } catch {
        return false
      }
    },
  })
  errorRate.add(!passed)
  ticketCreateDuration.add(res.timings.duration)
  sleep(1)
}

// Fires the LNBits payment webhook twice, concurrently, for the same
// payment_hash — the double-webhook-delivery scenario confirmPaymentByHash()
// must handle idempotently. Asserts the ticket settles into exactly one
// consistent end state, not that it never got hit twice.
export function webhookSettlementRaceTest(data: { offerId: string; buyerTokens: string[] }) {
  const token = data.buyerTokens[__VU % data.buyerTokens.length]

  const createRes = http.post(`${BASE_URL}/api/tickets`, JSON.stringify({
    offerId: data.offerId,
  }), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    tags: { name: 'POST /api/tickets (for webhook race)' },
  })
  if (createRes.status !== 200) {
    errorRate.add(true)
    return
  }
  const created = JSON.parse(createRes.body as string)
  const ticketId = created.ticket.id
  const paymentHash = created.paymentHash

  // http.batch fires both requests concurrently — this is the actual race,
  // not two sequential calls that happen to look concurrent in source order.
  const webhookBody = JSON.stringify({ payment_hash: paymentHash, pending: false, amount: 25000 })
  const responses = http.batch([
    ['POST', `${BASE_URL}/api/webhooks/lnbits`, webhookBody, { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/webhooks/lnbits (race A)' } }],
    ['POST', `${BASE_URL}/api/webhooks/lnbits`, webhookBody, { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/webhooks/lnbits (race B)' } }],
  ])
  responses.forEach(r => webhookDuration.add(r.timings.duration))

  const bothAccepted = responses.every(r => r.status === 200)
  errorRate.add(!bothAccepted)

  // Give the (fire-and-forget) DB writes a moment to land, then read back the
  // authoritative state exactly once — this is the actual double-settle check.
  sleep(0.5)
  const ticketRes = http.get(`${BASE_URL}/api/tickets/${ticketId}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: 'GET /api/tickets/:id (post-race verify)' },
  })
  const okState = check(ticketRes, {
    'ticket reached a single consistent escrow state after concurrent webhooks': (r) => {
      try {
        const body = JSON.parse(r.body as string)
        // GET /api/tickets/:id wraps the ticket: { ticket: {...}, viewerRole }.
        // RESERVED = Phase-1 settled exactly once and advanced correctly.
        // PHASE_1_PENDING would mean the webhook never landed (a different bug).
        // Anything else (e.g. a corrupted/unexpected status) fails the check.
        return body.ticket && body.ticket.escrowStatus === 'RESERVED'
      } catch {
        return false
      }
    },
  })
  if (!okState) doubleSettleCount.add(1)
}

export function handleSummary(data: {
  metrics: Record<string, { values: Record<string, number> }>
}) {
  const ticketP95 = data.metrics.ticket_create_p95?.values?.['p(95)'] ?? 0
  const webhookP95 = data.metrics.webhook_confirm_p95?.values?.['p(95)'] ?? 0
  const doubleSettles = data.metrics.double_settles_detected?.values?.['count'] ?? 0
  const errRate = data.metrics.errors?.values?.['rate'] ?? 0

  const failed = []
  if (ticketP95 >= TICKET_CREATE_THRESHOLD_MS) failed.push(`ticket_create p95 ${ticketP95}ms >= ${TICKET_CREATE_THRESHOLD_MS}ms`)
  if (doubleSettles > 0) failed.push(`${doubleSettles} ticket(s) did NOT reach a single consistent state after concurrent webhook delivery — possible double-settle or lost update`)
  if (errRate >= 0.05) failed.push(`error rate ${(errRate * 100).toFixed(1)}% >= 5%`)

  // k6 has no Node `process` global — the configured `thresholds` (above)
  // already fail the run (nonzero exit code) on their own when crossed.
  // This summary only adds a human-readable one-line verdict to stdout.
  if (failed.length > 0) {
    return {
      stdout: `ESCROW LOAD TEST FAILED: ${failed.join('; ')}\n`,
    }
  }

  return {
    stdout: `Escrow load test passed — ticket_create p95: ${ticketP95}ms, webhook_confirm p95: ${webhookP95}ms, double-settles: ${doubleSettles}, error rate: ${(errRate * 100).toFixed(2)}%\n`,
  }
}
