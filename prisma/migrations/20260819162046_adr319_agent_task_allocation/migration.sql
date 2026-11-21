-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('OPEN', 'SELECTING', 'ASSIGNED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgentTaskApplicationStatus" AS ENUM ('PENDING', 'AWAITING_OWNER_APPROVAL', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "creatorPubkey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requiredCapabilities" TEXT[],
    "budgetSats" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3),
    "autoSelect" BOOLEAN NOT NULL DEFAULT false,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'OPEN',
    "selectedAgentProfileId" TEXT,
    "selectedOfferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTaskApplication" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "message" TEXT,
    "proposedPriceSats" INTEGER,
    "proposedETA" TIMESTAMP(3),
    "status" "AgentTaskApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTaskApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentTask_status_idx" ON "AgentTask"("status");

-- CreateIndex
CREATE INDEX "AgentTask_creatorPubkey_idx" ON "AgentTask"("creatorPubkey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTaskApplication_taskId_agentProfileId_key" ON "AgentTaskApplication"("taskId", "agentProfileId");

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_creatorPubkey_fkey" FOREIGN KEY ("creatorPubkey") REFERENCES "User"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskApplication" ADD CONSTRAINT "AgentTaskApplication_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskApplication" ADD CONSTRAINT "AgentTaskApplication_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskApplication" ADD CONSTRAINT "AgentTaskApplication_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
