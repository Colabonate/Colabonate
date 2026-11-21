import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/payments/src/**/*.test.ts',
      'packages/nostr-schema/src/**/*.test.ts',
      'packages/cashu-wallet/src/**/*.test.ts',
      'packages/agent-persona/src/**/*.test.ts',
      'apps/server/src/**/*.test.ts',
      'apps/server/services/**/*.test.ts',
      'apps/server/lib/**/*.test.ts',
      'apps/server/middleware/**/*.test.ts',
      // Route-level contract tests (supertest + mocked Prisma): the coverage
      // include below already listed apps/server/routes/**/*.ts, but the test
      // glob was missing — route tests were never collected (fixed 2026-09-18
      // alongside the ADR-240 LNURL-pay + ADR-381 prod-guard route tests).
      'apps/server/routes/**/*.test.ts',
      'apps/mcp-server/src/**/*.test.ts',
      'apps/canvas-agent-runner/src/**/*.test.ts',
      'apps/colabonate-app/src/lib/**/*.test.ts',
      'apps/colabonate-app/src/hooks/**/*.test.ts',
      'apps/colabonate-app/src/config/**/*.test.ts',
      'apps/colabonate-app/src/components/offers/**/*.test.ts',
      'apps/colabonate-app/src/components/marketplace/**/*.test.ts',
      'apps/colabonate-app/src/routes/onboarding/**/*.test.ts',
      // ADR-377 Phase 2 (FU-704): component tests (render + userEvent), jsdom
      // via each file's own `// @vitest-environment jsdom` pragma — the
      // global `environment: 'node'` above stays untouched for every other
      // (non-component) test in this config.
      'apps/colabonate-app/src/components/currency/**/*.test.tsx',
      'apps/colabonate-app/src/components/kpi/**/*.test.tsx',
      'apps/colabonate-app/src/components/tickets/**/*.test.tsx',
      'apps/colabonate-app/src/components/offers/**/*.test.tsx',
      'apps/colabonate-app/src/components/login/**/*.test.tsx',
      'apps/colabonate-app/src/routes/sell/components/**/*.test.tsx',
      'apps/colabonate-app/src/routes/buy/components/**/*.test.tsx',
      'apps/colabonate-app/src/context/**/*.test.tsx',
    ],
    coverage: {
      reporter: ['text', 'lcov'],
      include: [
        'packages/payments/src/**/*.ts',
        'packages/nostr-schema/src/**/*.ts',
        'packages/cashu-wallet/src/**/*.ts',
        'packages/agent-persona/src/**/*.ts',
        'apps/server/src/**/*.ts',
        'apps/server/routes/**/*.ts',
      ],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', '**/*.d.ts'],
    },
  },
})
