# Colabonate Server — Architecture Overview

Express + Prisma backend for the Colabonate marketplace.
Port: `4001` (HTTP + WebSocket on the same port).

---

## Table of Contents

1. [Stack & Entry Point](#1-stack--entry-point)
2. [Authentication: LNURL-Auth](#2-authentication-lnurl-auth)
3. [Nostr: What it is and what it is used for](#3-nostr-what-it-is-and-what-it-is-used-for)
4. [Identity Levels (L0–L3)](#4-identity-levels-l0l3)
5. [L1 Upgrade Flow in Detail](#5-l1-upgrade-flow-in-detail)
6. [Offers](#6-offers)
7. [Tickets](#7-tickets)
8. [Milestones](#8-milestones)
9. [Lightning Payments](#9-lightning-payments)
10. [Reviews & COL-Points](#10-reviews--col-points)
11. [Local Mock Relay (DEV)](#11-local-mock-relay-dev)
12. [Nostr Ticket Listener](#12-nostr-ticket-listener)
13. [Database Schema (Overview)](#13-database-schema-overview)
14. [Environment Variables](#14-environment-variables)
15. [API Reference](#15-api-reference)

---

## 1. Stack & Entry Point

| Component | Technology |
|---|---|
| HTTP Server | Express |
| Database | SQLite via Prisma + LibSQL adapter |
| WebSocket (Mock Relay) | `ws` package |
| Nostr client | `nostr-tools` (SimplePool) |
| Lightning | LNbits API (optional) |

**Entry point:** `apps/server/index.ts`

On startup the server:
1. Connects to the SQLite database via Prisma
2. Mounts all API routes
3. Starts listening on `APP_PORT` (default `4001`)
4. Attaches the Mock Nostr Relay to the same HTTP server (DEV only)
5. Starts the `NostrTicketListener` which subscribes to relay events

---

## 2. Authentication: LNURL-Auth

**Route:** `GET/GET /api/auth/lnurl`
**Service:** `services/lnurl-auth.ts`

LNURL-Auth is the only login mechanism. No passwords, no email, no OAuth.

### How it works

```
Browser                        Server                        Lightning Wallet
  |                              |                                |
  |-- GET /api/auth/lnurl -----> |                                |
  |<-- { lnurl, k1 } ---------- |                                |
  |                              |                                |
  | [User scans QR code with wallet]                              |
  |                              |<-- GET /callback?k1&sig&key -- |
  |                              | [verifySchnorrSignature]       |
  |                              | [upsert User in DB]            |
  |                              | [create Session with k1]       |
  |                              |-- { status: OK, pubkey } ----> |
  |                              |                                |
  |-- GET /status/:k1 --------> |                                |
  |<-- { status: authenticated, pubkey, lnAddress }              |
```

### Key points

- The server generates a random **k1 challenge** (32 random bytes as hex), valid for **5 minutes**
- The wallet signs the k1 with its private key using **Schnorr signature** (secp256k1)
- The server verifies the signature with `@noble/curves`
- The resulting `pubkey` (the wallet's public key) becomes the **user's permanent identity** in the DB
- `pubkey` and `lnAddress` are stored in `localStorage` on the frontend — **no session cookies**
- A `Session` row is created in the DB with a 24h expiry (currently used for status polling only)

### Important: LNURL-Auth pubkey ≠ Nostr pubkey

These are **two different keys**:

| Key | Source | Used for |
|---|---|---|
| `pubkey` (LNURL) | Lightning wallet | Primary DB identity, auth |
| `nostrPubkey` | Nostr extension or burner key | Nostr event signing, L1 identity |

---

## 3. Nostr: What it is and what it is used for

Nostr is a **decentralized publish-subscribe protocol** based on cryptographic keypairs. Events are JSON objects signed with a private key and broadcast to relays (WebSocket servers).

Colabonate uses Nostr as a **public broadcast layer** — not for auth.

### Nostr Event Kinds used in Colabonate

| Kind | Name | Published by | Purpose |
|---|---|---|---|
| `0` | User Profile | Frontend (client) | Name, Lightning Address, colabonate_pubkey |
| `30017` | Offer | Server (`nostrService`) | Marketplace offer listing |
| `30018` | Ticket Request | Frontend (client) | Buyer requests ticket from seller |
| `30019` | Ticket Status Update | Frontend (client) | Status changes (ACCEPTED, PAID, etc.) |
| `30021` | Identity Credential | Frontend (client) | Links LNURL pubkey ↔ Nostr profile (L1) |
| `30024` | Review | Frontend (client) | Post-ticket star rating + text |
| `30026` | Proximity Proof (Mock) | Frontend (client) | Peer verification for L2 (Phase 3 mock) |

### Signing

All client-side events go through `signAndPublishEvent()` in `apps/colabonate-app/src/lib/nostr.ts`:

1. **NIP-07 Browser Extension** (Alby, nos2x, etc.) — the user's real Nostr key signs the event
2. **Burner key fallback** — if no extension is installed, a random key is generated and stored in `localStorage('nostr_burner_key')`. This key is NOT tied to the user's identity and persists across sessions on the same device.

**Note:** The Lightning Address stored in a Nostr Kind-0 profile is a **self-claim only** — it is never verified against the actual Lightning network.

---

## 4. Identity Levels (L0–L3)

Stored in `User.identityLevel` (integer, DB).
Each level unlocks additional marketplace features.

| Level | Label | How to reach | COL-Points awarded |
|---|---|---|---|
| **L0** | Anonymous | Default on registration | — |
| **L1** | Nostr Profile | Publish Kind-0 + Kind-30021 to relay, then call `POST /api/identity/upgrade-l1` | — |
| **L2** | Peer Verified | Two community verifiers sign a proximity proof *(Phase 3: mock button)* | +50 pts |
| **L3** | HID Verified | Humanode Biomapper ZK-proof *(Phase 4: not yet implemented)* | — |

### What each level unlocks

| Feature | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| Browse marketplace | ✓ | ✓ | ✓ | ✓ |
| Create offers | — | ✓ | ✓ | ✓ |
| Open & accept tickets | — | ✓ | ✓ | ✓ |
| DAO governance votes | — | — | ✓ | ✓ |
| Higher ticket limits | — | — | ✓ | ✓ |
| Arbitrator eligibility | — | — | — | ✓ |
| 1-person-1-vote weight | — | — | — | ✓ |

---

## 5. L1 Upgrade Flow in Detail

The 3-step flow in `NostrProfileForm` (frontend) + `/api/identity/upgrade-l1` (server):

```
Step 1: publishNostrProfile()
  → Nostr Kind-0 event { name, lud16, colabonate_pubkey }
  → Signed by NIP-07 extension or burner key
  → Published to relay (ws://localhost:4001 in DEV, public relays in PROD)
  → Must be confirmed by at least 1 relay — throws Error if all relays reject

Step 2: publishIdentityCredential()
  → Nostr Kind-30021 event
  → Tags: credential_type=identity_level_1, hid_level=1, issued_by=<lnurl_pubkey>
  → Same relay + confirmation requirement as Step 1

Step 3: POST /api/identity/upgrade-l1 { pubkey, nostrPubkey, nip05? }
  → Validates: nostrPubkey must be 64 hex chars
  → Validates: user must exist and be at L0
  → Sets: User.identityLevel = 1, User.nostrPubkey, User.nip05
  → Returns updated user object
```

**Guard:** Steps 1 & 2 throw an error if all relays reject the event. Step 3 is never reached without successful relay confirmation.

---

## 6. Offers

**Routes:** `GET/POST /api/offers`, `GET /api/offers/:id`
**Defined in:** `index.ts` (inline, not a separate router file)

### Offer Types

| `offerType` | Behavior |
|---|---|
| `SERVICE` | 1x per buyer — seller must manually accept. Duplicate-ticket guard active. |
| `PRODUCT` | Unlimited quantity — ticket auto-moves to `IN_PROGRESS` (no seller accept needed) |

### Ticket Types

| `ticketType` | Behavior |
|---|---|
| `SMART_ORDER` | Simple single payment |
| `MILESTONE` | Split into multiple milestone payments (percentage-based) |

### Nostr publishing

When an offer is created via the REST API, the server automatically publishes a **Kind-30017** event to the relay (via `nostrService.publishOffer()`). If the relay is unavailable, this is logged as a warning but does **not** block the offer creation.

---

## 7. Tickets

**Routes:** `GET/POST /api/tickets`, `GET/PATCH /api/tickets/:id`
**Defined in:** `index.ts` (inline)

### Ticket Status Flow

```
PENDING → IN_PROGRESS → COMPLETED
        ↘ CANCELLED
                     ↘ DISPUTED
```

- **SERVICE offers:** Start as `PENDING`, seller must `accept` (→ `IN_PROGRESS`) or `reject` (→ `CANCELLED`)
- **PRODUCT offers:** Start directly as `IN_PROGRESS`

### COL-Points on completion

When a ticket reaches `COMPLETED`:
- Seller: **+10 COL-Points** (`TICKET_COMPLETED_SELLER`)
- Buyer: **+5 COL-Points** (`TICKET_COMPLETED_BUYER`)

### Milestone auto-creation

If the linked Offer has `OfferMilestone` rows, they are automatically copied into `Milestone` rows when the ticket is created. Amounts are calculated proportionally (`milestone.percentage / 100 * totalSats`).

### Dev utilities (Simulator)

| Endpoint | Effect |
|---|---|
| `DELETE /api/tickets/cache` | Deletes all tickets |
| `DELETE /api/tickets/wipe` | Deletes all tickets, milestones, reviews, offers (full DB reset) |

---

## 8. Milestones

**Routes:** `POST /api/milestones`, `PATCH /api/milestones/:id`

- Each milestone has its own `status` (`PENDING` → `COMPLETED`)
- When **all** milestones of a ticket are `COMPLETED`, the ticket is automatically set to `COMPLETED` and COL-Points are awarded

---

## 9. Lightning Payments

**Route:** `/api/lightning`
**Service:** `services/lnbits.ts`
**Router:** `routes/lightning.ts`

### With LNbits (real payments)

Set `LNBITS_ADMIN_KEY` and `LNBITS_INVOICE_KEY` in `.env`. The server creates and checks real BOLT11 invoices via the LNbits API.

### Without LNbits (mock mode)

If the env vars are not set, the server generates **mock BOLT11 strings** (not real invoices). Useful for UI development without a Lightning node.

> **Production guard (ADR-141 follow-up):** mock mode is **refused** when `NODE_ENV=production`.
> If `PAYMENT_PROVIDER=lnbits` (the default) and `LNBITS_ADMIN_KEY` / `LNBITS_INVOICE_KEY` are
> missing, the server **throws on startup** instead of silently settling real orders against fake
> invoices. Set both keys before deploying to production.

### Payment confirmation flow

```
LNbits webhook → POST /api/lightning/webhook { payment_hash }
  → Sets storedInvoices[payment_hash].status = PAID (in-memory)
  → Updates Ticket.status = PAID in DB (via paymentHash lookup)
```

### Escrow phases

For multi-phase payments: `POST /api/tickets/:id/escrow-phase { phase: 1|2|3 }`
Splits the total amount 25% / 50% / 25% and generates one invoice per phase.

---

## 10. Reviews & COL-Points

### Reviews

**Routes:** `POST /api/reviews`, `GET /api/reviews/:pubkey`
**Router:** `routes/reviews.ts`

Rules:
- Ticket must be `COMPLETED`
- Reviewer must be buyer or seller of the ticket
- Only one review per party per ticket (duplicate guard)
- Review window: **14 days** after ticket completion
- Max content length: **2048 characters**

Reviews can be submitted via REST API or arrive via Nostr (Kind-30024 events, handled by `NostrTicketListener`).

### COL-Points

**Service:** `services/colPointsService.ts`

Every point award is an atomic transaction: creates a `ColPointsEvent` row AND increments `User.colPoints`.

| Event | Points | Who |
|---|---|---|
| Ticket completed | +10 | Seller |
| Ticket completed | +5 | Buyer |
| Both parties reviewed (mutual) | +3 | Both |
| L2 identity upgrade | +50 | User |

---

## 11. Local Mock Relay (DEV)

**Service:** `services/mock-relay.ts`
**Attached in:** `index.ts:572` — `attachMockRelay(httpServer)`
**Active when:** `NODE_ENV !== 'production'`

### Key facts

- Runs on `ws://localhost:4001` — **the same port as Express**
- WebSocket upgrade requests are handled by the `ws` package on the same HTTP server — no port conflict
- **Pure Node.js — no Docker, no system dependencies, works on Windows and Linux**
- Starts automatically when the server starts (`pnpm dev`)
- **In-memory only:** all events are lost on server restart
- Implements NIP-01 (EVENT, REQ, CLOSE)

### Why a local relay and not the public ones in DEV?

Using public relays (damus.io etc.) during development would permanently publish test data (fake profiles, test tickets, mock reviews) to the public Nostr network. The local relay keeps all dev data isolated.

### Relay configuration

```
NOSTR_RELAY_URLS env var (comma-separated)  — publish path
  → If set: always used (overrides everything)
  → If not set:
      NODE_ENV=production  → wss://ribo.nostria.app, wss://relay.damus.io, wss://nos.lol, wss://relay.primal.net
      NODE_ENV=development → ws://localhost:4001 (mock relay)

NOSTR_INGEST_RELAY_URLS env var (comma-separated)  — subscriber only (ADR-145)
  → Decouples ingestion from publishing: dev/beta can publish to the mock
    relay while ingesting from public ones without leaking test events.
  → Precedence: NOSTR_INGEST_RELAY_URLS > NOSTR_RELAY_URLS > public defaults
  → Conduit/Gamma merchants publish to wss://relay.conduit.market — include
    it when real remote listings are wanted.
```

---

## 12. Nostr Ticket Listener

**Service:** `services/nostr-ticket-listener.ts`
**Started in:** `index.ts:567` after server is ready

Subscribes to relay events since server start and processes them:

| Event Kind | Handler | Effect |
|---|---|---|
| `30018` | `handleTicketRequest` | Creates a new Ticket in DB from Nostr event |
| `30019` | `handleStatusUpdate` | Updates Ticket status from Nostr event |
| `30024` | `handleReviewEvent` | Creates Review in DB, awards mutual COL-Points |
| `30026` | `handleProximityProofEvent` | Logging only (Phase 3 — real logic in Phase 4) |

### Duplicate guard

Tickets and Reviews are identified by `nostrEventId` (unique constraint in DB). If an event arrives twice, the second is silently ignored.

---

## 13. Database Schema (Overview)

```
User
 ├── pubkey (LNURL-Auth key, primary identity)
 ├── lnAddress
 ├── identityLevel (0–3)
 ├── nostrPubkey (set on L1 upgrade)
 ├── nip05 (optional, set on L1 upgrade)
 └── colPoints

Session
 └── k1 (LNURL challenge, expires 24h)

Offer
 ├── offerType: SERVICE | PRODUCT
 ├── ticketType: SMART_ORDER | MILESTONE
 ├── images (JSON string[])
 ├── nostrEventId (Kind-30017)
 └── offerMilestones[] → OfferMilestone

Ticket
 ├── status: PENDING | IN_PROGRESS | PAID | COMPLETED | DISPUTED | CANCELLED
 ├── offerType (copied from Offer)
 ├── ticketType (copied from Offer)
 ├── lightningInvoice / paymentHash
 ├── escrowStatus + phase1/2/3Invoice (escrow flow)
 ├── nostrEventId (Kind-30018)
 ├── milestones[] → Milestone
 └── reviews[] → Review

Review
 ├── stars (1–5)
 ├── nostrEventId (Kind-30024, for dedup)
 └── 14-day window enforced

ColPointsEvent
 └── delta + reason + ticketId (audit log)

Milestone
 └── status: PENDING | IN_PROGRESS | COMPLETED | DISPUTED
```

---

## 14. Environment Variables

Copy `.env_example` to `.env` and adjust:

```bash
# Required
DATABASE_URL=file:./dev.db
APP_PORT=4001
BASE_URL=http://localhost:4001

# Frontend (Vite)
VITE_API_URL=http://localhost:4001

# Optional: Override Nostr relay URLs (comma-separated)
# NOSTR_RELAY_URLS=ws://localhost:4001

# Optional: LNbits for real Lightning payments
# Without these, mock invoices are used
# LNBITS_URL=https://demo.lnbits.com
# LNBITS_ADMIN_KEY=your_admin_key
# LNBITS_INVOICE_KEY=your_invoice_read_key
```

---

## 15. API Reference

### Auth
| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/lnurl` | Generate LNURL-Auth challenge |
| GET | `/api/auth/lnurl/callback` | Wallet callback (k1, sig, key) |
| GET | `/api/auth/lnurl/status/:k1` | Poll auth status |

### Identity
| Method | Path | Description |
|---|---|---|
| GET | `/api/identity/:pubkey` | Get identity + reputation score |
| GET | `/api/identity/reviews/:pubkey` | Get reviews for a user |
| POST | `/api/identity/upgrade-l1` | Upgrade to L1 (Nostr Profile) |
| POST | `/api/identity/upgrade-l2-mock` | Upgrade to L2 (mock, Phase 3) |

### Offers
| Method | Path | Description |
|---|---|---|
| GET | `/api/offers` | List active offers |
| POST | `/api/offers` | Create offer (+ auto-publish to Nostr) |
| GET | `/api/offers/:id` | Get offer by ID |

### Tickets
| Method | Path | Description |
|---|---|---|
| GET | `/api/tickets?pubkey=` | List tickets for a user |
| POST | `/api/tickets` | Create ticket |
| GET | `/api/tickets/:id` | Get ticket by ID |
| PATCH | `/api/tickets/:id` | Update ticket status |
| GET | `/api/tickets/:id/payment-status` | Poll payment status |
| POST | `/api/tickets/:id/escrow-phase` | Generate phase invoice |
| DELETE | `/api/tickets/cache` | Clear all tickets (simulator) |
| DELETE | `/api/tickets/wipe` | Full DB wipe (simulator) |

### Milestones
| Method | Path | Description |
|---|---|---|
| POST | `/api/milestones` | Create milestone |
| PATCH | `/api/milestones/:id` | Update milestone status |

### Lightning
| Method | Path | Description |
|---|---|---|
| POST | `/api/lightning/invoice` | Create invoice |
| GET | `/api/lightning/invoice/:paymentHash` | Check invoice status |
| POST | `/api/lightning/webhook` | LNbits payment webhook |

### Reviews
| Method | Path | Description |
|---|---|---|
| POST | `/api/reviews` | Submit review |
| GET | `/api/reviews/:pubkey` | Get reviews for user |
