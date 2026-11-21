-- ADR-152: Private Trade Mode — TradeVisibility + DisputeMode enums
-- ADR-152 §A4 / PROB-002 A2: PrivateArbiter table for mutual-arbiter pattern
--
-- This migration:
--   1. Creates the TradeVisibility and DisputeMode enums
--   2. Adds visibility + disputeMode columns to Offer, Cooperation, Ticket
--      (all default PUBLIC — no breaking change for existing rows)
--   3. Creates the PrivateArbiter table for the mutual-arbiter dispute pattern
--
-- Existing rows: all get visibility='PUBLIC' and disputeMode='PUBLIC' by default.
-- This preserves the current behavior: full reputation, DAO-Council dispute.
--
-- Idempotency: NOT idempotent. Re-running will fail with "type already exists".

-- 1. New enums --------------------------------------------------------------

CREATE TYPE "TradeVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "DisputeMode" AS ENUM ('PUBLIC', 'PRIVATE', 'NONE');

-- 2. Offer -----------------------------------------------------------------

ALTER TABLE "Offer" ADD COLUMN "visibility"  "TradeVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Offer" ADD COLUMN "disputeMode" "DisputeMode"     NOT NULL DEFAULT 'PUBLIC';

CREATE INDEX "Offer_visibility_idx" ON "Offer" ("visibility");
CREATE INDEX "Offer_disputeMode_idx" ON "Offer" ("disputeMode");

-- 3. Cooperation -----------------------------------------------------------

ALTER TABLE "Cooperation" ADD COLUMN "visibility"  "TradeVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Cooperation" ADD COLUMN "disputeMode" "DisputeMode"     NOT NULL DEFAULT 'PUBLIC';

CREATE INDEX "Cooperation_visibility_idx" ON "Cooperation" ("visibility");
CREATE INDEX "Cooperation_disputeMode_idx" ON "Cooperation" ("disputeMode");

-- 4. Ticket ----------------------------------------------------------------

ALTER TABLE "Ticket" ADD COLUMN "visibility"  "TradeVisibility" NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Ticket" ADD COLUMN "disputeMode" "DisputeMode"     NOT NULL DEFAULT 'PUBLIC';

CREATE INDEX "Ticket_visibility_idx" ON "Ticket" ("visibility");
CREATE INDEX "Ticket_disputeMode_idx" ON "Ticket" ("disputeMode");

-- 5. PrivateArbiter (PROB-002 A2) ------------------------------------------

CREATE TABLE "PrivateArbiter" (
  "id"                  TEXT NOT NULL,
  "ticketId"            TEXT NOT NULL,
  "arbiterPubkey"       TEXT NOT NULL,
  "nominatedByBuyer"    BOOLEAN NOT NULL DEFAULT false,
  "nominatedBySeller"   BOOLEAN NOT NULL DEFAULT false,
  "acceptedAt"          TIMESTAMP(3),
  "rejectedAt"          TIMESTAMP(3),
  "verdictNostrEventId" TEXT,
  "verdictOutcome"      TEXT,            -- RELEASE | CANCEL | SPLIT
  "verdictReasoning"    TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrivateArbiter_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one nomination row per (ticket, arbiter)
CREATE UNIQUE INDEX "PrivateArbiter_ticketId_arbiterPubkey_key"
  ON "PrivateArbiter" ("ticketId", "arbiterPubkey");

CREATE INDEX "PrivateArbiter_ticketId_idx"     ON "PrivateArbiter" ("ticketId");
CREATE INDEX "PrivateArbiter_arbiterPubkey_idx" ON "PrivateArbiter" ("arbiterPubkey");

-- Foreign key: Ticket → PrivateArbiter (cascade on delete)
ALTER TABLE "PrivateArbiter"
  ADD CONSTRAINT "PrivateArbiter_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
