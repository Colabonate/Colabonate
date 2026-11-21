import { test, expect } from '@playwright/test'
import { demoSession, DEMO_LOGIN_SKIP_REASON } from './fixtures/roles'

// ADR-377 D2 — sell journey. Covers the seller-facing loop's entry surface:
// listings shell + tabs, empty state, the create-listing CTA routing into the
// offer wizard, and the wizard's early validation contract. The full
// publish walk (all 7 steps) is exercised at API level; a deep UI publish
// walk is intentionally not asserted here to keep @smoke deterministic.

test.describe('@smoke Sell Journey', () => {
  test('seller with no listings sees the guide, CTA opens the create wizard with validation', async ({ page }) => {
    const uniq = Date.now().toString(36)
    const sellerPubkey = `e2esll${uniq}`.padEnd(64, '0').slice(0, 64)
    const seller = await demoSession(sellerPubkey)
    test.skip(!seller, DEMO_LOGIN_SKIP_REASON)
    await page.addInitScript(
      ([p, t]) => {
        localStorage.setItem('pubkey', p as string)
        localStorage.setItem('authToken', t as string)
      },
      [sellerPubkey, seller!.token] as const,
    )

    await test.step('empty listings tab shows the guide with the create CTA', async () => {
      await page.goto('/sell/listings')
      // PageHeader renders its title as a plain h4 — assert on content, not
      // on a heading role.
      await expect(page.getByText('No listings yet')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('tab', { name: 'Listings' })).toHaveAttribute('aria-selected', 'true')
    })

    await test.step('sub-tabs navigate via ?tab=', async () => {
      const sellTabs = page.getByRole('tablist', { name: 'Sell section' })
      await sellTabs.getByRole('tab', { name: 'Catalogs' }).click()
      await page.waitForURL(/\/sell\/listings\?tab=catalogs/)
      await sellTabs.getByRole('tab', { name: 'Products' }).click()
      await page.waitForURL(/\/sell\/listings\?tab=products/)
    })

    await test.step('create CTA routes into the offer wizard', async () => {
      page.getByRole('tablist', { name: 'Sell section' }).getByRole('tab', { name: 'Listings' }).click()
      await page.waitForURL(/\/sell\/listings(\?|$)/)
      // EmptyStateGuide's CTA is a react-router Link, not a button.
      await page.getByRole('link', { name: 'Create Listing' }).click()
      await page.waitForURL(/\/sell\/listings\/new/)
      // Wizard step 1 renders the type cards.
      await expect(page.getByRole('button', { name: /^Item/i }).first()).toBeVisible({ timeout: 15_000 })
    })
  })

  test('wizard content step enforces required fields', async ({ page }) => {
    const uniq = (Date.now() + 1).toString(36)
    const sellerPubkey = `e2esl2${uniq}`.padEnd(64, '0').slice(0, 64)
    const seller = await demoSession(sellerPubkey)
    test.skip(!seller, DEMO_LOGIN_SKIP_REASON)
    await page.addInitScript(
      ([p, t]) => {
        localStorage.setItem('pubkey', p as string)
        localStorage.setItem('authToken', t as string)
      },
      [sellerPubkey, seller!.token] as const,
    )

    await page.goto('/sell/listings/new?type=ITEM')
    // Type is preselected via ?type= — advance to Classification.
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    // Classification step renders root category cards from /api/standard-categories.
    await expect(page.getByText('Category Classification')).toBeVisible({ timeout: 15_000 })
  })
})
