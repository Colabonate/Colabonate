-- CreateTable
CREATE TABLE "OfferMember" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferMember_offerId_status_idx" ON "OfferMember"("offerId", "status");

-- CreateIndex
CREATE INDEX "OfferMember_pubkey_idx" ON "OfferMember"("pubkey");

-- CreateIndex
CREATE UNIQUE INDEX "OfferMember_offerId_pubkey_key" ON "OfferMember"("offerId", "pubkey");

-- AddForeignKey
ALTER TABLE "OfferMember" ADD CONSTRAINT "OfferMember_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
