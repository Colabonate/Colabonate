-- CreateTable
CREATE TABLE "AgentCatalog" (
    "id" TEXT NOT NULL,
    "ownerPubkey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "standardCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCatalogMember" (
    "agentCatalogId" TEXT NOT NULL,
    "agentProfileId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCatalogMember_pkey" PRIMARY KEY ("agentCatalogId","agentProfileId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCatalog_ownerPubkey_name_key" ON "AgentCatalog"("ownerPubkey", "name");

-- AddForeignKey
ALTER TABLE "AgentCatalog" ADD CONSTRAINT "AgentCatalog_ownerPubkey_fkey" FOREIGN KEY ("ownerPubkey") REFERENCES "User"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCatalog" ADD CONSTRAINT "AgentCatalog_standardCategoryId_fkey" FOREIGN KEY ("standardCategoryId") REFERENCES "StandardCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCatalogMember" ADD CONSTRAINT "AgentCatalogMember_agentCatalogId_fkey" FOREIGN KEY ("agentCatalogId") REFERENCES "AgentCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCatalogMember" ADD CONSTRAINT "AgentCatalogMember_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "AgentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
