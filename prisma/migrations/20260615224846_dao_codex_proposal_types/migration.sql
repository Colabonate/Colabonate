/*
  Warnings:

  - The `executionPayload` column on the `DaoProposal` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('NORMAL_DECISION', 'CODEX_AMENDMENT', 'TREASURY_SPENDING', 'SANCTION', 'PROTOCOL_UPGRADE', 'NEW_DAO_CREATION');

-- AlterEnum
ALTER TYPE "ProposalStatus" ADD VALUE 'COMMENT_PERIOD';

-- AlterTable
ALTER TABLE "DaoProposal" ADD COLUMN     "commentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "proposalType" "ProposalType" NOT NULL DEFAULT 'NORMAL_DECISION',
DROP COLUMN "executionPayload",
ADD COLUMN     "executionPayload" JSONB,
ALTER COLUMN "votingStart" DROP NOT NULL,
ALTER COLUMN "votingEnd" DROP NOT NULL,
ALTER COLUMN "snapshotTimestamp" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "picture" TEXT;

-- CreateTable
CREATE TABLE "DaoGovernanceTypeOverride" (
    "daoId" TEXT NOT NULL,
    "proposalType" "ProposalType" NOT NULL,
    "quorumPercent" INTEGER NOT NULL,
    "majorityPercent" INTEGER NOT NULL,
    "votingPeriodSeconds" INTEGER NOT NULL,

    CONSTRAINT "DaoGovernanceTypeOverride_pkey" PRIMARY KEY ("daoId","proposalType")
);

-- CreateTable
CREATE TABLE "DaoProposalComment" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "authorPubkey" TEXT NOT NULL,
    "nostrEventId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DaoProposalComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DaoProposalComment_nostrEventId_key" ON "DaoProposalComment"("nostrEventId");

-- CreateIndex
CREATE INDEX "DaoProposalComment_proposalId_idx" ON "DaoProposalComment"("proposalId");

-- CreateIndex
CREATE INDEX "DaoProposalComment_authorPubkey_idx" ON "DaoProposalComment"("authorPubkey");

-- CreateIndex
CREATE INDEX "DaoProposal_proposalType_idx" ON "DaoProposal"("proposalType");

-- AddForeignKey
ALTER TABLE "DaoGovernanceTypeOverride" ADD CONSTRAINT "DaoGovernanceTypeOverride_daoId_fkey" FOREIGN KEY ("daoId") REFERENCES "Dao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DaoProposalComment" ADD CONSTRAINT "DaoProposalComment_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "DaoProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
