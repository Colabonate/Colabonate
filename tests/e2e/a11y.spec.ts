import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from './fixtures/roles'

// ADR-377 Phase 3 (FU-705): P0-only a11y gate on Login / Search / TicketDetail
// (the three pages named in the plan). "P0" here means axe's own `critical`
// impact level — this is a floor, not a full audit: it blocks the class of
// violation a screen-reader user cannot work around at all (missing form
// labels, broken landmark structure, etc.), not every WCAG nit.

const SERVER_BASE_URL = process.env.PLAYWRIGHT_SERVER_URL || 'http://localhost:4001'
const DATA_URL_PNG_2X2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAARSURBVBhXY9CIOvEfhBlgDABMcAklYz1uFAAAAABJRU5ErkJggg=='

async function apiPost(path: string, body: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${SERVER_BASE_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> }
}

async function expectNoCriticalViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const critical = results.violations.filter((v) => v.impact === 'critical')
  const summary = critical.map((v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))`).join('\n')
  expect(critical, `critical a11y violations:\n${summary}`).toEqual([])
}

test.describe('@smoke A11y (P0-only gate)', () => {
  test('Login has no critical a11y violations', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 15_000 })
    await expectNoCriticalViolations(page)
  })

  test('Search (marketplace) has no critical a11y violations', async ({ page }) => {
    await page.goto('/search?context=marketplace')
    await expect(page.getByRole('tab', { name: 'Marketplace' })).toBeVisible({ timeout: 15_000 })
    await expectNoCriticalViolations(page)
  })

  test('TicketDetail has no critical a11y violations', async ({ page }) => {
    const uniq = Date.now().toString(36)

    const sellerPubkey = `e2ea11y${uniq}`.padEnd(64, '0').slice(0, 64)
    const seller = await demoSession(sellerPubkey)
    test.skip(!seller, DEMO_LOGIN_SKIP_REASON)
    if (!seller) return // narrows for TS — test.skip(true) already ended the run
    await apiPost('/api/wallet/create', { pubkey: sellerPubkey }, seller.token)

    const offerTitle = `E2E A11y Ticket Offer ${uniq}`
    const offer = await apiPost('/api/offers', {
      title: offerTitle,
      description: 'Deterministic e2y a11y offer',
      priceSats: 5000,
      offerType: 'SERVICE',
      sellerPubkey,
      images: [DATA_URL_PNG_2X2],
    }, seller.token)
    expect(offer.status).toBe(200)
    const offerId = offer.data.offer?.id
    expect(offerId).toBeTruthy()

    const buyerPubkey = `e2eb11y${uniq}`.padEnd(64, '0').slice(0, 64)
    const buyer = await apiPost('/api/auth/demo', { pubkey: buyerPubkey })
    expect(buyer.data.token).toBeTruthy()
    await apiPost('/api/wallet/create', { pubkey: buyerPubkey }, buyer.data.token)

    const ticket = await apiPost('/api/tickets', { offerId, sellerPubkey }, buyer.data.token)
    expect(ticket.status).toBe(200)
    const ticketId = ticket.data.ticket?.id
    expect(ticketId).toBeTruthy()

    await page.addInitScript(
      ([p, t]) => {
        localStorage.setItem('pubkey', p as string)
        localStorage.setItem('authToken', t as string)
      },
      [buyerPubkey, buyer.data.token] as const,
    )

    await page.goto(`/tickets/${ticketId}`)
    await expect(page.getByText(offerTitle)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('PENDING', { exact: true })).toBeVisible()
    await expectNoCriticalViolations(page)
  })
})
