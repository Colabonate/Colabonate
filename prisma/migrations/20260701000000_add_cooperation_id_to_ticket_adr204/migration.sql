-- ADR-204: Cooperation Ticket Coverage
-- Phase 1: Add cooperationId to Ticket, escrowStatus to Cooperation, tickets relation to Cooperation.

-- 1. Add cooperationId to Ticket (unique, nullable — either offerId OR cooperationId must be set)
ALTER TABLE "Ticket" ADD COLUMN "cooperationId" TEXT;

CREATE UNIQUE INDEX "Ticket_cooperationId_key" ON "Ticket"("cooperationId")
  WHERE "cooperationId" IS NOT NULL;

-- 2. Add foreign key constraint (Ticket can reference a Cooperation)
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_cooperationId_fkey"
  FOREIGN KEY ("cooperationId") REFERENCES "Cooperation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Add escrowStatus tracking field to Cooperation (mirrors Ticket.escrowStatus)
ALTER TABLE "Cooperation" ADD COLUMN "escrowStatus" TEXT;

-- 4. Add tickets relation to Cooperation (implicit via the FK above)
-- No column needed; Prisma uses the FK on Ticket.cooperationId.
-- Add a comment for clarity:
COMMENT ON COLUMN "Ticket"."cooperationId" IS 'ADR-204: Either offerId OR cooperationId must be set. Enables the dispute flow for cooperations.';
COMMENT ON COLUMN "Cooperation"."escrowStatus" IS 'ADR-204: Tracks multi-phase escrow state for cooperation (FUNDED, RELEASE_PHASE_1, ..., RELEASED_FULL). Mirrors Ticket.escrowStatus.';
