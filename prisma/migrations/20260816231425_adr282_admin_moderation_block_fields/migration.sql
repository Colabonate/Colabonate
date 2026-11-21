-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedByPubkey" TEXT,
ADD COLUMN     "blockedReason" TEXT;

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedByPubkey" TEXT,
ADD COLUMN     "blockedReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedByPubkey" TEXT,
ADD COLUMN     "blockedReason" TEXT;
