-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "AgentProfile_companyId_idx" ON "AgentProfile"("companyId");

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
