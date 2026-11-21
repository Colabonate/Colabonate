-- CreateEnum
CREATE TYPE "ShippingServiceType" AS ENUM ('STANDARD', 'EXPRESS', 'OVERNIGHT', 'PICKUP');

-- CreateEnum
CREATE TYPE "ListingVisibility" AS ENUM ('HIDDEN', 'ON_SALE', 'PRE_ORDER');

-- DropIndex
DROP INDEX "Cooperation_disputeMode_idx";

-- DropIndex
DROP INDEX "Cooperation_escrowSubWalletId_idx";

-- DropIndex
DROP INDEX "Cooperation_visibility_idx";

-- DropIndex
DROP INDEX "DmMessage_ownerPubkey_createdAt_idx";

-- DropIndex
DROP INDEX "DmMessage_ownerPubkey_peerPubkey_createdAt_idx";

-- DropIndex
DROP INDEX "Offer_disputeMode_idx";

-- DropIndex
DROP INDEX "Offer_lightningSubWalletId_idx";

-- DropIndex
DROP INDEX "Offer_visibility_idx";

-- DropIndex
DROP INDEX "Ticket_disputeMode_idx";

-- DropIndex
DROP INDEX "Ticket_escrowSubWalletId_idx";

-- DropIndex
DROP INDEX "Ticket_visibility_idx";

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "disclosureDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "allowedVisibility" JSONB,
ADD COLUMN     "dimensions" TEXT,
ADD COLUMN     "dimensionsUnit" TEXT,
ADD COLUMN     "lightningSubWalletAdminKey" TEXT,
ADD COLUMN     "listingVisibility" TEXT DEFAULT 'on-sale',
ADD COLUMN     "parentOfferId" TEXT,
ADD COLUMN     "physicalType" TEXT,
ADD COLUMN     "productType" TEXT,
ADD COLUMN     "shippingOptionRefs" JSONB,
ADD COLUMN     "specs" JSONB,
ADD COLUMN     "stock" INTEGER,
ADD COLUMN     "weight" TEXT,
ADD COLUMN     "weightUnit" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "dimensions" TEXT,
ADD COLUMN     "dimensionsUnit" TEXT,
ADD COLUMN     "listingVisibility" TEXT DEFAULT 'on-sale',
ADD COLUMN     "parentProductId" TEXT,
ADD COLUMN     "physicalType" TEXT,
ADD COLUMN     "productType" TEXT,
ADD COLUMN     "specs" TEXT,
ADD COLUMN     "weight" TEXT,
ADD COLUMN     "weightUnit" TEXT;

-- CreateTable
CREATE TABLE "ShippingOption" (
    "id" TEXT NOT NULL,
    "d" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "baseCost" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "countries" TEXT NOT NULL,
    "service" "ShippingServiceType" NOT NULL DEFAULT 'STANDARD',
    "carrier" TEXT,
    "regions" TEXT,
    "durationMin" INTEGER,
    "durationMax" INTEGER,
    "durationUnit" TEXT,
    "location" TEXT,
    "geohash" TEXT,
    "weightMin" TEXT,
    "weightMax" TEXT,
    "weightUnit" TEXT,
    "dimMin" TEXT,
    "dimMax" TEXT,
    "dimUnit" TEXT,
    "priceWeight" TEXT,
    "priceWeightCur" TEXT,
    "priceVolume" TEXT,
    "priceVolumeCur" TEXT,
    "priceDistance" TEXT,
    "priceDistanceCur" TEXT,
    "nostrEventId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCollection" (
    "id" TEXT NOT NULL,
    "d" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "image" TEXT,
    "location" TEXT,
    "geohash" TEXT,
    "nostrEventId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCollectionMember" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductCollectionMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionShippingOption" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "shippingOptionId" TEXT NOT NULL,

    CONSTRAINT "CollectionShippingOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayloadDisclosure" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "disclosedByPubkey" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'plaintext',
    "commitmentVerified" BOOLEAN NOT NULL DEFAULT false,
    "payloadJson" TEXT,
    "nostrEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayloadDisclosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShippingOption_d_key" ON "ShippingOption"("d");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingOption_nostrEventId_key" ON "ShippingOption"("nostrEventId");

-- CreateIndex
CREATE INDEX "ShippingOption_companyId_isActive_idx" ON "ShippingOption"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "ShippingOption_countries_idx" ON "ShippingOption"("countries");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCollection_d_key" ON "ProductCollection"("d");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCollection_nostrEventId_key" ON "ProductCollection"("nostrEventId");

-- CreateIndex
CREATE INDEX "ProductCollection_companyId_isActive_idx" ON "ProductCollection"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCollectionMember_collectionId_productId_key" ON "ProductCollectionMember"("collectionId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionShippingOption_collectionId_shippingOptionId_key" ON "CollectionShippingOption"("collectionId", "shippingOptionId");

-- CreateIndex
CREATE UNIQUE INDEX "PayloadDisclosure_nostrEventId_key" ON "PayloadDisclosure"("nostrEventId");

-- CreateIndex
CREATE INDEX "PayloadDisclosure_disputeId_idx" ON "PayloadDisclosure"("disputeId");

-- CreateIndex
CREATE INDEX "PayloadDisclosure_disclosedByPubkey_idx" ON "PayloadDisclosure"("disclosedByPubkey");

-- CreateIndex
CREATE INDEX "DmMessage_ownerPubkey_createdAt_idx" ON "DmMessage"("ownerPubkey", "createdAt");

-- CreateIndex
CREATE INDEX "DmMessage_ownerPubkey_peerPubkey_createdAt_idx" ON "DmMessage"("ownerPubkey", "peerPubkey", "createdAt");

-- AddForeignKey
ALTER TABLE "ShippingOption" ADD CONSTRAINT "ShippingOption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCollectionMember" ADD CONSTRAINT "ProductCollectionMember_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "ProductCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCollectionMember" ADD CONSTRAINT "ProductCollectionMember_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionShippingOption" ADD CONSTRAINT "CollectionShippingOption_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "ProductCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionShippingOption" ADD CONSTRAINT "CollectionShippingOption_shippingOptionId_fkey" FOREIGN KEY ("shippingOptionId") REFERENCES "ShippingOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayloadDisclosure" ADD CONSTRAINT "PayloadDisclosure_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
