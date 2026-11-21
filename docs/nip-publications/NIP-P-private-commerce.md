NIP-P0
======

Private Commerce via NIP-17 Gift-Wrapped Direct Messages
--------------------------------------------------------

`draft` `optional` `depends:17` `depends:44` `depends:59` `depends:10050`

`kind:14` `kind:1059` `kind:31990` `kind:31989`

---

> **Status:** DRAFT (PR-ready for `nostr-protocol/nips` repository)
> **Kind(s):** 14 (encrypted DM content), 1059 (gift wrap), 31990/31989 (app handlers)
> **Authors:** Deniz Yilmaz <<info@colabonate.com>>
> **License:** CC0
> **Discussions-To:** https://github.com/nostr-protocol/nips/pull/2480 (to be opened)
> **Companion:** [NIP-A — Freedom of Interaction Protocol (Identity & Commerce)](NIP-A-service-marketplace-and-identity.md)
> **Reference implementation:** Colabonate (`apps/colabonate-app/src/lib/nostr-ticket.ts`, `apps/server/routes/private-verdict.ts`)

---

## Abstract

[NIP-A](NIP-A-service-marketplace-and-identity.md) defines the **public** commerce layer over Nostr: service offers (`kind:30402`), cooperation proposals (`kind:30414`), milestones (`kind:30415`), and reviews (`kind:30406`) are broadcast as addressable text events. That is correct for trades that want discovery and reputation, but it is the wrong default for a second class of trade: those that require **maximum anonymity** and explicitly opt out of the global index and the reputation graph.

This NIP defines how the **same** commerce lifecycle (offer → acceptance → ticket → escrow → milestone delivery → optional private dispute verdict) is carried **privately** as the decrypted `content` of [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) gift-wrapped direct messages ([NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) encryption, [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) gift wrap). The wire format is a disciplined JSON envelope whose `t` discriminator reuses the existing NIP-A/NIP-C tag vocabulary, so a private DM and a public event describe the **same** trade object and a client can reconstruct either from the other.

It also specifies how a Colabonate-compatible client advertises itself as a handler for these kinds via [NIP-89](https://github.com/nostr-protocol/nips/blob/master/89.md) app-handler events, so private offers shared as `nostr:` URIs open in any cooperating client.

**Key properties:**

- No new Nostr kinds for the trade objects themselves — private commerce reuses `kind:14`/`kind:1059`.
- Metadata-hiding by construction: a relay sees only a `kind:1059` gift wrap from a random one-time pubkey; sender, recipient, subject, and timing are all hidden (NIP-59).
- The same JSON envelope works for a 1:1 offer, an n-party cooperation, a milestone, and a private dispute verdict.
- Reputation is **structurally** excluded: there is no public `kind:30406` review for a private trade (see "Reputation").

---

## Motivation

### Why a separate private layer?

NIP-A's public events are globally indexable by design. For a user who wants to buy or sell **without** that exposure — whistleblowers, sensitive services, high-value one-offs, or anyone who simply does not want a permanent public commerce graph — the only Nostr-native option is NIP-17 direct messages. But "send a DM" alone is not a commerce protocol: both peers need to agree on what a "private offer" *is*, how acceptance is signalled, how milestones are delivered, and how a mutually-agreed arbiter returns a verdict.

This NIP standardizes that, without inventing new kinds and without duplicating NIP-A/NIP-C semantics.

### What this NIP does NOT do

- It does **not** replace NIP-A public events. Public and private are parallel modes; the user picks per trade.
- It does **not** define a new encryption scheme. NIP-44 v2 + NIP-59 gift wrap are mandatory and reused as-is.
- It does **not** provide discovery. There is intentionally **no** search index for private offers; recipients are addressed by npub/nprofile/DM-relay list (`kind:10050`).

---

## Transport and envelope

All private-commerce messages are **NIP-59 gift-wrapped**: a `kind:1059` event whose `content` is a NIP-44-encrypted `kind:13` seal of a `kind:14` rumor. The rumor's `content` is the **JSON envelope** defined by this NIP. Relays and any party other than the recipient see only the opaque gift wrap.

The envelope is a single JSON object. It is NOT Nostr-native (it lives inside the encrypted DM), so it carries its own `t` discriminator that reuses the existing NIP-A/NIP-C vocabulary:

| Envelope `type` / `t` | Meaning                                              | Public counterpart |
|-----------------------|------------------------------------------------------|--------------------|
| `offer`               | Private service/product offer                        | `kind:30402`       |
| `cooperation_proposal`| Private cooperation proposal **or** acceptance        | `kind:30414`       |
| `milestone` (`t=colabonate-milestone`) | Private milestone completion/release | `kind:30415`       |
| `counter`             | Counter-offer to a private offer                      | _(none — DM-only)_ |
| `message`             | Free-text chat in a trade thread                      | _(none — DM-only)_ |
| `verdict`             | Mutual-arbiter dispute verdict (RELEASE/CANCEL/SPLIT) | _(none — DM-only)_ |

A `kind:14` (plaintext DM) form is permitted **only** for server-side inbox cache rows that are never placed on a relay; anything that touches a relay MUST be gift-wrapped (`kind:1059`).

---

## Specification — Envelope `offer` (private service/product offer)

Sent by the seller to one or more prospective buyers. Mirrors NIP-A `kind:30402` fields.

```jsonc
// Decrypted content of the kind:14 rumor inside the kind:1059 gift wrap.
{
  "type": "offer",
  "offerId": "offer-abc123",                       // local id; the d-tag of the public counterpart
  "title": "Brand identity package",
  "description": "Full brand identity …",
  "priceSats": 50000,
  "categoryCode": "services/design",
  "images": ["https://…/logo.png"],                // optional
  "creatorPubkey": "<seller-pubkey>",
  "deliveryTimeDays": 7,                            // optional
  "deliveryCostSats": 0,                            // optional
  "deliveryNotes": "",                              // optional
  "timestamp": 1715000000
}
```

Validation rules:

- `offerId`, `title`, `priceSats` (positive integer), `creatorPubkey` (64-hex), and `timestamp` (unix seconds) are REQUIRED.
- `categoryCode` SHOULD be a UN/SPSC-aligned code consistent with the public NIP-A vocabulary.
- The recipient is determined by the gift wrap's `p`-tag (NIP-59), not by any field in the envelope.

---

## Specification — Envelope `cooperation_proposal` (proposal or acceptance)

Carries the **identical** NIP-C `kind:30414` tag set inside `nip_c.tags` so the counterparty can reconstruct the agreement byte-for-byte; no logic duplication between public and private paths. `subType` distinguishes the dual-signature direction.

```jsonc
{
  "type": "cooperation_proposal",
  "subType": "proposal",                            // "proposal" | "acceptance"
  "cooperationId": "coop-xyz",
  "title": "Web3 landing page",
  "budgetSats": 250000,
  "initiatorPubkey": "<initiator>",
  "partnerPubkey": "<partner>",
  "nip_c": {
    "kind": 30414,
    "tags": [                                        // exact NIP-C tag set
      ["d", "coop-xyz"], ["type", "proposal"],
      ["cooperation", "coop-xyz"], ["initiator", "<initiator>"],
      ["partner", "<partner>"], ["p", "<partner>"],
      ["title", "Web3 landing page"], ["budget", "250000", "sats"],
      ["status", "PROPOSED"], ["ticket_type", "cooperation"]
    ],
    "content": "Optional long-form description"
  },
  "timestamp": 1715000000
}
```

For `subType: "acceptance"`, the `p`-tag (and the gift-wrap recipient) flips to the initiator, mirroring public NIP-C dual-signature direction.

---

## Specification — Envelope `milestone` (private milestone delivery)

Replicates a `kind:30415` milestone event as a DM. The marker `t=colabonate-milestone` lets a client route the message to its milestone pipeline. The recipient is the **counterparty**: a partner's `COMPLETED` event goes to the initiator; the initiator's `ACCEPTED`/release event goes to the partner.

```jsonc
{
  "type": "milestone",
  "t": "colabonate-milestone",
  "cooperationId": "coop-xyz",
  "milestoneId": "ms-1",
  "milestoneIndex": 0,
  "status": "COMPLETED",                            // PROPOSED | ACCEPTED | COMPLETED | REJECTED
  "amountSats": 125000,
  "released": false,
  "nip_c": { "kind": 30415, "tags": [["…"]], "content": "" },
  "timestamp": 1715000000
}
```

---

## Specification — Envelope `verdict` (mutual-arbiter dispute resolution)

A mutually-accepted private arbiter (see [PROB-002 §A.2 Option A2](../problems/PROB-002-private-dispute-architecture.md)) returns a signed verdict as a DM. The verdict is the trigger for escrow release/cancel/split; clients MUST verify the signer is the `arbiterPubkey` both parties nominated before acting on it.

```jsonc
{
  "type": "verdict",
  "ticketId": "ticket-123",
  "outcome": "RELEASE",                             // RELEASE | CANCEL | SPLIT
  "reasoning": "Seller delivered per spec; buyer hold-out unsupported.",
  "arbiterPubkey": "<arbiter-64-hex>",
  "verdictNostrEventId": "<id-of-the-signed-verdict-event>",
  "timestamp": 1715000000
}
```

Validation rules:

- `outcome` MUST be one of `RELEASE`, `CANCEL`, `SPLIT`.
- `arbiterPubkey` MUST be 64-char hex.
- The verdict MUST be delivered as a separately-signed Nostr event whose id is `verdictNostrEventId`, so it is independently verifiable and replay-protected.

---

## Specification — Envelopes `counter` and `message`

Lightweight negotiation/chat envelopes that have **no** public counterpart:

```jsonc
{ "type": "counter", "offerId": "offer-abc123", "counterPriceSats": 45000, "counterNotes": "Can you do 45k?" }
{ "type": "message", "offerId": "offer-abc123", "message": "Sounds good, sending payment." }
```

---

## Reputation

Private trades **do not** produce public reputation. Concretely:

- A private ticket MUST NOT be the subject of a public `kind:30406` review.
- A private cooperation/milestone MUST NOT emit `ColPoints`/reputation-score events.

This is enforced structurally (the lifecycle never publishes the review event) and is a feature, not a limitation: the whole point of the private mode is to leave no public commerce graph. See [ADR-152](../decisions/152-private-trade-mode-via-nip17.md).

---

## Cross-client interop (NIP-89 / NIP-19 / NIP-21)

A Colabonate-compatible client SHOULD publish a [NIP-89](https://github.com/nostr-protocol/nips/blob/master/89.md) **handler information** event (`kind:31990`) declaring the kinds it handles, so that a private offer shared as a `nostr:` URI ([NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md)) can be opened in any cooperating client:

```jsonc
{
  "kind": 31990,
  "tags": [
    ["d", "colabonate"],
    ["name", "Colabonate"],
    ["web", "https://app.colabonate.org"],
    ["picture", "https://…/logo.png"],
    ["supports", "14"],          // NIP-17 DM content (this NIP's envelopes)
    ["supports", "1059"],        // NIP-59 gift wrap
    ["supports", "10050"],       // DM relay list
    ["supports", "30402"],       // public NIP-A offer
    ["supports", "30414"]        // public NIP-C cooperation
  ],
  "content": ""
}
```

A recommending client publishes `kind:31989` pointing at the handler's `31990:<pubkey>:colabonate` address. Private offers are shared as `nostr:nevent1…` / `nostr:naddr1…` ([NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md)) URIs carrying the gift-wrap event id with relay hints from the recipient's `kind:10050` list.

---

## Security considerations

- **Encryption is mandatory.** A relay MUST never see plaintext envelopes. NIP-44 v2 + NIP-59 gift wrap are required; the legacy `kind:14` plaintext DM is permitted only for trusted server-side cache rows that never touch a relay.
- **Gift-wrap randomization.** Per NIP-59, the gift wrap's `pubkey` is a fresh random key and `created_at` is randomized; relays cannot correlate sender, recipient, or timing.
- **Verdict authenticity.** A `verdict` envelope is only actionable once the client independently verifies the signature on `verdictNostrEventId` and confirms the signer was mutually nominated for that ticket.
- **No deletion guarantee.** A relay that received a gift wrap is under no obligation to honour a [NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md) deletion request. GDPR Art. 17 compliance therefore relies on **local** database erasure plus key-shredding (the gift-wrap content becomes permanently unreadable once the recipient discards their decryption key). See [ADR-156](../decisions/156-gdpr-private-offer-deletion-nip09.md).
- **Spam.** Because private offers are push DMs, clients SHOULD surface only offers from peers the user has a reason to expect (e.g. via a NIP-51 follow-set of trusted counterparties, or an opt-in "accept private offers from L2+" gate).

---

## Open questions

1. Should the `counter` envelope carry a signed counter-offer event id (like `verdict`) for non-repudiation, or remain best-effort chat? Current implementation: best-effort.
2. Multi-recipient private offers (one seller, N buyers) — should the seller gift-wrap N times (current) or use a NIP-44 group-encryption extension if one emerges?

---

## References

- [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) — Private Direct Messages
- [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) — Encryption
- [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) — Gift Wrap
- [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) / [NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md) — bech32 entity IDs / `nostr:` URIs
- [NIP-89](https://github.com/nostr-protocol/nips/blob/master/89.md) — Recommended Application Handlers
- [NIP-A](NIP-A-service-marketplace-and-identity.md) — public Freedom-of-Interaction commerce layer
- [NIP-C](NIP-C-cooperation-layer.md) — public cooperation layer
- [ADR-152](../decisions/152-private-trade-mode-via-nip17.md) — Private Trade Mode via NIP-17
- [ADR-155](../decisions/155-cross-client-private-commerce-nip19-21-89.md) — Cross-client private commerce
