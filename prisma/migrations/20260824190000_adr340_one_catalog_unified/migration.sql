-- ADR-340: One Catalog for Products and Agent Setups.
-- Fold AgentCatalog + AgentCatalogMember into the typed Catalog +
-- CatalogAgentMember. Make Catalog.companyId nullable; add catalogType +
-- ownerPubkey. Add AgentProfile.deletedAt for soft delete (D4).

-- CreateEnum
CREATE TYPE "CatalogType" AS ENUM ('PRODUCT', 'AGENT_SETUP');

-- CreateTable: CatalogAgentMember (created empty; populated below from the
-- fold of AgentCatalogMember).
CREATE TABLE "CatalogAgentMember" (
    "catalogId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogAgentMember_pkey" PRIMARY KEY ("catalogId","agentProfileId")
);
CREATE INDEX "CatalogAgentMember_agentProfileId_idx" ON "CatalogAgentMember"("agentProfileId");

-- AlterTable: Catalog — add catalogType (default PRODUCT so existing rows
-- land in the product bucket), ownerPubkey (nullable), drop NOT NULL on
-- companyId. Done in this order so the NOT NULL with default is valid.
ALTER TABLE "Catalog" ADD COLUMN "catalogType" "CatalogType" NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE "Catalog" ADD COLUMN "ownerPubkey" TEXT;
ALTER TABLE "Catalog" ALTER COLUMN "companyId" DROP NOT NULL;

-- Fold AgentCatalog rows into Catalog (preserve id, name, category, timestamps;
-- null companyId; copy ownerPubkey).
INSERT INTO "Catalog" (
  "id", "companyId", "ownerPubkey", "catalogType", "standardCategoryId",
  "name", "description", "isActive", "createdAt", "updatedAt"
)
SELECT
  ac."id",
  NULL,
  ac."ownerPubkey",
  'AGENT_SETUP'::"CatalogType",
  ac."standardCategoryId",
  ac."name",
  NULL,
  true,
  ac."createdAt",
  ac."updatedAt"
FROM "AgentCatalog" ac;

-- Fold AgentCatalogMember rows into CatalogAgentMember.
INSERT INTO "CatalogAgentMember" ("catalogId", "agentProfileId", "addedAt")
SELECT acm."agentCatalogId", acm."agentProfileId", acm."addedAt"
FROM "AgentCatalogMember" acm;

-- CreateIndex: Catalog — name uniqueness per axis (Postgres treats NULLs as
-- distinct, so PRODUCT rows unique by companyId+name, AGENT_SETUP rows unique
-- by ownerPubkey+name; cross-axis rows never collide).
CREATE UNIQUE INDEX "Catalog_companyId_name_key" ON "Catalog"("companyId", "name");
CREATE UNIQUE INDEX "Catalog_ownerPubkey_name_key" ON "Catalog"("ownerPubkey", "name");
CREATE INDEX "Catalog_companyId_idx" ON "Catalog"("companyId");
CREATE INDEX "Catalog_ownerPubkey_idx" ON "Catalog"("ownerPubkey");
CREATE INDEX "Catalog_catalogType_idx" ON "Catalog"("catalogType");

-- AddForeignKey: Catalog.owner → User
ALTER TABLE "Catalog" ADD CONSTRAINT "Catalog_ownerPubkey_fkey" FOREIGN KEY ("ownerPubkey") REFERENCES "User"("pubkey") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CatalogAgentMember
ALTER TABLE "CatalogAgentMember" ADD CONSTRAINT "CatalogAgentMember_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogAgentMember" ADD CONSTRAINT "CatalogAgentMember_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropTable: AgentCatalog + AgentCatalogMember (fold complete).
DROP TABLE "AgentCatalogMember";
DROP TABLE "AgentCatalog";

-- AlterTable: AgentProfile.deletedAt + index (ADR-340 D4 soft delete).
ALTER TABLE "AgentProfile" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "AgentProfile_deletedAt_idx" ON "AgentProfile"("deletedAt");