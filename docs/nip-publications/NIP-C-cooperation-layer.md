NIP-C
=====

Colabonate Cooperation Layer: Proposal & Milestone Protocol
------------------------------------------------------------

`draft` `optional`

`kind:30414` `kind:30415`

---

## Abstract

This NIP defines two addressable event kinds for the **cooperation layer** of the Colabonate
decentralized marketplace. It extends NIP-A (offers) and NIP-B (transactions) with a
multi-party collaboration model built on milestones, mutual agreement, and per-milestone
payment release.

- **Kind 30414** — Cooperation Proposal: an initiator publishes a cooperation offer;
  a partner responds with acceptance, forming a cryptographically bound agreement
  via co-signed event references
- **Kind 30415** — Milestone Event: completion proof and release signal per milestone

Both kinds are addressable (30000–39999 range, NIP-01), enabling state replacement via
the `d` tag + pubkey + kind triple.

---

## Motivation

NIP-A enables offer discovery. NIP-B handles single-transaction buy/sell with one buyer
and one seller. The Cooperation Layer closes the gap for:

- **Multi-party collaboration** — n partners, not just buyer/seller
- **Longer-term relationships** — multiple milestones over days or weeks
- **Mutual agreement** — both parties cryptographically sign the cooperation terms
- **Per-milestone payment release** — escrow released incrementally, not in one shot

Without a Nostr-native cooperation layer, collaboration agreements are tracked
exclusively in centralized databases. Publishing them as Nostr events enables:

- Cross-client visibility of active cooperations
- Relay-based persistence independent of any single server
- Cryptographic audit trail of milestone completions and payment releases
- Portable reputation tied to pubkeys across the Nostr ecosystem

### Relation to Existing NIPs

| NIP | Role |
|-----|------|
| [NIP-01](01.md) | Base protocol, event structure, addressable events |
| [NIP-A](NIP-A-service-marketplace-and-identity.md) | Offer discovery layer (30402); `ticket_type: cooperation` forward-compat tag |
| [NIP-B](NIP-B-transaction-layer.md) | Ticket Created (30407) + Status Update (30408); `ticket_type: milestone` |
| [NIP-57](57.md) | Lightning Zap receipts (9735); milestone payment settlement |
| [NIP-98](98.md) | HTTP Auth; authenticates server-side cooperation state transitions |

---

## Kinds

| Kind  | Name                     | Publisher   | Description                                 |
|-------|--------------------------|-------------|---------------------------------------------|
| 30414 | Cooperation Proposal     | Initiator / Partner | Opens a cooperation or confirms acceptance |
| 30415 | Milestone Completion     | Partner / Initiator  | Reports milestone completion, signals release |

---

## Kind 30414 — Cooperation Proposal

### Description

Published by the **initiator** to propose a cooperation (Phase A of cooperation-protocol.md).
The initiator describes the goal, required skills, budget, and timeline.
After the **partner** accepts, their acceptance event (also Kind 30414, replaceable per
`d`-tag) forms the cryptographically signed agreement.

The agreement is the combination of two signed Nostr events:
1. Initiator's proposal event (Kind 30414)
2. Partner's acceptance event (Kind 30414, same `d` tag, replaces proposal)

This pattern avoids the need for co-signed events (Nostr events support only one signature)
while achieving the same effect: both parties have cryptographically signed the same
cooperation ID (`d` tag), establishing mutual agreement.

### Schema

```json
{
  "kind": 30414,
  "pubkey": "<initiator-or-partner-pubkey-hex>",
  "created_at": 1712000000,
  "tags": [
    ["d",          "<cooperation-id>"],
    ["type",       "proposal" | "acceptance"],
    ["cooperation","<cooperation-id>"],
    ["initiator",  "<initiator-pubkey-hex>"],
    ["partner",    "<partner-pubkey-hex>"],
    ["p",          "<counterparty-pubkey-hex>"],
    ["title",      "<cooperation-title>"],
    ["budget",     "<sats>", "sats"],
    ["timeline",   "<optional-timeline-description>"],
    ["status",     "OPEN" | "ACCEPTED" | "ACTIVE" | "COMPLETED" | "CANCELLED"],
    ["ticket_type","cooperation"]
  ],
  "content": "<proposal-description-or-acceptance-note>",
  "sig": "<schnorr-signature>"
}
```

### Tags

| Tag | Required | Value format | Description |
| --- | --- | --- | --- |
| `d` | yes | UUID string | Unique cooperation identifier |
| `type` | yes | `proposal` / `acceptance` | Role of this event in the agreement |
| `cooperation` | yes | UUID string | Same as `d`; redundancy aids filtering |
| `initiator` | yes | hex pubkey | Cooperation initiator's pubkey |
| `partner` | yes | hex pubkey | Cooperation partner's pubkey |
| `p` | yes | hex pubkey | Counterparty pubkey (NIP-01 contact tag for relay notification) |
| `title` | yes | String (max 200 chars) | Human-readable cooperation title |
| `budget` | yes | Integer string + "sats" | Total budget in satoshis |
| `timeline` | no | String | Expected duration or deadline |
| `status` | yes | See Status Values table | Current cooperation status |
| `ticket_type` | yes | `cooperation` | Forward-compat with NIP-A Kind 30402 |
| `skills` | no | Multi-value: `["skills", "skill1", "skill2", ...]` | Required skills or roles |
| `cooperation_type` | no | `transactional` / `production` / `sales` / `service` / `educational` / `crowdfunding` / `barter` | Social context from cooperation-protocol.md |

### Status Values

| Status       | Terminal | Meaning |
|--------------|----------|---------|
| `OPEN`       | no       | Proposal published; awaiting partner acceptance |
| `ACCEPTED`   | no       | Partner signed acceptance; agreement formed |
| `ACTIVE`     | no       | Milestone work in progress |
| `COMPLETED`  | yes      | All milestones done; cooperation closed |
| `CANCELLED`  | yes      | Cancelled by initiator or partner |

### Agreement Formation (Cryptographic Binding)

The cooperation agreement is formed by the **combination** of two Kind 30414 events
with the same `d` tag (cooperation ID):

```
Initiator publishes:
  Kind 30414, pubkey=<initiator>, type=proposal, status=OPEN

Partner publishes:
  Kind 30414, pubkey=<partner>, type=acceptance, status=ACCEPTED, d=<same-id>
```

Because Kind 30414 is addressable, the partner's acceptance **replaces** the open
proposal at the `(partner-pubkey, kind, d)` triple. The agreement's integrity is
verifiable:

1. Initiator's proposal event proves the initiatorIntent
2. Partner's acceptance event proves the partner agreed to those terms
3. Both events reference the same `d` tag (cooperation ID)
4. Both events are signed by their respective private keys

A third party can verify the agreement by querying:
```
{ kinds: [30414], "#d": ["<cooperation-id>"] }
```
Two events with the same cooperation ID, one signed by initiator and one by partner,
constitute the complete agreement.

### State Machine

```
OPEN ──────────────────────► CANCELLED  (initiator cancels before acceptance)
   │
   └──[partner accepts]──► ACCEPTED ──► ACTIVE ──► COMPLETED
                                    │           │
                                    └───────────┴──► CANCELLED  (either party)
```

### Authorization Rules

| Transition            | Authorized `pubkey`            |
|-----------------------|--------------------------------|
| Any (initiator)       | Initiator pubkey               |
| OPEN → ACCEPTED       | Partner pubkey (first to publish acceptance) |
| OPEN → CANCELLED      | Initiator pubkey               |
| ACCEPTED → ACTIVE     | Initiator or Partner (triggers milestone work) |
| ACCEPTED → CANCELLED  | Initiator or Partner           |
| ACTIVE → COMPLETED    | Initiator (after all milestones done) |
| ACTIVE → CANCELLED    | Initiator or Partner           |

### Example Events

**Initiator publishes a proposal:**
```json
{
  "kind": 30414,
  "pubkey": "a1b2c3d4...",
  "created_at": 1712000000,
  "tags": [
    ["d",               "coop-xyz789"],
    ["type",            "proposal"],
    ["cooperation",     "coop-xyz789"],
    ["initiator",       "a1b2c3d4..."],
    ["partner",         "e5f6a7b8..."],
    ["p",               "e5f6a7b8..."],
    ["title",           "Joint logo design project"],
    ["budget",          "100000", "sats"],
    ["timeline",        "4 weeks"],
    ["status",          "OPEN"],
    ["ticket_type",     "cooperation"],
    ["skills",          "graphic design, branding"],
    ["cooperation_type","transactional"]
  ],
  "content": "Looking for a designer partner to create a complete brand identity for my cafe. Budget 100k sats total, split per milestone.",
  "sig": "..."
}
```

**Partner accepts:**
```json
{
  "kind": 30414,
  "pubkey": "e5f6a7b8...",
  "created_at": 1712000100,
  "tags": [
    ["d",               "coop-xyz789"],
    ["type",            "acceptance"],
    ["cooperation",     "coop-xyz789"],
    ["initiator",       "a1b2c3d4..."],
    ["partner",         "e5f6a7b8..."],
    ["p",               "a1b2c3d4..."],
    ["title",           "Joint logo design project"],
    ["budget",          "100000", "sats"],
    ["status",          "ACCEPTED"],
    ["ticket_type",     "cooperation"],
    ["cooperation_type","transactional"]
  ],
  "content": "I accept! I have experience with cafe branding. Let's start with the first milestone next week.",
  "sig": "..."
}
```

---

## Kind 30415 — Milestone Completion Event

### Description

Published by the party who completed a milestone (typically the partner delivering work)
to report completion and evidence. The initiator responds by releasing the milestone
payment (via Kind 30408 escrow signaling or Lightning invoice settlement).

Each milestone gets its own Kind 30415 event. The event is addressable per
`(cooperation-id, milestone-index, kind)` — the `d` tag encodes both the cooperation
ID and the milestone number to allow per-milestone replacement.

### Schema

```json
{
  "kind": 30415,
  "pubkey": "<completer-pubkey-hex>",
  "created_at": 1712002000,
  "tags": [
    ["d",             "<cooperation-id>-<milestone-index>"],
    ["cooperation",   "<cooperation-id>"],
    ["milestone",     "<milestone-id>"],
    ["milestone_index","<1-based-index>"],
    ["initiator",     "<initiator-pubkey-hex>"],
    ["partner",       "<partner-pubkey-hex>"],
    ["p",             "<initiator-pubkey-hex>"],
    ["title",         "<milestone-title>"],
    ["status",        "COMPLETED" | "ACCEPTED" | "DISPUTED"],
    ["amount",        "<sats>", "sats"],
    ["evidence",      "<optional-url-or-hash>"],
    ["released",      "true" | "false"]
  ],
  "content": "<completion-note-or-evidence-description>",
  "sig": "<schnorr-signature>"
}
```

### Tags

| Tag              | Required | Value format                  | Description |
|------------------|----------|-------------------------------|-------------|
| `d`              | yes      | `<coop-id>-<milestone-index>` | Composite addressable ID |
| `cooperation`    | yes      | UUID string                   | Reference to the parent cooperation |
| `milestone`      | yes      | UUID string                   | Milestone database ID |
| `milestone_index`| yes      | Integer string (1-based)      | Milestone number in sequence |
| `initiator`      | yes      | hex pubkey                    | Cooperation initiator |
| `partner`        | yes      | hex pubkey                    | Cooperation partner |
| `p`              | yes      | hex pubkey                    | Counterparty to notify |
| `title`          | yes      | String                        | Milestone title |
| `status`         | yes      | `COMPLETED` / `ACCEPTED` / `DISPUTED` | Milestone state |
| `amount`         | yes      | Integer string + "sats"       | Amount to be released |
| `evidence`       | no       | URL or hash string            | Link to deliverable or proof |
| `released`       | no       | `true` / `false`              | Whether payment was released |

### Milestone Status Values

| Status      | Terminal | Meaning |
|-------------|----------|---------|
| `COMPLETED` | no       | Partner reported completion; awaiting initiator acceptance |
| `ACCEPTED`  | yes      | Initiator accepted; payment released |
| `DISPUTED`  | no       | Initiator rejected; dispute raised |

### State Machine

```
PENDING (in ticket) ──► COMPLETED ──► ACCEPTED ──► (payment released)
                            │
                            └──────────► DISPUTED ──► (dispute protocol)
```

### Authorization Rules

| Transition             | Authorized `pubkey`              |
|------------------------|-----------------------------------|
| Any milestone → COMPLETED | Partner pubkey (performer)     |
| COMPLETED → ACCEPTED   | Initiator pubkey (reviewer)       |
| COMPLETED → DISPUTED   | Initiator pubkey                  |

### Dual Publishing

Kind 30415 is dual-published to legacy kind 30023 (if not already used for HID)
and the new kind 30415. The legacy kind for cooperation milestones is TBD based
on NIP-15 conflict analysis. Until resolved, publish only to 30415.

### Example Events

**Partner completes milestone 1:**
```json
{
  "kind": 30415,
  "pubkey": "e5f6a7b8...",
  "created_at": 1712002000,
  "tags": [
    ["d",              "coop-xyz789-1"],
    ["cooperation",    "coop-xyz789"],
    ["milestone",      "ms-001"],
    ["milestone_index", "1"],
    ["initiator",      "a1b2c3d4..."],
    ["partner",        "e5f6a7b8..."],
    ["p",              "a1b2c3d4..."],
    ["title",          "Logo concept designs"],
    ["status",         "COMPLETED"],
    ["amount",         "25000", "sats"],
    ["evidence",       "https://example.com/deliverables/logo-v1.zip"],
    ["released",       "false"]
  ],
  "content": "I've created 3 logo concepts based on our discussion. Please review and approve for the next phase.",
  "sig": "..."
}
```

**Initiator accepts milestone 1 (releases payment):**
```json
{
  "kind": 30415,
  "pubkey": "a1b2c3d4...",
  "created_at": 1712003000,
  "tags": [
    ["d",              "coop-xyz789-1"],
    ["cooperation",    "coop-xyz789"],
    ["milestone",      "ms-001"],
    ["milestone_index", "1"],
    ["initiator",      "a1b2c3d4..."],
    ["partner",        "e5f6a7b8..."],
    ["p",              "e5f6a7b8..."],
    ["title",          "Logo concept designs"],
    ["status",         "ACCEPTED"],
    ["amount",         "25000", "sats"],
    ["evidence",       "https://example.com/deliverables/logo-v1.zip"],
    ["released",       "true"]
  ],
  "content": "Love the concepts! 25k sats released to your Lightning address.",
  "sig": "..."
}
```

---

## Client Behavior

### Querying Cooperations

To fetch cooperations where the user is the initiator:
```json
{
  "kinds": [30414],
  "authors": ["<initiator-pubkey>"]
}
```

To fetch cooperations where the user is the partner:
```json
{
  "kinds": [30414],
  "#partner": ["<partner-pubkey>"]
}
```

### Fetching Milestones for a Cooperation

```json
{
  "kinds": [30415],
  "#cooperation": ["<cooperation-id>"]
}
```

### Agreement Verification

A cooperation agreement is valid when two Kind 30414 events exist with the same
`d` tag and different `pubkey` values (initiator + partner). The `status` field
of the latest event determines the current state.

---

## Backward Compatibility

Implementations SHOULD continue to publish to legacy kinds during the dual-publishing
transition period. For Kind 30414, the legacy alias is TBD. When the transition period
ends, clients SHOULD prefer the new kinds (30414/30415).

---

## Open Questions

1. **Legacy kind for 30414/30415:** The legacy kind range 30017–30027 has NIP-15
   conflicts. A legacy kind for cooperation proposals and milestones has not yet
   been assigned. This should be resolved before NIP-C submission.

2. **Dispute escalation:** When a milestone is marked `DISPUTED`, the full dispute
   flow (Kind 30409) should be triggered. The integration point between Kind 30415
   and Kind 30409 needs to be specified in NIP-D.

3. **Client-side signing path:** Similar to NIP-B V1, the server publishes 30414/30415
   events with an ephemeral key. A future revision should define how NIP-07/NIP-46
   clients sign directly.

---

## References

- [NIP-01](01.md) — Base Nostr protocol
- [NIP-A](NIP-A-service-marketplace-and-identity.md) — Colabonate Marketplace Layer (30402, 30404, 30405, 30406)
- [NIP-B](NIP-B-transaction-layer.md) — Transaction Layer (30407, 30408)
- [NIP-57](57.md) — Lightning Zaps
- [NIP-98](98.md) — HTTP Auth
- [docs/protocols/core/nostr-events.md](../protocols/core/nostr-events.md) — Full kind reference
- [docs/protocols/workflows/cooperation-protocol.md](../protocols/workflows/cooperation-protocol.md) — Cooperation workflow
- [docs/decisions/108-nip-c-cooperation-layer.md](../decisions/108-nip-c-cooperation-layer.md) — NIP-C design decisions
