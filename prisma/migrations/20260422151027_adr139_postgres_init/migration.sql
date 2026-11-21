-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'PSEUDO_PRIVATE', 'PRIVATE');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('SMART_ORDER', 'MILESTONE', 'DISPUTE', 'GOVERNANCE', 'VERIFICATION', 'ROYALTY');

-- CreateEnum
CREATE TYPE "WalletProvider" AS ENUM ('LIGHTSPARK', 'LNBITS', 'WEBLN', 'MOCK');

-- CreateEnum
CREATE TYPE "WalletMode" AS ENUM ('CUSTODIAL', 'NON_CUSTODIAL');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('SERVICE', 'PRODUCT', 'ITEM', 'COOP');

-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('LOCAL', 'REMOTE');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CooperationStatus" AS ENUM ('DRAFT', 'OPEN', 'ACCEPTED', 'PAID', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CoopMilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'ACCEPTED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CooperationType" AS ENUM ('TRANSACTIONAL', 'PRODUCTION', 'SALES', 'SERVICE', 'EDUCATIONAL', 'CROWDFUNDING', 'BARTER', 'TENDER');

-- CreateEnum
CREATE TYPE "DaoStatus" AS ENUM ('BOOTSTRAP', 'ACTIVE', 'DISSOLVED');

-- CreateEnum
CREATE TYPE "DaoRole" AS ENUM ('ADMIN', 'ARBITRATOR', 'MEDIATOR');

-- CreateEnum
CREATE TYPE "DaoMemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "QuorumType" AS ENUM ('SINGLE', 'MAJORITY', 'THRESHOLD');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'COUNCIL_QUEUE', 'IN_REVIEW', 'RESOLVED_PENDING', 'APPEALED', 'RESOLVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VerdictOutcome" AS ENUM ('RELEASE', 'CANCEL', 'SPLIT');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PASSED', 'REJECTED', 'EXECUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');

-- CreateEnum
CREATE TYPE "RemoteOfferCandidateStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "lnAddress" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "identityLevel" INTEGER NOT NULL DEFAULT 0,
    "nostrPubkey" TEXT,
    "nip05" TEXT,
    "colPoints" INTEGER NOT NULL DEFAULT 0,
    "email" TEXT,
    "googleId" TEXT,
    "linkedPubkey" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "magicLinkToken" TEXT,
    "magicLinkExpires" TIMESTAMP(3),
    "profileVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "k1" TEXT NOT NULL,
    "token" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "WalletProvider" NOT NULL,
    "mode" "WalletMode" NOT NULL,
    "walletId" TEXT,
    "accountId" TEXT,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "balanceSats" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priceSats" INTEGER NOT NULL,
    "category" TEXT,
    "subcategory" TEXT,
    "categoryCode" TEXT NOT NULL,
    "subcategoryCode" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "ticketType" "TicketType" NOT NULL DEFAULT 'SMART_ORDER',
    "offerType" "OfferType" NOT NULL DEFAULT 'SERVICE',
    "images" JSONB,
    "nostrEventId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creatorPubkey" TEXT NOT NULL,
    "companyId" TEXT,
    "productId" TEXT,
    "deliveryTimeDays" INTEGER,
    "deliveryCostSats" INTEGER,
    "deliveryTemplateId" TEXT,
    "deliveryNotes" TEXT,
    "cooperationId" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isRemote" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "source" "OfferSource" NOT NULL DEFAULT 'LOCAL',

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferMilestone" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "percentage" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OfferMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "buyerPubkey" TEXT NOT NULL,
    "sellerPubkey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "offerType" "OfferType" NOT NULL DEFAULT 'SERVICE',
    "lightningInvoice" TEXT,
    "paymentHash" TEXT,
    "amountSats" INTEGER,
    "disputeReason" TEXT,
    "nostrEventId" TEXT,
    "preimage" TEXT,
    "ticketType" "TicketType" NOT NULL DEFAULT 'SMART_ORDER',
    "escrowStatus" TEXT NOT NULL DEFAULT 'NONE',
    "phase1Invoice" TEXT,
    "phase2Invoice" TEXT,
    "phase3Invoice" TEXT,
    "escrowPhase1Hash" TEXT,
    "escrowPhase2Hash" TEXT,
    "escrowPhase3Hash" TEXT,
    "escrowPhase1Preimage" TEXT,
    "escrowPhase2Preimage" TEXT,
    "escrowPhase3Preimage" TEXT,
    "deliveryConfirmedAt" TIMESTAMP(3),
    "deliveryAddress" JSONB,
    "deliveryTimeDays" INTEGER,
    "deliveryCostSats" INTEGER,
    "totalHours" INTEGER,
    "deliveryNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "daoId" TEXT DEFAULT 'colabonate-foundation',
    "codexHash" TEXT,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "reviewerPubkey" TEXT NOT NULL,
    "revieweePubkey" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "nostrEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColPointsEvent" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColPointsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "invoice" TEXT,
    "amountSats" INTEGER,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "ownerPubkey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "city" TEXT,
    "zipCode" TEXT,
    "country" TEXT,
    "openingHours" JSONB,
    "businessFields" JSONB,
    "coopRadius" INTEGER,
    "terms" TEXT,
    "imprint" TEXT,
    "privacyPolicy" TEXT,
    "legalJurisdiction" TEXT,
    "taxId" TEXT,
    "logoUrl" TEXT,
    "bannerUrl" TEXT,
    "images" JSONB,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "socialLinks" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "hourlyRateSats" INTEGER,
    "nostrEventId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Catalog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "standardCategoryId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StandardCategory" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "unspscCode" TEXT,
    "offerType" "OfferType" NOT NULL DEFAULT 'SERVICE',
    "level" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandardCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "standardCategoryId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceSats" INTEGER NOT NULL,
    "images" TEXT,
    "sku" TEXT,
    "stock" INTEGER,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deliveryTimeDays" INTEGER NOT NULL,
    "deliveryCostSats" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reviewerPubkey" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cooperation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "initiatorPubkey" TEXT NOT NULL,
    "partnerPubkey" TEXT,
    "cooperationType" "CooperationType",
    "partnerMode" TEXT DEFAULT 'WHOLE',
    "budgetSats" INTEGER NOT NULL,
    "timeline" TEXT,
    "skills" TEXT,
    "status" "CooperationStatus" NOT NULL DEFAULT 'OPEN',
    "nostrProposalId" TEXT,
    "nostrAcceptId" TEXT,
    "categoryCode" TEXT,
    "images" TEXT,
    "deadline" TIMESTAMP(3),
    "requirements" TEXT,
    "offerId" TEXT,
    "lightningInvoice" TEXT,
    "paymentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cooperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoopMilestone" (
    "id" TEXT NOT NULL,
    "cooperationId" TEXT NOT NULL,
    "milestoneIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "dueDate" TIMESTAMP(3),
    "amountSats" INTEGER NOT NULL,
    "status" "CoopMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "partnerPubkey" TEXT,
    "evidence" TEXT,
    "lightningInvoice" TEXT,
    "paymentHash" TEXT,
    "nostrEventId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoopMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoopMilestoneMessage" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "authorPubkey" TEXT NOT NULL,
    "action" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoopMilestoneMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoopMilestoneApplication" (
    "id" TEXT NOT NULL,
    "cooperationId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "applicantPubkey" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoopMilestoneApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CooperationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cooperationType" TEXT NOT NULL,
    "budgetRange" TEXT,
    "timelinePreset" TEXT,
    "requiredSkills" TEXT,
    "defaultMilestones" TEXT,
    "categoryCode" TEXT,
    "terms" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdByPubkey" TEXT NOT NULL,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CooperationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dao" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "codexHash" TEXT NOT NULL,
    "codexVersion" TEXT NOT NULL,
    "codexUrl" TEXT NOT NULL,
    "status" "DaoStatus" NOT NULL DEFAULT 'BOOTSTRAP',
    "nostrEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DaoMember" (
    "id" TEXT NOT NULL,
    "daoId" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "role" "DaoRole" NOT NULL,
    "status" "DaoMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentialEventId" TEXT,
    "invitedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DaoMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DaoConfig" (
    "daoId" TEXT NOT NULL,
    "quorumType" "QuorumType" NOT NULL DEFAULT 'SINGLE',
    "thresholdN" INTEGER NOT NULL DEFAULT 1,
    "coolingOffDays" INTEGER NOT NULL DEFAULT 7,
    "mediationDays" INTEGER NOT NULL DEFAULT 14,
    "verdictDeadlineHours" INTEGER NOT NULL DEFAULT 48,
    "appealWindowHours" INTEGER NOT NULL DEFAULT 72,
    "appealQuorumType" "QuorumType",
    "appealThresholdN" INTEGER,

    CONSTRAINT "DaoConfig_pkey" PRIMARY KEY ("daoId")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "daoId" TEXT NOT NULL DEFAULT 'colabonate-foundation',
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" "VerdictOutcome",
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "arbitratorPubkey" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "quorumTypeSnapshot" "QuorumType",
    "thresholdNSnapshot" INTEGER,
    "verdictIssuedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArbitrationVerdict" (
    "id" TEXT NOT NULL,
    "verdictId" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "arbitratorPubkey" TEXT NOT NULL,
    "outcome" "VerdictOutcome" NOT NULL,
    "reasoning" TEXT,
    "evidenceEventIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "round" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ArbitrationVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminPubkey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppealRequest" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "appealerPubkey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceEventIds" TEXT NOT NULL,
    "originalVerdictId" TEXT NOT NULL,
    "nostrEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "finalVerdictId" TEXT,

    CONSTRAINT "AppealRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NostrAuthChallenge" (
    "nonce" TEXT NOT NULL,
    "issuedFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "NostrAuthChallenge_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "DaoProposal" (
    "id" TEXT NOT NULL,
    "daoId" TEXT NOT NULL,
    "authorPubkey" TEXT NOT NULL,
    "nostrEventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "executionStrategy" TEXT NOT NULL,
    "executionPayload" TEXT NOT NULL,
    "votingStart" TIMESTAMP(3) NOT NULL,
    "votingEnd" TIMESTAMP(3) NOT NULL,
    "snapshotTimestamp" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DaoProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DaoVote" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "voterPubkey" TEXT NOT NULL,
    "nostrEventId" TEXT NOT NULL,
    "choice" TEXT NOT NULL,
    "votingPower" INTEGER NOT NULL,
    "strategyUsed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DaoVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DaoGovernanceConfig" (
    "daoId" TEXT NOT NULL,
    "proposalValidationStrategy" TEXT NOT NULL,
    "votingStrategies" TEXT NOT NULL,
    "quorumType" TEXT NOT NULL DEFAULT 'SIMPLE',
    "quorumThreshold" INTEGER NOT NULL DEFAULT 1,
    "votingDelaySeconds" INTEGER NOT NULL DEFAULT 0,
    "minVotingPeriodSeconds" INTEGER NOT NULL DEFAULT 86400,
    "maxVotingPeriodSeconds" INTEGER NOT NULL DEFAULT 604800,

    CONSTRAINT "DaoGovernanceConfig_pkey" PRIMARY KEY ("daoId")
);

-- CreateTable
CREATE TABLE "DaoTreasury" (
    "id" TEXT NOT NULL,
    "daoId" TEXT NOT NULL,
    "escrowAccountId" TEXT,
    "multisigPubkey" TEXT,
    "balanceSats" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DaoTreasury_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryTransaction" (
    "id" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountSats" BIGINT NOT NULL,
    "toPubkey" TEXT,
    "proposalId" TEXT,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreasuryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoLookup" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemoteOfferCandidate" (
    "id" TEXT NOT NULL,
    "remoteEventId" TEXT NOT NULL,
    "remoteRelay" TEXT NOT NULL,
    "remoteAuthor" TEXT NOT NULL,
    "rawEvent" JSONB NOT NULL,
    "normalized" JSONB NOT NULL,
    "status" "RemoteOfferCandidateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "promotedOfferId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteOfferCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_pubkey_key" ON "User"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_k1_key" ON "Session"("k1");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_nostrEventId_key" ON "Offer"("nostrEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_cooperationId_key" ON "Offer"("cooperationId");

-- CreateIndex
CREATE INDEX "Offer_status_publishedAt_idx" ON "Offer"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "Offer_creatorPubkey_status_idx" ON "Offer"("creatorPubkey", "status");

-- CreateIndex
CREATE INDEX "Offer_offerType_status_idx" ON "Offer"("offerType", "status");

-- CreateIndex
CREATE INDEX "Offer_country_status_idx" ON "Offer"("country", "status");

-- CreateIndex
CREATE INDEX "Offer_categoryCode_idx" ON "Offer"("categoryCode");

-- CreateIndex
CREATE INDEX "Offer_companyId_status_idx" ON "Offer"("companyId", "status");

-- CreateIndex
CREATE INDEX "Offer_source_status_idx" ON "Offer"("source", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_nostrEventId_key" ON "Ticket"("nostrEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_nostrEventId_key" ON "Review"("nostrEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_ownerPubkey_key" ON "Company"("ownerPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "Company_nostrEventId_key" ON "Company"("nostrEventId");

-- CreateIndex
CREATE UNIQUE INDEX "StandardCategory_slug_key" ON "StandardCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Cooperation_offerId_key" ON "Cooperation"("offerId");

-- CreateIndex
CREATE INDEX "CoopMilestoneMessage_milestoneId_idx" ON "CoopMilestoneMessage"("milestoneId");

-- CreateIndex
CREATE UNIQUE INDEX "CoopMilestoneApplication_cooperationId_milestoneId_applican_key" ON "CoopMilestoneApplication"("cooperationId", "milestoneId", "applicantPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "DaoMember_daoId_pubkey_key" ON "DaoMember"("daoId", "pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_disputeId_key" ON "Dispute"("disputeId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "Dispute_ticketId_idx" ON "Dispute"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "ArbitrationVerdict_verdictId_key" ON "ArbitrationVerdict"("verdictId");

-- CreateIndex
CREATE INDEX "ArbitrationVerdict_disputeId_round_idx" ON "ArbitrationVerdict"("disputeId", "round");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminPubkey_idx" ON "AdminAuditLog"("adminPubkey");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_idx" ON "AdminAuditLog"("action");

-- CreateIndex
CREATE INDEX "NotificationLog_eventType_idx" ON "NotificationLog"("eventType");

-- CreateIndex
CREATE INDEX "NotificationLog_refId_idx" ON "NotificationLog"("refId");

-- CreateIndex
CREATE UNIQUE INDEX "AppealRequest_disputeId_key" ON "AppealRequest"("disputeId");

-- CreateIndex
CREATE INDEX "AppealRequest_appealerPubkey_idx" ON "AppealRequest"("appealerPubkey");

-- CreateIndex
CREATE INDEX "AppealRequest_createdAt_idx" ON "AppealRequest"("createdAt");

-- CreateIndex
CREATE INDEX "NostrAuthChallenge_createdAt_idx" ON "NostrAuthChallenge"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DaoProposal_nostrEventId_key" ON "DaoProposal"("nostrEventId");

-- CreateIndex
CREATE INDEX "DaoProposal_daoId_idx" ON "DaoProposal"("daoId");

-- CreateIndex
CREATE INDEX "DaoProposal_status_idx" ON "DaoProposal"("status");

-- CreateIndex
CREATE INDEX "DaoProposal_authorPubkey_idx" ON "DaoProposal"("authorPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "DaoVote_nostrEventId_key" ON "DaoVote"("nostrEventId");

-- CreateIndex
CREATE INDEX "DaoVote_proposalId_idx" ON "DaoVote"("proposalId");

-- CreateIndex
CREATE INDEX "DaoVote_voterPubkey_idx" ON "DaoVote"("voterPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "DaoVote_proposalId_voterPubkey_key" ON "DaoVote"("proposalId", "voterPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "DaoTreasury_daoId_key" ON "DaoTreasury"("daoId");

-- CreateIndex
CREATE INDEX "TreasuryTransaction_treasuryId_idx" ON "TreasuryTransaction"("treasuryId");

-- CreateIndex
CREATE INDEX "TreasuryTransaction_proposalId_idx" ON "TreasuryTransaction"("proposalId");

-- CreateIndex
CREATE INDEX "GeoLookup_country_region_idx" ON "GeoLookup"("country", "region");

-- CreateIndex
CREATE UNIQUE INDEX "GeoLookup_country_region_city_key" ON "GeoLookup"("country", "region", "city");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteOfferCandidate_remoteEventId_key" ON "RemoteOfferCandidate"("remoteEventId");

-- CreateIndex
CREATE INDEX "RemoteOfferCandidate_status_fetchedAt_idx" ON "RemoteOfferCandidate"("status", "fetchedAt");

-- CreateIndex
CREATE INDEX "RemoteOfferCandidate_remoteAuthor_idx" ON "RemoteOfferCandidate"("remoteAuthor");

-- CreateIndex
CREATE INDEX "RemoteOfferCandidate_remoteRelay_idx" ON "RemoteOfferCandidate"("remoteRelay");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_pubkey_fkey" FOREIGN KEY ("pubkey") REFERENCES "User"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_creatorPubkey_fkey" FOREIGN KEY ("creatorPubkey") REFERENCES "User"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_deliveryTemplateId_fkey" FOREIGN KEY ("deliveryTemplateId") REFERENCES "DeliveryTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferMilestone" ADD CONSTRAINT "OfferMilestone_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_buyerPubkey_fkey" FOREIGN KEY ("buyerPubkey") REFERENCES "User"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_sellerPubkey_fkey" FOREIGN KEY ("sellerPubkey") REFERENCES "User"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColPointsEvent" ADD CONSTRAINT "ColPointsEvent_pubkey_fkey" FOREIGN KEY ("pubkey") REFERENCES "User"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Catalog" ADD CONSTRAINT "Catalog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Catalog" ADD CONSTRAINT "Catalog_standardCategoryId_fkey" FOREIGN KEY ("standardCategoryId") REFERENCES "StandardCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandardCategory" ADD CONSTRAINT "StandardCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StandardCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_standardCategoryId_fkey" FOREIGN KEY ("standardCategoryId") REFERENCES "StandardCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTemplate" ADD CONSTRAINT "DeliveryTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyReview" ADD CONSTRAINT "CompanyReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyReview" ADD CONSTRAINT "CompanyReview_reviewerPubkey_fkey" FOREIGN KEY ("reviewerPubkey") REFERENCES "Company"("ownerPubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cooperation" ADD CONSTRAINT "Cooperation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMilestone" ADD CONSTRAINT "CoopMilestone_cooperationId_fkey" FOREIGN KEY ("cooperationId") REFERENCES "Cooperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMilestoneMessage" ADD CONSTRAINT "CoopMilestoneMessage_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "CoopMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMilestoneApplication" ADD CONSTRAINT "CoopMilestoneApplication_cooperationId_fkey" FOREIGN KEY ("cooperationId") REFERENCES "Cooperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMilestoneApplication" ADD CONSTRAINT "CoopMilestoneApplication_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "CoopMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CooperationTemplate" ADD CONSTRAINT "CooperationTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaoMember" ADD CONSTRAINT "DaoMember_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "Dao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaoConfig" ADD CONSTRAINT "DaoConfig_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "Dao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "Dao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArbitrationVerdict" ADD CONSTRAINT "ArbitrationVerdict_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealRequest" ADD CONSTRAINT "AppealRequest_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaoProposal" ADD CONSTRAINT "DaoProposal_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "Dao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaoVote" ADD CONSTRAINT "DaoVote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "DaoProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaoGovernanceConfig" ADD CONSTRAINT "DaoGovernanceConfig_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "Dao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaoTreasury" ADD CONSTRAINT "DaoTreasury_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "Dao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryTransaction" ADD CONSTRAINT "TreasuryTransaction_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "DaoTreasury"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
