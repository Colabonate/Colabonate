-- AlterTable
ALTER TABLE "AgentNetwork" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "AgentNetwork_companyId_idx" ON "AgentNetwork"("companyId");

-- AddForeignKey
ALTER TABLE "AgentNetwork" ADD CONSTRAINT "AgentNetwork_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
