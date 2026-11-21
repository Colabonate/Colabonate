-- CreateEnum
CREATE TYPE "OrchestrationMode" AS ENUM ('HUMAN', 'AUTONOMOUS');

-- CreateEnum
CREATE TYPE "AgentNetworkMemberRole" AS ENUM ('MEMBER', 'LEAD');

-- CreateEnum
CREATE TYPE "AgentNetworkJoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "AgentNetwork" (
    "id" TEXT NOT NULL,
    "ownerPubkey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "orchestrationMode" "OrchestrationMode" NOT NULL DEFAULT 'HUMAN',
    "openMembership" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "reputationScore" DOUBLE PRECISION,
    "nostrPubkey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentNetworkMember" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "role" "AgentNetworkMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentNetworkMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentNetworkJoinRequest" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "message" TEXT,
    "status" "AgentNetworkJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AgentNetworkJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentNetwork_nostrPubkey_key" ON "AgentNetwork"("nostrPubkey");

-- CreateIndex
CREATE INDEX "AgentNetwork_isPublic_idx" ON "AgentNetwork"("isPublic");

-- CreateIndex
CREATE UNIQUE INDEX "AgentNetworkMember_networkId_agentProfileId_key" ON "AgentNetworkMember"("networkId", "agentProfileId");

-- CreateIndex
CREATE INDEX "AgentNetworkJoinRequest_networkId_status_idx" ON "AgentNetworkJoinRequest"("networkId", "status");

-- AddForeignKey
ALTER TABLE "AgentNetwork" ADD CONSTRAINT "AgentNetwork_ownerPubkey_fkey" FOREIGN KEY ("ownerPubkey") REFERENCES "User"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNetworkMember" ADD CONSTRAINT "AgentNetworkMember_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "AgentNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNetworkMember" ADD CONSTRAINT "AgentNetworkMember_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNetworkJoinRequest" ADD CONSTRAINT "AgentNetworkJoinRequest_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "AgentNetwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentNetworkJoinRequest" ADD CONSTRAINT "AgentNetworkJoinRequest_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
