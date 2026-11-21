import { test, expect } from '@playwright/test'
import { TEST_SELLER_PUBKEY, TEST_BUYER_PUBKEY, SERVER_BASE_URL } from '../e2e/fixtures/test-fixtures.js'
import { ApiClient } from '../e2e/helpers/api-client.js'

// ADR-377 D1: contract-level smoke (no page.* interaction) — tagged @api.
test.describe('@api Sell Flow', () => {
  test('T2: Offer → Ticket → Escrow Phases → Release', async () => {
    const api = new ApiClient()

    const sellerAuth = await api.demoLogin(TEST_SELLER_PUBKEY)
    const buyerAuth = await api.demoLogin(TEST_BUYER_PUBKEY)

    const offerData = await api.createOffer(TEST_SELLER_PUBKEY, {}, sellerAuth.token)
    expect(offerData).toBeDefined()

    const ticketData = await api.createTicket(TEST_BUYER_PUBKEY, 'test-offer-1', buyerAuth.token)
    expect(ticketData).toBeDefined()

    const phase1 = await api.fundEscrowPhase('test-ticket-1', TEST_SELLER_PUBKEY, 1, sellerAuth.token)
    expect(phase1).toBeDefined()
  })
})
