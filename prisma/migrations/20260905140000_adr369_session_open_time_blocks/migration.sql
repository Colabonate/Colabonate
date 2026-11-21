-- AlterTable: ADR-369 SESSION open-window time blocks.
-- bookingStyle: FIXED (default, ADR-271 behaviour) | OPEN (buyer picks start + duration).
-- slotMinutes: start-time grid step for OPEN resources (v1: 60).

ALTER TABLE "BookableResource" ADD COLUMN "bookingStyle" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "BookableResource" ADD COLUMN "slotMinutes" INTEGER NOT NULL DEFAULT 60;
