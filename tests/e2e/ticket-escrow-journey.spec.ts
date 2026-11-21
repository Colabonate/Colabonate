import { test, expect } from '@playwright/test'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from './fixtures/roles'

// ADR-377 D2 — ticket + escrow lifecycle journey (non-escrow direct-pay DEMO
// rail, the default in the e2e environment):
// PENDING --buyer demo-pay--> PAID --seller Confirm & Start--> IN_PROGRESS
// --buyer Confirm Receipt--> COMPLETED, plus the Report-issue dispute path.
// Both parties drive the real UI; cross-party state changes are picked up by
// reloading the detail page (its own poll interval is 30 s — too slow for CI).

const SERVER_BASE_URL = process.env.PLAYWRIGHT_SERVER_URL || 'http://localhost:4001'

async function api(method: string, path: string, body?: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${SERVER_BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> }
}

async function setupTicket(uniq: string) {
  const sellerPubkey = `e2etsl${uniq}`.padEnd(64, '0').slice(0, 64)
  const buyerPubkey = `e2etby${uniq}`.padEnd(64, '0').slice(0, 64)
  const seller = await demoSession(sellerPubkey)
  const buyer = await demoSession(buyerPubkey)
  if (!seller || !buyer) return null as const
  await api('POST', '/api/wallet/create', { pubkey: sellerPubkey }, seller.token)
  await api('POST', '/api/wallet/create', { pubkey: buyerPubkey }, buyer.token)
  const title = `E2E Ticket Journey ${uniq}`
  // ITEM (not SERVICE): the ticket UI's seller action at PAID ("Confirm &
  // Start") is gated on offerType !== 'SERVICE' — SERVICE tickets accept at
  // PENDING instead and have no PAID-state seller button.
  const offer = await api('POST', '/api/offers', {
    title, description: 'x', priceSats: 10000, offerType: 'ITEM', sellerPubkey,
  }, seller.token)
  const ticket = await api('POST', '/api/tickets', {
    offerId: offer.data.offer.id, amountSats: 10000, buyerPubkey,
  }, buyer.token)
  return {
    title,
    ticketId: ticket.data.ticket.id as string,
    buyer: { pubkey: buyerPubkey, token: buyer.token },
    seller: { pubkey: sellerPubkey, token: seller.token },
  }
}

async function seedSession(page: import('@playwright/test').Page, pubkey: string, token: string) {
  await page.addInitScript(
    ([p, t]) => {
      localStorage.setItem('pubkey', p as string)
      localStorage.setItem('authToken', t as string)
    },
    [pubkey, token] as const,
  )
}

test.describe('@smoke Ticket Escrow Journey', () => {
  test('buyer pays → seller starts → buyer confirms receipt → COMPLETED', async ({ browser }) => {
    const ctx = await setupTicket(Date.now().toString(36) + 'a')
    test.skip(!ctx, DEMO_LOGIN_SKIP_REASON)
    if (!ctx) return // narrows for TS — test.skip(true) already ended the run
    const buyerPage = await (await browser.newContext()).newPage()
    const sellerPage = await (await browser.newContext()).newPage()
    await seedSession(buyerPage, ctx.buyer.pubkey, ctx.buyer.token)
    await seedSession(sellerPage, ctx.seller.pubkey, ctx.seller.token)
    const detail = (p: typeof buyerPage) => `/tickets/${ctx.ticketId}`

    await test.step('buyer sees the PENDING ticket and demo-pays it', async () => {
      await buyerPage.goto(detail(buyerPage))
      await expect(buyerPage.getByText(ctx.title).first()).toBeVisible({ timeout: 15_000 })
      // The detail header shows the raw status enum (the label mapping is
      // list-page only).
      await expect(buyerPage.getByText('PENDING', { exact: true }).first()).toBeVisible()
      await buyerPage.getByRole('button', { name: /Pay with demo wallet/i }).click()
      await expect(buyerPage.getByText('Demo payment confirmed!')).toBeVisible({ timeout: 30_000 })
    })

    await test.step('seller confirms & starts fulfillment', async () => {
      await sellerPage.goto(detail(sellerPage))
      await expect(sellerPage.getByText('PAID', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
      await sellerPage.getByRole('button', { name: /Confirm & Start/i }).click()
      // The action auto-navigates back after ~3 s — let it, then re-enter.
      await sellerPage.waitForURL((url) => url.pathname !== `/tickets/${ctx.ticketId}`, { timeout: 15_000 }).catch(() => {})
      await sellerPage.goto(detail(sellerPage))
      await expect(sellerPage.getByText('IN_PROGRESS', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    })

    await test.step('buyer confirms receipt → COMPLETED', async () => {
      await buyerPage.goto(detail(buyerPage))
      await expect(buyerPage.getByText('IN_PROGRESS', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
      await buyerPage.getByRole('button', { name: 'Confirm Receipt' }).click()
      // Auto-navigates back after 1.5 s — return to the detail to assert.
      await buyerPage.waitForURL((url) => url.pathname !== `/tickets/${ctx.ticketId}`, { timeout: 15_000 }).catch(() => {})
      await buyerPage.goto(detail(buyerPage))
      await expect(buyerPage.getByText('COMPLETED', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    })

    await Promise.all([buyerPage.context().close(), sellerPage.context().close()])
  })

  test('report issue flips the ticket to DISPUTED with the council banner', async ({ browser }) => {
    const ctx = await setupTicket(Date.now().toString(36) + 'b')
    test.skip(!ctx, DEMO_LOGIN_SKIP_REASON)
    if (!ctx) return // narrows for TS — test.skip(true) already ended the run
    const buyerPage = await (await browser.newContext()).newPage()
    await seedSession(buyerPage, ctx.buyer.pubkey, ctx.buyer.token)

    await buyerPage.goto(`/tickets/${ctx.ticketId}`)
    await expect(buyerPage.getByText('PENDING', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await buyerPage.getByRole('button', { name: 'Report issue' }).click()
    // PATCH DISPUTED succeeds → snackbar → auto-navigates back after ~3 s.
    await buyerPage.waitForURL((url) => url.pathname !== `/tickets/${ctx.ticketId}`, { timeout: 15_000 }).catch(() => {})
    await buyerPage.goto(`/tickets/${ctx.ticketId}`)
    await expect(buyerPage.getByText('DISPUTED', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await expect(buyerPage.getByText(/under dispute review/i).first()).toBeVisible()

    await buyerPage.context().close()
  })
})
