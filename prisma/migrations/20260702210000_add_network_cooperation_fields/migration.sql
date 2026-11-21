-- Network-type cooperations (coopType=network): persist membership configuration
-- for provider networks created via the Coop Guide. All nullable → non-breaking
-- for existing/plain offers. Only populated when an offer represents a network.

ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "networkType"        TEXT;
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "membershipCriteria" TEXT;
ALTER TABLE "Offer" ADD COLUMN IF NOT EXISTS "maxMembers"         INTEGER;
