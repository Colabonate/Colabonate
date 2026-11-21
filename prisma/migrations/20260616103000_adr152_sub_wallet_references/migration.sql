-- PROB-003 B-α: Sub-Wallet references for private-mode isolation.
-- All columns are nullable so PUBLIC offers/tickets/cooperations are unaffected.
-- The actual sub-wallet lives in the user's LNBits account and is identified
-- by its LNBits walletId. This schema just records the linkage.
--
-- Idempotency: NOT idempotent. Re-running will fail with "column already exists".

-- 1. Offer -----------------------------------------------------------------
ALTER TABLE "Offer" ADD COLUMN "lightningSubWalletId" TEXT;
CREATE INDEX "Offer_lightningSubWalletId_idx" ON "Offer" ("lightningSubWalletId");

-- 2. Ticket ----------------------------------------------------------------
ALTER TABLE "Ticket" ADD COLUMN "escrowSubWalletId" TEXT;
CREATE INDEX "Ticket_escrowSubWalletId_idx" ON "Ticket" ("escrowSubWalletId");

-- 3. Cooperation -----------------------------------------------------------
ALTER TABLE "Cooperation" ADD COLUMN "escrowSubWalletId" TEXT;
CREATE INDEX "Cooperation_escrowSubWalletId_idx" ON "Cooperation" ("escrowSubWalletId");
