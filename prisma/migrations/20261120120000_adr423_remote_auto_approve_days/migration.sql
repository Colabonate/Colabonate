-- ADR-423 — remote-candidate auto-approval timer. Nullable int on the
-- FoundationSettings singleton (id = 1): when set (1–29), the
-- runRemoteAutoApproveTick approves PENDING_REVIEW candidates older than
-- N days; null = timer off. remoteCandidatesAutoApprove (immediate mode)
-- takes precedence over the timer. Both default off — curation stays manual
-- until an admin flips a switch.

ALTER TABLE "FoundationSettings"
    ADD COLUMN "remoteCandidatesAutoApproveDays" INTEGER;
