import { test, expect } from '@playwright/test'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from './fixtures/roles'

// ADR-377 D2 — coop journey: partner accepts an OPEN cooperation in the UI,
// the initiator funds the escrow through the real UI (COOP_ESCROW_ENABLED=1
// per playwright.config beta-stack parity), and /coop/manage's tab shell
// renders. Requires BETA_MODE for the demo-pay leg of the Fund Escrow button.

const SERVER_BASE_URL = process.env.PLAYWRIGHT_SERVER_URL || 'http://localhost:4001'

async function api(method: string, path: string, body?: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${SERVER_BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, any> }
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

test.describe('@smoke Coop Journey', () => {
  test('partner accepts, initiator funds escrow, manage tabs render', async ({ browser }) => {
    const uniq = Date.now().toString(36)
    const initiatorPubkey = `e2ecin${uniq}`.padEnd(64, '0').slice(0, 64)
    const partnerPubkey = `e2ecpt${uniq}`.padEnd(64, '0').slice(0, 64)
    const initiator = await demoSession(initiatorPubkey)
    const partner = await demoSession(partnerPubkey)
    test.skip(!initiator || !partner, DEMO_LOGIN_SKIP_REASON)
    // Initiator needs the demo wallet for the Fund Escrow payment leg.
    await api('POST', '/api/wallet/create', { pubkey: initiatorPubkey }, initiator!.token)

    const title = `E2E Coop Journey ${uniq}`
    const coop = await api('POST', '/api/cooperations', {
      title, description: 'x', budgetSats: 5000, cooperationType: 'SERVICE',
    }, initiator!.token)
    const coopId = coop.data.cooperation.id
    expect(coopId).toBeTruthy()

    const partnerPage = await (await browser.newContext()).newPage()
    const initiatorPage = await (await browser.newContext()).newPage()
    await seedSession(partnerPage, partnerPubkey, partner!.token)
    await seedSession(initiatorPage, initiatorPubkey, initiator!.token)

    await test.step('partner accepts the OPEN cooperation', async () => {
      await partnerPage.goto(`/coop/${coopId}`)
      await expect(partnerPage.getByText(title).first()).toBeVisible({ timeout: 15_000 })
      await expect(partnerPage.getByText('OPEN', { exact: true }).first()).toBeVisible()
      await partnerPage.getByRole('button', { name: 'Accept Cooperation' }).click()
      await expect(partnerPage.getByText('ACCEPTED', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    })

    await test.step('initiator funds the escrow via the UI (beta demo-pay)', async () => {
      await initiatorPage.goto(`/coop/${coopId}`)
      const fund = initiatorPage.getByRole('button', { name: 'Fund Escrow' })
      await expect(fund).toBeVisible({ timeout: 15_000 })
      await fund.click()
      await expect(initiatorPage.getByText('PAID', { exact: true }).first()).toBeVisible({ timeout: 45_000 })
    })

    await test.step('manage shell lists it under the cooperations tab', async () => {
      await initiatorPage.goto('/coop/manage')
      await expect(initiatorPage.getByRole('tab', { name: 'Cooperations' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
      await expect(initiatorPage.getByText(title).first()).toBeVisible({ timeout: 15_000 })

      await initiatorPage.getByRole('tab', { name: 'Services' }).click()
      await initiatorPage.waitForURL(/\/coop\/manage\?tab=services/)
      await initiatorPage.getByRole('tab', { name: 'Agent Stack' }).click()
      await initiatorPage.waitForURL(/\/coop\/manage\?tab=stack/)
      await initiatorPage.getByRole('tab', { name: 'Bounties' }).click()
      await initiatorPage.waitForURL(/\/coop\/manage\?tab=bounties/)
    })

    await Promise.all([partnerPage.context().close(), initiatorPage.context().close()])
  })
})
