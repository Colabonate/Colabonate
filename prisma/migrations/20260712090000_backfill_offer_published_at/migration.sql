-- Backfill publishedAt for ACTIVE offers created through the catalog endpoints
-- (POST /api/catalog/:id/products and .../products/:productId/offers), which
-- never set it. /api/offers orders by publishedAt DESC, so these offers were
-- missing from the first page of the marketplace. createdAt is the best
-- available estimate of the original publish time.
UPDATE "Offer"
SET "publishedAt" = "createdAt"
WHERE "status" = 'ACTIVE'
  AND "publishedAt" IS NULL;
