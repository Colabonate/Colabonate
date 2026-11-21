-- ADR-384 D2/D3: fixed-price AI credit packs (non-refillable entitlement counter)

-- CreateTable
CREATE TABLE "AiCreditBalance" (
    "pubkey" TEXT NOT NULL,
    "requestsRemaining" INTEGER NOT NULL DEFAULT 0,
    "requestsUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCreditBalance_pkey" PRIMARY KEY ("pubkey")
);

-- CreateTable
CREATE TABLE "AiCreditPurchase" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "requests" INTEGER NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "rail" TEXT NOT NULL,
    "invoice" TEXT,
    "paymentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "AiCreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCreditPurchase_pubkey_createdAt_idx" ON "AiCreditPurchase"("pubkey", "createdAt");
