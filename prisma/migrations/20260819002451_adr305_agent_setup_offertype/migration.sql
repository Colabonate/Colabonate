-- CreateEnum
CREATE TYPE "AgentBillingModel" AS ENUM ('ONE_TIME', 'PER_HOUR', 'PER_TOKEN', 'SUBSCRIPTION');

-- AlterEnum
ALTER TYPE "OfferType" ADD VALUE 'AGENT_SETUP';

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "agentBillingModel" "AgentBillingModel",
ADD COLUMN     "agentConfigMeta" JSONB,
ADD COLUMN     "agentConfigSealed" TEXT,
ADD COLUMN     "agentWorkspaceTTL" INTEGER DEFAULT 604800,
ADD COLUMN     "personaId" TEXT,
ADD COLUMN     "personaPackHash" TEXT,
ADD COLUMN     "personaPackRef" TEXT,
ADD COLUMN     "personaPackVersion" TEXT;
