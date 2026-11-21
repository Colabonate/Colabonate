-- DropIndex
DROP INDEX "AgentProfile_isVerified_idx";

-- AlterTable
ALTER TABLE "CoopMilestone" ADD COLUMN     "assigneeAgentProfileId" TEXT;

-- AlterTable
ALTER TABLE "CooperationTemplate" ADD COLUMN     "isAgentOrchestration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "orchestrationSteps" JSONB;

-- CreateIndex
CREATE INDEX "CoopMilestone_assigneeAgentProfileId_idx" ON "CoopMilestone"("assigneeAgentProfileId");

-- AddForeignKey
ALTER TABLE "CoopMilestone" ADD CONSTRAINT "CoopMilestone_assigneeAgentProfileId_fkey" FOREIGN KEY ("assigneeAgentProfileId") REFERENCES "AgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
