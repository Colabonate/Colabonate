import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callApi } from './api.js';
import type { ToolContext } from './offers.js';
import { FULL_GATE, type ToolGate } from './gate.js';

const getMyTicketsSchema = z.object({
  role: z.enum(['buyer', 'seller']).optional(),
});

const getTicketSchema = z.object({
  id: z.string(),
});

const createTicketSchema = z.object({
  offerId: z.string(),
});

const TICKET_STATUSES = [
  'PENDING',
  'INTEREST_SENT',
  'ACCEPTED',
  'PAID',
  'IN_PROGRESS',
  'COMPLETED',
  'DISPUTED',
  'ARBITRATION_LOST',
  'ARBITRATION_WON',
  'CANCELLED',
] as const;

const updateTicketStatusSchema = z.object({
  id: z.string(),
  status: z.enum(TICKET_STATUSES),
});

const getPaymentStatusSchema = z.object({
  id: z.string(),
});

const releasePaymentSchema = z.object({
  id: z.string(),
});

const confirmDirectPaymentSchema = z.object({
  id: z.string(),
  preimage: z.string(),
});

const confirmCanvasFeeSchema = z.object({
  id: z.string(),
  preimage: z.string().optional(),
});

const openDisputeSchema = z.object({
  id: z.string(),
  reason: z.string(),
  details: z.string().optional(),
  agentDisputeType: z.enum(['TIMEOUT', 'QUALITY', 'PROOF_MISSING', 'CONFIG_LEAK']).optional(),
  arbiterPubkey: z.string().optional().describe('For PRIVATE disputeMode: nominate this arbiter when opening the dispute'),
});

const nominateArbiterSchema = z.object({
  id: z.string(),
  arbiterPubkey: z.string().describe('64-char hex npub of the mutual arbiter'),
});

const acceptArbiterSchema = z.object({
  id: z.string(),
  arbiterPubkey: z.string(),
  arbiterSignature: z.string().optional(),
});

const listArbitersSchema = z.object({
  id: z.string(),
});

const submitPrivateVerdictSchema = z.object({
  id: z.string(),
  arbiterPubkey: z.string().describe('64-char hex npub of the accepted arbiter'),
  outcome: z.enum(['RELEASE', 'CANCEL']),
  reasoning: z.string().optional(),
  signedEvent: z.object({
    id: z.string(),
    pubkey: z.string(),
    created_at: z.number(),
    kind: z.number(),
    tags: z.array(z.array(z.string())),
    content: z.string(),
    sig: z.string(),
  }).describe('The arbiter-signed Nostr event (requires the arbiter private key to sign)'),
});

export function registerTicketTools(server: McpServer, ctx: ToolContext, gate: ToolGate = FULL_GATE) {
  if (!gate.isGuest)
    server.registerTool(
      'get_my_tickets',
      {
        description: 'Get tickets for the authenticated user, optionally filtered by role',
        inputSchema: getMyTicketsSchema,
      },
      async ({ role }) => {
        const params = new URLSearchParams();
        if (role) params.set('role', role);
        const data = await callApi<{ tickets: unknown[] }>(`/api/tickets${params.toString() ? `?${params}` : ''}`, { token: ctx.token });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest)
    server.registerTool(
      'get_ticket',
      {
        description: 'Get a single ticket by ID',
        inputSchema: getTicketSchema,
      },
      async ({ id }) => {
        const data = await callApi<{ ticket: unknown }>(`/api/tickets/${id}`, { token: ctx.token });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest)
    server.registerTool(
      'get_ticket_payment_status',
      {
        description: 'Poll a ticket\'s payment status (status, paymentHash, paid)',
        inputSchema: getPaymentStatusSchema,
      },
      async ({ id }) => {
        const data = await callApi<unknown>(`/api/tickets/${id}/payment-status`, { token: ctx.token });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest)
    server.registerTool(
      'list_ticket_arbiters',
      {
        description: 'List the mutual-arbiter nomination state for a private-mode ticket',
        inputSchema: listArbitersSchema,
      },
      async ({ id }) => {
        const data = await callApi<unknown>(`/api/tickets/${id}/arbiters`, { token: ctx.token });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('tickets'))
    server.registerTool(
      'create_ticket',
      {
        description: 'Create a ticket (purchase order) from an offer',
        inputSchema: createTicketSchema,
      },
      async ({ offerId }) => {
        const data = await callApi<{ ticket: unknown }>('/api/tickets', {
          method: 'POST',
          body: JSON.stringify({ offerId, buyerPubkey: ctx.pubkey }),
          token: ctx.token,
        });
        const ticket = data.ticket as Record<string, unknown> | undefined;
        const ticketId = ticket?.id;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ticket: data.ticket, id: ticketId, created: true }) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('tickets'))
    server.registerTool(
      'update_ticket_status',
      {
        description: 'Update a ticket\'s status (buyer or seller only). Use COMPLETED to confirm receipt/delivery.',
        inputSchema: updateTicketStatusSchema,
      },
      async ({ id, status }) => {
        const data = await callApi<{ ticket: unknown }>(`/api/tickets/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('tickets'))
    server.registerTool(
      'release_ticket_payment',
      {
        description: 'Release a ticket\'s escrow-held payment (buyer only; ticket must be IN_PROGRESS). Only meaningful when escrow is enabled on this deployment — with direct payments, use confirm_direct_payment instead.',
        inputSchema: releasePaymentSchema,
      },
      async ({ id }) => {
        const data = await callApi<unknown>(`/api/tickets/${id}/release-payment`, {
          method: 'POST',
          body: JSON.stringify({}),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('tickets'))
    server.registerTool(
      'confirm_direct_payment',
      {
        description: 'Confirm a direct-pay ticket payment by reporting the preimage (buyer only)',
        inputSchema: confirmDirectPaymentSchema,
      },
      async ({ id, preimage }) => {
        const data = await callApi<unknown>(`/api/tickets/${id}/confirm-direct-payment`, {
          method: 'POST',
          body: JSON.stringify({ preimage }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('tickets'))
    server.registerTool(
      'confirm_canvas_fee',
      {
        description: 'Confirm a hosted-canvas service-fee payment (buyer only). LN rail requires the preimage; demo rail needs none.',
        inputSchema: confirmCanvasFeeSchema,
      },
      async ({ id, preimage }) => {
        const data = await callApi<unknown>(`/api/tickets/${id}/confirm-canvas-fee`, {
          method: 'POST',
          body: JSON.stringify(preimage ? { preimage } : {}),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('tickets'))
    server.registerTool(
      'open_ticket_dispute',
      {
        description: 'Open a dispute on a ticket (buyer or seller only)',
        inputSchema: openDisputeSchema,
      },
      async ({ id, reason, details, agentDisputeType, arbiterPubkey }) => {
        const data = await callApi<unknown>(`/api/tickets/${id}/dispute`, {
          method: 'POST',
          body: JSON.stringify({
            callerPubkey: ctx.pubkey,
            reason,
            ...(details ? { details } : {}),
            ...(agentDisputeType ? { agentDisputeType } : {}),
            ...(arbiterPubkey ? { arbiterPubkey } : {}),
          }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('tickets'))
    server.registerTool(
      'nominate_ticket_arbiter',
      {
        description: 'Nominate a mutual arbiter for a private-mode ticket (buyer or seller only)',
        inputSchema: nominateArbiterSchema,
      },
      async ({ id, arbiterPubkey }) => {
        const data = await callApi<unknown>(`/api/tickets/${id}/nominate-arbiter`, {
          method: 'POST',
          body: JSON.stringify({ callerPubkey: ctx.pubkey, arbiterPubkey }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('tickets'))
    server.registerTool(
      'accept_ticket_arbiter',
      {
        description: 'Accept the mutual-arbiter role on a private-mode ticket (acting as the arbiter)',
        inputSchema: acceptArbiterSchema,
      },
      async ({ id, arbiterPubkey, arbiterSignature }) => {
        const data = await callApi<unknown>(`/api/tickets/${id}/accept-arbiter`, {
          method: 'POST',
          body: JSON.stringify({ arbiterPubkey, ...(arbiterSignature ? { arbiterSignature } : {}) }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('tickets'))
    server.registerTool(
      'submit_private_verdict',
      {
        description: 'Submit a signed mutual-arbiter verdict for a private-mode ticket dispute. The signedEvent must be produced and Schnorr-signed by the arbiter holding their own private key.',
        inputSchema: submitPrivateVerdictSchema,
      },
      async ({ id, arbiterPubkey, outcome, reasoning, signedEvent }) => {
        const data = await callApi<unknown>(`/api/tickets/${id}/private-verdict`, {
          method: 'POST',
          body: JSON.stringify({ arbiterPubkey, outcome, ...(reasoning ? { reasoning } : {}), signedEvent }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      }
    );
}
