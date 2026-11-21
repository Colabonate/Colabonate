import { test, expect } from '@playwright/test'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from './fixtures/roles'

// ADR-377 D2 — buy journey (marketplace context of the unified search).
//
// The listing step route-mocks /api/search (B8: deterministic, rate-limit
// safe) with one SERVICE offer that was created via the real API; everything
// from the detail page on (offer fetch, cart, ticket creation, beta demo
// payment, orders) runs against the real dev server.

const DATA_URL_PNG_2X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAARSURBVBhXY9CIOvEfhBlgDABMcAklYz1uFAAAAABJRU5ErkJggg=='

const SERVER_BASE_URL = process.env.PLAYWRIGHT_SERVER_URL || 'http://localhost:4001'

async function apiPost(path: string, body: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${SERVER_BASE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> }
}

test.describe('@smoke Buy Journey', () => {
  test('search → offer detail → cart → checkout → demo-pay → orders', async ({ page }) => {
    const uniq = Date.now().toString(36)

    // Fresh seller (demo login upserts a user; wallet bootstraps the ADR-255
    // DEMO rail the ticket's direct-pay resolves against).
    const sellerPubkey = `e2ebuy${uniq}`.padEnd(64, '0').slice(0, 64)
    const seller = await demoSession(sellerPubkey)
    test.skip(!seller, DEMO_LOGIN_SKIP_REASON)
    await apiPost('/api/wallet/create', { pubkey: sellerPubkey }, seller!.token)

    const offerTitle = `E2E Buy Journey Offer ${uniq}`
    const offer = await apiPost('/api/offers', {
      title: offerTitle,
      description: 'Deterministic e2e buy-journey service offer',
      priceSats: 10000,
      offerType: 'SERVICE',
      sellerPubkey,
      images: [DATA_URL_PNG_2X2],
    }, seller!.token)
    expect(offer.status).toBe(200)
    const offerId = offer.data.offer?.id
    expect(offerId).toBeTruthy()

    // Deterministic listing step: one hit, data-URL image (passes the
    // useImageValidity probe without network).
    const hit = {
      id: offerId,
      title: offerTitle,
      description: 'Deterministic e2e buy-journey service offer',
      priceSats: 10000,
      offerType: 'SERVICE',
      status: 'ACTIVE',
      images: [DATA_URL_PNG_2X2],
      imageThumbs: null,
      creatorPubkey: sellerPubkey,
      categoryCode: null,
      gammaTags: [],
      stock: null,
      ticketType: 'SMART_ORDER',
      country: null,
      publishedAt: new Date().toISOString(),
    }
    const searchBody = JSON.stringify({ hits: [hit], estimatedTotalHits: 1, processingTimeMs: 1 })
    await page.route('**/api/search*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: searchBody }))

    // Buyer session (demo) — minted per B3.
    const buyerPubkey = `e2ebye${uniq}`.padEnd(64, '0').slice(0, 64)
    const buyer = await demoSession(buyerPubkey)
    test.skip(!buyer, DEMO_LOGIN_SKIP_REASON)
    await page.addInitScript(
      ([p, t]) => {
        localStorage.setItem('pubkey', p as string)
        localStorage.setItem('authToken', t as string)
      },
      [buyerPubkey, buyer!.token] as const,
    )

    await test.step('marketplace context lists the offer', async () => {
      await page.goto('/search?context=marketplace')
      await expect(page.getByRole('tab', { name: 'Marketplace' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
      await expect(page.getByRole('link', { name: new RegExp(offerTitle) })).toBeVisible({ timeout: 15_000 })
    })

    await test.step('offer detail exposes the primary CTA', async () => {
      await page.getByRole('link', { name: new RegExp(offerTitle) }).click()
      await page.waitForURL((url) => url.pathname === `/buy/product/${offerId}`)
      await expect(page.getByRole('button', { name: 'Add to Cart' })).toBeVisible({ timeout: 15_000 })
    })

    await test.step('add to cart and open the cart via the CartFAB', async () => {
      await page.getByRole('button', { name: 'Add to Cart' }).click()
      const fab = page.getByRole('button', { name: 'Cart with 1 items' })
      await expect(fab).toBeVisible({ timeout: 10_000 })
      await fab.click()
      await page.waitForURL((url) => url.pathname === '/buy/cart')
      await expect(page.getByText(/Review your items/i)).toBeVisible({ timeout: 10_000 })
    })

    await test.step('services-only cart skips the delivery form', async () => {
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('button', { name: /Skip delivery address \(services only\)/i }).click()
      await expect(page.getByText('Bitcoin Lightning').first()).toBeVisible({ timeout: 10_000 })
    })

    await test.step('place order creates the ticket', async () => {
      await page.getByRole('button', { name: 'Place Order' }).click()
      await expect(page.getByText(/Order successful!|Order placed & paid!/i)).toBeVisible({ timeout: 30_000 })
    })

    await test.step('demo-pay settles the order', async () => {
      await page.getByRole('button', { name: 'Pay now' }).click()
      await expect(page.getByText(/Paid · View ticket/i).first()).toBeVisible({ timeout: 45_000 })
    })

    await test.step('order shows up in My Orders with Paid badge', async () => {
      await page.getByRole('link', { name: 'My Orders' }).click()
      await page.waitForURL((url) => url.pathname === '/buy/orders')
      const card = page.locator('a', { hasText: offerTitle }).first()
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText('Paid', { exact: true })).toBeVisible()
    })
  })
})
