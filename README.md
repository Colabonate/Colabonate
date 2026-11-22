# Colabonate

Colabonate is a **Nostr extension** — an open protocol for *Decentralized
Collaborative Commerce (DCC)* that adds marketplace, escrow, ticket and
cooperation primitives to Nostr and settles in Bitcoin.

This repository is the **reference implementation**: a web app, a reference
server, an MCP server and the workspace packages that together implement the
protocol.

- Listings travel on **NIP-99** (`Kind 30402`).
- Orders travel on **NIP-17** (`Kind 16/17`), with a public, addressable
  checkout state alongside.
- Payments are **Direct-Pay** — the buyer pays the seller directly over
  Lightning; no custody, no escrow by default.
- Escrow is specified, opt-in and non-custodial, and is **not live** today.

## What Colabonate does

### Commerce

| Feature | What it is | Status |
|---|---|---|
| **Marketplace** | NIP-99 listings (`30402`), buy/sell, catalog, collections — discoverable in other Nostr marketplaces | live |
| **Ticket system** | a public, auditable checkout state (`30407`/`30408`) — `PENDING → ACCEPTED → PAID → IN_PROGRESS → COMPLETED`, with cancellation and disputes | live |
| **Direct-Pay** | the buyer pays the seller directly over Lightning or Cashu; no custody, no escrow by default | live |
| **Standard categories** | a structured product catalog (UNSPSC-based) with a mapping to the Open Markets tag vocabulary | live |
| **Shipping & delivery** | shipping options (`30406`) and delivery templates | live |

### Trust layer

| Feature | What it is | Status |
|---|---|---|
| **Escrow Trade Desk** | a full escrow-transaction surface — trade list ("Deck"), single-trade cockpit, counterparty identity (NIP-17) and evidence export | behind flag, not live |
| **ISO 20022 interoperability** | an interop view and `ISO 20022` mapping (`endToEndId`, party identifiers) for escrow trades | behind flag, not live |
| **Dispute & arbitration** | 3-level escalation (self-service → mediation → arbitration), split verdicts, private arbiters, appeals, evidence export | live |
| **Reputation** | non-transferable credentials and reviews (`30410`/`30411`) | live |

### Collaboration

| Feature | What it is | Status |
|---|---|---|
| **Cooperation** | multi-party proposals with milestones (`30414`/`30415`) | live |
| **Workspaces** | MCP workspaces with members and recharge | live |
| **Bounties** | posted bounties as a cooperation type | live |
| **Company profiles** | merchant/company pages with reviews | live |

### Agents & AI

| Feature | What it is | Status |
|---|---|---|
| **Agent marketplace** | agent profiles, capability attestations, tasks, networks and reviews (`31416`–`31424`) | extension |
| **AI assistant** | hosted-LLM assistant with credit packs and usage policy | live |

### Platform & identity

| Feature | What it is | Status |
|---|---|---|
| **Human identity** | Nostr, email, Alby and MetaMask sign-in; NIP-05 identifiers | live |
| **Messaging** | NIP-17 encrypted counterparty messaging | live |
| **Notifications** | in-app and Nostr notifications | live |
| **Booking** | NIP-52 calendar-based bookings for bookable resources (`31922`–`31925`) | live |
| **DAO governance** | Colabonate's own governance layer: proposals, votes, the DAO codex and the arbitration council (`30420`–`30423`) | bootstrapping |
| **Remote interop** | ingesting and buying foreign NIP-99 listings (Open Markets ecosystem) | live |
| **MCP access** | a streamable MCP server with an access pass for agents | live |

## The protocol specification

The normative specification lives in its own repository:

- [**Colabonate/Colabonate_Protocol**](https://github.com/Colabonate/Colabonate_Protocol)
  — MIT-licensed, event kinds, tag shapes, the ticket state machine, the
  payment model and the governance layer.

The specification interoperates with the
[Open Markets specification](https://github.com/OpenMarketsFoundation/specification)
workspace: listings are discoverable in other Nostr marketplaces, and the
escrow / dispute / public-checkout layer is proposed there as an extension
rather than as a fork.

## Stack

| Layer | Technology |
|-------|------------|
| Web app (`apps/colabonate-app`) | React · TypeScript · Vite |
| Reference server (`apps/server`) | Node.js · Express · Prisma · PostgreSQL |
| MCP server (`apps/mcp-server`) | Streamable-HTTP MCP for agent access |
| Design system (`packages/ui`, `packages/tokens`, `packages/utils`) | Token-driven React components |
| Protocol packages | `packages/nostr-schema` · `packages/payments` · `packages/cashu-wallet` · `packages/data` |
| Canisters | `packages/icp-escrow-canister` · `packages/icp-workspace-canister` (Rust, Internet Computer) |

## Setup

```bash
git clone https://github.com/Colabonate/Colabonate.git
cd Colabonate

# Install dependencies (pnpm is invoked through npx)
npx pnpm install

# Build design tokens (required after first clone)
npx pnpm tokens:build

# Copy the environment template
cp .env_example .env

# Initialise the database (first time only)
cd apps/server && npx pnpm exec prisma migrate deploy && cd ../..

# Start the app and backend together
npx pnpm dev
```

- App → `http://localhost:5173`
- Server → `http://localhost:4001`
- Playground (design system) → `http://localhost:5174`

## Structure

```
apps/
  colabonate-app/   web app
  server/           reference server (Express + Prisma)
  mcp-server/       MCP server for agent access
packages/
  ui/               headless design-system components
  tokens/           design tokens
  utils/            shared utilities
  data/             category maps and data
  nostr-schema/     Zod schemas + builders for the protocol events
  payments/         payment-provider abstraction
  cashu-wallet/     Cashu eCash wallet
  agent-persona/    agent persona definitions
  icp-escrow-canister/     escrow canister (Rust)
  icp-workspace-canister/  workspace canister (Rust)
prisma/
  schema.prisma     data model
  migrations/       Postgres migrations
```

## Testing

```bash
npx pnpm test       # vitest unit suite
npx pnpm test:e2e   # playwright browser flows
```

## License

The whole repository — including the protocol specification it references — is
licensed under the [MIT License](LICENSE).

The **canonical** protocol specification is maintained separately in
[`Colabonate/Colabonate_Protocol`](https://github.com/Colabonate/Colabonate_Protocol)
and is also MIT licensed.

## Security

The platform is non-custodial by design: the buyer pays the seller directly,
the server never holds funds, and escrow is opt-in and not live. Private keys
stay client-side. See [SECURITY.md](SECURITY.md) for the disclosure process and
the security model.

## Contributing

- **[AGENTS.md](AGENTS.md)** — how to find your way around, the architecture, and
  the coding conventions.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — the workflow (fork, PR, testing).
- **[openmarkets_agents.md](openmarkets_agents.md)** — the protocol and the
  OpenMarkets interoperability.

Changes to the **protocol** itself go to the protocol repository; this
repository carries the reference implementation.
