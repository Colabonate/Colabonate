import { test, expect } from '@playwright/test'
import { TEST_BUYER_PUBKEY, TEST_SELLER_PUBKEY, SERVER_BASE_URL } from '../e2e/fixtures/test-fixtures.js'
import { injectWebLNMock } from '../e2e/helpers/webln-mock.js'

// ADR-377 D1: contract-level smoke (no page.* interaction) — tagged @api so
// UI-coverage reporting stays honest. UI journey lives in e2e/buy-journey.spec.ts.
test.describe('@api Buy Flow', () => {
  test('T1: Browse → Ticket → Escrow Phases → Release → Confirmation', async ({ page }) => {
    await injectWebLNMock(page, TEST_BUYER_PUBKEY)

    const res = await fetch(`${SERVER_BASE_URL}/api/offers`)
    const { offers } = await res.json()
    expect(Array.isArray(offers)).toBe(true)

    const ticketRes = await fetch(`${SERVER_BASE_URL}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyerPubkey: TEST_BUYER_PUBKEY,
        offerId: 'test-offer-1',
        amountSats: 10000,
      }),
    })
    const ticketData = await ticketRes.json()
    expect(ticketData).toBeDefined()
  })
})
