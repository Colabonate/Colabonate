-- ADR-370 Phase 1 (FU-670): ticket-level doop canvas binding.
-- The canvas binding is snapshotted onto the Ticket at creation (all providers)
-- so the post-purchase ticket UI is independent of later offer edits (fix G3)
-- and doop-hosted provisioning can run auto-enqueued at the first transition to
-- PAID without requiring a Workspace row yet (fix G2). Nullable + null-by-default
-- preserves "doesn't apply" for non-AGENT_SETUP tickets (same discipline as the
-- ADR-342 Workspace columns / ADR-331 D1).

ALTER TABLE "Ticket" ADD COLUMN "canvasProvider" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "canvasInstanceUrl" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "canvasId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "canvasBuyerAccess" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "canvasProvisioningStatus" TEXT;
