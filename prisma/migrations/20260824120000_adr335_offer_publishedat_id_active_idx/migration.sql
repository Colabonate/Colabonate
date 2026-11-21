-- ADR-335 D1: partial keyset-pagination index for /api/search's DB-fallback
-- path. Every /api/search query carries `status = 'ACTIVE' AND "blockedAt"
-- IS NULL` (near-universal predicate), so a partial index restricted to that
-- predicate is smaller and cheaper to maintain on writes than a plain
-- composite @@index while covering the dominant query shape identically.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Prisma
-- wraps migrations in a transaction by default, so this statement is run
-- outside one via the `-- CreateIndex` marker Prisma recognizes for
-- concurrently-created indexes (see Prisma docs: "Prisma Migrate and
-- CREATE INDEX CONCURRENTLY").
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Offer_publishedAt_id_active_idx"
  ON "Offer" ("publishedAt" DESC, "id" DESC)
  WHERE "status" = 'ACTIVE' AND "blockedAt" IS NULL;
