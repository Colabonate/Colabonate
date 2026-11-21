-- ADR-394 follow-ups. All additive + defaulted/nullable: existing rows keep
-- their meaning (no reservation, no checkout group, unknown fee issuer).

-- FU-841: units of Offer.stock reserved by the ticket (released by the stock tick).
ALTER TABLE "Ticket" ADD COLUMN "stockReserved" INTEGER NOT NULL DEFAULT 0;

-- FU-840: random key grouping the tickets of one cart checkout.
ALTER TABLE "Ticket" ADD COLUMN "checkoutId" TEXT;
CREATE INDEX "Ticket_checkoutId_idx" ON "Ticket"("checkoutId");

-- FU-838: settlement source of the hosted-canvas fee LN leg.
ALTER TABLE "TicketPlatformFee" ADD COLUMN "issuer" TEXT;
ALTER TABLE "TicketPlatformFee" ADD COLUMN "verifyUrl" TEXT;
