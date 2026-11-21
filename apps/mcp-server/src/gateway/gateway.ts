import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildMcpServer, createTransport, type ToolCallObserver } from '../mcp-instance.js';
import { GUEST_SESSION, resolveMcpBearer, McpTokenError, type ResolvedSession } from './session-resolver.js';
import type { ToolContext } from '../tools/offers.js';
import { API_BASE, AI_INTERNAL_SECRET } from '../config.js';

// ADR-371 D1/D8 — public external MCP gateway with per-session isolation.
//
// Every MCP session gets its OWN transport + McpServer, with tools registered
// against that session's resolved context (guest or bearer-derived, scoped by
// D8's tool gate). tools/list therefore advertises exactly the granted surface,
// and no shared mutable ctx exists (AV-12). Sessions are server-side only:
// `Mcp-Session-Id` headers resolve to the map entry; unknown/revoked sessions
// answer 404 (protocol behaviour for invalid session ids).
//
// DoS bounds (AV-14): per-session idle eviction + a hard cap; refreshes of the
// derived REST credential are scheduled before expiry and re-resolve the MCP
// bearer server-side (a revoked connection kills its session at the next tick;
// REST calls fail immediately because revoke deletes derived Session rows).

export interface McpGatewayOptions {
  /** Resolver for an MCP bearer (injectable for tests). */
  resolve?: (bearer: string, now?: number) => Promise<ResolvedSession>;
  /** Idle time before a session is evicted (ms). Default 30 min. */
  idleTimeoutMs?: number;
  /** Max concurrent sessions (ms). Default 250. */
  maxSessions?: number;
  /** Sweep interval (ms). Default 5 min. */
  sweepIntervalMs?: number;
  /** Per-session JSON-RPC call budget per minute (AV-6 scrape guard). Default 600. */
  perSessionCallsPerMinute?: number;
  /** Process-wide JSON-RPC call budget per minute (AV-14 DoS bound). Default 4000. */
  globalCallsPerMinute?: number;
  /**
   * Phase 3 activity-ledger sink. Defaults to a fire-and-forget POST to the
   * internal `/api/mcp/events` relay (server-side bounded). Injectable for
   * tests; only called for bearer sessions, never for guests.
   */
  recordEvent?: (event: McpToolEvent) => void;
}

/** Outcome-only tool-call event (Phase 3 ledger; FU-195-C: no args/results). */
export interface McpToolEvent {
  bearer?: string;
  agentLabel?: string | null;
  tool: string;
  outcome: 'success' | 'error';
}

/**
 * Default Phase 3 sink: report a completed tool call to the server's internal
 * relay. Fire-and-forget on purpose — the ledger must never break the tool
 * call — and silent on failure: nothing is logged, token material never leaves
 * the Authorization header (FU-195-C).
 */
function postMcpEvent(event: McpToolEvent): void {
  if (!event.bearer || !AI_INTERNAL_SECRET) return;
  fetch(`${API_BASE}/api/mcp/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ai-internal-secret': AI_INTERNAL_SECRET,
      Authorization: `Bearer ${event.bearer}`,
    },
    body: JSON.stringify({
      tool: event.tool,
      outcome: event.outcome,
      agentLabel: event.agentLabel ?? undefined,
    }),
  }).catch(() => {});
}

interface GatewayEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  auth: ResolvedSession;
  bearer?: string;
  lastActive: number;
  created: number;
  refreshTimer?: ReturnType<typeof setTimeout>;
}

const MCP_SESSION_ID_HEADER = 'mcp-session-id';

function sendStatus(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export class McpGateway {
  private readonly entries = new Map<string, GatewayEntry>();
  private readonly resolve: NonNullable<McpGatewayOptions['resolve']>;
  private readonly recordEvent: NonNullable<McpGatewayOptions['recordEvent']>;
  private readonly idleTimeoutMs: number;
  private readonly maxSessions: number;
  private readonly perSessionCallsPerMinute: number;
  private readonly globalCallsPerMinute: number;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private readonly globalCalls = new Map<string, number>();
  private readonly sessionCalls = new Map<string, number>();
  private windowStarted = Date.now();

  constructor(options: McpGatewayOptions = {}) {
    this.resolve = options.resolve ?? resolveMcpBearer;
    this.recordEvent = options.recordEvent ?? postMcpEvent;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000;
    this.maxSessions = options.maxSessions ?? 250;
    this.perSessionCallsPerMinute = options.perSessionCallsPerMinute ?? 600;
    this.globalCallsPerMinute = options.globalCallsPerMinute ?? 4000;
    const sweepIntervalMs = options.sweepIntervalMs ?? 5 * 60 * 1000;
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  private rollWindow(now = Date.now()): void {
    if (now - this.windowStarted >= 60_000) {
      this.windowStarted = now;
      this.globalCalls.clear();
      this.sessionCalls.clear();
    }
  }

  /** Returns an HTTP 429 when the request exceeds the ADR-371 D9 budgets. */
  private withinCallBudget(sessionId: string | undefined, now = Date.now()): boolean {
    this.rollWindow(now);
    const g = (this.globalCalls.get('all') ?? 0) + 1;
    if (g > this.globalCallsPerMinute) return false;
    this.globalCalls.set('all', g);
    if (sessionId) {
      const s = (this.sessionCalls.get(sessionId) ?? 0) + 1;
      if (s > this.perSessionCallsPerMinute) return false;
      this.sessionCalls.set(sessionId, s);
    }
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      const idle = now - entry.lastActive;
      const age = now - entry.created;
      if (idle > this.idleTimeoutMs || age > 24 * 60 * 60 * 1000) {
        this.drop(id, entry);
      }
    }
  }

  private drop(id: string, entry: GatewayEntry): void {
    if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
    this.entries.delete(id);
    entry.transport.close().catch(() => {});
  }

  private evictIfNeeded(): void {
    if (this.entries.size < this.maxSessions) return;
    // Evict the oldest active entry to bound memory (AV-14).
    let oldestId: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [id, e] of this.entries) {
      if (e.lastActive < oldest) {
        oldest = e.lastActive;
        oldestId = id;
      }
    }
    if (oldestId) {
      const entry = this.entries.get(oldestId);
      if (entry) this.drop(oldestId, entry);
    }
  }

  private armRefresh(entry: GatewayEntry): void {
    if (entry.auth.kind !== 'user' || !entry.bearer || !entry.auth.expiresAt) return;
    const remaining = entry.auth.expiresAt - Date.now();
    if (remaining <= 0) {
      // Already past the derived-session horizon — re-resolve immediately.
      void this.refresh(entry);
      return;
    }
    const delay = Math.max(5_000, Math.min(remaining / 2, 10 * 60 * 1000));
    entry.refreshTimer = setTimeout(() => void this.refresh(entry), delay);
    entry.refreshTimer.unref?.();
  }

  private async refresh(entry: GatewayEntry): Promise<void> {
    if (!entry.bearer) return;
    try {
      const next = await this.resolve(entry.bearer);
      if (next.kind !== 'user') return;
      // Mutate the SAME ctx object the registered tool closures captured, so the
      // refreshed derived token is picked up without re-registering tools.
      entry.auth.ctx.pubkey = next.ctx.pubkey;
      entry.auth.ctx.token = next.ctx.token;
      entry.auth.ctx.identityLevel = next.ctx.identityLevel;
      entry.auth.expiresAt = next.expiresAt;
      entry.auth.connectionId = next.connectionId;
      this.armRefresh(entry);
    } catch {
      // Revoked/expired connection: stop serving the session (404 for later
      // requests; in-flight REST calls already fail via deleted derived rows).
      const sessionId = this.sessionIdOf(entry);
      if (sessionId) this.drop(sessionId, entry);
    }
  }

  private sessionIdOf(entry: GatewayEntry): string | null {
    for (const [id, e] of this.entries) if (e === entry) return id;
    return null;
  }

  handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const header = req.headers[MCP_SESSION_ID_HEADER];
    const sessionId = typeof header === 'string' && header ? header : undefined;

    if (!this.withinCallBudget(sessionId)) {
      sendStatus(res, 429, { error: 'RATE_LIMITED', message: 'Too many MCP requests' });
      return;
    }

    if (sessionId) {
      const entry = this.entries.get(sessionId);
      if (!entry) {
        sendStatus(res, 404, { error: 'UNKNOWN_SESSION', message: 'Unknown or expired MCP session' });
        return;
      }
      entry.lastActive = Date.now();
      try {
        await entry.transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) sendStatus(res, 400, { error: 'BAD_REQUEST' });
      }
      return;
    }

    // New session — must be an initialize request (protocol) and carries an
    // optional MCP bearer. Read + parse the body so junk requests never build
    // a full McpServer (DoS guard, AV-14).
    const rawBody = await readBody(req);
    let parsed: { method?: string } | null = null;
    try {
      parsed = rawBody ? (JSON.parse(rawBody) as { method?: string }) : null;
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.method !== 'initialize') {
      sendStatus(res, 400, { error: 'BAD_REQUEST', message: 'A new MCP session must start with an initialize request' });
      return;
    }
    // Phase 3 ledger: capture the connecting agent's self-reported client
    // identity (initialize.params.clientInfo) for the activity display.
    const clientInfo = (parsed as { params?: { clientInfo?: { name?: string; version?: string } } }).params?.clientInfo;
    const agentLabel = clientInfo?.name
      ? clientInfo.version
        ? `${clientInfo.name} ${clientInfo.version}`
        : clientInfo.name
      : null;

    let auth: ResolvedSession;
    const authHeader = req.headers.authorization;
    const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (bearer) {
      try {
        auth = await this.resolve(bearer);
      } catch (err) {
        const status = err instanceof McpTokenError ? err.status : 500;
        sendStatus(res, status === 503 ? 503 : 401, {
          error: 'INVALID_MCP_TOKEN',
          message: err instanceof Error ? err.message : 'Invalid MCP connection token',
        });
        return;
      }
    } else {
      auth = GUEST_SESSION;
    }

    this.evictIfNeeded();
    const transport = createTransport();
    // Phase 3: for bearer sessions, report completed tool calls to the ledger
    // sink (guests and in-app sessions never record). The observer closes over
    // this session's bearer so the relay can validate the connection.
    const observer: ToolCallObserver | undefined =
      auth.kind === 'user' && bearer
        ? {
            onToolCall: (tool, outcome) => {
              this.recordEvent({ bearer, agentLabel, tool, outcome });
            },
          }
        : undefined;
    // FU-961: external agents get compact results (no inline base64 images).
    const server = buildMcpServer(auth.ctx, auth.gate, observer, { compactResults: true });
    const entry: GatewayEntry = {
      transport,
      server,
      auth,
      bearer: auth.kind === 'user' ? bearer : undefined,
      lastActive: Date.now(),
      created: Date.now(),
    };

    const register = (): void => {
      const sid = transport.sessionId;
      if (!sid) return;
      this.entries.set(sid, entry);
      transport.onclose = () => {
        if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
        this.entries.delete(sid);
      };
      this.armRefresh(entry);
    };

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch {
      if (!res.headersSent) sendStatus(res, 400, { error: 'BAD_REQUEST' });
      transport.close().catch(() => {});
      return;
    }
    register();
  };

  close(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const [id, entry] of this.entries) this.drop(id, entry);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createGateway(options: McpGatewayOptions = {}): McpGateway {
  return new McpGateway(options);
}

export type { ToolContext };
