-- CreateTable
CREATE TABLE "EscrowTrade" (
    "id" TEXT NOT NULL,
    "canisterTradeId" TEXT NOT NULL,
    "canisterId" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'ic',
    "btcAddress" TEXT NOT NULL,
    "buyerPubkey" TEXT NOT NULL,
    "sellerPubkey" TEXT NOT NULL,
    "buyerRefundAddress" TEXT NOT NULL,
    "sellerPayoutAddress" TEXT NOT NULL,
    "expectedAmountSats" INTEGER NOT NULL,
    "milestones" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING_FUNDING',
    "settledBuyerBps" INTEGER,
    "settledSellerBps" INTEGER,
    "timeoutAt" TEXT,
    "fundedAt" TEXT,
    "tradeTermsHash" TEXT,
    "moduleHashAtCreation" TEXT,
    "ticketId" TEXT,
    "cooperationId" TEXT,
    "endToEndId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscrowTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowTradeEvent" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowTradeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowVerificationSnapshot" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT,
    "canisterId" TEXT NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'ic',
    "moduleHash" TEXT NOT NULL,
    "controllers" JSONB NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowVerificationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscrowDisputeLink" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EscrowDisputeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceExport" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "shareToken" TEXT,
    "revokedAt" TIMESTAMP(3),
    "exportedByPubkey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EscrowTrade_canisterTradeId_key" ON "EscrowTrade"("canisterTradeId");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowTrade_ticketId_key" ON "EscrowTrade"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowTrade_cooperationId_key" ON "EscrowTrade"("cooperationId");

-- CreateIndex
CREATE INDEX "EscrowTrade_buyerPubkey_idx" ON "EscrowTrade"("buyerPubkey");

-- CreateIndex
CREATE INDEX "EscrowTrade_sellerPubkey_idx" ON "EscrowTrade"("sellerPubkey");

-- CreateIndex
CREATE INDEX "EscrowTrade_state_idx" ON "EscrowTrade"("state");

-- CreateIndex
CREATE INDEX "EscrowTrade_canisterId_network_idx" ON "EscrowTrade"("canisterId", "network");

-- CreateIndex
CREATE INDEX "EscrowTradeEvent_tradeId_createdAt_idx" ON "EscrowTradeEvent"("tradeId", "createdAt");

-- CreateIndex
CREATE INDEX "EscrowVerificationSnapshot_canisterId_network_observedAt_idx" ON "EscrowVerificationSnapshot"("canisterId", "network", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EscrowDisputeLink_disputeId_key" ON "EscrowDisputeLink"("disputeId");

-- CreateIndex
CREATE INDEX "EscrowDisputeLink_tradeId_idx" ON "EscrowDisputeLink"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceExport_shareToken_key" ON "EvidenceExport"("shareToken");

-- CreateIndex
CREATE INDEX "EvidenceExport_tradeId_idx" ON "EvidenceExport"("tradeId");

-- AddForeignKey
ALTER TABLE "EscrowTrade" ADD CONSTRAINT "EscrowTrade_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowTrade" ADD CONSTRAINT "EscrowTrade_cooperationId_fkey" FOREIGN KEY ("cooperationId") REFERENCES "Cooperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowTradeEvent" ADD CONSTRAINT "EscrowTradeEvent_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "EscrowTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowVerificationSnapshot" ADD CONSTRAINT "EscrowVerificationSnapshot_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "EscrowTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowDisputeLink" ADD CONSTRAINT "EscrowDisputeLink_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "EscrowTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscrowDisputeLink" ADD CONSTRAINT "EscrowDisputeLink_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceExport" ADD CONSTRAINT "EvidenceExport_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "EscrowTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
