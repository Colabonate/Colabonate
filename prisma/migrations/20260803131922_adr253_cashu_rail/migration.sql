-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "cashuMintUrl" TEXT,
ADD COLUMN     "cashuSellerPubkey" TEXT,
ADD COLUMN     "directPayRail" TEXT;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "cashuReceiveMintUrl" TEXT,
ADD COLUMN     "cashuReceivePubkey" TEXT;
