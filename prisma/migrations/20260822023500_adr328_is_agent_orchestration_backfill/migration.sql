-- ADR-328 D4: separate backfill migration — the original
-- 20260822022451_adr328_cooperation_is_agent_orchestration migration only
-- contains the ALTER TABLE (matches the checksum Prisma already recorded as
-- applied to the dev DB). The backfill UPDATE was added after apply; rather
-- than reset the DB to align checksums, it lives here as its own idempotent
-- migration. Same semantic as the runtime snapshot in apps/server/index.ts
-- POST /api/cooperations — 'true' iff any CoopMilestone of this Cooperation
-- has an assigned AgentProfile. Re-running on an already-backfilled DB
-- touches 0 rows.
UPDATE "Cooperation" c
SET    "isAgentOrchestration" = true
WHERE  c."isAgentOrchestration" = false
  AND  EXISTS (
    SELECT 1 FROM "CoopMilestone" m
      WHERE m."cooperationId" = c.id
        AND m."assigneeAgentProfileId" IS NOT NULL
  );
