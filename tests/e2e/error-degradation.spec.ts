import { test, expect } from '@playwright/test'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from './fixtures/roles'

// ADR-377 Phase 3 (FU-705): route-abort degradation states.
//
// Investigated live before writing this (not assumed): a routed 500/429 on
// /api/search renders the marketplace shell with an empty result set and NO
// visible error indication at all — indistinguishable from "there are simply
// no offers". That gap is real and is registered as FU-737, not silently
// built here (a proper error-state UI is a product/UI change, out of scope
// for "add tests"). These two tests instead lock in the one thing that does
// matter today: a failed search never crashes the page or blanks the shell.
//
// PAYMENTS_PAUSED (ADR-252 D2 kill switch) DOES have real, working client
// handling — confirmed in BuyCartFlow.tsx: any ApiError without a more
// specific branch falls through to the generic `errorMsg` state, which
// renders the server's own message. That's the one degradation path in this
// file with a real "shows the right thing" assertion.

const SERVER_BASE_URL = process.env.PLAYWRIGHT_SERVER_URL || 'http://localhost:4001'
const DATA_URL_PNG_2X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAARSURBVBhXY9CIOvEfhBlgDABMcAklYz1uFAAAAABJRU5ErkJggg=='

async function apiPost(path: string, body: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${SERVER_BASE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> }
}

test.describe('@smoke Error Degradation', () => {
  test('a 500 from /api/search does not crash the marketplace shell', async ({ page }) => {
    await page.route('**/api/search*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'INTERNAL_ERROR' }) }))
    await page.goto('/search?context=marketplace')
    // The page shell (nav, context tabs, sidebar) must still render — a
    // crashed/blank page would fail these, a silently-empty result list
    // (the current, imperfect behavior) would still pass them.
    await expect(page.getByRole('tab', { name: 'Marketplace' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Categories', { exact: true })).toBeVisible()
  })

  test('a 429 from /api/search does not crash the marketplace shell', async ({ page }) => {
    await page.route('**/api/search*', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'RATE_LIMITED' }) }))
    await page.goto('/search?context=marketplace')
    await expect(page.getByRole('tab', { name: 'Marketplace' })).toBeVisible({ timeout: 15_000 })
  })

  test('a 503 PAYMENTS_PAUSED on ticket creation surfaces the real server message', async ({ page }) => {
    const uniq = Date.now().toString(36)

    const sellerPubkey = `e2epau${uniq}`.padEnd(64, '0').slice(0, 64)
    const seller = await demoSession(sellerPubkey)
    test.skip(!seller, DEMO_LOGIN_SKIP_REASON)
    if (!seller) return // narrows for TS — test.skip(true) already ended the run
    await apiPost('/api/wallet/create', { pubkey: sellerPubkey }, seller.token)

    const offerTitle = `E2E Payments-Paused Offer ${uniq}`
    const offer = await apiPost('/api/offers', {
      title: offerTitle,
      description: 'Deterministic e2e payments-paused degradation offer',
      priceSats: 5000,
      offerType: 'SERVICE',
      sellerPubkey,
      images: [DATA_URL_PNG_2X2],
    }, seller.token)
    expect(offer.status).toBe(200)
    const offerId = offer.data.offer?.id
    expect(offerId).toBeTruthy()

    const buyerPubkey = `e2epby${uniq}`.padEnd(64, '0').slice(0, 64)
    const buyer = await demoSession(buyerPubkey)
    test.skip(!buyer, DEMO_LOGIN_SKIP_REASON)
    if (!buyer) return // narrows for TS
    await page.addInitScript(
      ([p, t]) => {
        localStorage.setItem('pubkey', p as string)
        localStorage.setItem('authToken', t as string)
      },
      [buyerPubkey, buyer.token] as const,
    )

    // The exact message blockIfPaymentsPaused (apps/server/middleware/payments-paused.ts) sends.
    const PAUSED_MESSAGE = 'New payments are temporarily paused. Existing orders can still be completed. Please try again shortly.'
    await page.route('**/api/tickets', (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'PAYMENTS_PAUSED', message: PAUSED_MESSAGE }) })
    })

    await page.goto(`/buy/product/${offerId}`)
    await page.getByRole('button', { name: 'Add to Cart' }).click()
    await page.getByRole('button', { name: 'Cart with 1 items' }).click()
    await page.waitForURL((url) => url.pathname === '/buy/cart')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('button', { name: /Skip delivery address \(services only\)/i }).click()
    await page.getByRole('button', { name: 'Place Order' }).click()

    await expect(page.getByText(PAUSED_MESSAGE)).toBeVisible({ timeout: 15_000 })
  })
})
