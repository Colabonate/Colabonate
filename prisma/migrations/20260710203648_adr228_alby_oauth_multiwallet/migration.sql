-- AlterEnum
ALTER TYPE "WalletProvider" ADD VALUE 'ALBY_OAUTH';

-- DropIndex
DROP INDEX "Wallet_userId_key";

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AlbyOauthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedAccess" TEXT NOT NULL,
    "encryptedRefresh" TEXT,
    "accessTokenLast4" TEXT NOT NULL,
    "refreshTokenLast4" TEXT,
    "expiresAt" TIMESTAMP(3),
    "grantedScopes" TEXT[],
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastRefreshedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "AlbyOauthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlbyOauthToken_userId_key" ON "AlbyOauthToken"("userId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_provider_key" ON "Wallet"("userId", "provider");

-- AddForeignKey
ALTER TABLE "AlbyOauthToken" ADD CONSTRAINT "AlbyOauthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

