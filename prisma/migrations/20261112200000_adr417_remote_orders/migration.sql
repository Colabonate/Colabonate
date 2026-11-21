-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "remoteSellerPubkey" TEXT;

-- CreateTable
CREATE TABLE "RemoteOrder" (
    "id" TEXT NOT NULL,
    "buyerPubkey" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "payeePubkey" TEXT NOT NULL,
    "payeeRole" TEXT NOT NULL,
    "payeeLud16" TEXT NOT NULL,
    "zap" BOOLEAN NOT NULL DEFAULT true,
    "amountSats" INTEGER NOT NULL,
    "amountBasis" TEXT NOT NULL,
    "priceAmount" TEXT,
    "priceCurrency" TEXT,
    "rateSnapshot" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUOTED',
    "quoteExpiresAt" TIMESTAMP(3) NOT NULL,
    "zapRequestId" TEXT,
    "bolt11" TEXT,
    "paymentHash" TEXT,
    "verifyUrl" TEXT,
    "invoiceExpiresAt" TIMESTAMP(3),
    "preimage" TEXT,
    "paidAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemoteOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemoteOrder_buyerPubkey_createdAt_idx" ON "RemoteOrder"("buyerPubkey", "createdAt");

-- CreateIndex
CREATE INDEX "RemoteOrder_offerId_idx" ON "RemoteOrder"("offerId");

-- CreateIndex
CREATE INDEX "RemoteOrder_status_quoteExpiresAt_idx" ON "RemoteOrder"("status", "quoteExpiresAt");

