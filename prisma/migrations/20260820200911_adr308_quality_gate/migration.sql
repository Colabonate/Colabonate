-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "qualityApprovedAt" TIMESTAMP(3),
ADD COLUMN     "qualityGateRequired" BOOLEAN NOT NULL DEFAULT false;
