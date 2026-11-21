-- ADR-315 D3: Verified Agent Badge schema.
-- Foundation-admin-awarded audit badge on AgentProfile. Public-read exposes
-- isVerified + verifiedAt (displayed on the badge); verifiedByPubkey +
-- verificationNotes stay admin-only so the auditor's identity + audit notes
-- remain a private accountability trail.
ALTER TABLE "AgentProfile"
  ADD COLUMN "isVerified"        BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN "verifiedAt"        TIMESTAMP(3),
  ADD COLUMN "verifiedByPubkey"  TEXT,
  ADD COLUMN "verificationNotes" TEXT;

-- Cheap admin-list filter + per-owner "do I have any verified agents?" lookup.
CREATE INDEX "AgentProfile_isVerified_idx" ON "AgentProfile"("isVerified");
