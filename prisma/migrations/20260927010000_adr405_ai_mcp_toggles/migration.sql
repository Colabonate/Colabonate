-- ADR-405 — runtime sales & visibility switches for the AI Assistant and MCP
-- surfaces. Four close-only / hide-only booleans on the FoundationSettings
-- singleton (id = 1). The env gates (AI_HOSTED_ENABLED, MCP_PAYWALL_ENABLED)
-- stay authoritative; these flags can only narrow, never widen (ADR-402 D7/D9).
-- All default false → behaviour is unchanged until an admin flips a switch.

ALTER TABLE "FoundationSettings"
    ADD COLUMN "aiSalesPaused" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "mcpSalesPaused" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "aiAssistantSectionHidden" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "mcpSectionHidden" BOOLEAN NOT NULL DEFAULT false;
