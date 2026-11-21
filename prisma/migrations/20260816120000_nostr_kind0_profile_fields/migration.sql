-- Nostr Kind 0 profile fields (name, about, banner) on User.
-- Display-only metadata, synced fill-once from relays via
-- POST /api/identity/sync-nostr-profile. Nullable → no Bestandsdaten risk.

ALTER TABLE "User" ADD COLUMN "name" TEXT;
ALTER TABLE "User" ADD COLUMN "about" TEXT;
ALTER TABLE "User" ADD COLUMN "banner" TEXT;
