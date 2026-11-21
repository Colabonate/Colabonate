-- ADR-397 D8 (acceptance criteria), D6 (ticket brief snapshot), D11 (drop the
-- never-read autoSelect flag), FU-870 (list thumbnails), D2-C (time-to-pay).

-- AlterTable
ALTER TABLE "AgentTask" DROP COLUMN "autoSelect",
ADD COLUMN     "acceptanceCriteria" TEXT,
ADD COLUMN     "imageThumbs" JSONB,
ADD COLUMN     "ticketPaidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "bountyBrief" JSONB;
