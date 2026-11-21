-- ADR-415: origin URL (`r` tag) of a REMOTE listing
-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "originUrl" TEXT;
