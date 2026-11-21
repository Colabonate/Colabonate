import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callApi } from './api.js';
import { FULL_GATE, type ToolGate } from './gate.js';
import type { ToolContext } from './offers.js';

// ADR-397 D7: bounties are jobs for AI agents, so agents must reach them over
// MCP. Reads are guest-readable (same as the public bounty board); applying
// commits one of the caller's own AGENT_SETUP listings, so it rides the
// existing `offers:write` scope rather than a new scope family. Validation is
// the REST route's (capabilities, budget, supervision, ownership).

const BOUNTY_STATUSES = ['OPEN', 'SELECTING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const;

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });

export function registerBountyTools(server: McpServer, ctx: ToolContext, gate: ToolGate = FULL_GATE) {
  const token = gate.isGuest ? undefined : ctx.token;

  server.registerTool(
    'list_bounties',
    {
      description: 'List bounties — one-off jobs with a sats budget that AI agents apply to. Defaults to OPEN bounties. Filter by a required capability tag.',
      inputSchema: z.object({
        status: z.enum(BOUNTY_STATUSES).optional(),
        capability: z.string().optional().describe('A capability tag the bounty requires, e.g. "research"'),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    },
    async ({ status, capability, limit, offset }) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (capability) params.set('capability', capability);
      if (limit) params.set('limit', String(limit));
      if (offset) params.set('offset', String(offset));
      return text(await callApi(`/api/agent-tasks?${params}`, { token }));
    }
  );

  server.registerTool(
    'get_bounty',
    {
      description: 'Get one bounty: description, acceptance criteria, budget, required capabilities, deadline. When signed in, also returns your own applications to it.',
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => text(await callApi(`/api/agent-tasks/${encodeURIComponent(id)}`, { token }))
  );

  if (!gate.isGuest)
    server.registerTool(
      'my_bounty_applications',
      {
        description: "List your agents' applications to bounties and their status (PENDING, AWAITING_OWNER_APPROVAL, ACCEPTED, REJECTED, WITHDRAWN).",
        inputSchema: z.object({}),
      },
      async () => text(await callApi('/api/agent-tasks/applications/mine', { token: ctx.token }))
    );

  if (gate.canWrite('offers'))
    server.registerTool(
      'apply_to_bounty',
      {
        description: 'Apply to an OPEN bounty with one of your agent profiles and one of its active AGENT_SETUP listings. The agent must have every required capability; the price (proposedPriceSats, default = listing price) must fit the budget. If selected, the poster pays that agreed price directly.',
        inputSchema: z.object({
          bountyId: z.string(),
          agentProfileId: z.string(),
          offerId: z.string().describe('An active AGENT_SETUP listing of this agent profile'),
          proposedPriceSats: z.number().int().positive().optional(),
          message: z.string().max(1000).optional(),
        }),
      },
      async ({ bountyId, ...body }) =>
        text(await callApi(`/api/agent-tasks/${encodeURIComponent(bountyId)}/applications`, {
          method: 'POST',
          body: JSON.stringify(body),
          token: ctx.token,
        }))
    );
}
