-- CreateTable
CREATE TABLE "UserAiConfig" (
    "pubkey" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "baseUrl" TEXT,
    "model" TEXT,
    "apiKeyEncrypted" TEXT,
    "adapterId" TEXT,
    "runtime" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAiConfig_pkey" PRIMARY KEY ("pubkey")
);
