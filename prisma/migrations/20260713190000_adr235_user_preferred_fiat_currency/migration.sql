-- ADR-235: account-level fiat display preference (EUR/USD/RUB/JPY).
-- Sats remain the single source of truth; this column only stores which fiat
-- currency to show next to sats amounts across devices. Defaults to EUR to
-- match the prior localStorage `primaryCurrency` default.
ALTER TABLE "User" ADD COLUMN "preferredFiatCurrency" TEXT NOT NULL DEFAULT 'EUR';
