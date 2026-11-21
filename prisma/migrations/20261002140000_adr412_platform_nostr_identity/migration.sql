-- ADR-412 FU-948: stable platform-level Nostr signing identity for
-- bidirectional transaction mirror events (Ticket/Cooperation/Milestone/
-- Dispute), where neither buyer nor seller is the sole "author". Stored on
-- the existing FoundationSettings singleton (id=1). Private key material is
-- encrypted at rest (apps/server/lib/secretbox.ts).

-- AlterTable
ALTER TABLE "FoundationSettings" ADD COLUMN     "platformNostrPrivkeyEnc" TEXT,
ADD COLUMN     "platformNostrPubkey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FoundationSettings_platformNostrPubkey_key" ON "FoundationSettings"("platformNostrPubkey");
