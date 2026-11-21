# Contributing to Colabonate

Thank you for your interest in contributing! Colabonate is an open-source project
building a decentralized marketplace and cooperation platform on Bitcoin Lightning and Nostr.

## Prerequisites

- Node.js >= 20
- pnpm (via `npx pnpm`)
- A Lightning wallet for LNURL-Auth testing (e.g. Phoenix, Breez, Zeus)
- Optional: LNBits account for Lightning payment tests

## Setup

```bash
git clone https://github.com/Colabonate/Colabonate.git
cd Colabonate

# Install dependencies
npx pnpm install

# Build design tokens (always required after first clone)
npx pnpm tokens:build

# Copy environment template
cp .env_example .env
# .env points at the local Postgres from docker-compose (port 5434)

# Initialize database (first time only)
cd apps/server && npx pnpm exec prisma migrate deploy && cd ../..

# Start everything
npx pnpm dev
```

## Must Read Before Writing Code

| Document | Purpose |
|----------|---------|
| `AGENTS.md` | All coding rules (no hardcoded CSS, `cn()`, `npx pnpm`, ...) |
| [Colabonate_Protocol](https://github.com/Colabonate/Colabonate_Protocol) | Protocol concepts and status tags |
| `docs/skills/ADD-COMPONENT.md` | How to add a new UI component |
| `docs/skills/TOKEN-PIPELINE.md` | How the token pipeline works |

## The protocol specification lives in its own repository

The **normative** protocol specification is maintained in
[`github.com/Colabonate/Colabonate_Protocol`](https://github.com/Colabonate/Colabonate_Protocol)
(MIT licensed). This repository carries the **reference implementation** only; the
specification is linked, not copied.

→ Changes to the protocol itself are proposed in the protocol repository.

## Branch Strategy

```
main        ← stable, merged via PR only
feature/*   ← new features
fix/*       ← bug fixes
docs/*      ← documentation only
```

## Pull Requests

1. Fork the repository
2. Create a branch from `main`: `git checkout -b feature/my-feature`
3. Keep commits atomic (one feature / fix per commit)
4. Open a PR against `main`
5. Fill out the PR template completely

## Architecture Decisions

For larger changes (new package, schema change, new protocol type, new dependency):
→ Open a GitHub Issue or Discussion first and describe the decision and its alternatives

## Protocols and Stack

Colabonate is **Bitcoin-only**. Please read the vision in the
[protocol repository](https://github.com/Colabonate/Colabonate_Protocol) before proposing
features. Concepts involving EVM, NFTs, Solana, Polygon, or altcoins are out of scope.

## Code Conventions (summary)

- No hardcoded CSS values — only token references (`var(--token-name)`) or Tailwind
- Use `cn()` from `@ds/utils` for all class composition
- Always use `npx pnpm` — `pnpm` is not in PATH
- `strict: true` TypeScript — no `any` without justification
- Headless components only in `packages/ui` — no state, no logic

## Communication

- **Issues:** GitHub Issues (bug reports, feature requests)
- **Discussion:** GitHub Discussions or Nostr (details TBD)
- **Language:** English (code, issues, PRs) or German (also welcome)

## Licence

The whole repository is licensed under the [MIT License](LICENSE), see the protocol
repository for the specification's licence. See [SECURITY.md](SECURITY.md) for the responsible-disclosure
process.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
