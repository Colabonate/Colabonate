import { test, expect } from '@playwright/test'
import { ApiClient } from '../e2e/helpers/api-client.js'

// ADR-377 D1: contract-level smoke (no page.* interaction) — tagged @api.
const INITIATOR = 'e2e-coop-initiator-00000000000000000000000000000000000000000000000000000000'
const PARTNER = 'e2e-coop-partner-000000000000000000000000000000000000000000000000000000000000'

test.describe('@api Cooperation Flow', () => {
  test('T3: Create → Accept → Fund Escrow → Webhook → PAID', async () => {
    const api = new ApiClient()

    const initiatorAuth = await api.demoLogin(INITIATOR)
    expect(initiatorAuth.token).toBeDefined()

    const partnerAuth = await api.demoLogin(PARTNER)
    expect(partnerAuth.token).toBeDefined()

    const createResult = await api.post('/api/cooperations', {
      title: 'E2E Test Cooperation',
      description: 'Integration test coop',
      budgetSats: 5000,
      cooperationType: 'SERVICE',
    }, initiatorAuth.token)
    expect(createResult.success).toBe(true)
    expect(createResult.cooperation.status).toBe('OPEN')
    const coopId = createResult.cooperation.id

    const acceptResult = await api.post(`/api/cooperations/${coopId}/accept`, {}, partnerAuth.token)
    expect(acceptResult.success).toBe(true)
    expect(acceptResult.cooperation.status).toBe('ACCEPTED')

    // fund-escrow is auth-gated now — act as the initiator.
    const fundResult = await api.post(`/api/cooperations/${coopId}/fund-escrow`, {}, initiatorAuth.token)
    expect(fundResult.success).toBe(true)
    expect(fundResult.invoice).toMatch(/^lnbc/)
    const { paymentHash } = fundResult

    const webhookResult = await api.post('/api/lightning/webhook', { payment_hash: paymentHash })
    expect(webhookResult.success).toBe(true)

    const statusResult = await api.get(`/api/cooperations/${coopId}`)
    expect(statusResult.cooperation.status).toBe('PAID')
  })
})
