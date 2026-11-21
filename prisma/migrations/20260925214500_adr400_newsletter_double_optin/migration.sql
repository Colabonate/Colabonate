-- ADR-400: Newsletter double opt-in (NewsletterSubscriber).
--
-- Existing rows predate double opt-in. They signed up under the single-opt-in
-- contract, so they are treated as CONFIRMED (or UNSUBSCRIBED if they already
-- opted out) and get a token backfilled, rather than being dropped or left in
-- PENDING. Tokens are random (gen_random_uuid) because Prisma's `cuid()`
-- default is client-side only and cannot backfill existing rows.

-- CreateEnum
CREATE TYPE "NewsletterStatus" AS ENUM ('PENDING', 'CONFIRMED', 'UNSUBSCRIBED');

-- AlterTable (nullable first so existing rows survive)
ALTER TABLE "NewsletterSubscriber"
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "pubkey" TEXT,
  ADD COLUMN "status" "NewsletterStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "token" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: mint a token per row and preserve the opt-out state.
UPDATE "NewsletterSubscriber"
SET
  "token" = replace(gen_random_uuid()::text, '-', ''),
  "status" = CASE
    WHEN "unsubscribedAt" IS NOT NULL THEN 'UNSUBSCRIBED'::"NewsletterStatus"
    ELSE 'CONFIRMED'::"NewsletterStatus"
  END,
  "confirmedAt" = CASE
    WHEN "unsubscribedAt" IS NOT NULL THEN NULL
    ELSE "createdAt"
  END;

ALTER TABLE "NewsletterSubscriber" ALTER COLUMN "token" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_token_key" ON "NewsletterSubscriber"("token");

-- CreateIndex
CREATE INDEX "NewsletterSubscriber_status_createdAt_idx" ON "NewsletterSubscriber"("status", "createdAt");
