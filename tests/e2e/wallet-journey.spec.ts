import { test, expect } from '@playwright/test'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from './fixtures/roles'

// ADR-377 D2 — wallet journey: a fresh demo user sets up the ADR-197/255
// DEMO wallet from the dashboard, and the send form enforces invoice
// validation. (The beta card no longer says "custodial" — the beta rail is the
// simulation ledger, and production provisions no wallet at all, ADR-381.)

test.describe('@smoke Wallet Journey', () => {
  test('fresh user creates the demo wallet; send form validates invoices', async ({ page }) => {
    const uniq = Date.now().toString(36)
    const pubkey = `e2ewal${uniq}`.padEnd(64, '0').slice(0, 64)
    const login = await demoSession(pubkey)
    test.skip(!login, DEMO_LOGIN_SKIP_REASON)
    await page.addInitScript(
      ([p, t]) => {
        localStorage.setItem('pubkey', p as string)
        localStorage.setItem('authToken', t as string)
      },
      [pubkey, login!.token] as const,
    )

    await test.step('wallet dashboard shows the setup card for a wallet-less user', async () => {
      await page.goto('/wallet')
      await expect(page.getByText('Set Up Your Wallet')).toBeVisible({ timeout: 15_000 })
    })

    await test.step('Create Demo Wallet bootstraps the DEMO wallet', async () => {
      await page.getByRole('button', { name: 'Create Demo Wallet' }).click()
      // The setup card disappears once WalletContext has an active wallet
      // (the balance/transaction surface replaces it).
      await expect(page.getByText('Set Up Your Wallet')).toBeHidden({ timeout: 30_000 })
      await expect(page.getByText('No transactions yet')).toBeVisible({ timeout: 15_000 })
    })

    await test.step('send form rejects non-invoice input and disables Send', async () => {
      await page.goto('/wallet/send')
      const invoice = page.getByLabel('Lightning invoice')
      await expect(invoice).toBeVisible({ timeout: 15_000 })
      await invoice.fill('definitely-not-an-invoice')
      await expect(page.getByText("This doesn't look like a Lightning invoice or LNURL.")).toBeVisible()
      // The send button relabels itself while no valid invoice is entered.
      await expect(page.getByRole('button', { name: 'Paste invoice to continue' })).toBeDisabled()
    })
  })
})
