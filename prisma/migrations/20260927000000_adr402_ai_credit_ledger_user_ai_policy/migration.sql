-- ADR-402 D2/D7 (Phase 2 slice) — append-only AI-credit movement ledger +
-- per-identity AI/MCP policy. No sats balance: request entitlements only.

CREATE TABLE "AiCreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT,
    "guestSessionId" TEXT,
    "delta" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "actorPubkey" TEXT,
    "purchaseId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiCreditLedgerEntry_idempotencyKey_key" ON "AiCreditLedgerEntry"("idempotencyKey");
CREATE INDEX "AiCreditLedgerEntry_pubkey_createdAt_idx" ON "AiCreditLedgerEntry"("pubkey", "createdAt");
CREATE INDEX "AiCreditLedgerEntry_guestSessionId_createdAt_idx" ON "AiCreditLedgerEntry"("guestSessionId", "createdAt");

CREATE TABLE "UserAiPolicy" (
    "pubkey" TEXT NOT NULL,
    "hostedAccess" TEXT NOT NULL DEFAULT 'DEFAULT',
    "mcpAccess" TEXT NOT NULL DEFAULT 'DEFAULT',
    "mcpMaxPassHours" INTEGER,
    "note" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserAiPolicy_pkey" PRIMARY KEY ("pubkey")
);

-- Backfill: one PURCHASE ledger row per already-PAID, identity-owned purchase.
INSERT INTO "AiCreditLedgerEntry" ("id", "pubkey", "delta", "kind", "purchaseId", "idempotencyKey", "createdAt")
SELECT
    'purchase-' || p."id",
    p."pubkey",
    p."requests",
    'PURCHASE',
    p."id",
    'purchase:' || p."id",
    COALESCE(p."confirmedAt", p."createdAt")
FROM "AiCreditPurchase" p
WHERE p."status" = 'PAID' AND p."pubkey" IS NOT NULL;

-- Backfill: a reconciliation GRANT closes any remaining gap so the invariant
-- (sum(delta) − requestsUsed = requestsRemaining) holds from day one.
INSERT INTO "AiCreditLedgerEntry" ("id", "pubkey", "delta", "kind", "reason", "idempotencyKey", "createdAt")
SELECT
    'recon-' || b."pubkey",
    b."pubkey",
    (b."requestsRemaining" + b."requestsUsed") - COALESCE(led."total", 0),
    'GRANT',
    'backfill-reconciliation',
    'recon:' || b."pubkey",
    CURRENT_TIMESTAMP
FROM "AiCreditBalance" b
LEFT JOIN (
    SELECT "pubkey", SUM("delta") AS "total"
    FROM "AiCreditLedgerEntry"
    WHERE "pubkey" IS NOT NULL
    GROUP BY "pubkey"
) led ON led."pubkey" = b."pubkey"
WHERE (b."requestsRemaining" + b."requestsUsed") - COALESCE(led."total", 0) <> 0;
