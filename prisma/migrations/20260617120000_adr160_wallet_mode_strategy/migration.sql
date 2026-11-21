-- ADR-160 (PROB-003 B-γ): per-user wallet-mode strategy.
-- resolveWalletMode(strategy, tradeVisibility) is the single decision function
-- (apps/server/services/walletStrategy.ts). Consulted at wallet provisioning
-- (apps/server/routes/wallet.ts) and trade-time wallet selection.

-- AlterEnum
CREATE TYPE "WalletModeStrategy" AS ENUM ('HYBRID', 'CUSTODIAL_ONLY', 'NONCUSTODIAL_ONLY');

-- AddColumn
ALTER TABLE "User" ADD COLUMN "walletModeStrategy" "WalletModeStrategy" NOT NULL DEFAULT 'HYBRID';
