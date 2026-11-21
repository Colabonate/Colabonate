-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgentTaskStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "AgentTaskStatus" ADD VALUE 'COMPLETED';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "agentTaskId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_agentTaskId_key" ON "Ticket"("agentTaskId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_agentTaskId_fkey" FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

