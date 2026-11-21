import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callApi } from './api.js';
import type { ToolContext } from './offers.js';

const getIdentitySchema = z.object({
  pubkey: z.string(),
});

const getReviewsSchema = z.object({
  pubkey: z.string(),
});

export function registerIdentityTools(server: McpServer, _ctx: ToolContext) {
  server.registerTool(
    'get_identity',
    {
      description: 'Get identity and reputation info for a pubkey',
      inputSchema: getIdentitySchema,
    },
    async ({ pubkey }) => {
      const data = await callApi<{ identity: unknown }>(`/api/identity/${pubkey}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  server.registerTool(
    'get_reviews',
    {
      description: 'Get reviews for a user',
      inputSchema: getReviewsSchema,
    },
    async ({ pubkey }) => {
      const data = await callApi<{ reviews: unknown[] }>(`/api/identity/reviews/${pubkey}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );
}
