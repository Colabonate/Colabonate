-- ADR-370 Phase 4 (FU-673): canvas-agent-runner state on the Ticket.
-- The runner is a separate process acting as the MCP client for the seller's
-- configured agent on the ticket's doop-hosted canvas. These columns are the
-- server-side bookkeeping mirror only (the runner itself never writes Prisma):
--   agentRunnerSealed  — seller's NIP-44 re-seal of the persona to the runner's
--                        per-ticket pubkey (ciphertext relay only, ADR-306).
--   agentRunnerStatus  — 'none'|'starting'|'running'|'stopping'|'stopped'|'failed'
--   agentRunnerStartedAt / agentRunnerStoppedAt / agentRunnerLastError.
-- Nullable + null-default keeps non-AGENT_SETUP / no-agentInCanvas tickets clean.

ALTER TABLE "Ticket" ADD COLUMN "agentRunnerSealed" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "agentRunnerStatus" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "agentRunnerStartedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "agentRunnerStoppedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN "agentRunnerLastError" TEXT;
