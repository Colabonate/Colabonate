-- This is an empty migration.

-- ADR-139 Phase 3: Enable trigram extension for PostgreSQL full-text search fallback
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for title/description search (used by dbSearchFallback in search.ts)
CREATE INDEX IF NOT EXISTS idx_offer_title_trgm ON "Offer" USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_offer_description_trgm ON "Offer" USING gin (description gin_trgm_ops);