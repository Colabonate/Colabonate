-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "priceAmount" TEXT,
ADD COLUMN     "priceCurrency" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "gammaTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Product_gammaTags_idx" ON "Product" USING GIN ("gammaTags");
