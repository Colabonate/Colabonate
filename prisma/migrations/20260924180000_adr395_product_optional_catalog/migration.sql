-- ADR-395: a Product belongs to a Company; the Catalog becomes optional.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Product" ALTER COLUMN "catalogId" DROP NOT NULL;

-- Backfill: every existing product inherits its catalog's company.
UPDATE "Product" AS p
SET "companyId" = c."companyId"
FROM "Catalog" AS c
WHERE p."catalogId" = c."id";

-- CreateIndex
CREATE INDEX "Product_companyId_idx" ON "Product"("companyId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
