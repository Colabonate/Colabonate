-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "agentProfileId" TEXT;

-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL,
    "ownerPubkey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capabilities" TEXT[],
    "tools" JSONB NOT NULL,
    "avatarUrl" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "requireHumanApproval" BOOLEAN NOT NULL DEFAULT true,
    "nostrPubkey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FoundationSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "remoteCandidatesAutoApprove" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FoundationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_nostrPubkey_key" ON "AgentProfile"("nostrPubkey");

-- CreateIndex
CREATE INDEX "AgentProfile_isPublic_idx" ON "AgentProfile"("isPublic");

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_ownerPubkey_name_key" ON "AgentProfile"("ownerPubkey", "name");

-- CreateIndex
CREATE INDEX "Offer_agentProfileId_idx" ON "Offer"("agentProfileId");

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_ownerPubkey_fkey" FOREIGN KEY ("ownerPubkey") REFERENCES "User"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
