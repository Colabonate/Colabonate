-- CreateEnum
CREATE TYPE "DaoType" AS ENUM ('COMMUNITY', 'PROTOCOL', 'INVESTMENT', 'SERVICE', 'GRANT', 'SOCIAL', 'INDUSTRY', 'COLLECTOR');

-- CreateEnum
CREATE TYPE "MembershipType" AS ENUM ('OPEN', 'APPLICATION', 'INVITE_ONLY', 'TOKEN_GATED');

-- AlterTable
ALTER TABLE "Dao" ADD COLUMN     "bannerUrl" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "daoType" "DaoType" NOT NULL DEFAULT 'COMMUNITY',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "focusAreas" TEXT,
ADD COLUMN     "foundedAt" TIMESTAMP(3),
ADD COLUMN     "isOnlineOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "membershipType" "MembershipType" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "website" TEXT;
