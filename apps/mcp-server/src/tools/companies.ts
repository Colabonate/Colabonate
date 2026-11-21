import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callApi } from './api.js';
import type { ToolContext } from './offers.js';
import { FULL_GATE, type ToolGate } from './gate.js';

const listCompaniesSchema = z.object({
  limit: z.number().optional(),
});

const getMyCompanySchema = z.object({});

// Mirrors the web UI's stored shape (SellCompanySetup / packages/ui DayKey);
// times are documented as HH:mm but not regex-enforced — the web UI can store
// "09:00 AM" strings (formatLocaleTime), which read-modify-write round-trips
// must be able to echo back.
const dayHoursSchema = z.object({
  start: z.string().describe('Opening time, 24-hour HH:mm, e.g. "09:00"'),
  end: z.string().describe('Closing time, 24-hour HH:mm, e.g. "18:00"'),
});

const upsertCompanySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  openingHours: z
    .record(
      z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
      z.union([dayHoursSchema, z.null()])
    )
    .optional()
    .describe(
      'Weekly opening hours keyed by day (mon–sun); null = closed that day. ' +
        'Send all seven days in one call — the map replaces the stored hours as a whole.'
    ),
});

export function registerCompanyTools(server: McpServer, ctx: ToolContext, gate: ToolGate = FULL_GATE) {
  server.registerTool(
    'list_companies',
    {
      description: 'List active companies on the marketplace',
      inputSchema: listCompaniesSchema,
    },
    async ({ limit }) => {
      const params = limit ? `?limit=${limit}` : '';
      const data = await callApi<{ companies: unknown[] }>(`/api/companies${params}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  if (!gate.isGuest)
    server.registerTool(
      'get_my_company',
      {
        description: 'Get company owned by the authenticated user',
        inputSchema: getMyCompanySchema,
      },
      async () => {
        const data = await callApi<{ company: unknown | null }>('/api/company/me', { token: ctx.token });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  // Company profile edits are identity/profile writes (scope family 'identity').
  if (gate.canWrite('identity'))
    server.registerTool(
      'upsert_company',
      {
        description: 'Create or update the authenticated user\'s company profile',
        inputSchema: upsertCompanySchema,
      },
      async (args) => {
        const existing = await callApi<{ company: unknown | null }>('/api/company/me', { token: ctx.token }).catch(() => null);
        const method = existing?.company ? 'PATCH' : 'POST';
        const endpoint = existing?.company ? '/api/company/me' : '/api/company';
        const result = await callApi<{ company: unknown; created: boolean }>(endpoint, {
          method,
          body: JSON.stringify(args),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ...result, created: !existing?.company }) }] };
      }
    );
}
