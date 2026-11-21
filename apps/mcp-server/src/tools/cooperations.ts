import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callApi } from './api.js';
import type { ImageAwareContext } from './offers.js';
import { FULL_GATE, type ToolGate } from './gate.js';
import { resolveImageRefs } from './images.js';

const discoverCooperationsSchema = z.object({
  q: z.string().optional(),
  cooperationType: z.string().optional(),
  status: z.string().optional(),
});

const getCooperationSchema = z.object({
  id: z.string(),
});

const createCooperationSchema = z.object({
  title: z.string(),
  cooperationType: z.string(),
  budgetSats: z.number().min(1),
  description: z.string().optional().describe('Detailed description of the cooperation project'),
  categoryCode: z.string().optional().describe('StandardCategory slug for the cooperation'),
  timeline: z.string().optional().describe('Timeline preset or description (e.g. "2weeks", "1month")'),
  skills: z.array(z.string()).optional().describe('Required skills for the cooperation'),
  deadline: z.string().optional().describe('Deadline as ISO date string'),
  requirements: z.string().optional().describe('Specific requirements or qualifications needed'),
  images: z.array(z.string()).optional().describe('Array of image references from get_pending_images (e.g. "pending:0"), or HTTPS URLs'),
});

const updateCooperationSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional().describe('Detailed description of the cooperation project'),
  budgetSats: z.number().min(1).optional(),
  timeline: z.string().optional().describe('Timeline preset or description'),
  skills: z.array(z.string()).optional().describe('Required skills for the cooperation'),
  categoryCode: z.string().optional().describe('StandardCategory slug for the cooperation'),
  deadline: z.string().optional().describe('Deadline as ISO date string'),
  requirements: z.string().optional().describe('Specific requirements or qualifications needed'),
  images: z.array(z.string()).optional().describe('Array of image references from get_pending_images (e.g. "pending:0"), or HTTPS URLs. Replaces all existing images.'),
  status: z.string().optional().describe('Set to "OPEN" to publish a draft, "CANCELLED" to cancel'),
});

export function registerCooperationTools(server: McpServer, ctx: ImageAwareContext, gate: ToolGate = FULL_GATE) {
  server.registerTool(
    'discover_cooperations',
    {
      description: 'Search for public cooperations on the marketplace',
      inputSchema: discoverCooperationsSchema,
    },
    async ({ q, cooperationType, status }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (cooperationType) params.set('cooperationType', cooperationType);
      if (status) params.set('status', status);

      const data = await callApi<{ cooperations: unknown[] }>(`/api/cooperations/discover?${params}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  if (!gate.isGuest)
    server.registerTool(
      'get_my_cooperations',
      {
        description: 'Get cooperations where the authenticated user is initiator or partner',
        inputSchema: z.object({}),
      },
      async () => {
        const data = await callApi<{ cooperations: unknown[] }>('/api/cooperations', { token: ctx.token });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  server.registerTool(
    'get_cooperation',
    {
      description: 'Get a single cooperation by ID',
      inputSchema: getCooperationSchema,
    },
    async ({ id }) => {
      const data = await callApi<{ cooperation: unknown }>(`/api/cooperations/${id}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  if (gate.canWrite('cooperations'))
    server.registerTool(
      'create_cooperation',
      {
        description: 'Create a new cooperation',
        inputSchema: createCooperationSchema,
      },
      async (args) => {
        const data = await callApi<{ cooperation: unknown }>('/api/cooperations', {
          method: 'POST',
          body: JSON.stringify({ ...args, images: resolveImageRefs(args.images, ctx.pendingImages ?? []), initiatorPubkey: ctx.pubkey }),
          token: ctx.token,
        });
        const cooperation = data.cooperation as Record<string, unknown> | undefined;
        const cooperationId = cooperation?.id;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ cooperation: data.cooperation, id: cooperationId, created: true }) }] };
      }
    );

  if (gate.canWrite('cooperations'))
    server.registerTool(
      'update_cooperation',
      {
        description: 'Update an existing cooperation. Can update title, description, budget, images, and other fields. Use status "OPEN" to publish a draft.',
        inputSchema: updateCooperationSchema,
      },
      async ({ id, ...updates }) => {
        const data = await callApi<{ cooperation: unknown }>(`/api/cooperations/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...updates, images: resolveImageRefs(updates.images, ctx.pendingImages ?? []) }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ cooperation: data.cooperation, changed: Object.keys(updates) }) }] };
      }
    );
}
