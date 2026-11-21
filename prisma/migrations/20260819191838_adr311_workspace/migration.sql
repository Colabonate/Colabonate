-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "agentProfileId" TEXT,
    "buyerPubkey" TEXT NOT NULL,
    "canisterId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_DEPLOY',
    "cycleBudgetSats" INTEGER,
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_ticketId_key" ON "Workspace"("ticketId");

-- CreateIndex
CREATE INDEX "Workspace_buyerPubkey_status_idx" ON "Workspace"("buyerPubkey", "status");

-- CreateIndex
CREATE INDEX "Workspace_status_expiresAt_idx" ON "Workspace"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_buyerPubkey_fkey" FOREIGN KEY ("buyerPubkey") REFERENCES "User"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;
