-- AlterTable
ALTER TABLE "User" ADD COLUMN     "evmAddress" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_evmAddress_key" ON "User"("evmAddress");
