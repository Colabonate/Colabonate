-- CreateTable
CREATE TABLE "SupportTip" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportTip_createdAt_idx" ON "SupportTip"("createdAt" DESC);
