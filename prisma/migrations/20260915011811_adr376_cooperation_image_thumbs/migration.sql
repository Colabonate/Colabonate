-- AlterTable
ALTER TABLE "Cooperation" ADD COLUMN     "imageThumbs" JSONB;

-- AlterTable
ALTER TABLE "McpConnection" ALTER COLUMN "scope" DROP DEFAULT;
