-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "variantAxes" JSONB,
ADD COLUMN     "variantValues" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "variantAxes" TEXT,
ADD COLUMN     "variantValues" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "variantLabel" TEXT;

-- CreateIndex
CREATE INDEX "Offer_parentOfferId_idx" ON "Offer"("parentOfferId");

-- CreateIndex
CREATE INDEX "Offer_productType_status_idx" ON "Offer"("productType", "status");
