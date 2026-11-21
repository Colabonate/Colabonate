-- AlterTable
ALTER TABLE "BetaFeedback" ADD COLUMN     "read" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "BetaFeedback_read_createdAt_idx" ON "BetaFeedback"("read", "createdAt");
