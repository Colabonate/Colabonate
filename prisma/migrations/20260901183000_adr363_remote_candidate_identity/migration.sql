-- ADR-363 D4: addressable-event identity for the Nostr ingestion pipeline.
-- RemoteOfferCandidate gains the NIP-99 `d`-tag; the compound unique
-- (remoteAuthor, remoteDTag) makes a re-published listing resolve to the SAME
-- candidate row instead of inserting a duplicate offer. Postgres treats NULLs
-- as distinct in unique constraints, so non-addressable events (remoteDTag =
-- null) keep their remoteEventId-unique identity unchanged.

-- AlterTable
ALTER TABLE "RemoteOfferCandidate" ADD COLUMN     "remoteDTag" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RemoteOfferCandidate_remoteAuthor_remoteDTag_key" ON "RemoteOfferCandidate"("remoteAuthor", "remoteDTag");

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "remoteDTag" TEXT;

-- CreateIndex (ADR-363 review fix): support the approveCandidate in-place
-- guard lookup by (creatorPubkey, remoteDTag).
CREATE INDEX "Offer_creatorPubkey_remoteDTag_idx" ON "Offer"("creatorPubkey", "remoteDTag");
