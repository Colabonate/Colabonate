# Contributing to Colabonate — Agent & Contributor Guide

Colabonate is a **Nostr extension** for decentralized commerce. This repository
is the **reference implementation** of the [Colabonate Protocol
specification](https://github.com/Colabonate/Colabonate_Protocol). Read this file
before writing code or proposing a change.

- Listings travel on **NIP-99** (`Kind 30402`).
- Orders travel on **NIP-17** (`Kind 16/17`), with a public, addressable
  checkout state alongside.
- Payments are **Direct-Pay** — the buyer pays the seller directly over
  Lightning; no custody, no escrow by default.
- Escrow is specified, opt-in and non-custodial, and is **not live** today.

For the protocol and the OpenMarkets collaboration specifically, see
[openmarkets_agents.md](openmarkets_agents.md).

---

## Repository structure (monorepo)

```
apps/
  colabonate-app/      web app (React + Vite) — routes, components, pages
  server/              reference server (Express + Prisma + PostgreSQL)
  mcp-server/          MCP server for agent access to the marketplace
packages/
  ui/                  headless design-system components (no state, no logic)
  tokens/              design tokens (tokens.json → css/tokens.css)
  utils/               shared utilities (cn(), formatting, …)
  data/                category maps and static data
  nostr-schema/        Zod schemas + builders for the protocol events (the core)
  payments/            payment-provider abstraction (Lightning / Cashu / NWC)
  cashu-wallet/        Cashu eCash wallet (NIP-60/61)
  agent-persona/       agent persona definitions
  icp-escrow-canister/     escrow canister (Rust, Internet Computer)
  icp-workspace-canister/  workspace canister (Rust)
prisma/
  schema.prisma        the data model (36 models)
  migrations/          Postgres migrations
scripts/               build / smoke / tooling scripts
tests/                 e2e (Playwright) and api tests
docs/                  API reference, entity overview, skills, NIP drafts
```

Workspace aliases (from `pnpm-workspace.yaml`):

| Import | Resolves to |
|---|---|
| `@ds/tokens` | `packages/tokens/tokens.json` |
| `@ds/ui` | `packages/ui/index.ts` |
| `@ds/utils` | `packages/utils/index.ts` |

## Architecture — how the pieces fit

```text
browser (colabonate-app)
   │  REST + SSE
   ▼
reference server (Express)
   │  Prisma
   ▼
PostgreSQL  ────  Meilisearch (search index)

Nostr relays ◄──► server + browser publish/read protocol events
                 (offers 30402, tickets 30407/30408, reviews, governance)
```

- **The server is the coordination layer.** It persists state, indexes search,
  and relays protocol events. The protocol events themselves are the source of
  truth that third parties (arbitrators, other marketplaces) can read.
- **Payments are rail-agnostic.** `packages/payments` abstracts Lightning
  (NWC / LNBits / Alby) and Cashu behind one provider interface. The buyer pays
  the seller directly; the server never holds funds.
- **The protocol is `packages/nostr-schema`.** Zod schemas and event builders
  are the single source of truth for tag vocabulary. Publishing validates
  through `safeParse` at the boundary.

## Finding your way (search & navigation)

- **A route → its page:** `apps/colabonate-app/src/routes/<area>/<Page>.tsx`.
  The route map is in `docs/navigation-overview.md`.
- **A server endpoint:** `apps/server/routes/*.ts`; the ~130 endpoints are
  documented in `docs/API.md`.
- **A data model entity:** `prisma/schema.prisma`; the 36 models are explained
  in `docs/ENTITY-OVERVIEW.md`.
- **A protocol event / tag:** `packages/nostr-schema/src/` — the canonical
  definitions.
- **A payment path:** `packages/payments/` and `apps/server/routes/wallet.ts`.

Grep for a symbol, then read the surrounding file. The codebase follows strict
naming conventions (PascalCase components, kebab-case files, `use*` hooks,
`camelCase` utilities, `SCREAMING_SNAKE` constants).

## Setup

```bash
git clone https://github.com/Colabonate/Colabonate.git
cd Colabonate

npx pnpm install                 # pnpm is invoked through npx (not in PATH)
npx pnpm tokens:build            # build design tokens (required after first clone)
cp .env_example .env             # points at local Postgres (port 5434)

cd apps/server && npx pnpm exec prisma db push && cd ../..

npx pnpm dev                     # app + backend together
```

- App → `http://localhost:5173`
- Server → `http://localhost:4001`
- Playground → `http://localhost:5174`

## Development workflow

1. Fork `Colabonate/Colabonate` and open a pull request against `main`.
2. Keep commits atomic; one feature / fix per commit.
3. Write or update tests for behaviour you change.
4. Run the checks before you open the PR.

```bash
npx pnpm test       # vitest unit suite
npx pnpm test:e2e   # Playwright browser flows
```

## Coding conventions

- **No hardcoded CSS** — only `var(--token-name)` or Tailwind token classes.
- **`cn()` from `@ds/utils`** for all class composition — never string concat.
- **`npx pnpm`** — `pnpm` is not in PATH.
- **Headless-first** — no logic/state in `packages/ui` components.
- **Mobile-first** — 360px base, always responsive.
- **Typography** — never style `h1`–`h6` via Tailwind; global styles come from
  `packages/tokens/css/typography.css`.
- **English only** — all code, comments, variable names, log messages.
- **`strict: true`** TypeScript — no `any` without justification.
- **Sats/fiat through the currency surface** — use `useCurrency()` /
  `<SatsAmount />` / `<SatsAmountInput />`; sats stay the single source of
  truth, fiat is display-only.
- **Key material never in logs** — code touching nsec/private keys, NWC
  connection URIs or session tokens must never log them.

## The protocol specification

The **normative** protocol specification is maintained separately in
[`Colabonate/Colabonate_Protocol`](https://github.com/Colabonate/Colabonate_Protocol)
(MIT licensed). This repository carries the reference implementation.

- Changes to the **protocol itself** (event kinds, tag shapes, state machine)
  belong in the protocol repository, not here.
- Architecture decisions are recorded in the protocol repository and in the
  private development repository; this public mirror intentionally does not
  publish the internal decision log.

## License

MIT — see [LICENSE](LICENSE). Contributions are accepted under the same
licence. See [SECURITY.md](SECURITY.md) for the disclosure process.
