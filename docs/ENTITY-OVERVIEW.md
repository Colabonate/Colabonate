# Entity Overview – Colabonate App

> Hierarchische Darstellung aller Datenbank-Entities (Prisma-Modelle) mit Feldern, Relations und Abhängigkeiten.
>
> **Schema:** `prisma/schema.prisma`
>
> **ADRs:** ADR-031, ADR-059v2, ADR-065, ADR-066, ADR-078, ADR-096, ADR-109, ADR-112, ADR-125, ADR-127, ADR-128, ADR-139, ADR-155, ADR-156, ADR-172, ADR-173, ADR-187, ADR-277

---

## Quick Reference

| Entity | Context | Key Field |
|--------|---------|-----------|
| `User` | Core | `pubkey` |
| `Wallet` | Core | `userId` (→ User) |
| `Company` | Sell | `ownerPubkey` (→ User) |
| `Offer` | Sell/Buy | `creatorPubkey` (→ User) |
| `Ticket` | Buy | `buyerPubkey` / `sellerPubkey` (→ User) |
| `Cooperation` | Coop | `initiatorPubkey` (→ User) |
| `Dao` | DAO | `id` (z.B. "colabonate-foundation") |

---

## 1. Core Entities

### 1.1 User

```prisma
model User {
  id               String   @id @default(cuid())
  pubkey           String   @unique
  lnAddress        String?
  location         String?  // ZIP Code
  identityLevel    Int      @default(0)  // 0–3
  colPoints        Int      @default(0)
  email            String?  @unique
  googleId         String?  @unique
  nostrPubkey      String?
  nip05            String?
  picture          String?
  linkedPubkey     String?  // Lightning pubkey linked via LUD-04
  emailVerified    Boolean  @default(false)
  magicLinkToken   String?
  magicLinkExpires DateTime?
  profileVisibility ProfileVisibility @default(PUBLIC)
  wallet           Wallet?
  // ...relations
}
```

**Relations:** `offers`, `ticketsAsBuyer`, `ticketsAsSeller`, `sessions`, `colPointsEvents`, `wallet`

---

### 1.2 Wallet

```prisma
model Wallet {
  id           String        @id @default(cuid())
  userId       String        @unique
  provider     WalletProvider  // LIGHTSPARK | LNBITS | WEBLN | MOCK
  mode         WalletMode      // CUSTODIAL | NON_CUSTODIAL
  walletId     String?
  accountId    String?
  status       WalletStatus    @default(ACTIVE)
  balanceSats  Int            @default(0)
  lastSyncedAt DateTime?
}
```

**Context:** Payment Layer Phase 2 (ADR-121). One Wallet per User.

> **ADR-187 (Cashu eCash, NIP-60/61) — non-custodial rail, Phase 2 implemented 2026-06-23:**
> A second, **non-custodial** balance lives beside this custodial row.
> Crucially, **no Cashu proofs are stored in the database** — the load-bearing
> invariant is that the server never holds proofs. Cashu wallet state lives
> entirely in NIP-44-encrypted **Nostr events** (kind `17375`/`7375`/`7376`,
> see §11), with relays as the authoritative store. Phase 2 implementation:
> client-side package `@col/cashu` (`packages/cashu-wallet/`), app bridge
> `lib/cashu.ts` (NIP-44 codec `createNip44Codec`, feature flag
> `VITE_CASHU_ENABLED`, FU-39 default-mint list), hook `useCashuWallet()`,
> singleton `CashuProvider` context, and `components/wallet/cashu/`
> (CashuPanel + Receive/Send/MintManager modals, wired into WalletDashboard;
> Settings opt-in). 25 package + 15 app unit tests, `vite build` green, D4
> off-state Playwright smoke clean. **No Prisma changes in Phase 2** — the
> `WalletProvider.CASHU` enum value is deferred (FU-46) because the
> non-custodial wallet needs no server-side state. Server does **not** import
> `@col/cashu` (D1 invariant). FU-39 ships testnet-only (`testnut.cashu.space`).
> See ADR-187 + `docs/plans/Plan_cashu-ecash-wallet-nip60-61.md` +
> `memory/project_cashu_wallet_nip60.md`.

---

### 1.3 Session

```prisma
model Session {
  id        String   @id @default(cuid())
  pubkey    String
  k1        String   @unique
  token     String?  @unique
  expiresAt DateTime
}
```

---

### 1.4 StandardCategory

```prisma
model StandardCategory {
  id         String  @id @default(cuid())
  parentId   String?
  slug       String  @unique
  name       String
  nameKey    String  // i18n key
  unspscCode String?
  offerType  OfferType @default(SERVICE)
  level      Int      // 1=main, 2=sub, 3=detail
  sortOrder  Int      @default(0)
}
```

**ADR-078:** Single source of truth for categories (UNSPSC-referenced).

---

## 2. Sell Context

### 2.1 Company

```prisma
model Company {
  id               String  @id @default(cuid())
  ownerPubkey      String  @unique  // → User.pubkey
  name             String
  description      String?
  address / city / zipCode / country  String?
  coopRadius       Int?     // km
  terms            String?  // AGB
  imprint          String?  // Impressum
  privacyPolicy    String?  // Datenschutz
  legalJurisdiction String? // e.g. "Germany"
  taxId            String?  // VAT-ID
  hourlyRateSats   Int?     // Sat/Hour
  logoUrl / bannerUrl / images Json?
  website / email / phone / socialLinks Json?
  openingHours     Json?
  businessFields   Json?
  isActive         Boolean @default(false)
  publishedAt      DateTime?
  // relations
}
```

**Relations:** `catalogs`, `products` (ADR-395), `offers`, `deliveryTemplates`, `cooperationTemplates`, `reviews`, `writtenReviews`

---

### 2.2 Catalog

```prisma
model Catalog {
  id                 String  @id @default(cuid())
  companyId          String
  standardCategoryId String?
  name               String
  isActive           Boolean @default(true)
}
```

---

### 2.3 Product

```prisma
model Product {
  id                 String  @id @default(cuid())
  companyId          String?  // ADR-395: ownership axis (back-filled from the catalog)
  catalogId          String?  // ADR-395: optional grouping — null = product without catalog
  standardCategoryId String?
  name               String
  description        String?
  priceSats          Int
  images             String?  // JSON string[]
  sku                String?
  stock              Int?     // null = unlimited
  isAvailable        Boolean @default(true)
  metadata           String?  // JSON
  gammaTags          String[] @default([])  // ADR-277: derived union of gammaTags across this
                                             // product's offers[], kept fresh on every publish
}
```

**ADR-066:** 1:N Product → Offer (one product can have multiple offers).
**ADR-395:** Company 1:N Product (owner); Catalog 1:N Product (optional). Wizard products are created via `POST /api/offers` with `createProduct` (+ optional `catalogId`).

---

### 2.4 DeliveryTemplate

```prisma
model DeliveryTemplate {
  id               String  @id @default(cuid())
  companyId        String
  name             String
  deliveryTimeDays Int
  deliveryCostSats Int
  isDefault        Boolean @default(false)
}
```

---

### 2.4a ShippingOption (ADR-172/277)

```prisma
model ShippingOption {
  id               String  @id @default(cuid())
  d                String  @unique  // Kind 30406 d-tag
  companyId        String
  title            String
  baseCost         String   // decimal string
  currency         String   // ISO-4217
  countries        String   // comma-separated ISO-3166-1 alpha-2
  service          ShippingServiceType @default(STANDARD)  // STANDARD | EXPRESS | OVERNIGHT | PICKUP
  carrier / regions / durationMin / durationMax / durationUnit  String?/Int?
  location / geohash  String?
  weightMin / weightMax / weightUnit  String?
  dimMin / dimMax / dimUnit  String?
  priceWeight / priceWeightCur / priceVolume / priceVolumeCur / priceDistance / priceDistanceCur  String?
  nostrEventId     String? @unique  // Kind 30406
  isActive         Boolean @default(true)
}
```

**Gamma Markets Kind 30406.** Published/re-published by `POST`/`PATCH /api/shipping-options`
via `NostrRelayService.publishShippingOption()`; deactivation triggers a NIP-09 deletion.
Referenced by `Offer.shippingOptionRefs` (JSON, ADR-172) and by `CollectionShippingOption`
(union-merged onto members per Gamma §4.2).

---

### 2.4b ProductCollection (ADR-173/277)

```prisma
model ProductCollection {
  id           String  @id @default(cuid())
  d            String  @unique  // Kind 30405 d-tag
  companyId    String
  title        String
  summary / image / location / geohash  String?
  nostrEventId String? @unique  // Kind 30405
  isActive     Boolean @default(true)
}

model ProductCollectionMember {
  id           String @id @default(cuid())
  collectionId String
  productId    String
  sortOrder    Int    @default(0)

  @@unique([collectionId, productId])
}

model CollectionShippingOption {
  id               String @id @default(cuid())
  collectionId     String
  shippingOptionId String

  @@unique([collectionId, shippingOptionId])
}
```

**Gamma Markets Kind 30405.** Unlike ADR-173's original one-sided design, D10 (ADR-277) requires
the collection event to carry a required, repeatable `a` product ref per member — resolved from
each `ProductCollectionMember.product`'s most recently published `ACTIVE` non-variation `Offer`.
A collection with no resolvable member offer is not published (would be spec-invalid). Published
via `POST`/`PATCH /api/collections` → `NostrRelayService.publishProductCollection()`.

---

### 2.5 Offer

```prisma
model Offer {
  id                 String  @id @default(cuid())
  title              String
  description        String?
  priceSats          Int
  priceAmount        String?  // ADR-277 D9: foreign non-sats price, display-only
  priceCurrency      String?  // ADR-277 D9: ISO-4217, paired with priceAmount
  categoryCode       String
  subcategoryCode    String?
  gammaTags          String[] @default([])  // ADR-277: free-form NIP-99 `t` tags — a second,
                                             // emergent taxonomy axis alongside categoryCode
  status             String  @default("DRAFT")  // OfferStatus
  ticketType         TicketType @default(SMART_ORDER)
  offerType          OfferType  @default(SERVICE)
  images             Json?      // ADR-139: native JSON (was String?)
  publishedAt        DateTime?
  creatorPubkey      String
  companyId          String?
  productId          String?
  deliveryTemplateId String?
  deliveryTimeDays   Int?
  deliveryCostSats   Int?
  deliveryNotes      String?
  cooperationId      String?  @unique  // → Cooperation.id (COOP offers)
  // Geo (ADR-139)
  country            String?  // ISO 3166-1 alpha-2
  region             String?
  city               String?
  lat                Float?
  lng                Float?
  isRemote           Boolean @default(false)
  language           String?  // BCP-47
  source             OfferSource @default(LOCAL)
  location           String?  // Legacy – sunset (ADR-041)
}
```

**OfferType behavior:**

| OfferType | Approval | Action | Ticket Initial Status |
|-----------|----------|--------|-----------------------|
| SERVICE | Seller must accept | "Request" | PENDING |
| PRODUCT | Auto-accepted | "Buy Now" | IN_PROGRESS |
| ITEM | Auto-accepted | "Buy Now" | IN_PROGRESS |
| COOP | Partner application | "Apply" | n/a |

---

### 2.6 OfferMilestone

```prisma
model OfferMilestone {
  id          String  @id @default(cuid())
  offerId     String
  title       String
  description String?
  percentage  Int
  sortOrder   Int    @default(0)
}
```

---

## 3. Buy Context

### 3.1 Ticket

```prisma
model Ticket {
  id               String  @id @default(cuid())
  offerId          String
  buyerPubkey      String
  sellerPubkey     String
  status           String  @default("PENDING")  // TicketStatus
  offerType        OfferType @default(SERVICE)
  ticketType       TicketType @default(SMART_ORDER)
  amountSats       Int?
  lightningInvoice String?
  paymentHash      String?
  preimage         String?
  disputeReason    String?
  // Three-Phase Escrow
  escrowStatus        String @default("NONE")  // EscrowStatus
  phase1Invoice       String?
  phase2Invoice       String?
  phase3Invoice       String?
  escrowPhase1Hash    String?
  escrowPhase2Hash    String?
  escrowPhase3Hash    String?
  escrowPhase1Preimage String?
  escrowPhase2Preimage String?
  escrowPhase3Preimage String?
  deliveryConfirmedAt DateTime?
  deliveryAddress     Json?   // ADR-139: native JSON
  deliveryTimeDays    Int?
  deliveryCostSats     Int?
  totalHours          Int?
  deliveryNotes       String?
  // DAO/Dispute
  daoId               String? @default("colabonate-foundation")
  codexHash           String?
  // relations
}
```

**Status flow by OfferType:**

```
SERVICE:  PENDING ──(accept)──► IN_PROGRESS ──► PAID ──► COMPLETED
                     (reject)──► CANCELLED
PRODUCT:  IN_PROGRESS ──► PAID ──► COMPLETED
Both:     Any ──► DISPUTED ──► COMPLETED | CANCELLED
```

---

### 3.2 Milestone (Ticket-bound)

```prisma
model Milestone {
  id          String  @id @default(cuid())
  ticketId    String
  title       String
  description String?
  dueDate     DateTime?
  status      MilestoneStatus @default(PENDING)
  invoice     String?
  amountSats  Int?
  completedAt DateTime?
}
```

---

### 3.3 Review

```prisma
model Review {
  id             String  @id @default(cuid())
  ticketId       String
  reviewerPubkey String
  revieweePubkey String
  stars          Int     // 1–5
  content        String
  nostrEventId   String? @unique  // Kind 30024
}
```

---

## 4. Cooperation Context

### 4.1 Cooperation

```prisma
model Cooperation {
  id                    String  @id @default(cuid())
  title                 String
  description           String?
  initiatorPubkey       String
  partnerPubkey         String?   // null until accepted
  cooperationType       CooperationType?
  partnerMode           String?   @default("WHOLE")
  budgetSats            Int
  timeline              String?
  skills                String?
  status                CooperationStatus @default(OPEN)
  categoryCode          String?
  images                String?   // JSON string[]
  deadline              DateTime?
  requirements          String?
  offerId               String?   @unique  // → Offer.id
  nostrProposalId       String?
  nostrAcceptId         String?
  lightningInvoice      String?
  paymentHash           String?
}
```

**CooperationStatus flow:**

```
DRAFT ──► OPEN ──► ACCEPTED ──► PAID ──► IN_PROGRESS ──► COMPLETED
                │                                              │
                └─► DISPUTED ──► COMPLETED | CANCELLED ◄──────┘
                └─► CANCELLED
```

---

### 4.2 CoopMilestone

```prisma
model CoopMilestone {
  id                 String  @id @default(cuid())
  cooperationId      String
  milestoneIndex     Int     // 1-based sequence
  title              String
  description        String?
  acceptanceCriteria String?
  dueDate            DateTime?
  amountSats         Int
  status             CoopMilestoneStatus @default(PENDING)
  partnerPubkey      String?
  evidence           String?
  lightningInvoice   String?
  paymentHash        String?
  nostrEventId       String?
  completedAt        DateTime?
  // ADR-310 D2/D4: orchestration step assignment
  assigneeAgentProfileId String?  // FK → AgentProfile, nullable, SetNull
}
```

---

### 4.3 CoopMilestoneMessage

```prisma
model CoopMilestoneMessage {
  id           String  @id @default(cuid())
  milestoneId  String
  authorPubkey String
  action       String?
  message      String?
  createdAt    DateTime @default(now())
}
```

---

### 4.4 CoopMilestoneApplication

```prisma
model CoopMilestoneApplication {
  id              String  @id @default(cuid())
  cooperationId   String
  milestoneId     String
  applicantPubkey String
  message         String?
  status          String  @default("PENDING")

  @@unique([cooperationId, milestoneId, applicantPubkey])
}
```

---

### 4.5 CooperationTemplate

```prisma
model CooperationTemplate {
  id                String  @id @default(cuid())
  name              String
  description       String?
  cooperationType   String  // transactional | production | ...
  budgetRange       String?  // JSON { min, max }
  timelinePreset    String?  // "2weeks" | "1month" | ...
  requiredSkills    String?  // JSON string[]
  defaultMilestones String?  // JSON [{ title, percentage }]
  categoryCode      String?
  terms             String?
  isPublic          Boolean @default(false)
  createdByPubkey   String
  companyId         String?
  // ADR-310 D1: multi-agent orchestration templates
  isAgentOrchestration Boolean @default(false)
  orchestrationSteps   Json?  // OrchestrationStep[]: order, title, requiredAgentCapabilities, inputFromStep, outputToSteps
}
```

---

## 5. Reputation

### 5.1 ColPointsEvent

```prisma
model ColPointsEvent {
  id        String  @id @default(cuid())
  pubkey    String
  delta     Int
  reason    String
  ticketId  String?
}
```

---

### 5.2 CompanyReview

```prisma
model CompanyReview {
  id             String  @id @default(cuid())
  companyId      String  // reviewee
  reviewerPubkey String  // reviewer's Company.ownerPubkey
  stars          Int
  content        String
}
```

**ADR-065:** Company-to-company review (not user-level).

---

## 6. DAO / Governance (ADR-125, ADR-128)

### 6.1 Dao

```prisma
model Dao {
  id           String  @id  // e.g. "colabonate-foundation"
  name         String
  codexHash    String  // SHA-256
  codexVersion String
  codexUrl     String
  status       DaoStatus @default(BOOTSTRAP)
  nostrEventId String?   // Kind 30022
  // relations
}
```

---

### 6.2 DaoMember

```prisma
model DaoMember {
  id                String  @id @default(cuid())
  daoId             String
  pubkey            String
  role              DaoRole           // ADMIN | ARBITRATOR | MEDIATOR
  status            DaoMemberStatus    @default(ACTIVE)
  credentialEventId String?            // Kind 30021
  invitedBy         String?
  acceptedAt        DateTime?
  revokedAt         DateTime?

  @@unique([daoId, pubkey])
}
```

---

### 6.3 DaoConfig

```prisma
model DaoConfig {
  daoId                String      @id
  quorumType           QuorumType  @default(SINGLE)
  thresholdN           Int         @default(1)
  coolingOffDays       Int         @default(7)
  mediationDays        Int         @default(14)
  verdictDeadlineHours Int         @default(48)
  appealWindowHours    Int         @default(72)   // ADR-127
  appealQuorumType     QuorumType?
  appealThresholdN     Int?
}
```

---

### 6.4 Dispute

```prisma
model Dispute {
  id                String  @id @default(cuid())
  disputeId         String  @unique
  ticketId          String
  daoId             String  @default("colabonate-foundation")
  status            DisputeStatus @default(OPEN)
  outcome           VerdictOutcome?  // RELEASE | CANCEL | SPLIT
  openedAt          DateTime @default(now())
  resolvedAt        DateTime?
  arbitratorPubkey  String?
  escalatedAt       DateTime?
  verdictIssuedAt   DateTime?
  // relations: verdicts, appealRequest
}
```

**DisputeStatus flow:**

```
OPEN ──► COUNCIL_QUEUE ──► IN_REVIEW ──► RESOLVED_PENDING
    │                                              │
    └─► APPEALED ──► RESOLVED ◄───────────────────┘
    └─► WITHDRAWN
```

---

### 6.5 ArbitrationVerdict

```prisma
model ArbitrationVerdict {
  id                String  @id @default(cuid())
  verdictId         String  @unique
  disputeId         String
  arbitratorPubkey  String
  outcome           VerdictOutcome
  reasoning         String?
  evidenceEventIds  String?
  round             Int     @default(1)
}
```

---

### 6.6 AppealRequest (ADR-127)

```prisma
model AppealRequest {
  id                String  @id @default(cuid())
  disputeId         String  @unique
  appealerPubkey    String
  reason            String
  evidenceEventIds  String   // JSON array
  originalVerdictId String
  nostrEventId      String?
  resolvedAt        DateTime?
  finalVerdictId    String?
}
```

**Single-shot appeal per dispute; round-2 quorum higher.**

---

### 6.7 NotificationLog (ADR-127)

```prisma
model NotificationLog {
  id        String  @id @default(cuid())
  eventType String  // "dispute_opened" | "verdict_issued" | ...
  recipient String  // email or pubkey
  refId     String
  status    String  // "sent" | "failed" | "skipped_no_email" | ...
  errorMsg  String?
}
```

---

### 6.8 AdminAuditLog

```prisma
model AdminAuditLog {
  id          String  @id @default(cuid())
  adminPubkey String
  action      String
  targetId    String?
  payload     String
}
```

---

### 6.9 DaoProposal (ADR-128)

```prisma
model DaoProposal {
  id                 String  @id @default(cuid())
  daoId              String
  authorPubkey       String
  nostrEventId       String  @unique  // Kind 30420
  title              String
  content            String
  executionStrategy  String
  executionPayload   String
  votingStart        DateTime
  votingEnd          DateTime
  snapshotTimestamp  Int
  status             ProposalStatus @default(DRAFT)
  // relations: votes
}
```

---

### 6.10 DaoVote (ADR-128)

```prisma
model DaoVote {
  id              String  @id @default(cuid())
  proposalId      String
  voterPubkey     String
  nostrEventId    String  @unique  // Kind 30421
  choice          String  // FOR | AGAINST | ABSTAIN
  votingPower     Int
  strategyUsed    String

  @@unique([proposalId, voterPubkey])
}
```

---

### 6.11 DaoGovernanceConfig (ADR-128)

```prisma
model DaoGovernanceConfig {
  daoId                      String  @id
  proposalValidationStrategy String
  votingStrategies           String   // JSON Strategy[]
  quorumType                 String   @default("SIMPLE")
  quorumThreshold            Int      @default(1)
  votingDelaySeconds         Int      @default(0)
  minVotingPeriodSeconds     Int      @default(86400)
  maxVotingPeriodSeconds     Int      @default(604800)
}
```

---

### 6.12 DaoTreasury + TreasuryTransaction (ADR-128)

```prisma
model DaoTreasury {
  id               String  @id @default(cuid())
  daoId            String  @unique
  escrowAccountId  String?
  multisigPubkey   String?
  balanceSats      BigInt  @default(0)
  // relations: transactions
}

model TreasuryTransaction {
  id          String      @id @default(cuid())
  treasuryId  String
  type        String      // FUND | RELEASE | SPEND
  amountSats  BigInt
  toPubkey    String?
  proposalId  String?
  status      TxStatus    @default(PENDING)
}
```

---

## 7. Auth / Nostr

### 7.1 NostrAuthChallenge

```prisma
model NostrAuthChallenge {
  nonce      String    @id
  issuedFor  String?
  createdAt  DateTime  @default(now())
  consumedAt DateTime?
}
```

---

## 8. International Pipeline (ADR-139)

### 8.1 GeoLookup

```prisma
model GeoLookup {
  id        String  @id @default(cuid())
  country   String  // ISO 3166-1 alpha-2
  region    String?
  city      String?
  lat       Float
  lng       Float
  provider  String  // "nominatim" | "mapbox"
  fetchedAt DateTime @default(now())

  @@unique([country, region, city])
}
```

---

### 8.2 OutboxEvent (ADR-139)

```prisma
model OutboxEvent {
  id          String  @id @default(cuid())
  aggregate   String  // "offer" | "company" | ...
  aggregateId String
  eventType   String  // "upsert" | "delete"
  payload     Json
  status      OutboxEventStatus @default(PENDING)
  attempts    Int     @default(0)
  lastError   String?
  createdAt   DateTime @default(now())
  processedAt DateTime?
}
```

---

### 8.3 RemoteOfferCandidate (ADR-139)

```prisma
model RemoteOfferCandidate {
  id              String  @id @default(cuid())
  remoteEventId   String  @unique
  remoteRelay     String
  remoteAuthor    String
  rawEvent        Json
  normalized      Json
  status          RemoteOfferCandidateStatus @default(PENDING_REVIEW)
  reviewedBy      String?
  reviewedAt      DateTime?
  rejectedReason  String?
  promotedOfferId String?
  fetchedAt       DateTime @default(now())
  expiresAt       DateTime
}
```

---

### 8.4 AI credits and MCP access (ADR-384)

| Model | Purpose | Key fields |
| ----- | ------- | ---------- |
| `AiCreditBalance` | Bounded service-entitlement counter of already-paid hosted-AI requests (not money, no top-up) | `pubkey` (PK), `requestsRemaining`, `requestsUsed`; consumed by a CAS decrement |
| `AiCreditPurchase` | Audit row per pack purchase (user or guest) | `pubkey?`, `guestSessionId?`, `tier`, `requests`, `amountSats`, `rail` (LN/DEMO), `paymentHash`, `status` (PENDING/PAID) |
| `AiGuestCredit` | Anonymous, browser-bound session credits (kept separate from `AiCreditBalance` so ownership is never ambiguous) | `guestSessionId` (PK, 64 hex), `requestsRemaining`, `requestsUsed` |
| `McpAccessPass` | Time-boxed MCP access pass | `pubkey`, `tier` (day/week/month), `amountSats`, `rail`, `status`, `activatedAt`, `expiresAt` (starts at confirm, extends an active pass) |
| `McpTrial` | One-time free trial marker; the primary key makes the claim atomic | `pubkey` (PK), `usedAt` |
| `McpConnection.passTier` | Which access the connection was minted under | `trial`/`day`/`week`/`month`, null = legacy free connection |

## 9. Enums Reference

| Enum | Values |
|------|--------|
| `ProfileVisibility` | PUBLIC, PSEUDO_PRIVATE, PRIVATE |
| `TicketType` | SMART_ORDER, MILESTONE, DISPUTE, GOVERNANCE, VERIFICATION, ROYALTY |
| `WalletProvider` | LIGHTSPARK, LNBITS, WEBLN, MOCK *(+ CASHU deferred — ADR-187 Phase 2 wallet ships without server-side state; FU-46)* |
| `WalletMode` | CUSTODIAL, NON_CUSTODIAL |
| `WalletStatus` | ACTIVE, SUSPENDED, CLOSED |
| `OfferType` | SERVICE, PRODUCT, ITEM, COOP |
| `OfferSource` | LOCAL, REMOTE |
| `MilestoneStatus` | PENDING, ACCEPTED, IN_PROGRESS, COMPLETED, DISPUTED |
| `CooperationStatus` | DRAFT, OPEN, ACCEPTED, PAID, IN_PROGRESS, COMPLETED, DISPUTED, CANCELLED |
| `CoopMilestoneStatus` | PENDING, IN_PROGRESS, COMPLETED, ACCEPTED, DISPUTED |
| `CooperationType` | TRANSACTIONAL, PRODUCTION, SALES, SERVICE, EDUCATIONAL, CROWDFUNDING, BARTER, TENDER |
| `DaoStatus` | BOOTSTRAP, ACTIVE, DISSOLVED |
| `DaoRole` | ADMIN, ARBITRATOR, MEDIATOR |
| `DaoMemberStatus` | PENDING, ACTIVE, REVOKED |
| `QuorumType` | SINGLE, MAJORITY, THRESHOLD |
| `DisputeStatus` | OPEN, COUNCIL_QUEUE, IN_REVIEW, RESOLVED_PENDING, APPEALED, RESOLVED, WITHDRAWN |
| `VerdictOutcome` | RELEASE, CANCEL, SPLIT |
| `TradeVisibility` | PUBLIC, PRIVATE, NONE |
| `DisputeMode` | PUBLIC, PRIVATE, NONE |
| `WalletModeStrategy` | HYBRID, CUSTODIAL_ONLY, NONCUSTODIAL_ONLY |
| `AgentTaskStatus` | OPEN, IN_PROGRESS, COMPLETED, CANCELLED |
| `AgentTaskApplicationStatus` | PENDING, APPROVED, REJECTED |
| `OrchestrationMode` | HUMAN, AUTONOMOUS |
| `AgentNetworkMemberRole` | LEAD, MEMBER |
| `AgentNetworkJoinRequestStatus` | PENDING, APPROVED, REJECTED |
| `CatalogType` | PRODUCTS, AGENT_SETUPS |
| `AgentBillingModel` | FIXED, HOURLY, PERFORMANCE |
| `ShippingServiceType` | STANDARD, EXPRESS, OVERNIGHT, PICKUP |
| `ListingVisibility` | PUBLIC, PRIVATE |
| `ProposalStatus` | DRAFT, ACTIVE, PASSED, REJECTED, EXECUTED, CANCELLED |
| `TxStatus` | PENDING, CONFIRMED, FAILED |
| `OutboxEventStatus` | PENDING, PROCESSING, DONE, DEAD |
| `RemoteOfferCandidateStatus` | PENDING_REVIEW, APPROVED, REJECTED, EXPIRED |

**Note:** `OfferStatus`, `TicketStatus`, `EscrowStatus` sind **volatile enums** → als String in der DB mit App-level Zod-Validierung (ADR-139).

---

## 10. Dependency Graph

```
User
├── Session
├── Wallet
├── ColPointsEvent
├── NostrAuthChallenge
├── Company
│   ├── Catalog
│   │   └── Product
│   │       └── Offer (via productId)
│   ├── DeliveryTemplate
│   ├── CooperationTemplate
│   ├── CompanyReview (in + out)
│   ├── ShippingOption
│   ├── ProductCollection
│   │   ├── ProductCollectionMember (→ Product)
│   │   └── CollectionShippingOption (→ ShippingOption)
│   └── Offer (via companyId)
├── Offer
│   ├── Ticket
│   │   ├── Milestone
│   │   ├── Review
│   │   └── Dispute
│   │       ├── ArbitrationVerdict
│   │       └── AppealRequest
│   └── Cooperation (via cooperationId, COOP offers)
└── Cooperation (standalone)
    ├── CoopMilestone
    │   ├── CoopMilestoneMessage
    │   └── CoopMilestoneApplication
    └── CoopMilestoneApplication

Dao
├── DaoMember
├── DaoConfig
├── DaoProposal
│   └── DaoVote
├── DaoGovernanceConfig
├── DaoTreasury
│   └── TreasuryTransaction
└── Dispute
    ├── ArbitrationVerdict
    └── AppealRequest
```

---

## 11. Nostr Event Kind → Entity Mapping

| Kind | Entity | Context |
|------|--------|---------|
| 30017 | Offer | Sell |
| 30018 | Ticket | Buy |
| 30019 | Ticket (status update) | Buy |
| 30020 | Ticket (dispute) | Dispute |
| 30021 | User credential (legacy; dual-published with 30410) | Identity |
| 30022 | DAO creation | DAO |
| 30024 | Review (legacy; dual-published with 30411) | Reputation |
| 30027 | Company | Sell |
| 30405 | ProductCollection — *Gamma Markets kind, ADR-277* | Sell |
| 30406 | ShippingOption — *Gamma Markets kind, ADR-277* | Sell |
| 30410 | User credential (new kind — ADR-277 D0 moved off the Gamma-claimed 30405) | Identity |
| 30411 | Review (new kind — ADR-277 D0 moved off the Gamma-claimed 30406) | Reputation |
| 30414 | Cooperation Proposal | Coop |
| 30415 | CoopMilestone | Coop |
| 30420 | DaoProposal | DAO |
| 30421 | DaoVote | DAO |
| 17375 | Cashu wallet (mint list + P2PK key) — *implemented client-side, ADR-187* | Wallet |
| 7375 | Cashu token (unspent proofs) — *implemented client-side, ADR-187* | Wallet |
| 7376 | Cashu spending history — *implemented client-side, ADR-187* | Wallet |

> **Cashu wallet events (kind 17375/7375/7376)** are NIP-44-encrypted and held
> on Nostr relays, **not** in any Prisma model (ADR-187 non-custodial invariant).
> They are listed here as the source of truth for Cashu wallet state, not as a
> DB-backed entity.

---

## 12. Context Summary

| Context | Entities | Count |
|---------|----------|-------|
| Core | User, Wallet, Session, NostrAuthChallenge | 4 |
| Sell | Company, Catalog, Product, DeliveryTemplate, Offer, OfferMilestone, ShippingOption, ProductCollection, ProductCollectionMember, CollectionShippingOption | 10 |
| Buy | Ticket, Milestone, Review | 3 |
| Coop | Cooperation, CoopMilestone, CoopMilestoneMessage, CoopMilestoneApplication, CooperationTemplate | 5 |
| Reputation | CompanyReview, ColPointsEvent | 2 |
| DAO | Dao, DaoMember, DaoConfig, Dispute, ArbitrationVerdict, AppealRequest, NotificationLog, AdminAuditLog, DaoProposal, DaoVote, DaoGovernanceConfig, DaoTreasury, TreasuryTransaction | 13 |
| Geo | GeoLookup, OutboxEvent, RemoteOfferCandidate | 3 |
| **Total** | | **69 models** |

> **ADR-368 D7 note (surface ownership, entities unchanged):** Sell = goods
> (`Offer` PRODUCT/ITEM, `Catalog` PRODUCT); Cooperate = services, agents and
> bounties (`Offer` SERVICE/AGENT_SETUP/COOP, `Cooperation`, `AgentProfile`,
> `AgentTask`, `Catalog` AGENT_SETUP). The Corporate/Private axis
> (`Offer.companyId`) stays a sub-context *within* Cooperate, not a nav context.

---

## 13. Key Rules

| Rule | Description |
|------|-------------|
| User→Company | 1:1 via `ownerPubkey` |
| Product→Offer | 1:N (ADR-066) |
| Offer→Ticket | 1:N |
| Company→Offer | `companyId` null = private, set = corporate (ADR-065) |
| Cooperation→Offer | Optional 1:1 via `cooperationId` (unique) |
| Ticket→Milestone | 1:N (SMART_ORDER service milestones) |
| Cooperation→CoopMilestone | 1:N |
| CoopMilestone→Application | 1:N, unique per (cooperation, milestone, applicant) |
| User role switching | Same pubkey can be buyer on Ticket A, seller on Ticket B |
| Dispute→Ticket | 1:1 |
| AppealRequest→Dispute | 1:1 (single-shot) |
| Ticket→Dispute | 1:1 |
| Offer.escrowStatus | Volatile – use Zod validation from `@ds/utils` |