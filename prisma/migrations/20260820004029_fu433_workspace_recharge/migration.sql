-- CreateTable
CREATE TABLE "WorkspaceRecharge" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "amountSats" INTEGER NOT NULL,
    "paymentHash" TEXT NOT NULL,
    "bolt11" TEXT,
    "rail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "relayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceRecharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceRecharge_paymentHash_key" ON "WorkspaceRecharge"("paymentHash");

-- CreateIndex
CREATE INDEX "WorkspaceRecharge_workspaceId_status_idx" ON "WorkspaceRecharge"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "WorkspaceRecharge" ADD CONSTRAINT "WorkspaceRecharge_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
