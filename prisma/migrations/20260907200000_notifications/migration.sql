-- Server-backed in-app notifications (feed read/managed via /api/notifications
-- and the MCP notification tools). Written server-side at ticket / cooperation
-- / dispute lifecycle events. Distinct from NotificationLog (council email
-- delivery audit).

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "ownerPubkey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "relatedId" TEXT,
    "actionUrl" TEXT,
    "meta" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_ownerPubkey_createdAt_idx" ON "Notification"("ownerPubkey", "createdAt");
CREATE INDEX "Notification_type_idx" ON "Notification"("type");
