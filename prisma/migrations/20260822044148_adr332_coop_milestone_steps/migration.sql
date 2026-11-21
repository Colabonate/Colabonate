-- ADR-332 D2: nested agent pipeline (CoopMilestoneStep). Deliberately NO
-- backfill: legacy flat agent-orchestration rows keep their milestone-level
-- assigneeAgentProfileId / requiredCapabilities (write-once per FU-505);
-- runtime isAgentOrchestration derivation reads BOTH levels, so legacy and
-- new rows are indistinguishable without data migration.

-- CreateTable
CREATE TABLE "CoopMilestoneStep" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "requiredCapabilities" TEXT,
    "assigneeAgentProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoopMilestoneStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoopMilestoneStep_assigneeAgentProfileId_idx" ON "CoopMilestoneStep"("assigneeAgentProfileId");

-- CreateIndex
CREATE INDEX "CoopMilestoneStep_milestoneId_idx" ON "CoopMilestoneStep"("milestoneId");

-- AddForeignKey
ALTER TABLE "CoopMilestoneStep" ADD CONSTRAINT "CoopMilestoneStep_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "CoopMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoopMilestoneStep" ADD CONSTRAINT "CoopMilestoneStep_assigneeAgentProfileId_fkey" FOREIGN KEY ("assigneeAgentProfileId") REFERENCES "AgentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
