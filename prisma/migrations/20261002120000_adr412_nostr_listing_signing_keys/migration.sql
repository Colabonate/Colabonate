-- ADR-412 D2: persistent per-entity Nostr signing key for marketplace-facing
-- listings (Offer/ProductCollection/ShippingOption via Company, or an
-- individual seller's own listings via User). Replaces the previous
-- behavior of signing every publish with a fresh, immediately-discarded
-- ephemeral key (FU-277-C). Private key material is encrypted at rest
-- (apps/server/lib/secretbox.ts) before being stored here.

ALTER TABLE "Company" ADD COLUMN "nostrListingPubkey" TEXT;
ALTER TABLE "Company" ADD COLUMN "nostrListingPrivkeyEnc" TEXT;
CREATE UNIQUE INDEX "Company_nostrListingPubkey_key" ON "Company"("nostrListingPubkey");

ALTER TABLE "User" ADD COLUMN "nostrListingPubkey" TEXT;
ALTER TABLE "User" ADD COLUMN "nostrListingPrivkeyEnc" TEXT;
CREATE UNIQUE INDEX "User_nostrListingPubkey_key" ON "User"("nostrListingPubkey");
