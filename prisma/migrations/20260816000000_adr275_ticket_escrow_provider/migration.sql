-- ADR-275 / FU-253-E: discriminate a ticket's escrow mechanism (Direct-Pay
-- vs the legacy custodial hold-invoice stack vs the future ICP canister)
-- independently of the single escrowStatus vocabulary.
ALTER TABLE "Ticket" ADD COLUMN "escrowProvider" TEXT NOT NULL DEFAULT 'NONE';

COMMENT ON COLUMN "Ticket"."escrowProvider" IS 'ADR-253/FU-253-E: NONE | CUSTODIAL_LEGACY | ICP. Zod-validated at the app boundary (see apps/server/lib/enums.ts EscrowProviderSchema).';
