-- ADR-301: index Cooperation(status, createdAt) for /api/cooperations/discover
-- The discover endpoint sorts cooperations by createdAt DESC filtered by
-- status='OPEN'. Without this index Postgres full-table-sorts the cooperation
-- table even at 10 rows (live measured 2-4 s response time on beta on 2026-08-18).
CREATE INDEX IF NOT EXISTS "Cooperation_status_createdAt_idx" ON "Cooperation"("status", "createdAt" DESC);