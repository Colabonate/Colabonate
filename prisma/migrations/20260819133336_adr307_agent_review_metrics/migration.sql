-- AlterTable
ALTER TABLE "AgentProfile" ADD COLUMN     "reputationScore" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "AgentReviewMetrics" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "accuracy" INTEGER,
    "speed" INTEGER,
    "reliability" INTEGER,
    "quality" INTEGER,
    "wouldReuse" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentReviewMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentReviewMetrics_reviewId_key" ON "AgentReviewMetrics"("reviewId");

-- AddForeignKey
ALTER TABLE "AgentReviewMetrics" ADD CONSTRAINT "AgentReviewMetrics_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
