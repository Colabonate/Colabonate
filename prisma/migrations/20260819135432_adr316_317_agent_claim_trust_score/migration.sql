-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "trustScore" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "AgentClaim" (
    "id" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "attesterType" TEXT NOT NULL,
    "attesterPubkey" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "ticketId" TEXT,
    "reviewId" TEXT,
    "nostrEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentClaim_reviewId_key" ON "AgentClaim"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentClaim_nostrEventId_key" ON "AgentClaim"("nostrEventId");

-- AddForeignKey
ALTER TABLE "AgentClaim" ADD CONSTRAINT "AgentClaim_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
