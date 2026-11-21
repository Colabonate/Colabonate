-- ADR-399: rail-complete ticket payment settlement
ALTER TABLE "Ticket" ADD COLUMN "sellerInvoiceSource" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "sellerVerifyUrl" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "cashuToken" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "cashuTokenSentAt" TIMESTAMP(3);
