-- AlterTable
-- ADR-394: purchased unit count. amountSats remains the total (priceSats × quantity);
-- quantity lets the seller know how many units to deliver. Additive + defaulted,
-- so existing rows keep their historical 1-unit meaning.
ALTER TABLE "Ticket" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
