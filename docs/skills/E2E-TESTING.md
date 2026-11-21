# E2E Testing — Conventions & Taxonomy (ADR-377)

Binding rules for browser tests. Read this before writing or reviewing any Playwright spec.

## Taxonomy — where tests live and how they are tagged

| Home | Layer | Tags | Runs |
| --- | --- | --- | --- |
| `tests/e2e/*.spec.ts` | Real-browser **UI journeys** through complete flows | `@smoke` (blocking core set) / `@full` (depth) | `npx pnpm test:e2e`, `npx pnpm test:smoke` (PR gate) |
| `tests/api/*.spec.ts` | Contract-level flows via `ApiClient`, **no `page.*`** | `@api` (+ `@lnbits` when the real LNBits docker/regtest stack is required) | `npx pnpm test:api` |
| `tests/live/*.spec.ts` | **Read-only production drill** against the deployed app — no local servers, zero mutations, volume-budgeted for the prod rate limiter | `@live` | `npx pnpm test:live` + nightly CI |
| `apps/**/src/**/*.test.ts(x)` | Unit (node) / component (jsdom) — vitest | — | `npx pnpm test` |

Rules:

- A spec in `tests/e2e/` **must drive real UI** (`page.goto`, role-based locators, visible-state assertions). If it only calls APIs, it belongs in `tests/api/` and is tagged `@api`. Never let API smokes masquerade as UI coverage.
- A spec in `tests/live/` must stay **read-only against production**: GET navigations and public API probes only — no logins (demo login is 403 in production anyway), no entity/payment creation, no form submissions. Mind the anonymous rate-limit budget (~120 req/min/IP): every SPA page load costs 10–15 anonymous API calls; retry 429s with backoff, never hammer.
- Tags go in the `test.describe` title: `test.describe('@smoke Buy Journey', …)`. `--grep` matches titles.
- One spec = one user flow. Phases inside a test use `test.step('…')`.
- **Demo-login specs** mint sessions via `demoSession()` (fixtures/roles.ts) and `test.skip(!session, DEMO_LOGIN_SKIP_REASON)` when a reused local dev server lacks `DEMO_LOGIN_ENABLED` (FU-640 pitfall) — CI boots its own server with the flag and stays strict.

## The ten conventions (ADR-377 D3)

1. **Locators**: `getByRole` / `getByText` / `getByLabel`. `data-testid` only as a documented last resort.
2. **No `waitForLoadState('networkidle')` and no bare `waitForTimeout`** in new specs — wait for target elements/URLs instead. Exceptions need a justification comment (see existing FU-640 cases).
3. **Auth via role fixtures**, never a per-test UI login: `journeyTest` + `{ buyer, seller, partner }` from `tests/e2e/fixtures/roles.ts` (demo login + `addInitScript` localStorage seeding).
4. **Test data**: unique pubkeys/entities per run (`rolePubkey()` / `e2e-<flow>-<role>-…` pattern). No cross-test dependencies; every test creates its own data.
5. **Tagging**: `@smoke` / `@full` / `@api` / `@lnbits` — keep coverage reporting honest.
6. **URL is the oracle**: the app is URL-driven (`?context=`, `?step=`, `?tab=`). Assert with `page.waitForURL(/…/)` plus ARIA/visible state — never implementation internals.
7. **Payments**: WebLN/NIP-07 only via `injectWebLNMock` (`tests/e2e/helpers/webln-mock.ts`) — never real wallets.
8. **Rate limits**: the dev server allows 60 req/min. Deterministic UI assertions that don't test server data use `page.route` mocks (pattern: `home-coop-dock.spec.ts` test (e)); journeys that need server truth create their own entities and keep request counts low.
9. **Mobile**: critical journeys get a 390×844 project variant in `playwright.config.ts` — never copied specs (FU-706).
10. **Component tests** (once FU-704 lands): render + `userEvent` + assert on user-facing behavior only.

## Recipes

### Authenticated journey (buyer + seller)

```ts
import { journeyTest as test, expect } from './fixtures/roles'

test.describe('@smoke Ticket Escrow Journey', () => {
  test('buyer funds → seller accepts → buyer releases → COMPLETED', async ({ buyer, seller }) => {
    await test.step('buyer opens the offer', async () => {
      await buyer.goto(`/buy/product/${offerId}`)
      await expect(buyer.getByRole('button', { name: /buy/i })).toBeVisible()
    })
    // ...
  })
})
```

### Single-role journey

```ts
import { journeyTest as test, expect } from './fixtures/roles'

test.describe('@smoke Wallet Journey', () => {
  test('fresh user sees the wallet connect surface', async ({ buyer }) => {
    await buyer.goto('/wallet')
    // ...
  })
})
```

### Deterministic API mocking (rate-limit safe)

```ts
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
await page.route('**/api/search*', (r) => r.fulfill(json({ hits: [], estimatedTotalHits: 0 })))
```

## Debugging

- `npx pnpm test:e2e:ui` — interactive HTML runner
- `npx playwright test tests/e2e/<spec> --debug` — step-through inspector
- Report: `playwright-report/` (HTML, uploaded as CI artifact)

## Related

- [ADR-377](../decisions/377-ui-ux-test-coverage-core-user-flows.md) — decision record
- [UI-UX-TEST-COVERAGE-PLAN.md](../plans/UI-UX-TEST-COVERAGE-PLAN.md) — gap analysis + phased rollout
- [PAYMENTS.md](PAYMENTS.md) — ticket/escrow error contract (branch on `code`, not text)
