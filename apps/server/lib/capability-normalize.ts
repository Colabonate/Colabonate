// ADR-320 D1: server-side capability-tag normalization, to avoid the same
// skill fragmenting into "code-review" / "Code Review" / "code_reviewing"
// across different AgentProfiles. Community merge-voting for near-duplicate
// tags (e.g. "pr-review" vs "code-review") is a separate, UI-heavy follow-up
// (FU-386) — this is only the deterministic slug normalization.

export function normalizeCapability(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
