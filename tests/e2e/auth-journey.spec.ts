import { test, expect } from '@playwright/test'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip19 from 'nostr-tools/nip19'

// ADR-377 D2 — auth journey. The login page's default method signs a real
// kind-27235 challenge event client-side with the entered nsec (TabNsec), and
// the server cryptographically verifies it (nostr-auth.ts verifyEvent) — so
// this spec generates a REAL throwaway key instead of faking window.nostr.
//
// Flow: guest hits an auth-gated route → /login?next= … → nsec login →
// LightningLinkPrompt (skip) → hard redirect back to the gated route →
// session survives reload → logout clears it.

test.describe('@smoke Auth Journey', () => {
  test('nsec login round-trips to returnTo, persists across reload, logout clears the session', async ({ page }) => {
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)
    expect(getPublicKey(sk)).toMatch(/^[0-9a-f]{64}$/)

    await test.step('guest hitting an auth-gated route is redirected to /login?next=', async () => {
      await page.goto('/buy/cart')
      await page.waitForURL((url) => url.pathname === '/login')
      expect(decodeURIComponent(new URL(page.url()).search)).toContain('/buy/cart')
    })

    await test.step('default method renders the nsec form (no extension present)', async () => {
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
      await expect(page.getByLabel('Private key (nsec)')).toBeVisible()
    })

    await test.step('nsec login completes and skips the optional Lightning link', async () => {
      await page.getByLabel('Private key (nsec)').fill(nsec)
      await page.getByRole('button', { name: 'Sign in with key' }).click()

      // Two-stage success: LightningLinkPrompt first, then the redirect screen.
      const skip = page.getByRole('button', { name: 'Skip for now' })
      await expect(skip).toBeVisible({ timeout: 15_000 })
      await skip.click()
      await expect(page.getByRole('heading', { name: 'Login successful' })).toBeVisible()
    })

    await test.step('hard redirect lands back on the gated route, authed', async () => {
      await page.waitForURL((url) => url.pathname === '/buy/cart', { timeout: 15_000 })
      await expect(page.getByText('Your cart is empty')).toBeVisible()
      await expect(page.getByText(/Review your items/i)).toBeVisible()
    })

    await test.step('session survives a reload', async () => {
      await page.reload()
      await page.waitForURL((url) => url.pathname === '/buy/cart')
      await expect(page.getByText('Your cart is empty')).toBeVisible()
    })

    await test.step('logout clears the session and returns home', async () => {
      await page.goto('/account')
      await page.getByRole('button', { name: 'Sign out' }).first().click()
      await page.waitForURL((url) => new URL(page.url()).pathname === '/')
      // The guard key must be gone (authToken intentionally survives logout —
      // documented quirk; assert on pubkey only).
      const pubkey = await page.evaluate(() => localStorage.getItem('pubkey'))
      expect(pubkey).toBeNull()
    })
  })
})
