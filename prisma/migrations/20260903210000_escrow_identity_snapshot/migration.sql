-- Escrow identity/contact snapshot (ADR-357 D2 + dispute position).
-- The partner cards on the trade detail view must show WHO is involved even if a
-- party later edits or deletes their Nostr profile. Captured at trade creation
-- and re-captured when a dispute opens; the dispute surface reads the frozen
-- value, never the live profile.

ALTER TABLE "EscrowTrade" ADD COLUMN "buyerIdentitySnapshot" JSONB;
ALTER TABLE "EscrowTrade" ADD COLUMN "sellerIdentitySnapshot" JSONB;
