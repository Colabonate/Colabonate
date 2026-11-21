// ADR-371 D8 — per-session tool gate for the external /mcp gateway.
//
// The in-app AI adapter registers the FULL surface (its per-turn ctx is a real
// login session). The external gateway passes a gate built from the resolved
// MCP connection: guests get public reads only; authenticated connections get
// public + account-scoped reads plus the write families their scope grants.
// Write tools are not registered at all when the family scope is missing, so
// `tools/list` advertises exactly the granted surface and a missing scope can
// never execute (defense-in-depth against AV-10/AV-12).

export type ScopeFamily = 'offers' | 'cooperations' | 'tickets' | 'dao' | 'identity' | 'images'

export interface ToolGate {
  /** Guest context (identityLevel 0): no account-scoped reads, no writes. */
  isGuest: boolean
  /** True when the connection's scope grants the given write family. */
  canWrite: (family: ScopeFamily) => boolean
}

/** Full surface — the in-app adapter's per-turn ctx (real login session). */
export const FULL_GATE: ToolGate = {
  isGuest: false,
  canWrite: () => true,
}

/** Build a gate from a resolved connection scope set. `read` is always granted. */
export function gateFromScopes(scopes: string[] | readonly string[], isGuest = false): ToolGate {
  const scope = new Set<string>(scopes)
  return {
    isGuest,
    canWrite: (family) => !isGuest && scope.has(`${family}:write`),
  }
}

/** Guest gate — public reads only, exactly what an anonymous visitor sees. */
export const GUEST_GATE: ToolGate = {
  isGuest: true,
  canWrite: () => false,
}
