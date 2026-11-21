NIP-B
=====

Colabonate Transaction Layer: Ticket Creation & Status Protocol
---------------------------------------------------------------

`draft` `optional`

`kind:30407` `kind:30408`

---

## Abstract

This NIP defines two addressable event kinds for the **transaction layer** of the Colabonate
decentralized marketplace. Together with NIP-A (kinds 30402, 30404, 30405, 30406), it forms
the open protocol stack for peer-to-peer buy/sell interactions over Nostr.

- **Kind 30407** — Ticket Created: a buyer signals the opening of a transaction against an offer
- **Kind 30408** — Ticket Status Update: either party advances the transaction state machine

Both kinds are addressable (30000–39999 range, NIP-01), enabling state replacement via the
`d`-tag + pubkey + kind triple.

---

## Motivation

NIP-A defines how offers are published to the marketplace. NIP-B closes the gap between
**offer discovery** and **completed transaction**: once a buyer selects an offer, both parties
need an auditable, relay-portable record of:

1. **That a transaction was opened** — with references to offer, buyer, and seller
2. **How the transaction evolved** — each authorized state transition, by whom, and when

Without a Nostr-native transaction layer, transaction records live exclusively in centralized
databases. Publishing them as Nostr events enables:

- Cross-client visibility (any Nostr client can display open/completed transactions)
- Relay-based persistence independent of the originating server
- Cryptographic audit trail of state transitions

### Relation to Existing NIPs

| NIP | Role |
|-----|------|
| [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) | Base protocol, event structure, addressable events |
| [NIP-A](NIP-A-service-marketplace-and-identity.md) | Offer discovery layer (30402); `offer` tag in 30407 references a 30402 event |
| [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) | Lightning Zap receipts (9735); optionally referenced via `payment_hash` tag in 30408 |
| [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md) | HTTP Auth; SHOULD be used to authenticate server-side state transitions |

---

## Kinds

| Kind  | Name                | Publisher | Description                              |
|-------|---------------------|-----------|------------------------------------------|
| 30407 | Ticket Created      | Buyer     | Opens a transaction against a 30402 offer |
| 30408 | Ticket Status Update | Buyer / Seller / Arbitrator | Advances the transaction state |

---

## Kind 30407 — Ticket Created

### Description

Published by the buyer (or a server acting as proxy for the buyer) when a transaction is
initiated against a 30402 offer. Creates a shared reference point (the ticket ID) that
all subsequent 30408 events reference.

### Schema

```json
{
  "kind": 30407,
  "pubkey": "<buyer-pubkey-hex>",
  "created_at": 1712000000,
  "tags": [
    ["d",          "<ticket-id>"],
    ["ticket",     "<ticket-id>"],
    ["offer",      "<offer-id>"],
    ["buyer",      "<buyer-pubkey-hex>"],
    ["seller",     "<seller-pubkey-hex>"],
    ["p",          "<seller-pubkey-hex>"],
    ["status",     "PENDING"],
    ["offer_type", "service"],
    ["ticket_type","smart_order"]
  ],
  "content": "<optional buyer message, max 2048 chars>",
  "sig": "<schnorr-signature>"
}
```

### Tags

| Tag           | Required | Value format                             | Description |
|---------------|----------|------------------------------------------|-------------|
| `d`           | yes      | UUID or slug string                      | Unique ticket identifier; same as `ticket` tag value |
| `ticket`      | yes      | UUID string                              | Ticket ID; redundant with `d`, aids filtering clients that do not parse `d` |
| `offer`       | yes      | UUID string                              | Reference to the Kind 30402 offer this ticket is opened against |
| `buyer`       | yes      | hex pubkey                               | Buyer's Nostr pubkey |
| `seller`      | yes      | hex pubkey                               | Seller's Nostr pubkey |
| `p`           | yes      | hex pubkey                               | Seller's Nostr pubkey (NIP-01 contact tag; enables `#p` relay filtering so the seller receives the event) |
| `status`      | yes      | `PENDING`                                | Initial status; always `PENDING` at creation for SERVICE offers |
| `offer_type`  | no       | `service` / `product` / `item`           | Delivery model copied from the referenced offer; informs the client which flow to use |
| `ticket_type` | no       | `smart_order` / `milestone` / `cooperation` | Transaction model; defaults to `smart_order` |

### Content

Optional free-text message from the buyer to the seller. Plain text, max 2048 characters.
Clients SHOULD render this as a first message in a ticket thread view.

### Initial Status by Offer Type

| `offer_type` | Initial `status` | Meaning |
|--------------|-----------------|---------|
| `service`    | `PENDING`       | Seller must explicitly accept |
| `product`    | `IN_PROGRESS`   | Auto-accepted; seller can invoice immediately |
| `item`       | `IN_PROGRESS`   | Same as `product` |

For `product` and `item` offers, clients MAY publish 30407 with `status: IN_PROGRESS` directly,
or publish with `PENDING` followed immediately by a 30408 advancing to `IN_PROGRESS`.

### Example Event

```json
{
  "kind": 30407,
  "pubkey": "a1b2c3d4...",
  "created_at": 1712000000,
  "tags": [
    ["d",           "ticket-7f3a9b2c"],
    ["ticket",      "ticket-7f3a9b2c"],
    ["offer",       "offer-abc123"],
    ["buyer",       "a1b2c3d4..."],
    ["seller",      "e5f6a7b8..."],
    ["p",           "e5f6a7b8..."],
    ["status",      "PENDING"],
    ["offer_type",  "service"],
    ["ticket_type", "smart_order"]
  ],
  "content": "Hi, I need the logo by Friday. Can you confirm?",
  "sig": "..."
}
```

---

## Kind 30408 — Ticket Status Update

### Description

Published whenever an authorized party advances the ticket state machine. Each event
replaces the previous 30408 for the same `d` tag (addressable event semantics: same
`pubkey` + `kind` + `d` → replacement).

> **Note on relay semantics:** Because 30408 is addressable, relays store only the **latest**
> version per (`pubkey`, `kind`, `d`) triple. Clients that need a full history of transitions
> MUST store received events locally before they are replaced.

### Schema

```json
{
  "kind": 30408,
  "pubkey": "<updater-pubkey-hex>",
  "created_at": 1712001000,
  "tags": [
    ["d",            "<ticket-id>"],
    ["ticket",       "<ticket-id>"],
    ["status",       "IN_PROGRESS"],
    ["buyer",        "<buyer-pubkey-hex>"],
    ["seller",       "<seller-pubkey-hex>"],
    ["p",            "<buyer-pubkey-hex>"],
    ["offer_type",   "service"],
    ["invoice",      "<bolt11-invoice>"],
    ["payment_hash", "<hex>"],
    ["preimage",     "<hex>"]
  ],
  "content": "<optional note>",
  "sig": "<schnorr-signature>"
}
```

### Tags

| Tag            | Required | Value format                     | Description |
|----------------|----------|----------------------------------|-------------|
| `d`            | yes      | UUID string                      | Ticket ID (same as in 30407 for this ticket) |
| `ticket`       | yes      | UUID string                      | Redundant with `d`; aids filtering |
| `status`       | yes      | see Status Values table          | The **new** status after this transition |
| `buyer`        | yes      | hex pubkey                       | Buyer's pubkey |
| `seller`       | yes      | hex pubkey                       | Seller's pubkey |
| `p`            | no       | hex pubkey                       | The **counterparty** pubkey (the party being notified); SHOULD be included |
| `offer_type`   | no       | `service` / `product` / `item`   | Copied from 30407; helps clients render the correct flow |
| `invoice`      | no       | BOLT11 string                    | Lightning invoice issued for this transition (escrow phase) |
| `payment_hash` | no       | hex string                       | Payment hash of the invoice; used for correlation with NIP-57 Zap receipts |
| `preimage`     | no       | hex string                       | Payment preimage; proof of settlement |

### Status Values

| Status          | Terminal | Meaning |
|-----------------|----------|---------|
| `PENDING`       | no       | Ticket opened, awaiting seller acceptance |
| `IN_PROGRESS`   | no       | Seller accepted; work in progress |
| `PAID`          | no       | Payment received; awaiting delivery |
| `COMPLETED`     | yes      | Buyer confirmed delivery; transaction closed |
| `CANCELLED`     | yes      | Cancelled by buyer or seller |
| `DISPUTED`      | no       | Either party raised a dispute |

### State Machine

```
PENDING ──────────────────────────► CANCELLED   (buyer or seller)
   │
   └──[seller accepts]──► IN_PROGRESS ──────────► CANCELLED   (buyer or seller)
                               │
                               ├──[invoice paid]──► PAID ──────► COMPLETED   (buyer confirms)
                               │                         │
                               └─────────────────────────┴──► DISPUTED   (buyer or seller)
                                                                    │
                                                    DISPUTED ──────►  COMPLETED   (arbitrator, Phase 4)
                                                                    └──► CANCELLED   (arbitrator, Phase 4)
```

### Authorization Rules

The `pubkey` of a 30408 event MUST match the authorized party for the transition:

| Transition              | Authorized `pubkey`              |
|-------------------------|----------------------------------|
| `PENDING → IN_PROGRESS` | Seller pubkey                    |
| `PENDING → CANCELLED`   | Buyer pubkey or Seller pubkey    |
| `IN_PROGRESS → PAID`    | Protocol / server (invoice paid webhook) |
| `IN_PROGRESS → CANCELLED` | Buyer pubkey or Seller pubkey  |
| `PAID → COMPLETED`      | Buyer pubkey                     |
| `PAID → DISPUTED`       | Buyer pubkey or Seller pubkey    |
| `IN_PROGRESS → DISPUTED`| Buyer pubkey or Seller pubkey    |
| `DISPUTED → COMPLETED`  | Arbitrator pubkey (Phase 4)      |
| `DISPUTED → CANCELLED`  | Arbitrator pubkey (Phase 4)      |

> **Implementation note (V1 / server-proxy mode):** In V1, the server publishes 30408
> events with an ephemeral key on behalf of the authorized party. This is an acceptable
> transitional model. The long-term goal is for clients to sign 30408 events directly
> using NIP-07 (browser extension) or NIP-46 (remote signing). The NIP-98 authorization
> header on the triggering HTTP request links the user's key to the server action.

### Escrow Integration

Lightning escrow phases are signaled via optional tags in 30408, not via a separate event kind:

| Escrow Phase | Tags present in 30408 |
|---|---|
| Phase 1 (25% hold invoice issued) | `invoice`, `payment_hash` |
| Phase 1 settled | `preimage` added; status → `PAID` |
| Phase 2 (50% release invoice) | `invoice`, `payment_hash` |
| Phase 3 (25% final release) | `invoice`, `payment_hash` |
| Fully released | status → `COMPLETED` |

Clients that do not understand escrow tags MUST still be able to render the `status` field
and display appropriate UI without the invoice data.

### Example Events

**Seller accepts (PENDING → IN_PROGRESS):**
```json
{
  "kind": 30408,
  "pubkey": "e5f6a7b8...",
  "created_at": 1712001000,
  "tags": [
    ["d",          "ticket-7f3a9b2c"],
    ["ticket",     "ticket-7f3a9b2c"],
    ["status",     "IN_PROGRESS"],
    ["buyer",      "a1b2c3d4..."],
    ["seller",     "e5f6a7b8..."],
    ["p",          "a1b2c3d4..."],
    ["offer_type", "service"]
  ],
  "content": "Accepted! I will start on Monday.",
  "sig": "..."
}
```

**Payment confirmed (IN_PROGRESS → PAID) with escrow Phase 1 invoice:**
```json
{
  "kind": 30408,
  "pubkey": "e5f6a7b8...",
  "created_at": 1712002000,
  "tags": [
    ["d",            "ticket-7f3a9b2c"],
    ["ticket",       "ticket-7f3a9b2c"],
    ["status",       "PAID"],
    ["buyer",        "a1b2c3d4..."],
    ["seller",       "e5f6a7b8..."],
    ["p",            "a1b2c3d4..."],
    ["offer_type",   "service"],
    ["invoice",      "lnbc500n1..."],
    ["payment_hash", "abc123..."],
    ["preimage",     "def456..."]
  ],
  "content": "",
  "sig": "..."
}
```

**Buyer confirms completion (PAID → COMPLETED):**
```json
{
  "kind": 30408,
  "pubkey": "a1b2c3d4...",
  "created_at": 1712005000,
  "tags": [
    ["d",          "ticket-7f3a9b2c"],
    ["ticket",     "ticket-7f3a9b2c"],
    ["status",     "COMPLETED"],
    ["buyer",      "a1b2c3d4..."],
    ["seller",     "e5f6a7b8..."],
    ["p",          "e5f6a7b8..."],
    ["offer_type", "service"]
  ],
  "content": "Delivered as agreed. Thank you!",
  "sig": "..."
}
```

---

## Client Behavior

### Querying Tickets

To fetch all open tickets for a seller:
```json
{
  "kinds": [30407],
  "#p": ["<seller-pubkey>"]
}
```

To fetch status updates for a specific ticket:
```json
{
  "kinds": [30408],
  "#d": ["<ticket-id>"]
}
```

### Relay Semantics and History

Because 30408 is an **addressable** (replaceable) event, only the latest state per
(`pubkey`, `kind`, `d`) is stored by relays. Clients that need a full audit trail
SHOULD implement local storage of received 30408 events before they are overwritten.

### Backward Compatibility

Implementations SHOULD continue to publish to legacy kinds 30018 and 30019 during
the dual-publishing transition period. When encountering events with the same ticket
ID in both legacy and new kinds, clients SHOULD prefer the new kinds (30407/30408).

---

## Open Questions

1. **Client-side signing path:** NIP-B V1 allows server-proxy signing with ephemeral keys.
   A future revision SHOULD define how NIP-07/NIP-46 clients sign 30408 events directly.

2. **Escrow as a separate kind (Kind 30416?):** Keeping escrow in optional tags of 30408
   is the V1 approach. If escrow coordination requires multi-party signatures (hold invoice
   co-signing), a dedicated Kind 30416 may be introduced in NIP-B v2.

3. **Dispute arbitrator pubkey:** The arbitrator authorization in `DISPUTED → COMPLETED/CANCELLED`
   requires a registered arbitrator registry (Phase 4 / NIP-D). Currently not defined.

---

## References

- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) — Base Nostr protocol
- [NIP-A](NIP-A-service-marketplace-and-identity.md) — Colabonate Marketplace Layer (30402, 30404, 30405, 30406)
- [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) — Lightning Zaps
- [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md) — HTTP Auth
- [docs/protocols/core/nostr-events.md](https://github.com/Colabonate/Colabonate_Protocol/blob/main/docs/protocols/core/nostr-events.md) — Full kind reference
- [docs/protocols/workflows/buy-protocol.md](https://github.com/Colabonate/Colabonate_Protocol/blob/main/docs/protocols/workflows/buy-protocol.md) — Buy flow
- [docs/protocols/core/escrow-protocol.md](https://github.com/Colabonate/Colabonate_Protocol/blob/main/docs/protocols/core/escrow-protocol.md) — Escrow details
- ADR-101 — NIP-15 conflict resolution
- ADR-106 — NIP-B implementation decisions
