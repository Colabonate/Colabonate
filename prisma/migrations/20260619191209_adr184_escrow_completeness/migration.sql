-- AlterTable
ALTER TABLE "ArbitrationVerdict" ADD COLUMN     "buyerPct" INTEGER,
ADD COLUMN     "feePct" INTEGER,
ADD COLUMN     "feeRecipient" TEXT,
ADD COLUMN     "feeSats" INTEGER,
ADD COLUMN     "sellerPct" INTEGER;

-- AlterTable
ALTER TABLE "DaoConfig" ADD COLUMN     "escrowFeeRecipient" TEXT;

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "phase2WindowHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "useEscrow" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PrivateArbiter" ADD COLUMN     "buyerPct" INTEGER,
ADD COLUMN     "feePct" INTEGER,
ADD COLUMN     "feeRecipient" TEXT,
ADD COLUMN     "feeSats" INTEGER,
ADD COLUMN     "sellerPct" INTEGER;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "escrowAutoReleaseDeadline" TIMESTAMP(3),
ADD COLUMN     "escrowEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "escrowPhase1Deadline" TIMESTAMP(3),
ADD COLUMN     "escrowPhase2Deadline" TIMESTAMP(3),
ADD COLUMN     "escrowPhase3Deadline" TIMESTAMP(3);
