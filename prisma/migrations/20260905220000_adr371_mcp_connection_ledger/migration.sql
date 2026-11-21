-- ADR-371: MCP connection ledger (external-agent copy-prompt access).
-- McpConnection stores only sha256(token) hex; the raw 256-bit token is shown
-- once at mint and never persisted or logged (FU-195-C). Connections are
-- REST-inert (D7): only the public /mcp gateway and the internal relay use
-- them; the relay mints short-lived derived Session rows (kind='MCP') instead.
-- McpConnectionEvent is an append-only activity log per connection.
-- Session gains derived-relay marker columns (kind + mcpConnectionId).

-- CreateTable
CREATE TABLE "McpConnection" (
    "id" TEXT NOT NULL,
    "pubkey" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "McpConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpConnectionEvent" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tool" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "agentLabel" TEXT,

    CONSTRAINT "McpConnectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpConnection_tokenHash_key" ON "McpConnection"("tokenHash");

-- CreateIndex
CREATE INDEX "McpConnection_pubkey_idx" ON "McpConnection"("pubkey");

-- CreateIndex
CREATE INDEX "McpConnectionEvent_connectionId_ts_idx" ON "McpConnectionEvent"("connectionId", "ts");

-- AlterTable: derived relay session markers (ADR-371 D7)
ALTER TABLE "Session" ADD COLUMN "kind" TEXT;
ALTER TABLE "Session" ADD COLUMN "mcpConnectionId" TEXT;

-- CreateIndex
CREATE INDEX "Session_mcpConnectionId_idx" ON "Session"("mcpConnectionId");

-- AddForeignKey
ALTER TABLE "McpConnection" ADD CONSTRAINT "McpConnection_pubkey_fkey" FOREIGN KEY ("pubkey") REFERENCES "User"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpConnectionEvent" ADD CONSTRAINT "McpConnectionEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "McpConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
