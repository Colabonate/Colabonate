-- ADR-342 Phase B (D3, review amendment A2): doop-hosted collaboration
-- canvas binding on Workspace. All columns nullable, null-by-default
-- preserves "doesn't apply" (ADR-331 D1 discipline).
-- Note: amendment A3 planned a bundled migration with ADR-343's buzzChannelId
-- columns; ADR-343 is still `proposed` (no build started), so the canvas
-- columns ship alone and the Buzz columns follow with ADR-343 Phase A.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "canvasId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "canvasProvider" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "canvasProvisioningStatus" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "canvasBuyerAccess" TEXT;
