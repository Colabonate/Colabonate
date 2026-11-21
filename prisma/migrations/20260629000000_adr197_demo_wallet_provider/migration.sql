-- ADR-197: Beta Mode — add DEMO to WalletProvider enum
-- This value is only used when BETA_MODE=true (never on NODE_ENV=production).

ALTER TYPE "WalletProvider" ADD VALUE 'DEMO';
