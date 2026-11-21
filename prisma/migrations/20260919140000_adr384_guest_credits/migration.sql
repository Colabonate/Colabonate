-- ADR-384 D10: anonymous session credits
ALTER TABLE "AiCreditPurchase" ALTER COLUMN "pubkey" DROP NOT NULL;
ALTER TABLE "AiCreditPurchase" ADD COLUMN "guestSessionId" TEXT;
CREATE INDEX "AiCreditPurchase_guestSessionId_idx" ON "AiCreditPurchase"("guestSessionId");

CREATE TABLE "AiGuestCredit" (
    "guestSessionId" TEXT NOT NULL,
    "requestsRemaining" INTEGER NOT NULL DEFAULT 0,
    "requestsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiGuestCredit_pkey" PRIMARY KEY ("guestSessionId")
);
