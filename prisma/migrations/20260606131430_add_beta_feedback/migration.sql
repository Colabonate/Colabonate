-- DropIndex
DROP INDEX "idx_offer_description_trgm";

-- DropIndex
DROP INDEX "idx_offer_title_trgm";

-- CreateTable
CREATE TABLE "BetaFeedback" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "route" TEXT,
    "userAgent" TEXT,
    "pubkey" TEXT,
    "userEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triagedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedIn" TEXT,

    CONSTRAINT "BetaFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BetaFeedback_status_createdAt_idx" ON "BetaFeedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BetaFeedback_pubkey_idx" ON "BetaFeedback"("pubkey");
