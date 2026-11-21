-- ADR-396 D3 (FU-851): pin the sealed agent config per booking.
ALTER TABLE "Ticket" ADD COLUMN "agentConfigSealedSnapshot" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "agentConfigHash" TEXT;
