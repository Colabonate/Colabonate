-- ADR-384 D11: MCP access passes + one-time trial
ALTER TABLE "McpConnection" ADD COLUMN "passTier" TEXT;

CREATE TABLE "McpAccessPass" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "rail" TEXT NOT NULL,
    "invoice" TEXT,
    "paymentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "McpAccessPass_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "McpAccessPass_pubkey_status_expiresAt_idx" ON "McpAccessPass"("pubkey", "status", "expiresAt");

CREATE TABLE "McpTrial" (
    "pubkey" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpTrial_pkey" PRIMARY KEY ("pubkey")
);
