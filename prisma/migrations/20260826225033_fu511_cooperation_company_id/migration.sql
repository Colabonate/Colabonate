-- AlterTable
ALTER TABLE "Cooperation" ADD COLUMN     "companyId" TEXT;

-- AddForeignKey
ALTER TABLE "Cooperation" ADD CONSTRAINT "Cooperation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
