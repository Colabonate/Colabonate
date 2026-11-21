import { defineConfig, devices } from '@playwright/test'

// ADR-377 live drill — READ-ONLY smoke against the production deployment
// (silent launch 2026-09-18: colabonate.app, invite cohort).
//
// Hard constraints (do not weaken):
//   - NEVER starts local dev servers (no webServer entry) — if these tests
//     run against localhost something is misconfigured.
//   - NEVER mutates production state: no logins (demo login is 403 in
//     production anyway, auth-session.ts), no ticket/payment creation, no
//     form submissions. GET navigations and public API probes only.
//
// Run: npx pnpm test:live
// Override target: PLAYWRIGHT_LIVE_BASE_URL=https://staging.example npx pnpm test:live
export default defineConfig({
  testDir: './tests/live',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-live-report', open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_LIVE_BASE_URL || 'https://colabonate.app',
    trace: 'retain-on-failure',
    // Public site: a stuck resource must fail the probe rather than hang it.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
  ],
})
