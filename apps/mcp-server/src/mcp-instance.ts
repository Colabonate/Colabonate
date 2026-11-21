import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerOfferTools, type ToolContext } from './tools/offers.js';
import { registerCooperationTools } from './tools/cooperations.js';
import { registerCompanyTools } from './tools/companies.js';
import { registerTicketTools } from './tools/tickets.js';
import { registerBountyTools } from './tools/bounties.js';
import { registerNotificationTools } from './tools/notifications.js';
import { registerIdentityTools } from './tools/identity.js';
import { registerDaoTools } from './tools/dao.js';
import { registerImageTools } from './tools/images.js';
import { FULL_GATE, GUEST_GATE, gateFromScopes, type ToolGate } from './tools/gate.js';
import { compactToolResult } from './tools/compact.js';

export { FULL_GATE, GUEST_GATE, gateFromScopes };
export type { ToolGate };
export type { ToolContext };

export interface McpServerInstance {
  server: McpServer;
  serverName: string;
}

/**
 * Phase 3 activity ledger — the gateway subscribes via `buildMcpServer` so it
 * can report completed tool calls (tool name + outcome) to the server's
 * internal `/api/mcp/events` relay. Never carries args or results (FU-195-C).
 */
export interface ToolCallObserver {
  onToolCall(tool: string, outcome: 'success' | 'error'): void;
}

/**
 * ADR-371 D1/D8 — one tool registry, many contexts.
 *
 * The legacy module-level `NO_AUTH_CTX` singleton server was removed: it had no
 * remaining caller (the in-app AI Assistant builds its own per-turn server in
 * `adapter/ai-chat.ts`, and nginx never exposed the raw `/mcp`). Exposing an
 * identity-less write-capable `/mcp` would let anyone run platform writes with
 * no owner (security review AV-2). Instead every external MCP session builds its
 * own McpServer with tools registered against that session's resolved context
 * and gate — `tools/list` then advertises exactly the granted surface, and no
 * shared mutable ctx can bleed between concurrent sessions (AV-12).
 */
export interface BuildMcpServerOptions {
  /**
   * FU-961: strip inline base64 images and de-duplicate cooperation pages from
   * every tool result (see tools/compact.ts). The external gateway turns this on;
   * the in-app assistant does not (its cards render thumbnails from the payload).
   */
  compactResults?: boolean;
}

export function buildMcpServer(
  ctx: ToolContext,
  gate: ToolGate = FULL_GATE,
  observer?: ToolCallObserver,
  options: BuildMcpServerOptions = {}
): McpServer {
  const server = new McpServer(
    { name: 'colabonate-mcp-server', version: '1.1.0' },
    { capabilities: { tools: {} } }
  );

  if (observer || options.compactResults) {
    // Wrap registerTool centrally so every registered handler reports back —
    // no per-tool-family changes needed. The wrapper is deliberately small and
    // outcome-only: tool args/results never touch the observer (FU-195-C).
    const registerTool = server.registerTool.bind(server) as unknown as {
      (name: string, config: Record<string, unknown>, cb: (...args: unknown[]) => unknown): void;
      (name: string, cb: (...args: unknown[]) => unknown): void;
    };
    const wrap = (tool: string, original: (...args: unknown[]) => Promise<unknown>) => async (...args: unknown[]): Promise<unknown> => {
      try {
        const raw = await original(...args);
        const result = options.compactResults ? compactToolResult(tool, raw) : raw;
        observer?.onToolCall(tool, 'success');
        return result;
      } catch (err) {
        observer?.onToolCall(tool, 'error');
        throw err;
      }
    };
    const patched = ((name: string, ...rest: unknown[]) => {
      const raw = rest.length >= 2 ? rest[1] : rest[0];
      const wrapped = wrap(name, raw as (...args: unknown[]) => Promise<unknown>);
      if (rest.length >= 2) registerTool(name, rest[0] as Record<string, unknown>, wrapped);
      else registerTool(name, wrapped);
    }) as unknown as typeof server.registerTool;
    server.registerTool = patched;
  }

  const imageCtx: ToolContext & { pendingImages: string[] } = { ...ctx, pendingImages: [] };

  registerOfferTools(server, ctx, gate);
  registerCooperationTools(server, ctx, gate);
  registerCompanyTools(server, ctx, gate);
  registerTicketTools(server, ctx, gate);
  registerBountyTools(server, ctx, gate);
  registerNotificationTools(server, ctx, gate);
  registerIdentityTools(server, ctx);
  registerDaoTools(server, ctx, gate);
  registerImageTools(server, imageCtx, gate);

  return server;
}

export function createTransport() {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
}
