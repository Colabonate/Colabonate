-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "gammaTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Offer_gammaTags_idx" ON "Offer" USING GIN ("gammaTags");
