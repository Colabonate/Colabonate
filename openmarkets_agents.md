# OpenMarkets & Protocol — Agent Guide

This file is the entry point for anyone (human or agent) working on the
**Colabonate Protocol** and its **OpenMarkets** interoperability. It assumes
you have read the top-level [AGENTS.md](AGENTS.md).

---

## The protocol in one paragraph

The **Colabonate Protocol** is a Nostr extension for decentralized commerce.
It is maintained as an MIT-licensed specification in
[`Colabonate/Colabonate_Protocol`](https://github.com/Colabonate/Colabonate_Protocol)
— that repository is the **normative** source. This repository implements it.

- **Listings** are NIP-99 `Kind 30402` events.
- **Orders** are NIP-17 encrypted `Kind 16/17` messages, with a public,
  addressable **checkout state** (`Kind 30407`/`30408`) alongside so the
  transaction history stays publicly auditable.
- **Payments** are rail-agnostic: the proof tag carries a medium, a reference
  and a proof (Lightning, Bitcoin, Cashu, fiat gateway). Direct-Pay is the
  default; escrow is opt-in and non-custodial, and not live today.
- **Reputation** and **governance** are ordinary Nostr events, so any
  relay-connected client can compute them.

## The OpenMarkets collaboration

Colabonate interoperates with the wider Nostr commerce ecosystem rather than
competing with it. The coordination point is the
[Open Markets specification](https://github.com/OpenMarketsFoundation/specification)
workspace (MIT, fork of the former Gamma Markets `market-spec`).

The shared layer today:

| Concern | Shared surface | Notes |
|---|---|---|
| Listings | **NIP-99 `Kind 30402`** | Colabonate publishes **and** ingests 30402; listings are discoverable in, and orderable from, other marketplaces |
| Collections / shipping | `Kind 30405` / `Kind 30406` | adopted verbatim from the Open Markets spec |
| Orders | **NIP-17 `Kind 16/17`** | the encrypted order channel |
| Reviews | `Kind 31555` (NIP-85) | product reviews |
| Merchant discovery | `Kind 31989` / `31990` (NIP-89) | app recommendation + handler |

The layers that differ by design are the **transaction/checkout** and
**escrow/dispute** layers. Colabonate's contribution is proposed in the
OpenMarkets workspace (`proposals/escrow.md`) as an *extension*, not a fork:

- non-custodial, opt-in escrow (never mandatory, never a marketplace custodian);
- a public settlement skeleton + encrypted commercial payload, linked by a
  commitment;
- verdict outcomes `RELEASE` / `CANCEL` / `SPLIT` (with explicit buyer/seller
  basis points) and an even-split dispute timeout.

## Event kinds — quick reference

Colabonate's own kinds (canonical definitions in `packages/nostr-schema/src`):

| Kind | Purpose | Status |
|---|---|---|
| `30402` | Product listing (NIP-99) | live |
| `30407` | Ticket created | live |
| `30408` | Ticket status update | live |
| `30410` | Verification credential | live (dual of legacy `30021`) |
| `30411` | Reputation / review | live (dual of legacy `30024`) |
| `30420`–`30423` | Governance: proposal, vote, membership, comment | live |
| `31416`–`31424` | Agent marketplace (only `31419`, `31423` normative) | extension |
| `31922`–`31925` | Booking (NIP-52) | live |
| `9734` / `9735` | Zap request / receipt (NIP-57) | payment |

> **Kind-number discipline:** `30405` (collection) and `30406` (shipping) belong
> to the Open Markets specification. Never repurpose a kind number another
> party uses — when adding a new event, check the
> [Nostr kind registry](https://github.com/nostr-protocol/registry-of-kinds)
> and the Open Markets `SPEC.md` first, and prefer proposing an allocation
> rather than taking a number unilaterally.

## Where the protocol lives in this repository

| Location | What it contains |
|---|---|
| `packages/nostr-schema/src/` | Zod schemas, tag builders, status bridge — the single source of truth |
| `packages/nostr-schema/src/builders/` | `market-spec.ts` (Kind 16/17), co-emission, status bridge |
| `packages/payments/` | payment-provider abstraction and the payment-proof shapes |
| `packages/cashu-wallet/` | Cashu eCash (NIP-60/61) |
| `docs/nip-publications/` | our NIP drafts (NIP-A/B/C/P) and the registration template |
| `apps/server/routes/remote-orders.ts` | ingesting + buying foreign NIP-99 listings |
| `apps/server/lib/zap-request.ts` | NIP-57 zap purchase of a foreign listing |

## How to contribute to the OpenMarkets work

1. **Read the workspace first.** `OpenMarketsFoundation/specification` →
   `SPEC.md` (the compatibility snapshot), `AGENTS.md` (guardrails), and
   `proposals/escrow.md` (the workspace this project is filling).
2. **Never change the current spec in a proposal.** Structural PRs there must
   preserve kind numbers, tag shapes, examples and MUST/SHOULD/MAY language.
   Semantic changes go into a clearly-marked proposal under `proposals/`.
3. **Reference existing work exactly** — the NIP-115 draft and nostr/nips PR
   #2323 are the prior art for the escrow/checkout layer.
4. **State the compatibility and the disclosure** of any extension: which
   kinds it needs, whether it needs public state, and what each actor
   (marketplace, arbiter, relay, counterparty) sees.

This repository mirrors the protocol work; the canonical protocol decisions are
in the protocol repository and the internal development repository (not
published here).
