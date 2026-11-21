-- ADR-402 D16: newsletter consent proof (GDPR Art. 7(1)).
--
-- Backfill rules:
--   * Rows that came from a newsletter form (footer etc.) and were not opted
--     out carry consent: the person typed their address into a newsletter
--     signup. consentAt = when they confirmed (or signed up, if still pending).
--   * ADR-401 D2 'account-signup' rows were created automatically on account
--     creation, without a checkbox — no consent. They are removed unless they
--     are UNSUBSCRIBED (those stay as suppression entries).

-- AlterTable
ALTER TABLE "NewsletterSubscriber"
  ADD COLUMN "consentAt" TIMESTAMP(3),
  ADD COLUMN "consentSource" TEXT,
  ADD COLUMN "consentTextVersion" TEXT;

-- Backfill consent for form signups.
UPDATE "NewsletterSubscriber"
SET
  "consentAt" = COALESCE("confirmedAt", "createdAt"),
  "consentSource" = 'footer',
  "consentTextVersion" = 'adr400-footer'
WHERE "source" <> 'account-signup'
  AND "status" <> 'UNSUBSCRIBED';

-- Drop automatic account-signup rows that never had consent.
DELETE FROM "NewsletterSubscriber"
WHERE "source" = 'account-signup'
  AND "status" <> 'UNSUBSCRIBED';
