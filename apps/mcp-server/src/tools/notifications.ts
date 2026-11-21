import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callApi } from './api.js';
import type { ToolContext } from './offers.js';
import { FULL_GATE, type ToolGate } from './gate.js';

// ADR-374 — server-backed in-app notifications over MCP.
//
// These tools read/manage the ACCOUNT-SCOPED notification feed. They are gated
// by `!gate.isGuest` (authenticated connections only) — reading your own
// notifications and mutating your own read/archive state is personal account
// data, not a marketplace write, so it is NOT a separate opt-in write family
// (unlike offers/cooperations/tickets/dao/identity/images). Guests (identity
// level 0) have no account and see no notification surface.

const getMyNotificationsSchema = z.object({
  unreadOnly: z.boolean().optional(),
  archived: z.boolean().optional(),
  limit: z.number().optional(),
});

const markNotificationReadSchema = z.object({
  id: z.string(),
});

const archiveNotificationSchema = z.object({
  id: z.string(),
});

export function registerNotificationTools(server: McpServer, ctx: ToolContext, gate: ToolGate = FULL_GATE) {
  if (!gate.isGuest)
    server.registerTool(
      'get_my_notifications',
      {
        description: 'Get the authenticated user\'s notifications (newest first), optionally filtered to unread or archived',
        inputSchema: getMyNotificationsSchema,
      },
      async ({ unreadOnly, archived, limit }) => {
        const params = new URLSearchParams();
        if (unreadOnly) params.set('unreadOnly', '1');
        if (archived) params.set('archived', '1');
        if (limit) params.set('limit', String(limit));
        const qs = params.toString();
        const data = await callApi<unknown>(`/api/notifications${qs ? `?${qs}` : ''}`, { token: ctx.token });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest)
    server.registerTool(
      'mark_notification_read',
      {
        description: 'Mark a single notification as read',
        inputSchema: markNotificationReadSchema,
      },
      async ({ id }) => {
        const data = await callApi<unknown>(`/api/notifications/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ read: true }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest)
    server.registerTool(
      'mark_all_notifications_read',
      {
        description: 'Mark every unread notification as read',
        inputSchema: z.object({}),
      },
      async () => {
        const data = await callApi<unknown>('/api/notifications/read-all', {
          method: 'POST',
          body: JSON.stringify({}),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest)
    server.registerTool(
      'archive_notification',
      {
        description: 'Archive a notification (marks it read and hides it from the active feed)',
        inputSchema: archiveNotificationSchema,
      },
      async ({ id }) => {
        const data = await callApi<unknown>(`/api/notifications/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ archived: true }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );
}
