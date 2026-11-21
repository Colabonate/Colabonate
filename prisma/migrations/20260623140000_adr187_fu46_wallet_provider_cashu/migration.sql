-- ADR-187 / FU-46: add CASHU to WalletProvider enum.
-- Metadata-only: the non-custodial Cashu wallet itself lives in NIP-60 events
-- on Nostr relays (D1 invariant — server never holds proofs). This enum value
-- lets server-side features recognise users who opted in via the client-side
-- VITE_CASHU_ENABLED + usePref gate. Revisit / extend when a server-side
-- Cashu feature (e.g. mint-down notifications) needs more than the marker.

ALTER TYPE "WalletProvider" ADD VALUE 'CASHU';
