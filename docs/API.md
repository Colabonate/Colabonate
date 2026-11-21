# Colabonate API Reference

> Auto-generated from codebase audit (2026-04-23). Must be updated when endpoints change.

**Base URL:** `http://localhost:4001` (dev)  
**Content-Type:** `application/json`  
**Auth:** Public endpoints unless marked **`🔒 requireAuth`**. Most list/detail endpoints are public.

---

## Quick Reference

| Resource | Endpoints |
|----------|-----------|
| [Offers](#1-offers) | GET list, POST, GET by ID, PATCH, DELETE |
| [Tickets](#2-tickets) | GET list, POST, GET by ID, payment/poll, release |
| [Cooperations](#3-cooperations) | Full CRUD + milestones + applications |
| [Disputes](#4-disputes) | Open, escalate, verdict, appeal |
| [DAO / Governance](#5-dao--governance) | Proposals, voting, treasury, members |
| [Wallet](#6-wallet) | Create, connect, transactions |
| [Auth](#7-auth) | LNURL, Google, Email, Nostr |
| [Search](#8-search) | MeiliSearch with DB fallback |
| [Nostr](#9-nostr) | Relay, DM, offer publishing |
| [Companies](#10-companies) | Full CRUD + publish |
| [Catalogs & Products](#11-catalogs--products) | Nested product management |
| [Reviews](#12-reviews) | Submit + list by pubkey |
| [Identity](#13-identity) | Level, reputation, upgrades |
| [Delivery Templates](#14-delivery-templates) | CRUD by company/pubkey |
| [Cooperation Templates](#15-cooperation-templates) | CRUD + public listing |
| [Map](#1a-map-adr-406) | Viewport markers for the marketplace map (ADR-406) |
| [Standard Categories](#16-standard-categories) | List + seed |
| [Upload](#17-upload) | Image upload (512kb max) |
| [Lightning](#18-lightning) | Invoice + webhook |
| [Escrow](#19-escrow) | Three-phase hold invoice |
| [User Profile](#20-user-profile) | Public profile, visibility, currency |
| [Health](#25-health) | Health check |
| [Collections & Shipping](#23-collections--shipping-options-adr-277) | CRUD + Kind 30405/30406 publish |
| [Gamma Tags](#24-gamma-tags-adr-277) | Tag suggestions for the offer wizard |
| [Admin](#26-admin-adr-273-adr-282) | metrics, accounts, active-users, feedback, entities, audit |
| [Agent Profiles](#27-agent-profiles-adr-309-adr-320) | CRUD, roster, similar agents |
| [Agent Tasks](#28-agent-tasks-adr-319) | Create, list, apply, select |
| [Agent Networks](#29-agent-networks-adr-328) | CRUD, join requests, member management |
| [Workspaces](#30-workspaces-adr-311-adr-314) | Deploy, outputs, chat, recharge |
| [Milestones](#31-milestones) | Lifecycle management for coop milestones |
| [Support & Contact](#32-support--contact--feedback) | Contact form, feedback, newsletter |
| [Webhooks](#33-webhooks) | LNBits payment notifications |

---

## 1. Offers

```
GET    /api/offers                             List active offers (cursor pagination)
GET    /api/offers/count-by-category           Category counts
GET    /api/offers/:id                         Get single offer
GET    /api/offers/:offerId/visitors          🔒 Visitors for offer
GET    /api/offers/:id/sealed-config          🔒 Owner-only: sealed agent config (ADR-396 D4)
GET    /api/tickets/:id/agent-config-seal     🔒 Seller-only: agent config pinned at booking (ADR-396 D3)
POST   /api/offers                             Create offer
PATCH  /api/offers/:id                         Update offer
DELETE /api/offers/:id                         Delete offer
```

### GET /api/offers

Query: `creatorPubkey`, `category`, `offerType`, `status`, `country`, `source`, `cursor`, `limit`

```json
// Response
{ "edges": [], "pageInfo": { "hasNextPage", "endCursor" }, "offers": [...] }
```

### POST /api/offers 🔒

```json
// Body
{
  "title", "description", "priceSats", "category", "categoryCode",
  "offerType", "ticketType", "location",
  "deliveryTimeDays", "deliveryCostSats", "deliveryNotes",
  "images": [], "companyId", "productId", "deliveryTemplateId",
  "status", "milestones": [{ "title", "description", "percentage", "sortOrder" }],
  "country", "region", "city", "isRemote", "language",
  "gammaTags": [],  // ADR-277: free-form NIP-99 `t` tags; normalized server-side via normalizeGammaTags()
  "createProduct",  // ADR-395: true → also create the Product row (PRODUCT or corporate ITEM)
  "catalogId"       // ADR-395: optional own PRODUCT catalog for createProduct; omit = product without catalog
}

// Response
{ "success": true, "offer": { ... } }
```

> **ADR-396 (agent setups):** `agentConfigSealed` is accepted on create/PATCH but **never returned** by any offer read, list, create or PATCH response (Prisma runtime omit). The owner reads it via `GET /api/offers/:id/sealed-config` → `{ agentConfigSealed }` (403 for others, `Cache-Control: no-store`). `agentConfigMeta.runtime = { provider: openai|anthropic|ollama, model, providerLabel?, catalogId? }` is the public provider/model disclosure (sanitized to exactly these fields; unknown provider → 400; `providerLabel` ≤60 chars and `catalogId` a lowercase slug are ADR-409's optional cosmetic fields — legacy offers omit them). `GET /api/offers/:id` includes public agent facts on `agentProfile` (`capabilities`, `tools` name/description, `reputationScore`, `trustScore`, `requireHumanApproval`, `humanInLoop`, `isVerified`, `isPioneer`). Booking an `AGENT_SETUP` offer pins `Ticket.agentConfigSealedSnapshot` + `agentConfigHash` (SHA-256); the seller reads the pin via `GET /api/tickets/:id/agent-config-seal` → `{ agentConfigSealed, agentConfigHash, pinned }` (`pinned: false` = legacy ticket, falls back to the offer's current seal).

> **ADR-395 (company products):** `createProduct: true` creates the `Product` in the same transaction and links `offer.productId`. The company is the validated `companyId` or the caller's own company — none → `400 { error: "COMPANY_REQUIRED" }`. `catalogId` must be a PRODUCT catalog of that company (else `400`); `catalogId` without `createProduct`/`productId` → `400`. `productId` (listing for an existing product) must be one of the caller's own products (else `400`); the offer's `companyId` is then derived from the product.

> **ADR-295:** `description` may contain **restricted HTML** (`p, br, strong, em, b, i, ul, ol, li, h3, h4, a[href]`) — written by the Tiptap WYSIWYG editor on every offer/coop form. The server stores it verbatim (client-side DOMPurify is the v1 gate; server-side sanitize = FU-318). Consumers must render via `<RichText>` (sanitized) or `richTextToPlainText()` for plain contexts — never trust it as safe HTML. Same applies to `PATCH /api/offers/:id` and the coop endpoints' `description`.

---

## 1a. Map (ADR-406)

```
GET    /api/map/markers                        Viewport markers for the marketplace map
```

### GET /api/map/markers

Public — same visibility rules as `GET /api/offers` / `GET /api/companies`
(ACTIVE, not blocked, creator not PRIVATE, parents only). Returns only
lightweight marker fields so a pannable map never loads the full catalog.

Query:
- `bbox=minLng,minLat,maxLng,maxLat` — optional; omit for the global set
- `kind=all|offers|vendors` (default `all`)
- `offerType=PRODUCT|SERVICE` (offers only)
- `categoryCode=<code>` (offers only)
- `country=<ISO-3166-1-alpha-2>`
- `q=<text>` — matches offer title / vendor name
- `limit=<n>` — per-bucket cap (default 800, max 2000)

```json
// Response
{
  "markers": [
    { "id": "", "kind": "offer|company", "lat": 0, "lng": 0, "title": "",
      "subtitle": "", "priceSats": 0, "offerType": "PRODUCT|SERVICE", "href": "" }
  ],
  "count": 40,
  "truncated": false
}
```

> **ADR-406 (FU-913/FU-914/FU-915):** the marketplace map reports its bbox on
> `moveend` and loads markers per viewport; `Offer(lat,lng)` / `Company(lat,lng)`
> indexes back the bbox filter. `priceSats` is sats — render through
> `<SatsAmount/>` (ADR-235). `truncated: true` means a bucket hit the cap.

---

## 2. Tickets

```
GET    /api/tickets                            🔒 List user's tickets (cursor pagination)
POST   /api/tickets                            🔒 Create ticket from offer (returns nostrEventTemplate, Kind 30407)
GET    /api/tickets/:id                        🔒 Get ticket
PATCH  /api/tickets/:id                        🔒 Update status (buyer/seller only; returns nostrEventTemplate, Kind 30408)
GET    /api/tickets/:id/payment-status         🔒 Poll payment status (parties only) → {status, paymentHash, paid, rail, cashuTokenSentAt}; for Direct-Pay LN also checks the seller rail (LUD-21 / NWC / Alby), throttled 10 s per ticket (ADR-399)
POST   /api/tickets/:id/confirm-direct-payment 🔒 Buyer confirms a Direct-Pay LN payment `{preimage}`
POST   /api/tickets/:id/cashu-token            🔒 Buyer delivers the P2PK-locked Cashu token `{token}` (CASHU rail, once; 409 CASHU_TOKEN_ALREADY_SENT); token returned on GET to buyer/seller only (ADR-399)
POST   /api/tickets/:id/release-payment        Release escrow
POST   /api/tickets/:id/dispute                🔒 Open dispute
POST   /api/tickets/:id/nominate-arbiter       🔒 Nominate mutual arbiter (private-mode only)
POST   /api/tickets/:id/accept-arbiter         Accept mutual-arbiter role (caller is the arbiter)
GET    /api/tickets/:id/arbiters               List mutual-arbiter nomination state
POST   /api/tickets/:id/private-verdict        Arbiter submits signed verdict (private-mode only)
DELETE /api/tickets/wipe                       Simulator wipe (secret header)
```

### GET /api/tickets 🔒

Query: `cursor`, `limit`, `checkoutId` (ADR-394 FU-840 — returns only the
caller's own tickets of that cart checkout, oldest first, plus `totalSats`) or
`cooperationId` (ADR-204 — returns the cooperation's single ticket; **ADR-411:
party-gated** — only the cooperation's initiator/partner or the ticket's
buyer/seller may read it, `403 FORBIDDEN` otherwise).

```json
// Response
{ "edges": [], "pageInfo": { "hasNextPage", "endCursor" }, "tickets": [...] }
// Response with ?checkoutId=
{ "checkoutId", "tickets": [...], "total", "totalSats", "edges": [] }
```

### POST /api/milestones 🔒 · PATCH /api/milestones/:id 🔒

Legacy offer-ticket milestones (offer-scoped `Milestone` rows, distinct from
coop milestones). **ADR-411:** both are party-gated now — only the parent
ticket's buyer/seller may call them (previously unauthenticated). PATCH
auto-completes the ticket when all its milestones are COMPLETED. Errors:
`400 BAD_REQUEST`, `404 NOT_FOUND`, `403 FORBIDDEN`.

### POST /api/tickets 🔒

```json
// Body
{
  "offerId",
  "quantity": 1,               // ADR-394: integer 1…1000, ≤ Offer.stock when finite
  "checkoutId": "…",           // ADR-394 FU-840: optional, 8-64 URL-safe chars
  "deliveryAddress": {},       // JSON
  "visibility": 0, "variantLabel"
}

// Response
{ "success": true, "ticket": {...}, "invoice", "paymentHash", "amountSats" }
```

`amountSats` is server-computed: `Offer.priceSats × quantity` plus the offer's
`deliveryCostSats` once per ticket for physical ITEM/PRODUCT offers (FU-842).
`deliveryTimeDays` / `deliveryCostSats` / `deliveryNotes` are copied from the
offer and ignored in the body. Stock is reserved atomically with the ticket
(`ticket.stockReserved`, FU-841) and released when the ticket is cancelled or
its unpaid invoice expires. Errors: `400 BAD_REQUEST` (malformed quantity /
checkoutId), `409 INSUFFICIENT_STOCK` (`availableStock`),
`422 SELLER_PAYMENT_NOT_CONFIGURED`, `400 TX_ABOVE_LAUNCH_CAP`,
`502 PAYMENT_UPSTREAM_ERROR` (incl. a seller invoice whose amount or LUD-06
description_hash does not match, FU-839).

### Remote orders (ADR-417, Zap Out)

Buyer-side record of paying a REMOTE offer's seller directly over Lightning (no escrow, no ticket).
`GET /api/remote-orders/payee/:offerId?quantity=1` is public; every other route needs a session and is buyer-only.

| Route | Purpose |
|---|---|
| `GET /api/remote-orders/payee/:offerId` | `{ orderable, reason?, payee?, quote? }`; payee is the `seller`-tagged pubkey when present, else the author; never exposes LNURL internals |
| `POST /api/remote-orders` `{ offerId, quantity? }` | creates a `QUOTED` order, amount fixed for 10 min; `201 { order, zapRequestTemplate? }` |
| `POST /api/remote-orders/:id/invoice` `{ zapRequest? }` | validates the buyer-signed Kind-9734 zap request, fetches the invoice; `{ bolt11, paymentHash, expiresAt?, order }` |
| `POST /api/remote-orders/:id/confirm` `{ preimage }` | `PAID` only if sha256(preimage) equals the payment hash (also for an invoice that just expired) |
| `GET /api/remote-orders/:id` | status; refreshes while `INVOICED` (one check per 10 s per order): LUD-21 verify, then a public NIP-57 zap receipt whose `preimage` tag hashes to the payment hash; expires lapsed quotes and invoices |
| `GET /api/remote-orders?offerId=` | own orders, newest first (max 50) |

Errors: `OFFER_NOT_FOUND` 404, `NOT_REMOTE`/`NOT_ORDERABLE` 400 (`reason`), `QUOTE_EXPIRED` 409, `ZAP_REQUEST_INVALID` 400, `INVALID_STATE` 409, `PREIMAGE_MISMATCH` 400, `FORBIDDEN` 403, `UPSTREAM_ERROR` 502, `UNAUTHORIZED` 401.


**Remote offers (ADR-415):** an offer with `source: "REMOTE"` (mirrored from another
Nostr marketplace) is refused before any seller lookup:
`400 { error, code: "BAD_REQUEST", reason: "REMOTE_OFFER_NOT_ORDERABLE", purchasePath: "origin-link" | "open-in-client", externalUrl? }`.
`externalUrl` is the listing's origin URL when one was published. The offer
objects returned by `GET /api/offers`, `GET /api/offers/:id` and the search hits
carry the new nullable `originUrl` (the `r` tag of the Kind-30402 listing, http(s)
only) for REMOTE offers; foreign-priced remote offers keep `priceSats: 0` plus
`priceAmount` / `priceCurrency`. `GET /api/exchange-rates` now also returns
best-effort estimate-only rates (`gbp, ars, brl, ngn, cad, aud, cny, inr, chf, krw,
sgd, idr, clp`); these are never part of the user's preferred-currency list.

### POST /api/tickets/:id/dispute 🔒

```json
// Body
{ "callerPubkey", "reason", "details" }

// Response
{ "success": true, "dispute": {...}, "nostrEventTemplate" }
```

### POST /api/tickets/:id/nominate-arbiter 🔒

ADR-152 §A4 / PROB-002 A2: Nominate an npub as the mutual arbiter for a
private-mode ticket. Both buyer and seller must nominate the **same** npub
before that person can accept the role. Idempotent: re-nominating the same
npub from the same party is a no-op; re-nominating from the other party
flips the `nominatedByBuyer` / `nominatedBySeller` flag.

```json
// Body
{ "callerPubkey": "<buyer|seller hex>", "arbiterPubkey": "<64-char hex>" }

// Response 200
{
  "nomination": {
    "id": "...", "ticketId": "...", "arbiterPubkey": "...",
    "nominatedByBuyer": true, "nominatedBySeller": false,
    "acceptedAt": null, "rejectedAt": null,
    "verdictNostrEventId": null, "verdictOutcome": null,
    "createdAt": "...", "updatedAt": "..."
  },
  "awaiting": "other_party_nomination" | "arbiter_acceptance"
}

// Errors
400 — missing fields, or arbiterPubkey is not 64-char hex
403 — caller is neither buyer nor seller
404 — ticket not found
409 — MUTUAL_ARBITER_NOT_APPLICABLE (ticket.disputeMode !== 'PRIVATE')
409 — "Arbiter has already accepted — dispute can be opened"
```

### POST /api/tickets/:id/accept-arbiter

Called by the nominated npub to accept the arbiter role. The server flips
the row's `acceptedAt`; the optional `arbiterSignature` is recorded but
not yet verified (Phase 2.8 wires NIP-44 / Gift-Wrap signature verification).

```json
// Body
{ "arbiterPubkey": "<64-char hex>", "arbiterSignature": "<optional>" }

// Response 200
{ "nomination": {...}, "status": "accepted" }

// Errors
400 — missing arbiterPubkey
404 — no nomination row for this (ticket, arbiter)
409 — BOTH_PARTIES_REQUIRED (buyer or seller hasn't nominated yet)
```

### GET /api/tickets/:id/arbiters

Returns the current nomination state. The endpoint is read-only and does
not require authentication; the server exposes only the nomination rows
for the given ticket, never for cross-ticket lookup.

```json
// Response 200
{
  "ticket": { "id", "disputeMode", "buyerPubkey", "sellerPubkey" },
  "nominations": [
    {
      "id", "ticketId", "arbiterPubkey",
      "nominatedByBuyer", "nominatedBySeller",
      "acceptedAt", "rejectedAt",
      "verdictNostrEventId", "verdictOutcome", "verdictReasoning",
      "createdAt", "updatedAt"
    }
  ],
  "ready_for_dispute": true | false
}
```

`ready_for_dispute` is `true` as soon as any nomination row has
`acceptedAt !== null`. Use it to decide whether the dispute-open button
should be enabled for private-mode tickets.

### POST /api/tickets/:id/private-verdict

Phase 2.8 (ADR-152 §A4 / PROB-002 A2). The nominated + accepted mutual
arbiter submits a Schnorr-signed verdict for a `disputeMode=PRIVATE`
ticket. This is distinct from the public DAO-Council verdict path
(`POST /api/disputes/:id/verdict`) which requires a `daoMember` role.

The arbiter signs a Kind 30022 Nostr event client-side
(`lib/nostr.ts::signVerdictIntent`); the signature proves control of the
accepted arbiter's privkey. The server verifies the signature, settles
(`RELEASE`) or cancels (`CANCEL`) the hold invoices, updates the ticket +
dispute + nomination rows, and writes DmMessage inbox notifications for
buyer and seller.

```json
// Request body
{
  "arbiterPubkey": "<64-char hex>",
  "outcome": "RELEASE" | "CANCEL",
  "reasoning": "optional free text",
  "signedEvent": { "id", "pubkey", "created_at", "kind": 30022, "tags", "content", "sig" }
}
```

```json
// Response 200
{
  "success": true,
  "verdict": {
    "outcome": "RELEASE" | "CANCEL",
    "escrowAction": "released" | "cancelled" | "partial_failure",
    "escrowFailures": ["..."],   // present only on partial failure
    "signedEventId": "<event id>"
  },
  "nostrEventTemplate": { "kind": 30022, "pubkey", "created_at", "tags", "content" }
}
```

Server-side guards (defense in depth):

| Condition | Status | Error code |
|---|---|---|
| `arbiterPubkey` missing / not 64-hex | 400 | — |
| `outcome` not `RELEASE`/`CANCEL` | 400 | — |
| `signedEvent.kind` !== 30022 | 400 | — |
| `signedEvent.pubkey` !== `arbiterPubkey` | 401 | — |
| Schnorr signature invalid | 401 | — |
| Ticket not found | 404 | — |
| `ticket.disputeMode` !== `PRIVATE` | 409 | `PRIVATE_VERDICT_NOT_APPLICABLE` |
| `ticket.status` !== `DISPUTED` | 409 | `TICKET_NOT_DISPUTED` |
| Caller not nominated | 403 | `NOT_NOMINATED` |
| Nominee not accepted | 403 | `NOT_ACCEPTED` |
| Verdict already recorded | 409 | `VERDICT_ALREADY_SUBMITTED` |
| No OPEN dispute | 409 | `NO_OPEN_DISPUTE` |

On success: ticket → `COMPLETED` (RELEASE) or `CANCELLED` (CANCEL);
dispute → `RESOLVED` with `outcome`, `verdictIssuedAt`, `arbitratorPubkey`;
nomination row carries `verdictOutcome` + `verdictReasoning` +
`verdictNostrEventId`.

---

## 2a. Notifications (ADR-374)

```
GET    /api/notifications                       🔒 List user's notifications (cursor)
PATCH  /api/notifications/:id                   🔒 Mark read / archive
POST   /api/notifications/read-all              🔒 Mark all unread as read
```

Server-backed in-app notifications (`Notification` model), written at ticket /
cooperation / dispute lifecycle events. Owner-scoped via the session identity.

### GET /api/notifications 🔒

Query: `unreadOnly` (`1`), `archived` (`1`), `limit`, `cursor`

```json
// Response
{ "notifications": [...], "total", "unread", "nextCursor" }
```

### PATCH /api/notifications/:id 🔒

```json
// Body
{ "read": true, "archived": false }   // at least one required
```

### POST /api/notifications/read-all 🔒

```json
// Response
{ "success": true, "updated": 3 }
```

---

## 3. Cooperations

```
GET    /api/cooperations                       🔒 User's cooperations (cursor)
GET    /api/cooperations/discover              Public marketplace
GET    /api/cooperations/applications/mine    🔒 My applications
GET    /api/cooperations/:id                    Public single cooperation
POST   /api/cooperations                       🔒 Create cooperation
PATCH  /api/cooperations/:id                   🔒 Update (initiator only)
POST   /api/cooperations/:id/accept            🔒 Accept cooperation
POST   /api/cooperations/:id/cancel            🔒 Cancel cooperation
PATCH  /api/cooperations/:id/status            Update status (state machine)
POST   /api/cooperations/:id/fund-escrow        Fund escrow for cooperation
PATCH  /api/cooperations/:id/milestones/:mid   🔒 Update milestone
POST   /api/cooperations/:id/milestones/:mid/release-payment  Release milestone payment
POST   /api/cooperations/:id/milestones/:mid/pay-direct  🔒 Direct-pay from the partner's own rail — LN invoice or Cashu target (only when COOP_ESCROW_ENABLED is off; initiator; any status except DISPUTED, once per milestone)
POST   /api/cooperations/:id/milestones/:mid/confirm-direct-payment  🔒 Verify payment preimage `{preimage}` (initiator)
POST   /api/cooperations/:id/milestones/:mid/cashu-token  🔒 Post a P2PK-locked Cashu token `{token}` for the partner (initiator, escrow off)
POST   /api/cooperations/:id/milestones/:mid/confirm-received  🔒 Partner attests receipt → sets paidAt (escrow off)
POST   /api/cooperations/:id/milestones/:mid/apply           🔒 Apply to milestone
GET    /api/cooperations/:id/milestones/:mid/applications     List applications
POST   /api/cooperations/:id/milestones/:mid/applications/:appId/accept   Accept application
POST   /api/cooperations/:id/milestones/:mid/applications/:appId/decline   Decline application
```

### POST /api/cooperations 🔒

```json
// Body
{
  "title", "description", "partnerPubkey", "cooperationType",
  "partnerMode", "budgetSats", "priceSats", "timeline",
  "skills": [], "categoryCode", "images": [], "deadline",
  "requirements",
  "milestones": [
    { "title", "description", "amountSats" | "percentage",
      "assigneeAgentProfileId?",          // legacy flat agent assignment (ADR-310/331)
      "requiredCapabilities"?: [],        // legacy flat per-milestone capabilities (ADR-331)
      "steps"?: [                          // ADR-332 D2: nested agent pipeline
        { "title",
          "requiredCapabilities"?: [],
          "assigneeAgentProfileId"? }
      ]
    }
  ],
  "status",
  "ticketType": "SMART_ORDER | MILESTONE"  // optional, default MILESTONE (ADR-329)
}

// Response
{ "success": true, "cooperation": {...}, "nostrEventTemplate?" }
```

> **ADR-329 payment structure:** `ticketType` selects the escrow structure. `MILESTONE` (default) keeps existing behavior — `milestones[]` as sent, none generated. `SMART_ORDER` with **no** `milestones[]` on a non-DRAFT submit makes the server generate the 3 canonical `CoopMilestone` phases Start 25% / Progress 50% / Completion 25% (Completion absorbs the rounding remainder so the sum equals `budgetSats`); authored `milestones[]` are never replaced, and `DRAFT` creations get no placeholder phases. Unknown values → 400 `{ error: "Invalid ticketType", code: "INVALID_TICKET_TYPE" }`.

> **ADR-332 nested pipeline:** `milestones[].steps[]` creates `CoopMilestoneStep` rows under the milestone — the milestone stays the escrow unit (`percentage`/`amountSats` unchanged), steps carry capabilities + per-step agent assignment. A milestone without steps is a human milestone (mixed flows). Step- and milestone-level `assigneeAgentProfileId`s share one validation pool (unknown/non-public → 400 before any row is created) and both derive `isAgentOrchestration`. No backfill: legacy rows keep milestone-level fields. All cooperation GET responses include `milestones[].steps[]` with JSON-decoded `requiredCapabilities`.

### PATCH /api/cooperations/:id 🔒

```json
// Body (all optional; initiator only)
{ "title", "description", "budgetSats", "timeline", "skills", "images",
  "deadline", "requirements", "status", "categoryCode", "cooperationType",
  "partnerMode", "ticketType" }

// Response
{ "success": true, "cooperation": {...} }
```

> `ticketType` (ADR-329) is metadata-only on PATCH: validated like POST (`SMART_ORDER | MILESTONE`, else 400 `INVALID_TICKET_TYPE`) and persisted, but never creates or replaces `CoopMilestone` rows.
>
> `status` (ADR-411) is validated against the same transition map as `PATCH /:id/status` — an illegal transition returns `409 INVALID_STATUS_TRANSITION`; a legal one publishes Kind 30414 and notifies the counterparty exactly like the dedicated status route.

### fund-escrow note (ADR-329 D4)

`POST /api/cooperations/:id/fund-escrow` creates its `Ticket` with `ticketType` mirrored from `cooperation.ticketType` (previously hardcoded `MILESTONE`, ADR-204).

### PATCH /api/cooperations/:id/:milestoneId

```json
// Body
{ "status", "evidence", "message" }

// Response
{ "success": true, "milestone": {...}, "messages": [], "nostrEventTemplate", "cooperationCompleted" }
```

> Idempotency note: calling `PATCH { status: "ACCEPTED" }` when the milestone is already `ACCEPTED` (e.g. after a release-payment webhook confirmed it) is allowed. It re-publishes the Kind 30415 milestone event and returns the current state instead of rejecting the transition.

---

## 4. Disputes

```
GET    /api/disputes                          List disputes (status, daoId)
GET    /api/disputes/:id                      Get dispute + appeal window
GET    /api/disputes/:id/appeal               Get appeal request
POST   /api/disputes/:id/escalate             🔒 Escalate to council
POST   /api/disputes/:id/withdraw             🔒 Withdraw dispute
POST   /api/disputes/:id/appeal               🔒 Request appeal
POST   /api/disputes/:id/verdict              🔒 Issue verdict (arbitrator)
```

### POST /api/disputes/:id/verdict 🔒

```json
// Body
{ "callerPubkey", "outcome": "RELEASE|CANCEL|SPLIT", "reasoning", "evidenceEventIds" }

// Response
{ "success": true, "verdict": {...}, "dispute": {...}, "nostrEventTemplate", "quorum" }
```

---

## 5. DAO / Governance

```
# Foundation DAO
GET    /api/dao/foundation                    Get foundation DAO info
GET    /api/dao/foundation/members            List members
GET    /api/dao/foundation/admins              List admin pubkeys
POST   /api/dao/foundation/members             🔒 Invite member (admin)
PATCH  /api/dao/foundation/members/:pubkey/revoke  🔒 Revoke member (admin)
POST   /api/dao/foundation/members/:pubkey/accept  Accept invitation
GET    /api/dao/foundation/config              Get DAO config
PATCH  /api/dao/foundation/config             🔒 Update config (admin)
POST   /api/dao/foundation/nostr-event-id      Update Nostr event ID
POST   /api/dao/simulator/seed                Dev: seed demo DAO
POST   /api/dao/simulator/reset               Dev: reset proposals

# DAO Voting
GET    /api/daos                              List all DAOs
POST   /api/daos                              🔒 Create Community DAO (ADR-149)
POST   /api/daos/validate-codex               Validate codex sections + compute SHA-256 (ADR-149)
GET    /api/daos/:id/proposals                List proposals (supports ?status=&proposalType=)
GET    /api/daos/:id/proposals/:pid           Get single proposal (lazy COMMENT_PERIOD→ACTIVE)
POST   /api/daos/:id/proposals                🔒 Create proposal (proposalType, executionPayload per ADR-149)
PATCH  /api/daos/:id/proposals/:pid/publish   🔒 Publish draft (COMMENT_PERIOD for CODEX_AMENDMENT)
POST   /api/daos/:id/proposals/:pid/vote      🔒 Cast vote (auto-EXECUTED for CODEX_AMENDMENT)
PATCH  /api/daos/:id/proposals/:pid            🔒 Update draft proposal (title, content, proposalType, payload)
PATCH  /api/daos/:id/proposals/:pid/cancel     🔒 Cancel DRAFT/COMMENT_PERIOD/ACTIVE proposal (author-only)
GET    /api/daos/:id/governance-config         Get governance config + overrides + codex defaults
PATCH  /api/daos/:id/governance-config         🔒 Update governance config + per-type overrides (ADR-149)
GET    /api/daos/:id/codex-settings            Get codex hash, version, amendment history (ADR-149)
GET    /api/daos/:id/treasury                  Get treasury + transactions
```

### POST /api/daos/:id/proposals 🔒

```json
// Body
{
  "title": "string",
  "content": "string",
  "executionStrategy": "simple|treasury|parameter",
  "executionPayload": { ... },         // Json, type-specific (ADR-149 §A1.1)
  "proposalType": "NORMAL_DECISION|CODEX_AMENDMENT|TREASURY_SPENDING|SANCTION",
  "status": "DRAFT|ACTIVE"             // DRAFT = save, omit = ACTIVE
}

// Response
{ "proposal": { "id", "nostrEventId", "status", "proposalType" } }
```

### POST /api/daos/validate-codex

```json
// Body
{ "codexBody": "string" }

// Response
{ "valid": true, "codexHash": "sha256-hex", "missingSections": [] }
```

### POST /api/daos 🔒

```json
// Body
{
  "name": "string",
  "codexBody": "string",
  "codexUrl": "string",
  "codexVersion": "string",
  "codexHash": "string (checksum, server re-validates)",
  "founders": ["pubkey", ...],          // min 5, initiator included
  "coSignatures": [{ "pubkey", "event" }],
  "governanceConfig": { ... }
}

// Response
{ "dao": { "id", "name", "codexHash", "codexVersion" } }
```

### PATCH /api/daos/:id/governance-config 🔒

```json
// Body
{
  "config": { "proposalValidationStrategy", "votingStrategies", "minVotingPeriodSeconds", "maxVotingPeriodSeconds" },
  "overrides": [{ "proposalType", "quorumPercent", "majorityPercent", "votingPeriodSeconds" }]
}
```

### POST /api/daos/:id/proposals/:pid/vote 🔒

```json
// Body
{ "choice": "FOR|AGAINST|ABSTAIN" }

// Response
{ "vote": { "id", "nostrEventId", "votingPower", "strategyUsed" } }
```

### PATCH /api/daos/:id/proposals/:pid 🔒

```json
// Body (all fields optional — only DRAFT proposals can be updated)
{
  "title": "string",
  "content": "string",
  "proposalType": "NORMAL_DECISION|CODEX_AMENDMENT|TREASURY_SPENDING|SANCTION",
  "executionPayload": { ... }
}

// Response
{ "proposal": { "id", "status", "proposalType", "executionPayload" } }
```

### PATCH /api/daos/:id/proposals/:pid/cancel 🔒

```json
// No body required. Author-only. Allowed for DRAFT, COMMENT_PERIOD, ACTIVE.
// Emits "proposal_cancelled" notification to DAO members.

// Response
{ "proposal": { "id", "status": "CANCELLED" } }
```

---

## 6. Wallet

```
POST   /api/wallet/create                     🔒 Create custodial wallet
GET    /api/wallet                            🔒 Get wallet + balance
POST   /api/wallet/connect                     🔒 Connect non-custodial wallet
DELETE /api/wallet/connection                  🔒 Disconnect wallet
GET    /api/wallet/transactions               🔒 Get transactions (pubkey, paginated)
GET    /api/wallet/payout-readiness           🔒 Does the caller pass the offer-publish gate right now?
POST   /api/wallet/validate-lnbits-demo       Validate LNBits demo
```

### GET /api/wallet/transactions 🔒

Query: `pubkey`, `cursor`, `limit`

```json
// Response
{ "transactions": [], "pageInfo": { "hasNextPage", "endCursor" } }
```

### GET /api/wallet/payout-readiness 🔒

FU-801: reuses `hasSellerPaymentMethodConfigured()` (the exact function the offer-publish gate calls) so the Settings UI can show payout readiness without duplicating the rail-eligibility rules (routable LN address · NWC · ACTIVE Alby OAuth · Cashu with pubkey+mint · DEMO in Beta only).

```json
// Response
{ "ready": true }
```

---

## 7. Auth

### LNURL Auth

```
GET    /api/auth/lnurl                         Generate LNURL challenge
GET    /api/auth/lnurl/callback                Wallet callback (k1, sig, key)
GET    /api/auth/lnurl/status/:k1              Poll auth status
GET    /api/auth/me                            Session info
```

### Google Auth

```
POST   /api/auth/google                        OAuth initiate
GET    /api/auth/google/link-challenge         Get link challenge
POST   /api/auth/google/link-lightning          Link Lightning
```

### Email Auth

```
POST   /api/auth/email/send                    Send magic link
GET    /api/auth/email/verify                  Verify token
POST   /api/auth/email/link-lightning           Link Lightning
GET    /api/auth/email/link-challenge           Get link challenge
```

### Nostr Auth

```
POST   /api/auth/nostr                        Nostr auth
```

### MetaMask Auth

```
GET    /api/auth/metamask/challenge            Get SIWE challenge for address
POST   /api/auth/metamask/verify               Verify signatures and create session
```

#### GET /api/auth/metamask/challenge

Query: `address` (Ethereum address, e.g. `0x...`)

```json
// Response
{
  "nonce": "<16-byte-hex>",
  "message": "colabonate.app wants you to sign in...",
  "expiresAt": "2026-06-28T17:00:00.000Z",
  "ttlSeconds": 300
}
```

#### POST /api/auth/metamask/verify

```json
// Request
{
  "address": "0x...",
  "pubkey": "<derived-nostr-pubkey-hex>",
  "derivationMessage": "Sign this message to derive your Colabonate Nostr identity...",
  "derivationSignature": "0x<65-byte-signature>",
  "authMessage": "colabonate.app wants you to sign in...",
  "authSignature": "0x<65-byte-signature>"
}
```

Response: HTTP 302 redirect to `/login/demo?token=<session-token>`.

On failure:

```json
{ "error": "AUTH_FAILED", "message": "<reason>" }
```

Reasons: `INVALID_ADDRESS`, `INVALID_PUBKEY`, `DERIVATION_SIGNATURE_MISMATCH`,
`PUBKEY_DERIVATION_MISMATCH`, `AUTH_SIGNATURE_MISMATCH`,
`AUTH_MESSAGE_MISSING_NONCE`, `CHALLENGE_INVALID_OR_EXPIRED`.

### Session info

```
GET    /api/auth/me                            Session info
```

```json
// Response
{
  "pubkey": "<nostr-pubkey-hex>",
  "lnAddress": "user@getalby.com",
  "evmAddress": "0x...",
  "identityLevel": 0
}
```

`evmAddress` is present for MetaMask-derived sessions; `lnAddress` may be
undefined until a Lightning wallet is linked.

---

## 8. Search

```
GET    /api/search                             Full-text search (Meili + DB fallback)
GET    /api/search/facets                      Location (country) facet counts (Meili + DB fallback)
GET    /api/search/suggest                     Typeahead suggestions (Meili + DB fallback)
```

### GET /api/search

Query: `q`, `offerType`, `country`, `categoryCode`, `gammaTag` (repeatable, OR-combined), `language`, `sort`, `first`, `after` (ADR-335 cursor pagination)

```json
// Response
{ "hits": [], "estimatedTotalHits", "processingTimeMs", "pageInfo": { "hasNextPage": true, "endCursor": "opaque-string|null" } }
```

**ADR-139:** Database fallback when Meili unavailable. Supports geo/country filtering.

**ADR-335 (cursor pagination):** `first` still caps each page at 100 rows, but `after` (an opaque cursor from the previous page's `pageInfo.endCursor`) lifts the old hard 100-row-total cap — pass it back to fetch the next batch until `pageInfo.hasNextPage` is `false`. Uses the same `after`/`pageInfo.{hasNextPage,endCursor}` contract as `GET /api/nostr/dm/private-offers`. Response also gains a `Redis`-backed cache (`X-Cache: HIT`/`MISS` header, 60s TTL, invalidated immediately on any offer mutation) — safe because the endpoint has no per-viewer state.

**ADR-277:** `gammaTag` filters on `Offer.gammaTags` (Meili facet `gammaTags`; DB fallback via
`hasSome`). This is the emergent, flat "Gamma" taxonomy axis — a separate filter dimension from
`categoryCode`, the curated standard axis, and **AND-combined** with it: selecting both narrows
results to offers matching the category *and* at least one of the given tags. Repeat the
`gammaTag` param to OR multiple tags within that one axis.

**ADR-380:** foreign Gamma listings are mapped onto the standard axis at ingest and by the
backfill — the seed map (`packages/data/categories/gamma-map-v2.json`, longest-slug-wins)
resolves their `t` tags to a `categoryCode`, which the normal `categoryCode` filter then matches.
A listing tagged `web-development` therefore carries `categoryCode = services/development/web`
and appears under it. Filter/count semantics are unchanged; each offer has exactly one
`categoryCode`, so `GET /api/offers/count-by-category` badge sums always equal the distinct
result count (ADR-233).

### GET /api/search/facets

**ADR-418:** country (Location) facet over the same offer set as `/api/search`, independent of the
loaded result pages. Query: the same parameters as `GET /api/search` (`q`, `offerType`,
`categoryCode`, `gammaTag`, `language`, `companyId`, `creatorPubkey`, `capability`,
`minReputation`, `agentBillingModel`, `canvasProvider`). **`country` is accepted but ignored by
design** (disjunctive facet): the counts stay visible for every country while one is selected.
`sort`, `first` and `after` are not used.

```json
// Response
{ "country": { "US": 77, "NL": 36, "DE": 30 }, "countryless": 4002, "total": 4243 }
```

- `country` maps ISO alpha-2 codes to offer counts. Null and empty countries are never keys.
- `countryless` = offers without a country. `total` = all matching offers, so
  `sum(country) + countryless == total` (Meili path: `total` is `estimatedTotalHits`).
- Public, cached 60s (`versionedListCache('offers', 60)`, shared `offers` tag, invalidated with the list).
- Meili path: one `search` with `limit: 0` and `facets: ['country']`. DB fallback (`SEARCH_BACKEND=database`
  or a Meili error): one `groupBy` on `country`. Both paths return the same shape.
- Requires `faceting.maxValuesPerFacet` 300 on the Meili index (`OFFER_INDEX_SETTINGS`), so the
  distribution does not truncate at Meili's default of 100 values.

### GET /api/search/suggest

Lightweight autosuggest endpoint for the Home search hero. Returns a small
projection of matching offers plus a category aggregation.

Query: `q` (required, min 1 char), `limit` (default 6, max 20), `lang`

```json
// Response
{
  "offers": [
    { "id", "title", "categoryCode", "offerType" }
  ],
  "categories": [
    { "code", "label", "count" }
  ]
}
```

- Public, cacheable (`Cache-Control: public, max-age=30`).
- 60-second in-memory LRU cache keyed on `(q, lang)`.
- Inherits `searchLimiter` (120 req/min) from `/api/search`.
- Filters out offers from PRIVATE-profile creators.

---

## 9. Nostr

```
GET    /api/nostr/test                         Test relay connection
GET    /api/nostr/offers/:sellerPubkey         Get Nostr-published offers
POST   /api/nostr/offers                        Re-publish offer to Nostr
GET    /api/nostr/dm/relays/:pubkey            Get NIP-17 DM relays
POST   /api/nostr/dm/publish                    Publish gift-wrapped DM
GET    /api/nostr/dm/messages                   Fetch chat messages
POST   /api/nostr/relay-signed                  Server-assisted relay signing
```

### GET /api/nostr/dm/messages

Query: `pubkey`, `otherPubkey`, `since`, `limit`

---

## 10. Companies

```
GET    /api/companies                          List companies (cursor pagination)
GET    /api/company/:pubkey                    Get company by owner
POST   /api/company                            🔒 Create company
PATCH  /api/company/:pubkey                    🔒 Update (owner only)
POST   /api/company/:pubkey/publish            🔒 Publish company
DELETE /api/company/:pubkey                    🔒 Delete company
```

### GET /api/companies

Query: `cursor`, `limit`, `includeCount`

```json
// Response
{ "edges": [], "pageInfo": { "hasNextPage", "endCursor" }, "companies": [], "totalCount" }
```

---

## 11. Catalogs & Products

```
GET    /api/catalog                            List catalogs (?companyId=)
GET    /api/catalog/:id                        Get catalog
POST   /api/catalog                            🔒 Create catalog
PATCH  /api/catalog/:id                        🔒 Update catalog
DELETE /api/catalog/:id                        🔒 Delete catalog
GET    /api/catalog/:catalogId/products        List products
POST   /api/catalog/:catalogId/products        🔒 Create product
GET    /api/catalog/products/:productId         Get product
PATCH  /api/catalog/products/:productId        🔒 Update product
DELETE /api/catalog/products/:productId        🔒 Delete product
POST   /api/catalog/:catalogId/products/:productId/offers  🔒 Create offer from product
```

---

## 12. Reviews

```
GET    /api/reviews/:pubkey                    Get reviews for user
POST   /api/reviews                            🔒 Submit review
```

### POST /api/reviews 🔒

```json
// Body
{ "ticketId", "reviewerPubkey", "revieweePubkey", "stars", "content", "nostrEventId" }
```

---

## 13. Identity

```
GET    /api/identity/:pubkey                   Get identity + reputation
GET    /api/identity/reviews/:pubkey           Get reviews for user
POST   /api/identity/upgrade-l1                🔒 Upgrade to L1 (Bearer session + NIP-98 in X-Nostr-Auth; relay verifies a signed Kind-0 + Kind-30021/30410 credential, ADR-144/379, FU-749)
POST   /api/identity/sync-nostr-profile        Sync Kind 0 display fields from relays (fill-once)
POST   /api/identity/upgrade-l1-mock           Dev: mock L1
POST   /api/identity/upgrade-l2-mock           Dev: mock L2
POST   /api/identity/reset                     Dev: reset identity
```

### GET /api/identity/:pubkey

```json
// Response
{
  "pubkey", "lnAddress", "identityLevel", "colPoints",
  "nostrPubkey", "nip05", "picture", "name", "about", "banner",
  "reputationScore",
  "sellerStats": { "rating", "reviewCount", "completionRate" }
}
```

### POST /api/identity/upgrade-l1

Body: `{ "pubkey": "<hex>", "nostrPubkey": "<hex>", "nip05"?: "…", "picture"?: "…" }`.

Requires **two** independent credentials (FU-749):
- `Authorization: Bearer <session-token>` — proves the caller owns the Colabonate account. The
  body `pubkey` must equal the session's pubkey, otherwise `403 FORBIDDEN`.
- `X-Nostr-Auth: Nostr <base64(kind-22242 event)>` — a NIP-98 event signed by `nostrPubkey`
  (it cannot share `Authorization` with the `Bearer` scheme — mutually exclusive header formats,
  see `apps/server/middleware/require-admin.ts`): `u` tag = absolute `/api/identity/upgrade-l1`
  URL, `method` = `POST`, content prefix `colabonate-l1-upgrade:<pubkey>:`, freshness ≤ 60 s. The
  signing key must equal the claimed `nostrPubkey` (else `400 NOSTR_KEY_MISMATCH`).

Relay verification (`verifyL1Ownership`, ADR-144 as relaxed by ADR-379)
requires both, on a relay:
1. a validly-signed **Kind-0** profile authored by `nostrPubkey` — the `colabonate_pubkey` content
   binding is **not** required, so an imported, already-published profile is adopted as-is; and
2. a validly-signed **Kind-30021 or 30410** credential with `d = identity-l1-<pubkey>` (ADR-141 Issue 3).

Errors: `400 ALREADY_UPGRADED` / `VALIDATION_ERROR` / `NOSTR_KEY_MISMATCH`, `401 UNAUTHORIZED`
(missing/invalid session, or missing/invalid NIP-98 event), `403 FORBIDDEN` (session does not own
the body `pubkey`) / `CREDENTIAL_NOT_VERIFIED` (`reason: kind0_missing | credential_missing`),
`404 USER_NOT_FOUND`. On success sets `identityLevel: 1` + `nostrPubkey` and returns the identity
payload above.

### POST /api/identity/sync-nostr-profile

Body: `{ "pubkey": "<hex>", "nostrPubkey": "<hex, optional>" }` — fetches the newest
Kind 0 for the key (L1-bound `nostrPubkey` wins over the body param once set) and
fills **only still-null** display fields: `picture`, `name` (`display_name` preferred),
`about`, `banner`, `nip05`. Response = the identity payload above plus `synced: boolean`.
Never changes `identityLevel` or `nostrPubkey`. 404 when no Kind 0 is found on relays.

---

## 14. Delivery Templates

```
GET    /api/delivery-templates/company/:companyId   Get by company
GET    /api/delivery-templates/by-pubkey/:pubkey    Get by owner
GET    /api/delivery-templates/:id                   Get single template
POST   /api/delivery-templates                      🔒 Create
PATCH  /api/delivery-templates/:id                  🔒 Update
DELETE /api/delivery-templates/:id                  🔒 Delete
```

---

## 15. Cooperation Templates

```
GET    /api/cooperation-templates               List (?pubkey=, ?companyId=)
GET    /api/cooperation-templates/:id            Get single
POST   /api/cooperation-templates               Create (isAgentOrchestration + orchestrationSteps — ADR-310 D1)
PATCH  /api/cooperation-templates/:id           Update
DELETE /api/cooperation-templates/:id           Delete
GET    /api/cooperation-templates/:id/match-agents   Top-3 ranked public AgentProfiles per pipeline step (ADR-310 D4, isAgentOrchestration templates only)
```

`POST /api/cooperations` (§4) accepts an optional `assigneeAgentProfileId` on each `milestones[]` entry (ADR-310 D2) — must be an existing, public `AgentProfile`.

---

## 16. Standard Categories

```
GET    /api/standard-categories                List all
GET    /api/standard-categories/:id            Get single
POST   /api/standard-categories/seed            Seed from JSON (dev)
```

**Write-path validation:** every endpoint that accepts a `categoryCode`
(`POST/PATCH /api/offers`, `POST /api/catalog/:catalogId/products/:productId/offers`,
`POST/PATCH /api/cooperations`, `POST/PATCH /api/cooperation-templates`)
validates it against the StandardCategory slug taxonomy and answers
`400 INVALID_CATEGORY_CODE` for unknown values. `services/other` is a real
taxonomy slug (Level 2 under `services`) and serves as the offer-create
default. `Cooperation.categoryCode` remains nullable (explicit `null` clears
it); `Offer.categoryCode` is NOT NULL — clearing it via PATCH returns 400.

---

## 17. Upload

```
POST   /api/upload/image                       Upload image (max 512kb)
```

---

## 18. Lightning

```
POST   /api/lightning/invoice                  Create invoice
GET    /api/lightning/invoice/:paymentHash      Check invoice status
POST   /api/lightning/webhook                  LNBits webhook callback
```

### POST /api/lightning/invoice

```json
// Body
{ "amountSats", "description", "webhookUrl" }

// Response
{ "success", "paymentHash", "invoice", "amountSats" }
```

---

## 19. Escrow

Three-Phase Hold Invoice Escrow (ADR-121 Payment Layer Phase 2).

```
POST   /api/tickets/:id/escrow/phase1    Generate Phase 1 hold (25%)
POST   /api/tickets/:id/escrow/phase2    Generate Phase 2 hold (50%)
POST   /api/tickets/:id/escrow/phase3    Generate Phase 3 hold (25%)
POST   /api/tickets/:id/escrow/release  Settle all hold invoices
POST   /api/tickets/:id/escrow/cancel    Cancel all hold invoices
```

### Escrow State Machine

```
INITIATED
  → PHASE_1_PENDING → RESERVED
    → PHASE_2_PENDING → DELIVERY_STARTED
      → PHASE_3_PENDING → DELIVERY_CONFIRMED
        → RELEASED

Any PENDING state → CANCELLED (timeout)
DELIVERY_STARTED / DELIVERY_CONFIRMED → DISPUTED → RELEASED | CANCELLED
```

---

## 20. User Profile

```
GET    /api/user/:pubkey/profile              Get public profile
PATCH  /api/user/:pubkey/visibility           🔒 Update visibility (owner only)
GET    /api/user/:pubkey/currency             Get preferred fiat display currency (ADR-235)
PATCH  /api/user/:pubkey/currency             🔒 Update preferred fiat display currency (owner only, ADR-235)
```

### PATCH /api/user/:pubkey/visibility

```json
// Body
{ "visibility": "PUBLIC|PSEUDO_PRIVATE|PRIVATE" }
```

### GET /api/user/:pubkey/profile

Public profile page payload. Nostr Kind 0 display metadata
(`picture`, `name`, `about`, `banner`, `nip05`) is included **only for PUBLIC
profiles** — PSEUDO_PRIVATE and PRIVATE get `null` (same policy as name/company).

```json
// 200
{
  "pubkey", "lnAddress", "identityLevel", "colPoints",
  "picture", "name", "about", "banner", "nip05",
  "reputationScore", "reviewCount",
  "stats": { "offersCreated", "completedTickets", "completionRate", "completedAsBuyer", "completedAsSeller" },
  "company": { "id", "name", "logoUrl", "city" } | null,
  "visibility", "walletModeStrategy"
}
```

### GET /api/user/:pubkey/currency

```json
// 200
{ "preferredFiatCurrency": "EUR" }   // one of EUR | USD | RUB | JPY
```

### PATCH /api/user/:pubkey/currency

```json
// Body
{ "preferredFiatCurrency": "RUB" }

// 200
{ "success": true, "preferredFiatCurrency": "RUB" }
// 400 VALIDATION_ERROR — must be one of: EUR, USD, RUB, JPY
```

---

## 21. Exchange Rates (ADR-235)

```
GET    /api/exchange-rates                    Public BTC↔fiat rates proxy (CoinGecko, server-cached)
```

Server-side proxy (60 s in-memory cache; serves the last good value marked `stale`
for up to 24 h on upstream failure). Replaces the per-client direct CoinGecko
fetch. No auth; `Cache-Control: public, max-age=30`.

```json
// 200
{
  "rates": {
    "eur": { "price": 63712.8, "change24h": 1.23 },
    "usd": { "price": 69120.4, "change24h": 1.18 },
    "rub": { "price": 6120333.0, "change24h": 0.95 },
    "jpy": { "price": 10245000.0, "change24h": 1.05 }
  },
  "lastUpdated": "2026-07-13T18:05:11.000Z",   // last successful upstream fetch
  "stale": false,                                // true when served from cache past 60 s
  "fetchedAt": "2026-07-13T18:05:42.000Z"
}
// 503 RATES_UNAVAILABLE — upstream down beyond the 24 h stale window
```

---

## 22. Bookable Resources & Bookings (ADR-271)

Nostr-authoritative booking layer: availability is **derived** (open rules −
blackouts − confirmed bookings, D2), and a booking exists only through the
**seller's countersigned NIP-52 event** (kind 31922/31923, D3) — the server
verifies and mirrors, it never signs. Requests carry a 15-minute *advisory*
hold (never a reservation, D4).

```
GET    /api/resources/mine                    List own resources (auth) — includes rules, blackouts, _count
POST   /api/resources                         Create resource (auth) — { kind: SPACE|SESSION, title, timezone, capacity,
                                                minUnits?, maxUnits?, leadTimeHours?, bufferMinutes?, country?, city?,
                                                lat?, lng?, companyId?, rules[], blackouts[] }
GET    /api/resources/:id                     Public read (includes rules + blackouts)
PATCH  /api/resources/:id                     Owner edit; rules/blackouts replaced wholesale when present
GET    /api/resources/:id/availability        Derived availability: ?from=ISO&to=ISO (defaults now → +60 d)
       → { resourceId, kind, timezone, slots, holds }
         SPACE slot:  { kind: 'SPACE', startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }  (end exclusive)
         SESSION slot: { kind: 'SESSION', start: ISO, end: ISO, seatsTotal, seatsLeft }
         holds: unexpired REQUESTED bookings overlapping the window (advisory only, D4 — never blocks)
POST   /api/resources/:id/bookings            Buyer request (auth) — { offerId?, start, end, units, note? }
       → 201 { booking, rsvpTemplate }  — client signs + publishes the kind 31925 RSVP template
       → 409 { error: TAKEN|SOLD_OUT|NOT_OPEN|BLACKOUT|LEAD_TIME|UNITS_INVALID, message }
GET    /api/bookings/incoming                 Seller queue (auth)
GET    /api/bookings/mine                     Buyer list (auth)
GET    /api/bookings/:id                      Party read (auth)
PATCH  /api/bookings/:id/request-event        Buyer attaches the signed kind 31925 RSVP (auth) — { event }; server verifies signature, schema, occurrence linkage, units + interval before storing the id
POST   /api/bookings/:id/confirm              Seller countersignature ingest (auth) — { event: signedKind31922Or31923 }; kind must match the resource kind, a-tag must address the deterministic occurrence; conflict resolution is capacity-aware (SESSION seats vs SPACE capacity-1) and runs in a per-resource advisory-locked transaction
       → 200 { booking, cancelledConflicts? } | 400 INVALID_SIGNATURE/VALIDATION_ERROR | 409 CONFLICT_LOST
POST   /api/bookings/:id/decline              Seller declines a REQUESTED booking (auth)
POST   /api/bookings/:id/cancel               Party cancel (auth) → { booking, requiresNip09Deletion, nip09EventIds }
```

`Offer` create/PATCH additionally accepts `resourceId`, `bookingMode`
(`DATE_RANGE`|`SESSION`), `priceUnit` (`per_night`|`per_day`|`per_hour`|
`per_seat`|`flat`), `bookingMinUnits`, `bookingMaxUnits`,
`confirmationWindowHours` (default 24), `autoConfirm` (only with a bookable
mode — D5).

---

## 23. Collections & Shipping Options (ADR-277)

Gamma Markets object graph (kind 30405 / 30406). Create/update publishes (or re-publishes) the
Nostr event and writes the resulting id back to `nostrEventId`; deactivating or deleting
publishes a NIP-09 deletion. Publish is **best-effort** — a relay failure does not fail the
HTTP request, the DB row is the source of truth either way.

```
GET    /api/collections/company/:companyId       List active collections for a company
GET    /api/collections/by-pubkey/:pubkey        List active collections by company owner
GET    /api/collections/:id                      Get single collection
POST   /api/collections                          Create collection (+ publish Kind 30405)
PATCH  /api/collections/:id                       Update collection (+ re-publish or NIP-09 delete on deactivate)
DELETE /api/collections/:id                       Delete collection (+ NIP-09 delete)

GET    /api/shipping-options/company/:companyId  List active shipping options for a company
GET    /api/shipping-options/by-pubkey/:pubkey   List active shipping options by company owner
GET    /api/shipping-options/:id                 Get single shipping option
POST   /api/shipping-options                     Create shipping option (+ publish Kind 30406)
PATCH  /api/shipping-options/:id                  Update shipping option (+ re-publish or NIP-09 delete on deactivate)
DELETE /api/shipping-options/:id                  Delete shipping option (+ NIP-09 delete)
```

### POST /api/collections

```json
// Body
{ "companyId", "d", "title", "productIds": [], "summary?", "image?", "location?", "geohash?", "shippingOptionIds?": [] }

// Response
{ "success": true, "collection": { ... "nostrEventId" } }
```

Required: `companyId`, `d`, `title`, `productIds` (non-empty). `shippingOptionIds` is optional.
The Kind 30405 event's `a` product refs (D10) resolve
each member product's most recently published `ACTIVE` non-variation offer — a member with no
such offer is skipped, and a collection with zero resolvable refs is **not published** (would be
spec-invalid); the response's `collection.nostrEventId` is `null` in that case. The API does not
emit a literal "unpublished" field — the frontend (`SellCollections.tsx`) derives that label from
`nostrEventId` being falsy.

### PATCH /api/collections/:id

```json
// Body (all fields optional)
{ "title?", "summary?", "image?", "location?", "geohash?", "isActive?", "productIds?": [], "shippingOptionIds?": [] }
```

Setting `isActive: false` on a previously-published collection triggers a NIP-09 deletion instead
of a re-publish.

### POST /api/shipping-options

```json
// Body
{ "companyId", "d", "title", "baseCost", "currency", "countries",
  "service?": "standard|express|overnight|pickup", "carrier?", "regions?",
  "durationMin?", "durationMax?", "durationUnit?": "H|D|W|M|Y",
  "location?", "geohash?", "weightMin?", "weightMax?", "weightUnit?",
  "dimMin?", "dimMax?", "dimUnit?",
  "priceWeight?", "priceWeightCur?", "priceVolume?", "priceVolumeCur?", "priceDistance?", "priceDistanceCur?" }

// Response
{ "success": true, "shippingOption": { ... "nostrEventId" } }
```

`countries`/`regions` accept an array or a comma-separated string; stored as comma-separated.
`companyId`, `d`, `title`, `baseCost`, `currency`, `countries` are required.

### PATCH /api/shipping-options/:id

Same optional-field shape as POST, plus `isActive?`. Deactivating triggers a NIP-09 deletion
instead of a re-publish, same as Collections.

---

## 24. Gamma Tags (ADR-277)

```
GET    /api/gamma-tags                         Tag suggestions for the offer-wizard gamma-tag input
```

### GET /api/gamma-tags

Query: `categoryCode?`

```json
// Response
{
  "popular": ["electronics", "tech", ...],     // live corpus, frequency-sorted (unnest over Offer.gammaTags, status=ACTIVE, top 50)
  "suggested": ["electronics", "gadgets"]        // seed map (gamma-map-v2.json, ADR-380) for the given categoryCode; [] if omitted or unmapped
}
```

Cached 5 minutes. Neither list is a constraint — sellers may enter any tag; normalization
(`normalizeGammaTag`) happens client- and server-side on write, not here.

---

## 25. Health

```
GET    /api/health                            Health check
```

---

## 26. Admin (ADR-273, ADR-282)

All admin endpoints are **🔒 requireAuth + requireFoundationAdminBySession** (mounted at `apps/server/index.ts:280`). Foundation-DAO admin role is server-confirmed via `/api/auth/me.isAdmin` — there is no client-side admin check (ADR-273).

```
GET    /api/admin/metrics                     Platform KPI snapshot (users/offers/tickets/sessions/feedback/wallets/audit)
GET    /api/admin/active-users                Distinct users with a non-expired session (ADR-282)
GET    /api/admin/accounts                    Curated accounts list with breakdown + per-account lastSeen
GET    /api/admin/newsletter/subscribers      Unified newsletter audience (confirmed signups + account emails)
GET    /api/admin/newsletter/subscribers/export  CSV export of the filtered audience (ADR-400)
GET    /api/admin/health                      Aggregated DB/Redis/LND service status + launch flags
                                              (betaMode, paymentsPaused, launchMaxTxSats,
                                               escrowEnabled, coopEscrowEnabled, criticalAlertingConfigured)
POST   /api/admin/alerts/test                 Fire one synthetic CRITICAL alert through the on-call
                                              channel (Gate G4). 200 {ok,to,sentAt} · 503 ALERTING_NOT_CONFIGURED
                                              · 502 ALERT_DELIVERY_FAILED. Body: { note?: string }
GET    /api/admin/infrastructure              Payment/Search provider + Docker-service health cards
GET    /api/admin/feedback                    Paginated feedback
PATCH  /api/admin/feedback/:id/read           Mark a single feedback entry as read
POST   /api/admin/feedback/:id/reply          Resend the reply mail for a feedback entry
GET    /api/admin/beta/testers                Demo-wallet users
GET    /api/admin/entities                    List all public PostgreSQL tables + row counts
GET    /api/admin/entities/:model             Paginated rows of a table (auto-detected columns)
GET    /api/admin/entities/:model/actions     Registered action-registry metadata for the model
POST   /api/admin/entities/:model/:id/:action Run a registered entity action
POST   /api/admin/entities/:model/bulk-action  Run a registered bulk entity action
GET    /api/admin/audit                       AdminAuditLog list
```

### GET /api/admin/metrics

Response: KPI snapshot for the overview (`AdminKpiStrip.tsx`). One Promise.all against Postgres.

```json
{
  "users":       { "total": 1234, "new7d": 42, "active": 18 },
  "offers":      { "total": 567 },
  "tickets":     { "total": 200, "active": 45 },
  "sessions":    { "total": 1500, "active": 23 },
  "feedback":    { "total": 50, "unread": 4 },
  "demoWallets": { "count": 12, "totalSats": 50000 },
  "auditLogs":   { "total": 870 }
}
```

> **ADR-282** — `users.active` counts **distinct pubkeys** with at least one non-expired `Session` row (login-time ≤ 7 days ago; no heartbeat). `sessions.active` counts *session rows* — one user on two devices = 2 in `sessions.active`, 1 in `users.active`.

### GET /api/admin/active-users

> **ADR-282** — backs the Active-Users chip on the overview. Returns the top `limit` currently-active users (sorted by most-recent session login) with the minimum profile fields the popover needs.

Query: `limit` (default 25, max 100)

```json
{
  "count": 18,
  "users": [
    {
      "pubkey": "npub1…",
      "identityLevel": 1,
      "picture": "https://…/avatar.png",
      "nip05": "alice@example.com",
      "lnAddress": "alice@ln.example.com",
      "sessionCount": 2,
      "lastSeen": "2026-08-17T10:42:00.000Z"
    }
  ]
}
```

Clicking a user in the chip's popover navigates to `/admin/accounts?pubkey=<pk>`, which pre-opens the curated detail panel for that user.

### GET /api/admin/accounts

Query: `page` (1-based, default 1), `limit` (1-100, default 25), `loginType` (nostr|lightning|email|google|evm|demo), `walletProvider`, `identityLevel` (0-3), `search` (pubkey contains)

```json
{
  "accounts": [{ "pubkey": "npub1…", "createdAt": "…", "identityLevel": 1, "loginMethods": ["nostr", "lightning"], "email": "a***@…", "picture": "…", "wallet": { "provider": "DEMO", "mode": "…", "balanceSats": 0 }, "offerCount": 5, "sessionCount": 3, "lastSeen": "…" }],
  "total": 1234,
  "page": 1,
  "limit": 25,
  "breakdown": { "methods": { "nostr": 800, "lightning": 200, … }, "wallets": { "DEMO": 12, "LNBITS": 5, "none": 1180 }, "combinations": [{ "key": "nostr", "count": 700 }, …] }
}
```

---

## 27. Agent Tasks (ADR-319)

Dynamic task allocation — a Buyer publishes an "Ausschreibung" (task) with no
fixed seller; AgentProfile owners apply (manually or via `autoApply`), the
Buyer selects a winner. `GET` routes are public; all mutating routes require
auth. Deviations from the ADR text: `offerId` is required on an application
(the codebase's Ticket model always anchors to a concrete Offer), and
`POST .../select` does not itself create the Ticket — it returns a `nextStep`
the client follows through the existing, unmodified `POST /api/tickets` flow
(the payment/escrow resolution there was judged too large/critical to
duplicate in this slice). D5 (agent-to-agent subcontracting) and D6 (Nostr
Kind 31420/31421/31422 publish) are not built (FU-382, FU-425).

```
POST   /api/agent-tasks                          Create a task (auth) — { title, description, requiredCapabilities[], budgetSats, images?, deadline?, autoSelect? } — `images`: up to 5 `data:image/` URLs (Offer.images contract, first = cover)
GET    /api/agent-tasks                          List tasks — ?status= (default OPEN) &capability=&limit=&offset=
GET    /api/agent-tasks/:id                      Task detail — `applications` included only for the creator (all) or an applicant owner (their own)
PATCH  /api/agent-tasks/:id                       Creator cancels (auth) — { action: 'cancel' }; only from OPEN/SELECTING
POST   /api/agent-tasks/:id/applications          Apply (auth, agent-profile owner) — { agentProfileId, offerId, message?, proposedPriceSats?, proposedETA? }
       → 400 CAPABILITY_MISMATCH | BUDGET_EXCEEDED, 409 ALREADY_APPLIED
PATCH  /api/agent-tasks/:id/applications/:appId   Applicant owner — { action: 'withdraw' | 'confirm' }; confirm only from AWAITING_OWNER_APPROVAL (auto-applied, owner gate)
POST   /api/agent-tasks/:id/select                Creator picks a winner (auth) — { applicationId } → task ASSIGNED, other applications REJECTED, { nextStep: { method:'POST', path:'/api/tickets', body:{ offerId, agentTaskApplicationId } } } (ADR-397 D3)
```

A background tick (`AGENT_TASK_MATCHER_TICK_MS`, default 5 min) auto-applies
`autoApply=true` AgentProfiles to matching OPEN tasks (capability subset +
budget fit) — landing as `AWAITING_OWNER_APPROVAL` when the profile's
`requireHumanApproval` is set, else straight to `PENDING`. The same tick
expires OPEN/SELECTING tasks past their `deadline`.

---

## 28. Agent Marketplace — Network Effects (ADR-320)

```
GET  /api/agent-profiles/:id/similar   Similar agents (auth) — Jaccard capability overlap (0.6) + shared-completed-ticket customer (0.3) + offer price proximity (0.1), DB-computed. ?limit= (default 6, max 20)
                                        → { similar: [{ agentProfile: {id,name,avatarUrl,reputationScore,trustScore,capabilities}, score }] }
GET  /api/agent-marketplace/stats      Public ecosystem KPIs — no auth
                                        → { activeAgentSetupCount, averageReputationScore, topCapabilities: [{capability,count}], completedAgentTicketCount, averageTimeToCompletionHours }
GET  /api/agent-profiles/roster        ADR-314 D10 / FU-436: workspace-overarching "My Agents" roster (auth) — pure query-projection, no new model
                                        → { owned: AgentProfile[], booked: [{ agentProfile: AgentProfile, ticket: {id,status,updatedAt}, workspace: {id,status,updatedAt}|null, lastActiveAt }] }
                                        booked = distinct AgentProfile reached via this caller's AGENT_SETUP tickets, most-recently-active ticket wins the dedupe.
                                        lastActiveAt falls back to workspace.updatedAt, then ticket.updatedAt (FU-395 Kind 20001 presence events not built)
                                        ADR-339 D1: each owned entry additionally carries `offer` — the newest non-archived (ACTIVE|DRAFT) AGENT_SETUP offer
                                        ({id,status,images,imageThumbs,title,priceSats,publishedAt,agentBillingModel,agentWorkspaceTTL,categoryCode,description}),
                                        or null. GET /api/agent-profiles/:id returns the same projection as sibling `offer` (edit-wizard prefill).
```

`POST`/`PATCH /api/agent-profiles` additionally normalize `capabilities` (lowercase, hyphenated, deduped — `"Code Review"` → `"code-review"`) and set `AgentProfile.isPioneer` (first 100 profiles created, permanent). The mutual-review COL-Points award (see §12 Reviews) pays +5 instead of +3 for an AGENT_SETUP offer's first 10 completed tickets. Note: the rest of the `/api/agent-profiles` CRUD surface (ADR-309) predates this section and is not yet documented here.

### Agent Catalogs — unified under /api/catalog (ADR-340 D6; ADR-368 D3)

The former `/api/agent-catalogs` router (ADR-339 D5) was folded into the single
unified `/api/catalog` router (ADR-340 D6) — PRODUCT and AGENT_SETUP catalogs
are one model (`Catalog.catalogType`). All routes require auth and are
owner-scoped; membership is N:M and toggles are idempotent. See §26 (Offers →
Listings, `/api/catalog` rows) for the full unified router.

Agent-catalog specifics on the unified router:

```
PUT    /api/catalog/:catalogId/agents   Assign/unassign — { agentProfileId, member: boolean }; the profile must belong to the caller
                                          → { success: true, agentProfileId, member } | 400 | 403 FORBIDDEN (foreign profile or catalog)
```

- AGENT_SETUP catalogs are owner-scoped (no `companyId`); list responses carry `memberIds` per catalog.
- Frontend surfaces (ADR-368 D3): PRODUCT-catalog CRUD lives under Sell → Listings → Catalogs
  (`CreateCatalogModal` preset PRODUCT); AGENT_SETUP-catalog CRUD lives under Cooperate → Manage →
  Agent Stack (`?tab=stack&view=catalogs`, `CreateCatalogModal` preset AGENT_SETUP). Membership is
  managed from the roster's row "⋮" menus.


---

## 29. Workspaces (ADR-311)

All routes require auth; a workspace is buyer-scoped runtime state (no public read tier). Lifecycle: `PENDING_DEPLOY → RUNNING → SUSPENDED → COMPLETED → EXPIRED` (resume `SUSPENDED → RUNNING` exists in the state map but is canister-driven, not exposed).

```
POST   /api/workspaces                Create from a paid AGENT_SETUP ticket (buyer) — { ticketId, signerPubkey? }; 1:1 per ticket, safe to retry.
                                      signerPubkey (ADR-314, 64-hex) sets Workspace.canisterBuyerPubkey — the key authorized to sign
                                      buyer-direct chat/tool-call actions on the canister; defaults to the caller's login pubkey when
                                      omitted (which can't sign chat actions if it's NIP-07/bunker-controlled — see §D5 note below)
                                      → 201 { workspace } (PENDING_DEPLOY without a canister backend; with `ICP_WORKSPACE_CANISTER_ID`
                                        configured it deploys for real and returns RUNNING + canisterId + canisterWorkspaceId)
                                      → 400 NOT_AGENT_SETUP | VALIDATION_ERROR, 403, 404, 409 TICKET_NOT_PAID | WORKSPACE_EXISTS
GET    /api/workspaces                List caller's workspaces (as buyer) — ?status=&limit=&offset=
GET    /api/workspaces/:id            Workspace detail — buyer or ticket seller only
GET    /api/workspaces/:id/outputs    Proxies the canister's `get_outputs` (D5) — buyer or ticket seller; { outputs: [] } when no
                                      canister backend is configured or deployed (honest-empty, not an error)
                                      → 403, 404
POST   /api/workspaces/:id/messages   ADR-314: buyer-signed chat send, relayed to the canister's `post_message` (FU-434 Slice C) —
                                      { content (≤4000 chars), timestamp (decimal ns string), signature (128-char hex) } signed
                                      client-side over `colabonate-workspace-v1:post_message:{canisterWorkspaceId}:{timestamp}:{content}`
                                      with the key matching Workspace.canisterBuyerPubkey; buyer-only, RUNNING + deployed canister required
                                      → 201 { output } · 400 VALIDATION_ERROR, 401 SIGNATURE_INVALID, 403, 404,
                                        409 WORKSPACE_NOT_RUNNING | NO_CANISTER | REPLAY_REJECTED | CONFIG_NOT_INJECTED,
                                        502 LLM_PROVIDER_ERROR (the outcall reached the provider boundary and failed — not a fake success)
POST   /api/workspaces/:id/complete   Buyer confirms completion — RUNNING|SUSPENDED → COMPLETED, sets expiresAt = now + Offer.agentWorkspaceTTL
                                      → 403, 404, 409 INVALID_TRANSITION
POST   /api/workspaces/:id/inject-config  Agent owner (ticket seller) injects the NIP-44-sealed agent config into the canister
                                      (FU-353; server relays ciphertext only, one-time) — { senderPubkey, ciphertext }
                                      → 400 INVALID_CONFIG, 403, 404, 409 INVALID_TRANSITION | NO_CANISTER | CONFIG_ALREADY_INJECTED
POST   /api/workspaces/:id/recharge     Buyer reloads the cycle budget (FU-433, ADR-312 D3/D6) — { amountSats } (integer, ≤ 100M);
                                      seller-rail invoice (LN) or DEMO invoice under BETA_MODE; RUNNING|SUSPENDED only
                                      → 201 { recharge, invoice|null } · 400 INVALID_AMOUNT, 403, 404,
                                        409 INVALID_TRANSITION, 422 SELLER_PAYMENT_NOT_CONFIGURED | RECHARGE_RAIL_UNSUPPORTED (Cashu)
POST   /api/workspaces/:id/recharge/:rechargeId/confirm  Buyer confirms payment — { preimage? } (LN verifies the preimage;
                                      DEMO rail only under BETA_MODE). Idempotent: no double-credit; relays `add_cycles` to the canister
                                      exactly once (canister `apply_topup` verdict is authoritative for SUSPENDED → RUNNING resume)
                                      → 200 { recharge } · 400 PREIMAGE_MISMATCH, 403 DEMO_RAIL_DISABLED, 404,
                                        502 RECHARGE_RELAY_FAILED (credit stays, re-confirm retries the relay only)
```

An hourly sweep flips `COMPLETED` workspaces past `expiresAt` to `EXPIRED` (terminal). The deploy path (PENDING_DEPLOY → RUNNING) is wired to the ICP Workspace-Canister via `@dfinity/agent` (`services/workspace-canister-client.ts`, FU-432, env-gated on `ICP_WORKSPACE_CANISTER_ID`/`ICP_HOST`). Cycle metering (D3) books every successful LLM/tool outcall against the workspace budget and auto-suspends at budget; recharges resume the workspace via the canister's `apply_topup` verdict. Buyer-direct canister actions are all buyer-signed BIP-340 (`post_message`/`call_tool`/`approve_tool_call`, FU-434 Slice C) — the server never signs on the buyer's behalf. `post_message` (chat) now has a server relay (`POST /:id/messages`, ADR-314, above); `call_tool`/`approve_tool_call` remain canister-direct-only client calls with no server route (no UI consumes them yet).

---

## Status Codes

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad request / validation error |
| `401` | Unauthorized |
| `403` | Forbidden (not owner/admin) |
| `404` | Not found |
| `500` | Server error |

Error format: `{ "error": "MESSAGE", "details?": [...] }`

---

## Frontend Usage

```typescript
// Use apiCall from @/lib/api.ts — throws on non-ok
const response = await apiCall('/api/offers/${id}')
if (!response.ok) throw new ApiError(response.status, await response.json())
const data = await response.json()
```

---

## Endpoint Count Summary

| Group | Count |
|-------|-------|
| Offers | 7 |
| Tickets | 8 |
| Cooperations | 15 |
| Disputes | 7 |
| DAO/Governance | 19 |
| Wallet | 6 |
| Auth (all) | 14 |
| Search | 1 |
| Nostr | 7 |
| Companies | 6 |
| Catalogs/Products | 10 |
| Reviews | 2 |
| Identity | 7 |
| Delivery Templates | 6 |
| Cooperation Templates | 5 |
| Standard Categories | 3 |
| Upload | 1 |
| Lightning | 3 |
| Escrow | 5 |
| User Profile | 2 |
| Collections & Shipping Options | 12 |
| Gamma Tags | 1 |
| Health | 1 |
| Admin | 13 |
| Agent Tasks (ADR-319) | 6 |
| Agent Marketplace (ADR-320) | 2 |
| Workspaces (ADR-311) | 7 |
| **Total** | **~174 endpoints** |---

## 27. Agent Profiles (ADR-309, ADR-320)

```
GET    /api/agent-profiles                     🔒 List own agent profiles
GET    /api/agent-profiles/roster              🔒 "My Agents" roster (owned + booked)
GET    /api/agent-profiles/:id                 Get profile detail (public if isPublic)
GET    /api/agent-profiles/:id/similar          Similar agents (Jaccard capability overlap)
POST   /api/agent-profiles                     🔒 Create agent profile
PATCH  /api/agent-profiles/:id                  🔒 Update agent profile
DELETE /api/agent-profiles/:id                  🔒 Soft delete (archiving offers)
GET    /api/agent-catalogs                     🔒 List own catalogs
POST   /api/agent-catalogs                     🔒 Create catalog
PATCH  /api/agent-catalogs/:id                  🔒 Update catalog
DELETE /api/agent-catalogs/:id                  🔒 Delete catalog
PUT    /api/agent-catalogs/:id/members          🔒 Assign/unassign profile to catalog
```

### POST /api/agent-profiles 🔒

```json
// Body
{
  "name", "description", "capabilities": ["hex", ...], "tools": [],
  "avatarUrl", "isPublic", "autoApply", "requireHumanApproval",
  "humanInLoop", "companyId"
}

// Response
{ "agentProfile": { "id", "name", "isPioneer", ... } }
```

---

## 28. Agent Tasks (ADR-319)

```
POST   /api/agent-tasks                          🔒 Create task (Ausschreibung)
GET    /api/agent-tasks                          List tasks (?status=OPEN&capability=)
GET    /api/agent-tasks/:id                      Task detail
PATCH  /api/agent-tasks/:id                       🔒 Creator cancels task
POST   /api/agent-tasks/:id/applications          🔒 Apply to task (Agent owner)
PATCH  /api/agent-tasks/:id/applications/:appId   🔒 Withdraw/confirm application
POST   /api/agent-tasks/:id/select                🔒 Creator picks winner
POST   /api/agent-tasks/:id/revert-selection      🔒 Creator undoes a selection while no live ticket exists (ADR-397 D4)
GET    /api/agent-tasks/applications/mine         🔒 Caller's own applications across all bounties, with bounty summary (ADR-397 D7)
```

### POST /api/agent-tasks/:id/select 🔒

```json
// Response
{ 
  "success": true, 
  "nextStep": { "method": "POST", "path": "/api/tickets", "body": { "offerId", "agentTaskApplicationId" } } 
}
```

**ADR-397 D3/D4 — bounty tickets.** Send the `nextStep.body` unchanged to `POST /api/tickets`. With `agentTaskApplicationId` the server checks that the application is the ACCEPTED winner of an ASSIGNED bounty, that `offerId` matches, and that the caller is the poster. The ticket then charges the application's `proposedPriceSats` (quantity 1) instead of the listing price and is linked via `Ticket.agentTaskId`. Errors: `404 BOUNTY_APPLICATION_NOT_FOUND`, `403 BOUNTY_NOT_POSTER`, `400 BOUNTY_OFFER_MISMATCH`, `409 BOUNTY_NOT_ASSIGNED`, `409 BOUNTY_TICKET_EXISTS` (+ `ticketId`), `409 BOUNTY_TICKET_CONFLICT` (concurrent revert/create). The bounty follows its ticket: PAID → `IN_PROGRESS`, COMPLETED → `COMPLETED`. `GET /api/agent-tasks/:id` returns `ticket: { id, status } | null` (poster and winner only).

**ADR-397 D2/D5–D8, D11, FU-870 (2026-09-25):**
- `POST /api/agent-tasks` → `422 PAYER_WALLET_REQUIRED` unless the poster has an ACTIVE `NWC`/`ALBY_OAUTH`/`WEBLN`/`CASHU` wallet (`DEMO` in beta). Never a balance lock.
- Create/update accept `acceptanceCriteria` (string ≤ 2,000 or null); `autoSelect` was removed.
- `GET /api/agent-tasks?status=` is validated (`400` for unknown values). List rows carry thumbnail `images` and `posterReliability: { decided, paid, paidRate, medianHoursToPay }`; the detail `task` carries `posterReliability` and full `images`.
- `PATCH` `update` rejects live applications that no longer fit (budget, capabilities, supervision) and notifies their owners.
- Bounty tickets store `bountyBrief: { bountyId, title, description, acceptanceCriteria, deadline }`; `GET /api/tickets/:id` and `GET /api/workspaces/:id` return it.
- In-app notifications of `type: 'bounty'` (`meta.event`: application_received, awaiting_owner_approval, selected, rejected, no_longer_eligible, cancelled, expired).
- MCP tools: `list_bounties`, `get_bounty` (guest), `my_bounty_applications` (signed in), `apply_to_bounty` (`offers:write` scope).

`POST /api/agent-tasks/:id/revert-selection` (poster): allowed while the bounty is ASSIGNED without a ticket, or when its linked ticket is CANCELLED. The bounty returns to `SELECTING`, ACCEPTED/REJECTED applications return to `PENDING`, and a cancelled ticket is unlinked. `409 INVALID_STATE` while a live ticket exists.

---

## 29. Agent Networks (ADR-328)

```
GET    /api/agent-networks                       List public networks
GET    /api/agent-networks/mine                  🔒 My owned networks
GET    /api/agent-networks/:id                   Network detail
POST   /api/agent-networks                       🔒 Create network
PATCH  /api/agent-networks/:id                   🔒 Update network
POST   /api/agent-networks/:id/members           🔒 Join/Add member
PATCH  /api/agent-networks/:id/members/:pid      🔒 Update member role (LEAD/MEMBER)
DELETE /api/agent-networks/:id/members/:pid      🔒 Remove member/Leave
POST   /api/agent-networks/:id/join-requests     🔒 Submit join request (Closed networks)
PATCH  /api/agent-networks/:id/join-requests/:rid 🔒 Approve/Reject request
```

---

## 30. Workspaces (ADR-311, ADR-314)

```
POST   /api/workspaces                           🔒 Deploy from paid ticket
GET    /api/workspaces                           🔒 List own workspaces
GET    /api/workspaces/:id                       🔒 Workspace status + hasConfig
GET    /api/workspaces/:id/outputs               🔒 List canister outputs
GET    /api/workspaces/:id/output-key            🔒 Get canister encryption key
POST   /api/workspaces/:id/inject-config         🔒 Inject encrypted agent config
POST   /api/workspaces/:id/messages              🔒 Send buyer-signed chat message
POST   /api/workspaces/:id/complete              🔒 Confirm buyer completion
POST   /api/workspaces/:id/recharge              🔒 Create budget recharge (paid to seller)
POST   /api/workspaces/:id/recharge/:rid/confirm 🔒 Confirm payment (preimage verification)
```

---

## 31. Support, Contact & Feedback

### POST /api/contact
Submit general contact form. Sends email via SMTP if configured.

```json
// Body
{ "name", "email", "subject", "message" }
```

### POST /api/feedback
Submit bug reports, ideas, or questions.

```json
// Body
{ "kind": "bug|idea|question", "title", "body", "email", "context": { "route", "userAgent", "pubkey" } }
```

### POST /api/newsletter
Start (or refresh) a double-opt-in newsletter signup. Normalises the email
(trim + lowercase), stores it as `PENDING` and sends a confirmation email. A
`CONFIRMED` address is an idempotent no-op. Rate-limited 5/hour (POST only —
the confirm/unsubscribe links are never throttled).

```json
// Body
{ "email" }
// 201 { "success": true, "status": "PENDING" }
// 200 { "success": true, "status": "CONFIRMED" }  (already confirmed)
```

### GET /api/newsletter/confirm?token=&lt;token&gt;
Email link: `PENDING → CONFIRMED`. Returns a small HTML result page.
`404` unknown token · `410` already unsubscribed.

### GET /api/newsletter/unsubscribe?token=&lt;token&gt;
Email link: `→ UNSUBSCRIBED` (kept as the suppression list, never deleted).
Returns a small HTML result page. `404` unknown token.

> Admin audience list/export: `GET /api/admin/newsletter/subscribers`
> (`status`, `origin`, `q`, `page`, `limit`) and
> `GET /api/admin/newsletter/subscribers/export` (CSV, same filters). The
> audience dedupes footer signups and registered `User.email`s by address; an
> explicit unsubscribe always wins over an account row.

---

## 32. Webhooks

### POST /api/lightning/webhook
LNBits callback for invoice settlement.

```json
// Body (LNBits standard)
{ "payment_hash", "amount", "checking_id", ... }
```

---

## 33. AI Credits & MCP Access (ADR-384)

Colabonate-hosted AI credits and paid MCP access passes. Both are paid directly to the platform's own Lightning address
(`resolvePlatformInvoice`, Beta stacks resolve the `DEMO` rail); nothing is a refillable balance.

### GET /api/ai/credits  (auth)
Balance and purchasable packs.

```json
// Response
{ "requestsRemaining": 12, "requestsUsed": 8, "hostedEnabled": false, "tiers": [{ "id": "starter", "requests": 5, "priceSats": 1000 }, ...] }
// hostedEnabled=false (AI_HOSTED_ENABLED unset): packs are not on sale, purchase returns 503
```

### POST /api/ai/credits/purchase  (auth)
```json
// Body
{ "tier": "starter|standard|power" }
// 201: { "id", "tier", "requests", "amountSats", "rail": "LN|DEMO", "invoice", "paymentHash", "status": "PENDING" }
// 400 unknown tier · 429 too many pending purchases · 503 AI_HOSTED_NOT_ENABLED (hard sales gate) · 503 PLATFORM_PAYMENT_NOT_CONFIGURED
```

### POST /api/ai/credits/purchase/:id/confirm  (auth)
Idempotent. `LN` needs `{ "preimage" }` (verified against `paymentHash`); `DEMO` is beta-only and debits the demo wallet
(402 `DEMO_BALANCE_EXHAUSTED` reverts the purchase to `PENDING`). Response: `{ success, alreadyPaid, requestsRemaining }`.

### POST /api/ai/credits/reserve · POST /api/ai/credits/refund  (internal)
Used only by the mcp-server. Require `x-ai-internal-secret` and the user's bearer. `reserve` atomically takes one request
(409 `AI_CREDITS_EXHAUSTED`); `refund` gives one back only if the LLM call failed before any output (bounded by `requestsUsed`).

### Guest session credits (no auth)
`GET /api/ai/credits/guest?guestSessionId=` returns tiers and the balance for a known id.
`POST /api/ai/credits/guest/purchase { tier, guestSessionId? }` mints a 64-hex `guestSessionId` on the first purchase
(a well-formed but unknown id is 404). `POST /api/ai/credits/guest/purchase/:id/confirm { guestSessionId, preimage? }`.
Purchase and confirm are IP rate limited (30/h). Internal `POST /api/ai/credits/guest/reserve|refund { guestSessionId }`
require `x-ai-internal-secret`. A guest id is browser-bound and not recoverable.

### POST /ai/chat  (mcp-server)
Body gained `provider: "platform"` (Colabonate Hosted). `platform` first reserves a credit; SSE `provider-info` carries
`requestsRemaining`; errors carry an optional `code` (`AI_CREDITS_EXHAUSTED`, `AI_CREDITS_UNAVAILABLE`). The only
unauthenticated path: `provider: "platform"` with `guestSessionId` and no token (no tools, no per-user config).
`GET /ai/config` lists `platform` as enabled only when LLM_BASE_URL, LLM_API_KEY and LLM_MODEL_OVERRIDE are all set.

### GET /api/mcp/pricing  (public)
```json
{ "paywallActive": true, "trialMinutes": 30, "passes": [{ "id": "lifetime", "hours": null, "priceSats": 2600 }] }
```
`paywallActive` is true only where a user can actually pay (Beta DEMO rail or `PLATFORM_LN_ADDRESS`) and not disabled via
`MCP_PAYWALL_ENABLED=false`. Since ADR-410 the default ladder is a single **lifetime** tier at the payment floor; the
`MCP_PASS_TIERS` env override can still express a dated ladder (`hours` is `null` = never expires).

### GET /api/mcp/access  (auth)
```json
{ "paywallActive", "trialAvailable", "trialMinutes", "activePass": { "tier", "expiresAt", "lifetime" } | null, "passes": [...] }
```
Lifetime passes carry `expiresAt: null` and `lifetime: true` (legacy Day/Week/Month rows keep a concrete `expiresAt`).

### POST /api/mcp/passes/purchase  (auth)
`{ "tier": "lifetime" }` returns `{ id, tier, hours, amountSats, rail, invoice, paymentHash, status }` (same errors as credit
purchase). A second lifetime purchase while one is already active is refused before invoicing: `409 { "error":
"LIFETIME_ALREADY_ACTIVE" }`. Legacy tier ids (`day|week|month`) are no longer sold.

### POST /api/mcp/passes/:id/confirm  (auth)
Idempotent, same LN-preimage / DEMO semantics as credit purchases. The pass activates here: lifetime tiers with
`expiresAt: null`, dated (env-override / pre-ADR-410 legacy) tiers extend a still-active pass. Response:
`{ success, alreadyPaid, activePass }`.

### POST /api/mcp/connect  (auth) - changed
With the paywall active the connection lives as long as the active pass (`passTier` `lifetime` — connections are bounded
to `MCP_LIFETIME_CONNECTION_TTL_MS`, default 366 days — or a legacy dated tier) or 30 minutes on the one-time trial
(`passTier: "trial"`). No pass and trial spent: `402 { "error": "TRIAL_ALREADY_USED" }`. Response gained `passTier`;
`GET /api/mcp/connections` rows carry `passTier` (null = legacy free connection).
