-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('SPACE', 'SESSION');

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "autoConfirm" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bookingMaxUnits" INTEGER,
ADD COLUMN     "bookingMinUnits" INTEGER,
ADD COLUMN     "bookingMode" TEXT,
ADD COLUMN     "confirmationWindowHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "priceUnit" TEXT,
ADD COLUMN     "resourceId" TEXT;

-- CreateTable
CREATE TABLE "BookableResource" (
    "id" TEXT NOT NULL,
    "ownerPubkey" TEXT NOT NULL,
    "companyId" TEXT,
    "kind" "ResourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "timezone" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "minUnits" INTEGER,
    "maxUnits" INTEGER,
    "leadTimeHours" INTEGER NOT NULL DEFAULT 0,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "country" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "calendarD" TEXT NOT NULL,
    "nostrEventId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookableResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceAvailabilityRule" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "ruleKind" TEXT NOT NULL,
    "weekday" INTEGER,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceAvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceBlackout" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceBlackout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "offerId" TEXT,
    "buyerPubkey" TEXT NOT NULL,
    "sellerPubkey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "priceSats" INTEGER,
    "requestEventId" TEXT,
    "bookingEventId" TEXT,
    "eventCreatedAt" TIMESTAMP(3),
    "holdExpiresAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookableResource_calendarD_key" ON "BookableResource"("calendarD");

-- CreateIndex
CREATE UNIQUE INDEX "BookableResource_nostrEventId_key" ON "BookableResource"("nostrEventId");

-- CreateIndex
CREATE INDEX "BookableResource_ownerPubkey_isActive_idx" ON "BookableResource"("ownerPubkey", "isActive");

-- CreateIndex
CREATE INDEX "BookableResource_kind_idx" ON "BookableResource"("kind");

-- CreateIndex
CREATE INDEX "ResourceAvailabilityRule_resourceId_ruleKind_idx" ON "ResourceAvailabilityRule"("resourceId", "ruleKind");

-- CreateIndex
CREATE INDEX "ResourceBlackout_resourceId_start_idx" ON "ResourceBlackout"("resourceId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_requestEventId_key" ON "Booking"("requestEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_bookingEventId_key" ON "Booking"("bookingEventId");

-- CreateIndex
CREATE INDEX "Booking_resourceId_start_idx" ON "Booking"("resourceId", "start");

-- CreateIndex
CREATE INDEX "Booking_sellerPubkey_status_idx" ON "Booking"("sellerPubkey", "status");

-- CreateIndex
CREATE INDEX "Booking_buyerPubkey_status_idx" ON "Booking"("buyerPubkey", "status");

-- CreateIndex
CREATE INDEX "Offer_resourceId_idx" ON "Offer"("resourceId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "BookableResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceAvailabilityRule" ADD CONSTRAINT "ResourceAvailabilityRule_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "BookableResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBlackout" ADD CONSTRAINT "ResourceBlackout_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "BookableResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "BookableResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
