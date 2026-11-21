import { API_BASE, AI_INTERNAL_SECRET } from '../config.js';
import { gateFromScopes, type ToolGate } from '../tools/gate.js';
import type { ToolContext } from '../tools/offers.js';

// ADR-371 D7 — the gateway never trusts the client: an MCP bearer is resolved
// server-side by the internal relay (POST /api/mcp/session, AI_INTERNAL_SECRET +
// Bearer <mcp token>). The relay validates the connection (hash lookup, expiry,
// revocation, blocked account) and mints a short-lived derived REST Session.
// The derived token is the ONLY credential the tool executor forwards to REST —
// the MCP bearer itself is REST-inert and never leaves this process.

export interface ResolvedSession {
  kind: 'guest' | 'user';
  ctx: ToolContext;
  gate: ToolGate;
  connectionId?: string;
  /** Absolute epoch ms when the derived REST session expires (user sessions). */
  expiresAt?: number;
  label?: string | null;
}

export const GUEST_SESSION: ResolvedSession = {
  kind: 'guest',
  ctx: { pubkey: '', token: '', identityLevel: 0 },
  gate: gateFromScopes(['read'], true),
};

export class McpTokenError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'McpTokenError';
  }
}

/**
 * Exchange an MCP bearer for a derived REST session via the server relay.
 * Throws McpTokenError (401) on invalid/revoked/expired/blocked connections and
 * on a misconfigured internal secret; never logs token material (FU-195-C).
 */
export async function resolveMcpBearer(bearer: string, now = Date.now()): Promise<ResolvedSession> {
  if (!AI_INTERNAL_SECRET) {
    throw new McpTokenError('MCP internal relay is not configured on this deployment (AI_INTERNAL_SECRET unset)', 503);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/mcp/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ai-internal-secret': AI_INTERNAL_SECRET,
        Authorization: `Bearer ${bearer}`,
      },
    });
  } catch {
    throw new McpTokenError('MCP session relay unreachable', 503);
  }
  if (!res.ok) {
    throw new McpTokenError(
      res.status === 401 || res.status === 403 ? 'Invalid, revoked or expired MCP connection' : 'MCP session relay error',
      res.status
    );
  }
  const data = (await res.json()) as {
    token?: string;
    expiresInMs?: number;
    connectionId?: string;
    label?: string | null;
    scopes?: string[];
    identity?: { pubkey?: string; identityLevel?: number };
  };
  if (!data.token || !data.expiresInMs || !data.identity?.pubkey || !data.scopes) {
    throw new McpTokenError('Malformed MCP session relay response', 502);
  }
  return {
    kind: 'user',
    ctx: {
      pubkey: data.identity.pubkey,
      token: data.token,
      identityLevel: data.identity.identityLevel ?? 0,
    },
    gate: gateFromScopes(data.scopes, false),
    connectionId: data.connectionId,
    expiresAt: now + data.expiresInMs,
    label: data.label ?? null,
  };
}
