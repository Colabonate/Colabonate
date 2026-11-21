/*
  Warnings:

  - You are about to drop the column `freeQuotaGrantedSats` on the `Workspace` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "estimatedWorkspaceHours" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Workspace" DROP COLUMN "freeQuotaGrantedSats";

-- AlterTable
ALTER TABLE "WorkspaceRecharge" ADD COLUMN     "isMandatoryInitial" BOOLEAN NOT NULL DEFAULT false;
