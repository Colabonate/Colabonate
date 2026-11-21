NIP-XX
======

Freedom of Interaction Protocol (Identity & Commerce)
-----------------------------------------------------

`draft` `optional`

`kind:30402` `kind:30404` `kind:30405` `kind:30406`

---

## Abstract

This NIP defines the foundational event kinds for a "Freedom of Interaction" protocol over Nostr, designed to dismantle digital monopolies and enable sovereign, trust-minimized collaboration. Ranging from simple local commerce to complex, multi-party cooperations, it combines verifiable Human Identities (HID, L0-L3), trust-weighted reputation scoring, and Bitcoin/Lightning-native escrow mechanisms. It extends [NIP-99](99.md) (Classified Listings) with structured transaction semantics, addressable company profiles, and soulbound credentials, establishing the base infrastructure for self-organized economic ecosystems.

**Key additions over NIP-99:**

- Service and offline-delivery offers (not just physical goods)
- Multi-level identity verification (L0–L3) via [NIP-98](98.md) HTTP auth
- Escrow-aware offers with milestone-based Lightning release
- Identity-level-weighted reputation scoring
- Company profiles with UNSPSC industry classification

---

## Motivation

NIP-99 defines a general classified listing (kind `30402`). This NIP extends it with structured tags for service marketplaces requiring trust, escrow, and identity. Three new kinds are introduced for company profiles (30404), verifiable credentials (30405), and reputation reviews (30406).

Unlike [NIP-15](15.md) (Stall/Product model), this NIP targets **service offers** with asynchronous delivery, milestone-based escrow release, and trust layers — use cases NIP-15 does not cover.

Unlike [NIP-69](69.md) (P2P Order events, kind `38383`), this NIP covers the **offer publication and identity layer**, not the order negotiation flow.

---

## Kinds

| Kind  | Name                   | Description                                          |
|-------|------------------------|------------------------------------------------------|
| 30402 | Service Offer          | Extends NIP-99 with escrow, identity, and milestones |
| 30404 | Company Profile        | Addressable company identity with UNSPSC categories  |
| 30405 | Verification Credential| Non-transferable identity level credential (L0–L3)   |
| 30406 | Reputation Review      | Post-transaction review with identity-weighted score |

---

## Kind 30402 – Service Offer (extends NIP-99)

All [NIP-99](99.md) fields and tags MUST be supported. Clients not implementing this NIP SHOULD still render kind `30402` events using NIP-99 rules.

### Additional Tags

| Tag                    | Required | Value format                          | Description                                                                        |
|------------------------|----------|---------------------------------------|------------------------------------------------------------------------------------|
| `seller`               | no       | hex pubkey                            | Pubkey of the seller (redundant with event `pubkey`, aids filtering)               |
| `offer_type`           | no       | `service` / `product` / `item`        | Delivery type; defaults to `service` if absent                                     |
| `ticket_type`          | no       | `smart_order` / `milestone` / `cooperation` | Transaction model; aids NIP-B clients in choosing the correct ticket flow  |
| `category`             | no       | UNSPSC slug (e.g. `services/design`)  | UNSPSC-based category code for structured filtering                                |
| `t`                    | no       | top-level category slug               | Hashtag for general-purpose Nostr relay filtering (derived from `category`)        |
| `delivery_time_days`   | no       | positive integer string               | Estimated delivery time in days                                                    |
| `delivery_cost_sats`   | no       | non-negative integer string           | Delivery cost in satoshis (0 = digital/remote)                                     |
| `country`              | no       | ISO 3166-1 alpha-2                    | Seller country code for structured location filtering                              |
| `city`                 | no       | string                                | Seller city for structured location filtering                                      |
| `image`                | no       | URL (repeatable)                      | Offer image URL; multiple `image` tags allowed, one URL each                       |
| `escrow`               | no       | `milestone` / `direct` / `none`       | Escrow settlement model; requires server-side escrow support                       |
| `identity_min`         | no       | `0` / `1` / `2` / `3`                | Minimum buyer identity level required to transact; requires server-side validation |
| `milestones`           | no       | JSON array string                     | Array of `{title, pct}` objects; used when `ticket_type=milestone`                 |
| `location`             | no       | ZIP / postal code string              | Seller location as postal code (deprecated in favor of country/city)               |

### Example Event

```json
{
  "kind": 30402,
  "pubkey": "<seller-pubkey-hex>",
  "created_at": 1712000000,
  "tags": [
    ["d", "offer-abc123"],
    ["title", "Logo Design – Brand Identity Package"],
    ["price", "50000", "sats"],
    ["published_at", "1712000000"],
    ["seller", "<seller-pubkey-hex>"],
    ["offer_type", "service"],
    ["ticket_type", "milestone"],
    ["category", "services/design"],
    ["t", "services"],
    ["delivery_time_days", "7"],
    ["delivery_cost_sats", "0"],
    ["image", "https://example.com/preview.png"],
    ["escrow", "milestone"],
    ["identity_min", "1"],
    ["milestones", "[{\"title\":\"Draft\",\"pct\":25},{\"title\":\"Revision\",\"pct\":50},{\"title\":\"Final\",\"pct\":25}]"],
    ["location", "1010"]
  ],
  "content": "Full brand identity package including logo, color palette, and typography guide. 2 revision rounds included.",
  "sig": "<schnorr-signature>"
}
```

---

## Kind 30404 – Company Profile

An addressable event representing a company or organization operating on the marketplace.

### Tags

| Tag       | Required | Value format             | Description                                                      |
|-----------|----------|--------------------------|------------------------------------------------------------------|
| `d`       | yes      | UUID string              | Unique company identifier                                        |
| `name`    | yes      | string (1–80 chars)      | Company display name                                             |
| `fields`  | no       | UNSPSC code(s)           | Industry category codes; multiple codes as multiple values in one tag |
| `radius`  | no       | `"<int>" "coop"`         | Cooperation radius in km; second value is the literal string `coop` |
| `address` | no       | string                   | Street address                                                   |
| `city`    | no       | string                   | City name                                                        |
| `zip`     | no       | string                   | ZIP / postal code                                                |
| `country` | no       | ISO 3166-1 alpha-2       | Country code (e.g. `DE`, `AT`, `US`)                            |
| `logo`    | no       | URL                      | Logo image URL                                                   |
| `banner`  | no       | URL                      | Banner image URL                                                 |
| `images`  | no       | URL(s)                   | Gallery URLs; multiple URLs as multiple values in one tag        |
| `website` | no       | URL                      | Company website URL                                              |
| `email`   | no       | email address            | Contact email                                                    |
| `phone`   | no       | phone number string      | Contact phone                                                    |
| `twitter` | no       | handle string            | Twitter/X handle (without `@`)                                   |
| `nostr`   | no       | hex pubkey               | Owner's Nostr pubkey for cross-linking                           |
| `lnurl`   | no       | LNURL string             | Lightning address for payments                                   |

### Content (JSON)

```json
{
  "description": "<company description text>",
  "opening_hours": {
    "mon": "09:00-17:00",
    "fri": "09:00-15:00",
    "sat": null
  },
  "terms": "<terms and conditions>"
}
```

### Example Event

```json
{
  "kind": 30404,
  "pubkey": "<owner-pubkey-hex>",
  "created_at": 1712000000,
  "tags": [
    ["d", "company-xyz789"],
    ["name", "Pixel Studio GmbH"],
    ["fields", "73000000", "80101500"],
    ["radius", "50", "coop"],
    ["address", "Mariahilfer Straße 1"],
    ["city", "Vienna"],
    ["zip", "1060"],
    ["country", "AT"],
    ["logo", "https://example.com/logo.png"],
    ["website", "https://pixelstudio.example.com"],
    ["nostr", "<owner-pubkey-hex>"]
  ],
  "content": "{\"description\":\"Full-service design studio.\",\"opening_hours\":{\"mon\":\"09:00-17:00\"},\"terms\":\"\"}",
  "sig": "<schnorr-signature>"
}
```

---

## Kind 30405 – Verification Credential

A non-transferable (soulbound) credential bound to the signing `pubkey`. Signals that the key holder has completed an identity verification step.

### Tags

| Tag               | Required | Value format                  | Description                                   |
|-------------------|----------|-------------------------------|-----------------------------------------------|
| `d`               | yes      | UUID string                   | Unique credential identifier                  |
| `credential_type` | yes      | string (see table below)      | Type of credential issued                     |
| `hid_level`       | yes      | `0` / `1` / `2` / `3`        | Identity level granted by this credential     |
| `issued_by`       | yes      | hex pubkey                    | Pubkey of the issuing authority               |

### Credential Types

| `credential_type`   | Meaning                              | Issuer           |
|---------------------|--------------------------------------|------------------|
| `identity_level_1`  | Nostr profile + LNURL verified       | Self (NIP-98)    |
| `identity_level_2`  | Peer-verified (2 independent peers)  | Peer network     |
| `identity_level_3`  | Biometric verified (Humanode)        | Protocol oracle  |
| `mediator`          | Authorized dispute mediator          | DAO governance   |

### NIP-98 Authorization Requirement

For `identity_level_1` credentials, the event MUST be produced after a [NIP-98](98.md)-authorized HTTP request to the credential issuance endpoint. The server verifies that the `Authorization: Nostr` header pubkey matches the event `pubkey`.

### Soulbound Guarantee

The credential is cryptographically bound to the `pubkey` via the Schnorr signature. A credential cannot be transferred to another pubkey without re-issuance by the original authority.

### Example Event

```json
{
  "kind": 30405,
  "pubkey": "<subject-pubkey-hex>",
  "created_at": 1712000000,
  "tags": [
    ["d", "cred-l1-abc123"],
    ["credential_type", "identity_level_1"],
    ["hid_level", "1"],
    ["issued_by", "<issuer-pubkey-hex>"]
  ],
  "content": "{\"credential_type\":\"identity_level_1\",\"subject\":\"<pubkey>\",\"issued_at\":1712000000}",
  "sig": "<schnorr-signature>"
}
```

---

## Kind 30406 – Reputation Review

A permanent post-transaction review. Reviews are identity-level-weighted to reduce Sybil influence.

### Tags

| Tag                    | Required | Value format       | Description                                          |
|------------------------|----------|--------------------|------------------------------------------------------|
| `d`                    | yes      | UUID string        | Unique review identifier                             |
| `review_for`           | yes      | hex pubkey         | Pubkey of the reviewed party                         |
| `ticket`               | yes      | UUID string        | Reference to the completed transaction ticket        |
| `stars`                | yes      | `1`–`5`            | Integer star rating                                  |
| `hid_level_reviewer`   | no       | `0`–`3`            | Identity level of reviewer at time of review         |
| `col_points_reviewer`  | no       | non-negative integer | Reviewer's reputation point balance at review time |

### Identity-Level Weighting

| Reviewer Level | Score Weight |
|----------------|--------------|
| L0             | ×1.0         |
| L1             | ×1.0         |
| L2             | ×1.2         |
| L3             | ×1.5         |

### Validation Rules

- The referenced ticket MUST have reached a completed state before a review is published
- Reviews are permanent and MUST NOT be deleted via [NIP-09](09.md) Kind 5 events
- Reviews without a verifiable prior transaction receive weight 0.0 in aggregation

### Example Event

```json
{
  "kind": 30406,
  "pubkey": "<reviewer-pubkey-hex>",
  "created_at": 1712000000,
  "tags": [
    ["d", "review-xyz456"],
    ["review_for", "<reviewed-pubkey-hex>"],
    ["ticket", "ticket-abc123"],
    ["stars", "5"],
    ["hid_level_reviewer", "2"],
    ["col_points_reviewer", "150"]
  ],
  "content": "Delivered on time, excellent communication, highly recommended.",
  "sig": "<schnorr-signature>"
}
```

---

## Relay Behavior

All kinds defined in this NIP:

- SHOULD be stored by any relay that accepts them
- MAY be queried by `pubkey`, `kind`, and `d` tag per [NIP-33](33.md)
- SHOULD NOT require authentication or payment to store
- MUST support parameterized replaceable event semantics ([NIP-33](33.md))

---

## Compatibility

### Depends On

| NIP     | Purpose                                          |
|---------|--------------------------------------------------|
| NIP-01  | Base event format and Schnorr signature scheme   |
| NIP-33  | Parameterized replaceable events (`d` tag)       |
| NIP-99  | Base Classified Listing format (kind 30402)      |
| NIP-98  | HTTP auth for credential issuance (kind 30405)   |

### Does Not Conflict With

- NIP-09 (Event deletion) – Kind 5 applies to kinds 30402/30404/30405 only; reviews (30406) are permanent
- NIP-15 (Stall/Product) – Uses separate kind range, no overlap
- NIP-17 (Private DMs) – Separate event range
- NIP-57 (Lightning zaps) – Compatible; zaps MAY reference offers or reviews
- NIP-69 (P2P Order events, kind 38383) – Complementary; this NIP covers offer publication and identity, not order negotiation

---

## Security Considerations

1. **Signature validation:** All events MUST be validated per NIP-01 before processing
2. **NIP-98 credential auth:** Servers issuing kind 30405 events MUST verify the HTTP auth signature matches the event `pubkey`
3. **Review integrity:** Aggregators SHOULD verify the referenced `ticket` exists and is in a completed state before including a review in reputation scores
4. **Replacement attacks:** NIP-33 replacement semantics apply; clients SHOULD display only the most recent version of kinds 30402/30404/30405

---

## Reference Implementations & Protocols

The reference software implementation is currently being prepared for open-source release. In the meantime, the full protocol specifications and workflow documentation are public:

- [Colabonate Protocol Repository](https://github.com/Colabonate/Colabonate_Protocol)

---

## Author

Deniz Yilmaz — [Colabonate](https://colabonate.com)  
Nostr: `npub1jcqnaxvmrqteazz9y323gj6r3v0q0rslhng69e7jdslcjadsxa4scpp2sv`
