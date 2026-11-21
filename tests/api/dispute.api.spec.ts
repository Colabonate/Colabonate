import { test, expect } from '@playwright/test'
import { ApiClient } from '../e2e/helpers/api-client.js'

// ADR-377 D1: contract-level smoke (no page.* interaction) — tagged @api.
const BUYER = 'e2e-dispute-buyer-00000000000000000000000000000000000000000000000000000000'
const SELLER = 'e2e-dispute-seller-0000000000000000000000000000000000000000000000000000000'

test.describe('@api Dispute Flow', () => {
  test('T4: Offer → Ticket → Dispute opened → DISPUTED state verified', async () => {
    const api = new ApiClient()

    const buyerAuth = await api.demoLogin(BUYER)
    expect(buyerAuth.token).toBeDefined()

    const sellerAuth = await api.demoLogin(SELLER)
    expect(sellerAuth.token).toBeDefined()

    // POST /api/tickets rejects wallet-less buyers with 400 WALLET_REQUIRED —
    // bootstrap the custodial demo wallets first (same as BuyCartFlow does).
    // The SELLER wallet matters too: it is what the ticket's direct-pay DEMO
    // rail resolves against (ADR-255 D1) once the synthetic @demo.local
    // lnAddress is skipped.
    const buyerWallet = await api.createWallet(BUYER, buyerAuth.token)
    expect(buyerWallet.success ?? buyerWallet.wallet).toBeTruthy()
    const sellerWallet = await api.createWallet(SELLER, sellerAuth.token)
    expect(sellerWallet.success ?? sellerWallet.wallet).toBeTruthy()

    const offerResult = await api.post('/api/offers', {
      title: 'E2E Dispute Test Offer',
      description: 'Offer for dispute E2E test',
      priceSats: 10000,
      offerType: 'SERVICE',
    }, sellerAuth.token)
    expect(offerResult.success).toBe(true)
    const offerId = offerResult.offer.id

    const ticketResult = await api.post('/api/tickets', {
      offerId,
      amountSats: 10000,
    }, buyerAuth.token)
    expect(ticketResult.success).toBe(true)
    const ticketId = ticketResult.ticket.id

    const disputeResult = await api.post(`/api/tickets/${ticketId}/dispute`, {
      callerPubkey: BUYER,
      reason: 'E2E test dispute: service not delivered',
    }, buyerAuth.token)
    expect(disputeResult.success).toBe(true)
    expect(disputeResult.dispute).toBeDefined()
    expect(disputeResult.dispute.status).toBe('OPEN')

    const ticketCheck = await api.get(`/api/tickets/${ticketId}`, buyerAuth.token)
    expect(ticketCheck.ticket.status).toBe('DISPUTED')

    // Escalation + verdict require coolingOffDays=0 and an active DAO arbitrator.
    // Those conditions are not met by the default seed (coolingOffDays=7, no test arbitrator).
    // Add an escalation E2E test when the seed includes a test arbitrator with coolingOffDays=0.
  })
})
