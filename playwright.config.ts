import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  // ADR-377 D1: tests/e2e = real-browser UI journeys (@smoke/@full),
  // tests/api = contract-level smokes (@api) and real-LNBits flows (@lnbits).
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    // channel 'chromium' = full Chromium in new headless mode — avoids the
    // separate chrome-headless-shell download (FU-640: shell build not cached
    // on this machine; full chromium-1217 matches @playwright/test 1.59.1).
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    // ADR-377 Phase 3 (FU-706): mobile viewport variant, scoped to the four
    // money journeys only (auth/buy/sell/ticket-escrow) via testMatch — not a
    // copy of the whole suite. 390×844 matches the viewport already used by
    // the ADR-324 dock mobile test (FU-342/FU-640).
    {
      name: 'mobile-chromium',
      testMatch: /(auth|buy|sell|ticket-escrow)-journey\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: [
    {
      command: 'npx pnpm dev:server',
      port: 4001,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER || 'mock',
        DATABASE_URL: process.env.DATABASE_URL || 'postgresql://colabonate:dev@localhost:5434/colabonate_test',
        WIPE_SECRET: process.env.WIPE_SECRET || 'test-secret',
        // Needed by the guest→login round-trip e2e tests: /api/auth/demo is
        // 403-gated without this flag (auth-session.ts).
        DEMO_LOGIN_ENABLED: process.env.DEMO_LOGIN_ENABLED || '1',
        // Beta-stack parity (docker-compose.beta.yml): BETA_MODE unlocks the
        // ADR-197/255 demo-payment rail ("Pay with demo wallet" →
        // /api/beta/demo-pay) and the DEMO-wallet seller fallback; the coop
        // escrow kill switch (ADR-255 D4) stays open so Cooperation escrow
        // flows are testable.
        BETA_MODE: process.env.BETA_MODE || 'true',
        COOP_ESCROW_ENABLED: process.env.COOP_ESCROW_ENABLED || '1',
      },
    },
    {
      command: 'npx pnpm dev:app',
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
})
