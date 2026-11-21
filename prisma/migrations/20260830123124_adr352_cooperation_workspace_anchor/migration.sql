-- CreateEnum
CREATE TYPE "CoopMilestoneStepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- DropForeignKey
ALTER TABLE "Workspace" DROP CONSTRAINT "Workspace_ticketId_fkey";

-- AlterTable
ALTER TABLE "CoopMilestone" ADD COLUMN     "assigneeOfferId" TEXT;

-- AlterTable
ALTER TABLE "CoopMilestoneStep" ADD COLUMN     "assigneeOfferId" TEXT,
ADD COLUMN     "status" "CoopMilestoneStepStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "cooperationId" TEXT,
ALTER COLUMN "ticketId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CoopMilestone_assigneeOfferId_idx" ON "CoopMilestone"("assigneeOfferId");

-- CreateIndex
CREATE INDEX "CoopMilestoneStep_assigneeOfferId_idx" ON "CoopMilestoneStep"("assigneeOfferId");

-- CreateIndex
CREATE INDEX "Workspace_cooperationId_idx" ON "Workspace"("cooperationId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_cooperationId_offerId_key" ON "Workspace"("cooperationId", "offerId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_cooperationId_fkey" FOREIGN KEY ("cooperationId") REFERENCES "Cooperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMilestone" ADD CONSTRAINT "CoopMilestone_assigneeOfferId_fkey" FOREIGN KEY ("assigneeOfferId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMilestoneStep" ADD CONSTRAINT "CoopMilestoneStep_assigneeOfferId_fkey" FOREIGN KEY ("assigneeOfferId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

