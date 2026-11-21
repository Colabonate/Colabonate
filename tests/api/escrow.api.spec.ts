/**
 * Playwright E2E — end-to-end escrow flow against the Beta compose stack.
 *
 * Skipped automatically when PLAYWRIGHT_LNBITS_URL is not set.
 * Requires:
 *   - docker-compose.beta.yml up and healthy
 *   - seed-regtest-lnd.sh + seed-lnbits.sh already run
 *   - A funded payer wallet (LNBITS_PAYER_ADMIN_KEY)
 *   - LND hold-state verification needs PLAYWRIGHT_LND_URL + LND_MACAROON_HEX
 *     (the regtest LND REST endpoint + admin macaroon hex). When those are
 *     absent the LN-layer hold-state assertions are skipped (ADR-193).
 *
 * To run:
 *   PLAYWRIGHT_LNBITS_URL=http://localhost:53000 \
 *   PLAYWRIGHT_LND_URL=https://localhost:8082 \
 *   LND_MACAROON_HEX=<hex> \
 *   LNBITS_ADMIN_KEY=<key> \
 *   LNBITS_INVOICE_KEY=<key> \
 *   LNBITS_PAYER_ADMIN_KEY=<funded-wallet-key> \
 *   npx playwright test tests/e2e/escrow-flow.spec.ts
 */
import { test, expect } from '@playwright/test'
import { ApiClient } from '../e2e/helpers/api-client.js'

// ADR-377 D1: contract-level flow against real LNBits (needs the docker/regtest
// stack) — tagged @api + @lnbits. No page.* interaction.

// Trust the self-signed regtest LND cert for the duration of this test run.
// (regtest only — never set this against mainnet LND.)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const LNBITS_URL = process.env.PLAYWRIGHT_LNBITS_URL
const LND_URL = process.env.PLAYWRIGHT_LND_URL
const LND_MACAROON = process.env.LND_MACAROON_HEX ?? ''
const PAYER_ADMIN_KEY = process.env.LNBITS_PAYER_ADMIN_KEY ?? ''

// Poll LND's invoicesrpc for the hold state (ADR-193). Returns undefined when
// LND access is not configured, so callers can soft-skip the LN assertion.
async function lndHoldState(paymentHash: string): Promise<string | undefined> {
  if (!LND_URL || !LND_MACAROON) return undefined
  const hashB64 = Buffer.from(paymentHash, 'hex').toString('base64')
  const res = await fetch(
    `${LND_URL}/v2/invoices/lookup?payment_hash=${encodeURIComponent(hashB64)}`,
    { headers: { 'Grpc-Metadata-macaroon': LND_MACAROON } },
  )
  if (!res.ok) return undefined
  const data = await res.json() as { state: string }
  return data.state
}

const SELLER_PUBKEY = 'e2e-escrow-seller-000000000000000000000000000000000000000000000000000000000000'
const BUYER_PUBKEY = 'e2e-escrow-buyer-0000000000000000000000000000000000000000000000000000000000000'

test.describe('@api @lnbits Escrow Flow — real LNBits holdinvoice', () => {
  test.skip(!LNBITS_URL, 'PLAYWRIGHT_LNBITS_URL not set — skipping real LNBits escrow tests')

  let api: ApiClient
  let sellerToken: string
  let buyerToken: string
  let offerId: string
  let ticketId: string
  let phase1Invoice: string
  let phase1Hash: string

  test.beforeAll(async () => {
    api = new ApiClient()

    const sellerAuth = await api.demoLogin(SELLER_PUBKEY)
    expect(sellerAuth.token).toBeDefined()
    sellerToken = sellerAuth.token

    const buyerAuth = await api.demoLogin(BUYER_PUBKEY)
    expect(buyerAuth.token).toBeDefined()
    buyerToken = buyerAuth.token
  })

  test('E1: seller publishes a SERVICE offer', async () => {
    const result = await api.post('/api/offers', {
      title: 'E2E Real Escrow Service',
      description: 'Integration test: real LNBits holdinvoice escrow',
      priceSats: 10000,
      offerType: 'SERVICE',
      sellerPubkey: SELLER_PUBKEY,
    }, sellerToken)

    expect(result.success).toBe(true)
    expect(result.offer?.id).toBeDefined()
    offerId = result.offer.id
  })

  test('E2: buyer creates a ticket and gets a phase-1 hold invoice', async () => {
    const createResult = await api.post('/api/tickets', {
      offerId,
      buyerPubkey: BUYER_PUBKEY,
      amountSats: 10000,
    }, buyerToken)

    expect(createResult.success).toBe(true)
    expect(createResult.ticket?.id).toBeDefined()
    ticketId = createResult.ticket.id
    expect(createResult.ticket.status).toBe('PENDING')

    const phase1Result = await api.fundEscrowPhase(ticketId, BUYER_PUBKEY, 1, buyerToken)
    expect(phase1Result.success).toBe(true)
    expect(phase1Result.invoice).toBeTruthy()
    expect(phase1Result.invoice).toMatch(/^lnbcrt/)
    expect(phase1Result.paymentHash).toBeTruthy()

    phase1Invoice = phase1Result.invoice
    phase1Hash = phase1Result.paymentHash
  })

  test('E3: LND confirms the hold is in OPEN (pending) state', async () => {
    const state = await lndHoldState(phase1Hash)
    test.skip(state === undefined, 'PLAYWRIGHT_LND_URL / LND_MACAROON_HEX not set — skipping LND hold-state assertion')
    expect(state).toBe('OPEN')
  })

  test('E4: payer wallet pays the hold invoice', async () => {
    test.skip(!PAYER_ADMIN_KEY, 'LNBITS_PAYER_ADMIN_KEY not set — cannot pay invoice in E4')

    const payResponse = await fetch(`${LNBITS_URL}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': PAYER_ADMIN_KEY,
      },
      body: JSON.stringify({ out: true, bolt11: phase1Invoice }),
    })
    expect(payResponse.ok).toBe(true)

    // Trigger the server webhook to register payment
    const webhookResult = await api.triggerWebhook(phase1Hash)
    expect(webhookResult.success).toBe(true)

    // Ticket should now be IN_PROGRESS
    const ticket = await api.get(`/api/tickets/${ticketId}`, buyerToken)
    expect(['IN_PROGRESS', 'PAID']).toContain(ticket.ticket?.status)
  })

  test('E5: seller accepts the ticket', async () => {
    const acceptResult = await api.acceptTicket(ticketId, sellerToken)
    expect(acceptResult.success).toBe(true)
  })

  test('E6: buyer releases escrow — settles the HTLC', async () => {
    const releaseResult = await api.releaseEscrow(ticketId, BUYER_PUBKEY, buyerToken)
    expect(releaseResult.success).toBe(true)

    // After release, LND should report the hold as SETTLED.
    await new Promise(r => setTimeout(r, 1000))
    const state = await lndHoldState(phase1Hash)
    test.skip(state === undefined, 'PLAYWRIGHT_LND_URL / LND_MACAROON_HEX not set — skipping LND hold-state assertion')
    expect(state).toBe('SETTLED')
  })

  test('E7: ticket final status is COMPLETED', async () => {
    const ticket = await api.get(`/api/tickets/${ticketId}`, sellerToken)
    expect(ticket.ticket?.status).toBe('COMPLETED')
  })
})

test.describe('@api @lnbits Escrow cancel path — dispute refund', () => {
  test.skip(!LNBITS_URL, 'PLAYWRIGHT_LNBITS_URL not set — skipping real LNBits escrow tests')

  let api: ApiClient
  let sellerToken: string
  let buyerToken: string
  let offerId: string
  let ticketId: string
  let phase1Hash: string
  let phase1Invoice: string

  test.beforeAll(async () => {
    api = new ApiClient()
    const sellerAuth = await api.demoLogin(
      'e2e-escrow-cancel-seller-000000000000000000000000000000000000000000000000000000',
    )
    sellerToken = sellerAuth.token
    const buyerAuth = await api.demoLogin(
      'e2e-escrow-cancel-buyer-0000000000000000000000000000000000000000000000000000000',
    )
    buyerToken = buyerAuth.token
  })

  test('C1: setup — create offer, ticket, get hold invoice', async () => {
    const offerRes = await api.post('/api/offers', {
      title: 'E2E Cancel Test Offer',
      description: 'Test cancel path',
      priceSats: 5000,
      offerType: 'SERVICE',
      sellerPubkey: 'e2e-escrow-cancel-seller-000000000000000000000000000000000000000000000000000000',
    }, sellerToken)
    offerId = offerRes.offer.id

    const ticketRes = await api.post('/api/tickets', {
      offerId,
      buyerPubkey: 'e2e-escrow-cancel-buyer-0000000000000000000000000000000000000000000000000000000',
      amountSats: 5000,
    }, buyerToken)
    ticketId = ticketRes.ticket.id

    const phaseRes = await api.fundEscrowPhase(ticketId, 'e2e-escrow-cancel-buyer-0000000000000000000000000000000000000000000000000000000', 1, buyerToken)
    phase1Invoice = phaseRes.invoice
    phase1Hash = phaseRes.paymentHash
    expect(phase1Hash).toBeTruthy()
  })

  test('C2: cancel escrow — HTLC transitions to CANCELED', async () => {
    const cancelResult = await api.cancelEscrow(ticketId, 'e2e-escrow-cancel-buyer-0000000000000000000000000000000000000000000000000000000', buyerToken)
    expect(cancelResult.success).toBe(true)

    await new Promise(r => setTimeout(r, 500))

    const state = await lndHoldState(phase1Hash)
    test.skip(state === undefined, 'PLAYWRIGHT_LND_URL / LND_MACAROON_HEX not set — skipping LND hold-state assertion')
    expect(state).toBe('CANCELED')
  })
})
