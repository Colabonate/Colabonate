import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callApi } from './api.js';
import type { ToolContext } from './offers.js';
import { FULL_GATE, type ToolGate } from './gate.js';

const DEFAULT_DAO_ID = 'colabonate-foundation';

const listDaosSchema = z.object({});

const getDaoSchema = z.object({});

const listProposalsSchema = z.object({
  daoId: z.string().default(DEFAULT_DAO_ID),
  status: z.enum(['DRAFT', 'ACTIVE', 'PASSED', 'REJECTED', 'EXECUTED', 'FAILED']).optional(),
});

const getProposalSchema = z.object({
  daoId: z.string().default(DEFAULT_DAO_ID),
  proposalId: z.string(),
});

const createProposalSchema = z.object({
  daoId: z.string().default(DEFAULT_DAO_ID),
  title: z.string(),
  content: z.string(),
  executionStrategy: z.string().optional(),
  executionPayload: z.string().optional(),
  status: z.enum(['DRAFT', 'ACTIVE']).default('DRAFT'),
});

const publishProposalSchema = z.object({
  daoId: z.string().default(DEFAULT_DAO_ID),
  proposalId: z.string(),
});

const voteProposalSchema = z.object({
  daoId: z.string().default(DEFAULT_DAO_ID),
  proposalId: z.string(),
  choice: z.enum(['FOR', 'AGAINST', 'ABSTAIN']),
});

const listDaoMembersSchema = z.object({
  status: z.enum(['ACTIVE', 'PENDING', 'REVOKED']).optional(),
});

const getDaoTreasurySchema = z.object({
  daoId: z.string().default(DEFAULT_DAO_ID),
});

const getGovernanceConfigSchema = z.object({
  daoId: z.string().default(DEFAULT_DAO_ID),
});

export function registerDaoTools(server: McpServer, ctx: ToolContext, gate: ToolGate = FULL_GATE) {
  server.registerTool(
    'list_daos',
    {
      description: 'List all DAOs with proposal and member counts',
      inputSchema: listDaosSchema,
    },
    async () => {
      const data = await callApi<{ daos: unknown[] }>('/api/daos');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  server.registerTool(
    'get_dao',
    {
      description: 'Get the foundation DAO details including config',
      inputSchema: getDaoSchema,
    },
    async () => {
      const data = await callApi<{ dao: unknown }>('/api/dao/foundation');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  server.registerTool(
    'list_proposals',
    {
      description: 'List DAO proposals, optionally filtered by status',
      inputSchema: listProposalsSchema,
    },
    async ({ daoId, status }) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const qs = params.toString();
      const data = await callApi<{ proposals: unknown[] }>(`/api/daos/${daoId}/proposals${qs ? `?${qs}` : ''}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  server.registerTool(
    'get_proposal',
    {
      description: 'Get a single proposal with its votes',
      inputSchema: getProposalSchema,
    },
    async ({ daoId, proposalId }) => {
      const data = await callApi<{ proposal: unknown }>(`/api/daos/${daoId}/proposals/${proposalId}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  if (!gate.isGuest && gate.canWrite('dao'))
    server.registerTool(
      'create_proposal',
      {
        description: 'Create a new DAO proposal. Defaults to DRAFT status (saved but not yet voting). Set status to ACTIVE to publish immediately.',
        inputSchema: createProposalSchema,
      },
      async ({ daoId, title, content, executionStrategy, executionPayload, status }) => {
        const data = await callApi<{ proposal: unknown; nostrTemplate?: unknown }>(`/api/daos/${daoId}/proposals`, {
          method: 'POST',
          body: JSON.stringify({ callerPubkey: ctx.pubkey, title, content, executionStrategy, executionPayload, status }),
          token: ctx.token,
        });
        const proposal = data.proposal as Record<string, unknown> | undefined;
        const proposalId = proposal?.id;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ proposal: data.proposal, id: proposalId, created: true }) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('dao'))
    server.registerTool(
      'publish_proposal',
      {
        description: 'Publish a DRAFT proposal to make it ACTIVE and open for voting. Requires the caller to be the proposal author.',
        inputSchema: publishProposalSchema,
      },
      async ({ daoId, proposalId }) => {
        const data = await callApi<{ proposal: unknown; nostrTemplate?: unknown }>(`/api/daos/${daoId}/proposals/${proposalId}/publish`, {
          method: 'PATCH',
          body: JSON.stringify({ callerPubkey: ctx.pubkey }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ proposal: data.proposal, published: true }) }] };
      }
    );

  if (!gate.isGuest && gate.canWrite('dao'))
    if (!gate.isGuest && gate.canWrite('dao'))
    server.registerTool(
      'vote_proposal',
      {
        description: 'Cast a vote (FOR, AGAINST, or ABSTAIN) on a DAO proposal',
        inputSchema: voteProposalSchema,
      },
      async ({ daoId, proposalId, choice }) => {
        const data = await callApi<{ vote: unknown; proposal: unknown; nostrTemplate?: unknown; outcomeTemplate?: unknown }>(`/api/daos/${daoId}/proposals/${proposalId}/vote`, {
          method: 'POST',
          body: JSON.stringify({ callerPubkey: ctx.pubkey, choice }),
          token: ctx.token,
        });
        return { content: [{ type: 'text' as const, text: JSON.stringify({ vote: data.vote, proposal: data.proposal }) }] };
      }
    );

  server.registerTool(
    'list_dao_members',
    {
      description: 'List members of the foundation DAO, optionally filtered by status',
      inputSchema: listDaoMembersSchema,
    },
    async ({ status }) => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const qs = params.toString();
      const data = await callApi<{ members: unknown[] }>(`/api/dao/foundation/members${qs ? `?${qs}` : ''}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  server.registerTool(
    'get_dao_treasury',
    {
      description: 'Get the DAO treasury balance and recent transactions',
      inputSchema: getDaoTreasurySchema,
    },
    async ({ daoId }) => {
      const data = await callApi<{ treasury: unknown }>(`/api/daos/${daoId}/treasury`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );

  server.registerTool(
    'get_governance_config',
    {
      description: 'Get the governance configuration for a DAO (quorum, voting strategies, periods)',
      inputSchema: getGovernanceConfigSchema,
    },
    async ({ daoId }) => {
      const data = await callApi<{ config: unknown }>(`/api/daos/${daoId}/governance-config`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    }
  );
}
