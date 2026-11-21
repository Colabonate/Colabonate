import { test, expect } from '@playwright/test'

// ADR-330 FU-501 + ADR-365: Coop Guide navigation contract.
// - ?step= is the step source of truth (id-based), pushed on transitions
// - refresh lands on the exact step; browser-back/forward walk the wizard
// - back is pure view navigation — selections survive
// - ADR-365 D2: the Model step merged Category Classification in — the create
//   flow is Guide → Model & Category → Details (3 steps) for projects AND
//   tenders (tenders auto-select TENDER, no separate Model-only page)
// - legacy ?role&type&action&model links still resolve via derivation (to the
//   merged model step); legacy ?step=classification deep links map to model
//
// Synchronization note: the hook reads from window.location.search on every
// URL write (syncParams/goTo in useCoopGuide.ts) so rapid clicks don't lose
// params to the stale-updater race. The waitForFunction calls below are
// belt-and-braces — if the race ever resurfaces, they pinpoint which click
// lost the param rather than masking it as a timeout.

test.describe('Coop Guide navigation (ADR-330)', () => {
  // FU-640: Lenis smooth-scroll runs an endless rAF easing loop whose
  // sub-pixel layout drift keeps Playwright's click-stability check from ever
  // settling. Lenis (and the selected-card GSAP glow) fully disable themselves
  // under prefers-reduced-motion — emulate it for this spec.
  test.use({ reducedMotion: 'reduce' })

  // FU-640: /coop/guide is auth-gated — mint a demo session per test
  // (DEMO_LOGIN_ENABLED=1 in playwright.config webServer env) and seed
  // localStorage before any app script runs, so the spec passes the login
  // wall without a UI login round-trip.
  test.beforeEach(async ({ page, request }) => {
    const pubkey = `${'aa'.repeat(32)}`
    const res = await request.post('/api/auth/demo', { data: { pubkey } })
    if (!res.ok()) throw new Error(`demo login failed: HTTP ${res.status()}`)
    const { token } = (await res.json()) as { pubkey: string; token: string }
    await page.addInitScript(
      ([p, t]) => {
        localStorage.setItem('pubkey', p as string)
        localStorage.setItem('authToken', t as string)
      },
      [pubkey, token] as const,
    )
  })

  test('create·projects: step transitions push history; back never mutates selections', async ({ page }) => {
    await page.goto('/coop/guide')
    await expect(page.getByText(/^\d+ \/ \d+$/).first()).toBeVisible()
    expect(page.url()).not.toMatch(/[?&]step=/)

    await page.getByRole('button', { name: /Corporate/i }).first().click()
    await page.waitForFunction(() => /[?&]role=corporate\b/.test(window.location.search))
    await page.getByRole('button', { name: /^Projects/i }).first().click()
    await page.waitForFunction(() => /[?&]type=projects\b/.test(window.location.search))
    await page.getByRole('button', { name: /^Create/i }).first().click()
    await page.waitForFunction(() => /[?&]action=create\b/.test(window.location.search))

    const continueBtn = page.getByRole('button', { name: 'Continue', exact: true })
    await continueBtn.click()
    await page.waitForURL(/[?&]step=model\b/)
    await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /Transactional/i }).first().click()
    await page.waitForFunction(() => /[?&]model=TRANSACTIONAL\b/.test(window.location.search))
    await continueBtn.click()
    await page.waitForURL(/[?&]step=details\b/)
    await expect(page.getByText('3 / 3', { exact: true })).toBeVisible()

    // Refresh lands on the exact step (was: dropped back to Model)
    await page.reload()
    await expect(page.getByText('3 / 3', { exact: true })).toBeVisible()
    expect(page.url()).toMatch(/[?&]step=details\b/)

    // Browser-back walks to the merged Model & Category step; the model
    // selection survives (pure navigation)
    await page.goBack()
    await page.waitForURL(/[?&]step=model\b/)
    await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Transactional/i }).first()).toBeVisible()

    // Browser-forward works symmetrically. Wait for the rendered step, not
    // just the URL — guide.goBack reads state.step, which commits one React
    // render after the pop; clicking Back on the URL alone races that commit
    // and lands on the guide step instead (FU-640).
    await page.goForward()
    await page.waitForURL(/[?&]step=details\b/)
    await expect(page.getByText('3 / 3', { exact: true })).toBeVisible()

    // Footer Back button returns to the merged Model step, again keeping selections
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(/[?&]step=model\b/)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL(/[?&]step=guide\b/)

    // ArrowLeft on the first step exits the wizard to /coop
    await page.keyboard.press('ArrowLeft')
    await page.waitForURL(/\/coop(\?.*)?$/)
  })

  test('create·tenders: 3 steps, Continue advances to the merged Model & Category step', async ({ page }) => {
    await page.goto('/coop/guide')
    await page.getByRole('button', { name: /Corporate/i }).first().click()
    await page.waitForFunction(() => /[?&]role=corporate\b/.test(window.location.search))
    await page.getByRole('button', { name: /^Tenders/i }).first().click()
    await page.waitForFunction(() => /[?&]type=tenders\b/.test(window.location.search))
    await page.getByRole('button', { name: /^Create/i }).first().click()
    await page.waitForFunction(() => /[?&]action=create\b/.test(window.location.search))
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await page.waitForURL(/[?&]step=model\b/)
    await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()
  })

  test('legacy selection-param links resolve via derivation fallback', async ({ page }) => {
    await page.goto('/coop/guide?role=private&type=projects&action=create&model=PRODUCTION')
    await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()

    await page.goto('/coop/guide?role=corporate&type=projects&action=create')
    await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()

    // Legacy ?step=classification (pre-ADR-365 merge) resolves to the merged
    // model step instead of an unknown step
    await page.goto('/coop/guide?role=private&type=projects&action=create&model=SERVICE&step=classification')
    await page.waitForURL(/[?&]step=model\b/)
    await expect(page.getByText('2 / 3', { exact: true })).toBeVisible()
  })

  test('manage: footer hidden at result; guide.goBack walks to step guide then out to /coop', async ({ page }) => {
    await page.goto('/coop/guide?role=corporate&type=projects&action=manage')
    await expect(page.getByText('2 / 2', { exact: true })).toBeVisible()
    // Footer Back is hidden at the result step (ADR-330 footer-visibility rule).
    // guide.goBack at step 'result' goes to step 'guide' (first in the manage
    // flow); ArrowLeft at step 'guide' then exits to /coop (ADR-330 D4).
    await page.getByRole('button', { name: 'Back', exact: true }).waitFor({ state: 'hidden' })
    await page.keyboard.press('ArrowLeft')
    await page.waitForURL(/[?&]step=guide\b/)
    await page.keyboard.press('ArrowLeft')
    await page.waitForURL(/\/coop(\?.*)?$/)
  })

  test('find: redirects to the unified search page', async ({ page }) => {
    await page.goto('/coop/guide?role=private&type=projects&action=find')
    await page.waitForURL(/\/search\?context=coop/)
  })
})
