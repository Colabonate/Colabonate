-- ADR-372: hosted-canvas service fee (doop-hosted, Colabonate-operated).
--  - Ticket gains a fee snapshot (bps + sats) pinned at creation for
--    doop-hosted AGENT_SETUP tickets only (null otherwise) — same
--    denormalization discipline as agentBillingModel (ADR-312) and the canvas
--    binding (ADR-370 D2).
--  - TicketPlatformFee is the 1:1 collection record: the buyer pays this as a
--    SEPARATE invoice to Colabonate's own Lightning Address (never a deduction
--    from the seller's Direct-Pay invoice, ADR-253). rail: LN | DEMO.

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "hostedCanvasFeeBps" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN "hostedCanvasFeeSats" INTEGER;

-- CreateTable
CREATE TABLE "TicketPlatformFee" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "memo" TEXT NOT NULL,
    "rail" TEXT NOT NULL,
    "invoice" TEXT,
    "paymentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sellerLegConfirmedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketPlatformFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketPlatformFee_ticketId_key" ON "TicketPlatformFee"("ticketId");

-- AddForeignKey
ALTER TABLE "TicketPlatformFee" ADD CONSTRAINT "TicketPlatformFee_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
