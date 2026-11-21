-- ADR-156: GDPR Art. 17 (Right to Erasure) — anonymized audit trail for
-- account deletion. Stores a NON-reidentifiable record (SHA-256 hash of the
-- deleted pubkey, NOT the plaintext pubkey) so regulators can verify erasure
-- without Colabonate retaining personal data.
--
-- Why hash-only (no plaintext pubkey column): the pubkey is a persistent
-- personal identifier under GDPR. The ADR's stated goal is "User ist nicht
-- re-identifizierbar", so we store only SHA-256(pubkey). Lookups re-hash the
-- queried pubkey and match on userPubkeyHash.
--
-- Lifecycle: created with completedAt=NULL when deletion starts; the cascade
-- + audit write happen synchronously in the same request, so completedAt is
-- set immediately. The nip09* / relayResponses columns are updated later via
-- the client ACK endpoint once the user has signed + published the Kind 5
-- deletion request via NIP-07 (the server never holds the privkey — ADR-141).
--
-- trigger = "USER" (self-service) | "ADMIN" (hard cases, adminPubkey set).
--
-- Idempotency: NOT idempotent. Re-running will fail with "relation already exists".

CREATE TABLE "AccountDeletionLog" (
    "id"                TEXT NOT NULL,
    "userPubkeyHash"    TEXT NOT NULL,
    "trigger"           TEXT NOT NULL DEFAULT 'USER',
    "adminPubkey"       TEXT,
    "requestedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"       TIMESTAMP(3),
    "deletedEntities"   JSONB NOT NULL,
    "eventIdsToDelete"  JSONB NOT NULL DEFAULT '[]'::jsonb,
    "nip09Kind5EventId" TEXT,
    "nip09RelaysOk"     INTEGER NOT NULL DEFAULT 0,
    "relayResponses"    JSONB NOT NULL DEFAULT '{}'::jsonb,
    "gdprLegalBasis"    TEXT NOT NULL DEFAULT 'Art. 17 DSGVO – Right to Erasure',
    CONSTRAINT "AccountDeletionLog_pkey" PRIMARY KEY ("id")
);

-- Regulator verification lookup (re-hash queried pubkey, match here).
CREATE INDEX "AccountDeletionLog_userPubkeyHash_idx"
    ON "AccountDeletionLog" ("userPubkeyHash");

-- Time-bounded audits ("show all deletions in Q2").
CREATE INDEX "AccountDeletionLog_requestedAt_idx"
    ON "AccountDeletionLog" ("requestedAt");
