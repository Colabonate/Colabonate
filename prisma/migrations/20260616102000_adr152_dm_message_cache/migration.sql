-- ADR-152 §4.1: DmMessage cache table for private-mode DM history.
-- Stores decrypted message content for the recipient (ownerPubkey) so the
-- server can render an inbox without each client scanning the relay.
--
-- Datenschutz: indexed on (ownerPubkey, createdAt) so cross-user lookups
-- are not possible without a separate explicit query. The Nostr relay
-- remains the source of truth; this is a cache for inbox rendering and
-- device-switching.
--
-- Idempotency: NOT idempotent. Re-running will fail with "relation already exists".

CREATE TABLE "DmMessage" (
  "id"          TEXT NOT NULL,
  "ownerPubkey" TEXT NOT NULL,
  "peerPubkey"  TEXT NOT NULL,
  "eventId"     TEXT NOT NULL,
  "kind"        INTEGER NOT NULL,
  "payload"     TEXT NOT NULL,
  "ticketId"    TEXT,
  "visibility"  "TradeVisibility" NOT NULL DEFAULT 'PRIVATE',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DmMessage_pkey" PRIMARY KEY ("id")
);

-- Unique on the relay event id so we never double-cache the same gift wrap.
CREATE UNIQUE INDEX "DmMessage_eventId_key" ON "DmMessage" ("eventId");

-- Inbox listing (newest first) + per-peer thread view.
CREATE INDEX "DmMessage_ownerPubkey_createdAt_idx"
  ON "DmMessage" ("ownerPubkey", "createdAt" DESC);

CREATE INDEX "DmMessage_ownerPubkey_peerPubkey_createdAt_idx"
  ON "DmMessage" ("ownerPubkey", "peerPubkey", "createdAt" DESC);

-- Optional ticket context (for ticket-scoped chat)
CREATE INDEX "DmMessage_ticketId_idx" ON "DmMessage" ("ticketId");
