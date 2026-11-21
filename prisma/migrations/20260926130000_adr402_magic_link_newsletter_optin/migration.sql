-- ADR-402 D16.3: bind the newsletter opt-in to the magic-link token that
-- carried it. The unauthenticated /api/auth/email/send no longer writes a
-- subscriber row; the opt-in waits here until that exact token is verified.
ALTER TABLE "User" ADD COLUMN "magicLinkNewsletterOptIn" TEXT;
