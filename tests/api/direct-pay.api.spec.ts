import { test, expect } from '@playwright/test'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from '../e2e/fixtures/roles.js'

// ADR-377 D1: contract-level smoke (no page.* interaction) — tagged @api.
// ADR-253 / FU-755/757/758: the buyer-confirms-with-preimage contract that the
// direct-pay purchase relies on. The browser self-confirm path lives behind
// `!isBeta` (see FU-759 for the non-beta harness gap), but the SERVER contract
// this app depends on is fully exercisable here against the beta+mock stack.

const SERVER_BASE_URL = process.env.PLAYWRIGHT_SERVER_URL || 'http://localhost:4001'

// 64 hex chars, valid shape, guaranteed not to hash to any real ticket hash.
const WRONG_PREIMAGE = 'ab'.repeat(32)

async function call(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  const res = await fetch(`${SERVER_BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> }
}

test.describe('@api Direct-Pay confirmation contract', () => {
  test('confirm-direct-payment enforces auth, buyer-only, existence and the sha256 proof', async () => {
    const uniq = Date.now().toString(36)

    const sellerPubkey = `e2edps${uniq}`.padEnd(64, '0').slice(0, 64)
    const buyerPubkey = `e2edpb${uniq}`.padEnd(64, '0').slice(0, 64)
    const otherPubkey = `e2edpo${uniq}`.padEnd(64, '0').slice(0, 64)

    const seller = await demoSession(sellerPubkey)
    const buyer = await demoSession(buyerPubkey)
    const other = await demoSession(otherPubkey)
    test.skip(!seller || !buyer || !other, DEMO_LOGIN_SKIP_REASON)

    // Seller wallet (beta → ADR-255 DEMO rail, which tickets resolve against)
    // + a real offer so the ticket can be created through the real API.
    await call('/api/wallet/create', { method: 'POST', body: { pubkey: sellerPubkey }, token: seller!.token })
    // The buyer also needs an active wallet (ADR-179 WALLET_REQUIRED pre-flight)
    // — in beta that is the DEMO wallet.
    await call('/api/wallet/create', { method: 'POST', body: { pubkey: buyerPubkey }, token: buyer!.token })
    const offer = await call('/api/offers', {
      method: 'POST',
      token: seller!.token,
      body: {
        title: `E2E Direct-Pay Contract ${uniq}`,
        description: 'Deterministic direct-pay confirmation contract test',
        priceSats: 10000,
        offerType: 'SERVICE',
        sellerPubkey,
      },
    })
    expect(offer.status).toBe(200)
    const offerId = offer.data.offer?.id ?? offer.data.id
    expect(offerId).toBeTruthy()

    const tx = await call('/api/tickets', {
      method: 'POST',
      token: buyer!.token,
      body: { offerId, amountSats: 10000 },
    })
    expect(tx.status).toBe(200)
    const ticketId = tx.data.ticket?.id
    expect(ticketId).toBeTruthy()
    expect(tx.data.paymentHash).toBeTruthy()
    expect(tx.data.ticket?.escrowEnabled).toBe(false)
    // The beta stack has no LN node, so the ticket resolves to the DEMO rail —
    // the confirm contract below is rail-agnostic (it verifies the preimage
    // against the ticket's paymentHash, exactly as it does for LN tickets).
    expect(tx.data.ticket?.directPayRail).toBe('DEMO')

    const url = `/api/tickets/${ticketId}/confirm-direct-payment`

    await test.step('unauthenticated → 401', async () => {
      const res = await call(url, { method: 'POST', body: { preimage: WRONG_PREIMAGE } })
      expect(res.status).toBe(401)
    })

    await test.step('missing preimage → 400', async () => {
      const res = await call(url, { method: 'POST', body: {}, token: buyer!.token })
      expect(res.status).toBe(400)
    })

    await test.step('non-buyer → 403', async () => {
      const res = await call(url, { method: 'POST', body: { preimage: WRONG_PREIMAGE }, token: other!.token })
      expect(res.status).toBe(403)
    })

    await test.step('unknown ticket → 404', async () => {
      const res = await call('/api/tickets/does-not-exist/confirm-direct-payment', {
        method: 'POST',
        body: { preimage: WRONG_PREIMAGE },
        token: buyer!.token,
      })
      expect(res.status).toBe(404)
    })

    await test.step('wrong preimage → 400 PREIMAGE_MISMATCH (sha256 proof enforced)', async () => {
      const res = await call(url, { method: 'POST', body: { preimage: WRONG_PREIMAGE }, token: buyer!.token })
      expect(res.status).toBe(400)
      expect(res.data.error).toBe('PREIMAGE_MISMATCH')
    })

    await test.step('ticket is unchanged after every rejected proof', async () => {
      const read = await call(`/api/tickets/${ticketId}`, { token: buyer!.token })
      expect(read.status).toBe(200)
      const status = read.data.ticket?.status ?? read.data.status
      expect(status).toBe('PENDING')
    })
  })
})
