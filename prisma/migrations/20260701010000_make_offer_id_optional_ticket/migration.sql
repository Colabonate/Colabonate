-- ADR-204: Make offerId optional on Ticket (xor with cooperationId).
-- Cooperation tickets have no offerId; offer tickets have no cooperationId.
-- Enforced at API level (schema cannot express "at least one of" constraints).

-- Drop the required NOT NULL constraint on offerId
ALTER TABLE "Ticket" ALTER COLUMN "offerId" DROP NOT NULL;

-- Drop the required FK constraint (re-add as nullable below)
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_offerId_fkey";

-- Re-add the FK as nullable (CASCADE SET NULL means if an Offer is deleted,
-- the Ticket's offerId becomes NULL — useful for archived offers)
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "Offer"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
