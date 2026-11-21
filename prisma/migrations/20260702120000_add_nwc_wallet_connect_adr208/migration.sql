-- ADR-208: Nostr Wallet Connect (NIP-47) integration.
-- NWC is a non-custodial user spending wallet (a peer of WEBLN/CASHU), NOT a
-- platform PaymentProvider. All new columns are nullable → non-breaking.

-- 1. Add NWC to the WalletProvider enum.
ALTER TYPE "WalletProvider" ADD VALUE IF NOT EXISTS 'NWC';

-- 2. NWC connection fields on Wallet.
--    nwcConnectionUriEnc: AES-256-GCM ciphertext of nostr+walletconnect:// URI
--    (embeds a spend-capable ephemeral secret — encrypted at rest, never logged).
--    nwcWalletPubkey / nwcRelayUrls: non-secret, stored plaintext for display.
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "nwcConnectionUriEnc" TEXT;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "nwcWalletPubkey"     TEXT;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "nwcRelayUrls"        TEXT;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "nwcConnectedAt"      TIMESTAMP(3);
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "nwcLastSyncedAt"     TIMESTAMP(3);
