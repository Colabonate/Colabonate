import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import OpenAI from 'openai';
import { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_OVERRIDE, DEFAULT_MODEL, API_BASE, ADAPTER_ENABLED, AI_INTERNAL_SECRET, PLATFORM_LLM_CONFIGURED, PLATFORM_MAX_OUTPUT_TOKENS, PLATFORM_MAX_TOOL_ROUNDS, PLATFORM_MAX_INPUT_TOKENS, LLM_MAX_INPUT_TOKENS, AI_ESCROW_ACTIVE } from '../config.js';
import { ADAPTERS, findAdapter, type AdapterDef } from './registry.js';
import { probeAdapter, resolveRuntime, spawnAdapter, type AdapterRuntime } from './runner.js';
import { buildSystemPrompt, buildGuestSystemPrompt, buildAdapterContextPrefix } from './system-prompt.js';
import { getCategorySlugs } from './category-slugs.js';
import { fitMessagesToBudget } from './context-budget.js';
import { registerOfferTools } from '../tools/offers.js';
import { registerCooperationTools } from '../tools/cooperations.js';
import { registerCompanyTools } from '../tools/companies.js';
import { registerTicketTools } from '../tools/tickets.js';
import { registerIdentityTools } from '../tools/identity.js';
import { registerDaoTools } from '../tools/dao.js';
import { registerImageTools } from '../tools/images.js';
import { registerBountyTools } from '../tools/bounties.js';
import type { ToolContext } from '../tools/offers.js';

export const TOOL_LABELS: Record<string, string> = {
  search_offers: 'Searching offers…',
  search_my_offers: 'Searching your offers…',
  get_offer: 'Loading offer…',
  create_offer: 'Creating offer…',
  update_offer: 'Updating offer…',
  delete_offer: 'Deleting offer…',
  discover_cooperations: 'Searching cooperations…',
  get_my_cooperations: 'Loading your cooperations…',
  get_cooperation: 'Loading cooperation…',
  create_cooperation: 'Creating cooperation…',
  get_my_tickets: 'Loading tickets…',
  get_ticket: 'Loading ticket…',
  create_ticket: 'Creating ticket…',
  get_ticket_payment_status: 'Checking payment status…',
  update_ticket_status: 'Updating ticket status…',
  release_ticket_payment: 'Releasing payment…',
  confirm_direct_payment: 'Confirming payment…',
  confirm_canvas_fee: 'Confirming canvas fee…',
  open_ticket_dispute: 'Opening dispute…',
  nominate_ticket_arbiter: 'Nominating arbiter…',
  accept_ticket_arbiter: 'Accepting arbiter role…',
  list_ticket_arbiters: 'Loading arbiters…',
  submit_private_verdict: 'Submitting verdict…',
  list_bounties: 'Listing bounties…',
  get_bounty: 'Loading bounty…',
  my_bounty_applications: 'Loading your bounty applications…',
  apply_to_bounty: 'Applying to bounty…',
  list_companies: 'Listing companies…',
  get_my_company: 'Loading your company…',
  upsert_company: 'Saving company…',
  get_identity: 'Loading identity…',
  get_reviews: 'Loading reviews…',
  list_daos: 'Listing DAOs…',
  get_dao: 'Loading DAO…',
  list_proposals: 'Listing proposals…',
  get_proposal: 'Loading proposal…',
  create_proposal: 'Creating proposal…',
  publish_proposal: 'Publishing proposal…',
  vote_proposal: 'Casting vote…',
  list_dao_members: 'Listing DAO members…',
  get_dao_treasury: 'Loading treasury…',
  get_governance_config: 'Loading governance config…',
  get_my_notifications: 'Loading notifications…',
  mark_notification_read: 'Marking notification read…',
  mark_all_notifications_read: 'Marking notifications read…',
  archive_notification: 'Archiving notification…',
  update_cooperation: 'Updating cooperation…',
  get_pending_images: 'Loading attached images…',
  upload_image: 'Uploading image…',
};

export type SSEEvent =
  | { type: 'provider-info'; info: ProviderInfo }
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-start'; tool: string; label: string }
  | { type: 'tool-result'; payload: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string; code?: string };

// ADR-281 D7 — effective provider after server-side resolution, emitted as the
// FIRST SSE event so both assistant surfaces can render the provider badge
// without an extra request.
export type ProviderInfo = {
  provider: 'local' | 'openai' | 'adapter' | 'platform';
  label: string;
  model?: string;
  requestsRemaining?: number;
  supportsImages: boolean;
};

// Result kinds the adapter can emit. A runtime const so tests can assert the
// frontend union (apps/colabonate-app .../ai-assistant.types.ts) stays in sync —
// the two packages share no type module.
export const ENTITY_RESULT_KINDS = [
  'offers',
  'cooperations',
  'companies',
  'tickets',
  'proposals',
  'daos',
  'dao_members',
  'dao_treasury',
  'bounties',
  'bounty_applications',
  'payment_status',
  'pending_images',
  'image_uploaded',
  'created',
  'updated',
  'deleted',
  'unknown',
] as const;

export type EntityResultKind = (typeof ENTITY_RESULT_KINDS)[number];

type EntityPayload = {
  kind: EntityResultKind;
  items?: unknown[];
  entityType?: string;
  entity?: unknown;
  changed?: string[];
  id?: string;
  title?: string;
};

export function parseToolResult(toolName: string, textResult: string): EntityPayload {
  try {
    const parsed = JSON.parse(textResult);
    if (parsed.offer && parsed.changed) {
      return { kind: 'updated', entityType: inferEntityType(toolName), entity: parsed.offer, changed: parsed.changed };
    }
    if (parsed.cooperation && parsed.changed) {
      return { kind: 'updated', entityType: 'cooperation', entity: parsed.cooperation, changed: parsed.changed };
    }
    if (parsed.created) return { kind: 'created', entityType: inferEntityType(toolName), entity: parsed.offer || parsed.cooperation || parsed.ticket || parsed.company || parsed.proposal };
    if (parsed.published) return { kind: 'updated', entityType: 'proposal', entity: parsed.proposal, changed: ['status'] };
    if (parsed.deleted) return { kind: 'deleted', entityType: inferEntityType(toolName), id: parsed.id, title: parsed.title };
    if (parsed.offer) return { kind: 'offers', items: [parsed.offer] };
    if (parsed.offers) return { kind: 'offers', items: parsed.offers };
    if (parsed.cooperation) return { kind: 'cooperations', items: [parsed.cooperation] };
    if (parsed.cooperations) return { kind: 'cooperations', items: parsed.cooperations };
    if (parsed.company) return { kind: 'companies', items: [parsed.company] };
    if (parsed.companies) return { kind: 'companies', items: parsed.companies };
    if (parsed.ticket) return { kind: 'tickets', items: [parsed.ticket] };
    if (parsed.tickets) return { kind: 'tickets', items: parsed.tickets };
    if (parsed.proposal) return { kind: 'proposals', items: [parsed.proposal] };
    if (parsed.proposals) return { kind: 'proposals', items: parsed.proposals };
    if (parsed.dao) return { kind: 'daos', items: [parsed.dao] };
    if (parsed.daos) return { kind: 'daos', items: parsed.daos };
    if (parsed.members) return { kind: 'dao_members', items: parsed.members };
    if (parsed.treasury) return { kind: 'dao_treasury', items: [parsed.treasury] };
    if (parsed.vote && parsed.proposal) return { kind: 'proposals', items: [parsed.proposal] };
    if (parsed.tasks) return { kind: 'bounties', items: parsed.tasks };
    if (parsed.task) return { kind: 'bounties', items: [parsed.task] };
    if (parsed.applications) return { kind: 'bounty_applications', items: parsed.applications };
    if (parsed.status && typeof parsed.paid === 'boolean') return { kind: 'payment_status', entity: parsed };
    if (parsed.images) return { kind: 'pending_images', items: parsed.images };
    if (parsed.success && parsed.url) return { kind: 'image_uploaded', entity: { url: parsed.url } };
    return { kind: 'unknown', items: [parsed] };
  } catch {
    return { kind: 'unknown', items: [] };
  }
}

function inferEntityType(toolName: string): string {
  if (toolName.includes('offer')) return 'offer';
  if (toolName.includes('cooperation')) return 'cooperation';
  if (toolName.includes('company')) return 'company';
  if (toolName.includes('ticket')) return 'ticket';
  if (toolName.includes('proposal')) return 'proposal';
  if (toolName.includes('dao') || toolName.includes('governance') || toolName.includes('treasury')) return 'dao';
  return 'unknown';
}

// ADR-389: map a provider error to a user-facing SSE event. A context-length
// rejection gets its own code so the assistant surfaces an actionable message
// ("start a new chat") instead of the raw provider 400 text.
function llmErrorEvent(err: unknown, prefix: string): SSEEvent {
  const text = err instanceof Error ? err.message : String(err);
  if (/maximum context length|context length|too many tokens|reduce the length/i.test(text)) {
    return {
      type: 'error',
      code: 'AI_CONTEXT_TOO_LARGE',
      message: 'This request is too large for the AI model context. Start a new chat or shorten your message.',
    };
  }
  return { type: 'error', message: `${prefix}: ${text}` };
}

// FU-291 infrastructure — line-buffers an adapter's stdout and, when the
// adapter declares a `parseToolActivity` parser, classifies each complete
// line into tool-start/tool-result SSE events (reusing `parseToolResult`
// above, same as the Ollama/OpenAI tool path) instead of raw text. Adapters
// without a parser (all three today, see registry.ts) fall through to the
// original unbuffered pass-through — zero behavior change for v1.
function makeAdapterStdoutEmitter(
  adapter: AdapterDef,
  emit: (event: SSEEvent) => void,
): { onStdout: (chunk: string) => void; flush: () => void } {
  if (!adapter.parseToolActivity) {
    return { onStdout: (chunk) => emit({ type: 'text-delta', delta: chunk }), flush: () => {} };
  }
  let buffer = '';
  const onStdout = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? ''; // keep the last, possibly-incomplete line for the next chunk
    for (const line of lines) {
      const parsed = adapter.parseToolActivity!(line);
      if (!parsed) {
        emit({ type: 'text-delta', delta: `${line}\n` });
      } else if (parsed.kind === 'tool-start') {
        emit({ type: 'tool-start', tool: parsed.tool ?? 'unknown', label: parsed.label ?? TOOL_LABELS[parsed.tool ?? ''] ?? 'Running tool…' });
      } else {
        emit({ type: 'tool-result', payload: parseToolResult(parsed.tool ?? '', parsed.resultText ?? '') });
      }
    }
  };
  const flush = () => {
    if (buffer) emit({ type: 'text-delta', delta: buffer });
    buffer = '';
  };
  return { onStdout, flush };
}

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

// Reasoning models (MiniMax-M2, Qwen3, …) emit their chain-of-thought as
// <think>…</think> inside message content. Strip it from the visible stream;
// tags may be split across SSE chunks, so a tail buffer is retained until a
// potential tag prefix is disambiguated. Exported for the scratch test only.
export function createThinkTagFilter(): { push: (delta: string) => string; flush: () => string } {
  let buf = '';
  let inThink = false;

  const push = (delta: string): string => {
    buf += delta;
    let out = '';
    while (buf.length > 0) {
      if (inThink) {
        const close = buf.indexOf(THINK_CLOSE);
        if (close === -1) {
          buf = buf.slice(-(THINK_CLOSE.length - 1));
          break;
        }
        buf = buf.slice(close + THINK_CLOSE.length);
        inThink = false;
        continue;
      }
      const open = buf.indexOf(THINK_OPEN);
      if (open !== -1) {
        out += buf.slice(0, open);
        buf = buf.slice(open + THINK_OPEN.length);
        inThink = true;
        continue;
      }
      let keep = 0;
      for (let k = Math.min(buf.length, THINK_OPEN.length - 1); k > 0; k--) {
        if (THINK_OPEN.startsWith(buf.slice(-k))) {
          keep = k;
          break;
        }
      }
      out += buf.slice(0, buf.length - keep);
      buf = buf.slice(buf.length - keep);
      break;
    }
    return out;
  };

  const flush = (): string => {
    // An unterminated think block is dropped; anything else is safe to emit.
    const out = inThink ? '' : buf;
    buf = '';
    return out;
  };

  return { push, flush };
}

export interface OllamaParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_ctx?: number;
  repeat_penalty?: number;
  seed?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4000;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeCustomInstructions(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL_CHARS, '').trim().slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH);
  return cleaned.length > 0 ? cleaned : undefined;
}

async function validateToken(token: string): Promise<{ pubkey: string; identityLevel: number } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { pubkey: string; identityLevel: number };
    return { pubkey: data.pubkey, identityLevel: data.identityLevel ?? 0 };
  } catch {
    return null;
  }
}

// ADR-281 D4 — internal-backend channel: fetch the user's provider selection
// (with the DECRYPTED key) from the API server. Guarded by the shared
// AI_INTERNAL_SECRET; disabled when the secret is unset. Failures (secret
// missing, HTTP error, no row) fall back to the operator env chain.
interface UserAiConfigInternal {
  provider: string;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  adapterId: string | null;
  runtime: string | null;
  adapterArgs: string[] | null;
}

async function fetchUserAiConfig(token: string): Promise<UserAiConfigInternal | null> {
  if (!AI_INTERNAL_SECRET) return null;
  try {
    const res = await fetch(`${API_BASE}/api/ai/config/plain`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-ai-internal-secret': AI_INTERNAL_SECRET,
      },
    });
    if (!res.ok) return null;
    return await res.json() as UserAiConfigInternal;
  } catch {
    return null;
  }
}

// ADR-384 D3 - atomic credit reservation on the API server (CAS decrement).
// `ok:false` distinguishes exhausted credits from an infrastructure failure so
// the caller can show the right message; neither ever falls through to a free
// provider.
type CreditPayer = { token: string } | { guestSessionId: string };

function creditRequest(who: CreditPayer, action: 'reserve' | 'refund'): [string, RequestInit] {
  if ('guestSessionId' in who) {
    return [`${API_BASE}/api/ai/credits/guest/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ai-internal-secret': AI_INTERNAL_SECRET },
      body: JSON.stringify({ guestSessionId: who.guestSessionId }),
    }];
  }
  return [`${API_BASE}/api/ai/credits/${action}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${who.token}`, 'x-ai-internal-secret': AI_INTERNAL_SECRET },
  }];
}

async function reserveAiCredit(who: CreditPayer): Promise<{ ok: true; requestsRemaining: number } | { ok: false; code: 'AI_CREDITS_EXHAUSTED' | 'AI_CREDITS_UNAVAILABLE' }> {
  if (!AI_INTERNAL_SECRET) return { ok: false, code: 'AI_CREDITS_UNAVAILABLE' };
  try {
    const res = await fetch(...creditRequest(who, 'reserve'));
    if (res.status === 409) return { ok: false, code: 'AI_CREDITS_EXHAUSTED' };
    if (!res.ok) return { ok: false, code: 'AI_CREDITS_UNAVAILABLE' };
    const data = await res.json() as { requestsRemaining?: number };
    return { ok: true, requestsRemaining: data.requestsRemaining ?? 0 };
  } catch {
    return { ok: false, code: 'AI_CREDITS_UNAVAILABLE' };
  }
}

async function refundAiCredit(who: CreditPayer): Promise<void> {
  try {
    await fetch(...creditRequest(who, 'refund'));
  } catch {
    // best effort - a lost refund costs the user one request, never Colabonate money
  }
}

// ADR-281 D2 — resolution chain: body-provided client preference → per-user
// config (API server) → operator env (this process). Returns the effective
// provider to stream with, or an error event payload when the choice cannot
// be honored (adapter disabled / no adapter available).
type ResolvedProvider =
  | { kind: 'error'; info: ProviderInfo; message: string }
  | { kind: 'openai'; info: ProviderInfo; endpoint: { baseUrl: string; apiKey: string }; platform?: boolean }
  | { kind: 'adapter'; info: ProviderInfo; adapter: NonNullable<ReturnType<typeof findAdapter>>; runtime: AdapterRuntime; extraArgs: string[] | null };

export async function resolveProvider(
  requested: string | undefined,
  requestedModel: string | undefined,
  userCfg: UserAiConfigInternal | null
): Promise<ResolvedProvider> {
  if (requested === 'adapter') {
    const infoBase: ProviderInfo = { provider: 'adapter', label: 'CLI agent', supportsImages: false };
    if (!ADAPTER_ENABLED) {
      return { kind: 'error', info: { ...infoBase, label: 'CLI agent (disabled)' }, message: 'CLI adapter mode is disabled on this deployment' };
    }
    const stored = userCfg?.provider === 'adapter' ? userCfg : null;
    const storedRuntime = (stored?.runtime as AdapterRuntime | null) ?? null;
    // FU-292 (scoped) — only applied when the stored adapter matches the one
    // actually resolved below; a leftover adapterArgs from a previously
    // selected adapter must never leak onto a different one's invocation.
    const storedExtraArgs = stored?.adapterId && Array.isArray(stored.adapterArgs) ? stored.adapterArgs : null;
    let def = stored?.adapterId ? findAdapter(stored.adapterId) : undefined;
    if (!def) {
      // No stored preference → first available adapter wins (D10 fallback).
      const runtime = resolveRuntime(storedRuntime);
      def = ADAPTERS.find((a) => probeAdapter(a.id, runtime).available);
    }
    if (!def) {
      return {
        kind: 'error',
        info: infoBase,
        message: 'No CLI agent found on this platform. Install OpenCode, Pi Agent or Hermes (or run via bun/npx).',
      };
    }
    const runtime = resolveRuntime(storedRuntime);
    const extraArgs = def.id === stored?.adapterId ? storedExtraArgs : null;
    return { kind: 'adapter', info: { ...infoBase, label: def.label }, adapter: def, runtime, extraArgs };
  }

  // ADR-384 D1: Colabonate-hosted mode - the operator's own LLM account, gated
  // on a paid credit reservation done by the caller (handleAIChat).
  if (requested === 'platform') {
    if (!PLATFORM_LLM_CONFIGURED) {
      return {
        kind: 'error',
        info: { provider: 'platform', label: 'Colabonate Hosted (unavailable)', supportsImages: false },
        message: 'Colabonate-hosted AI is not available on this deployment yet',
      };
    }
    return {
      kind: 'openai',
      platform: true,
      info: { provider: 'platform', label: 'Colabonate Hosted', model: LLM_MODEL_OVERRIDE, supportsImages: true },
      endpoint: { baseUrl: LLM_BASE_URL, apiKey: LLM_API_KEY },
    };
  }

  if (userCfg?.provider === 'openai' && userCfg.baseUrl && userCfg.apiKey) {
    const model = userCfg.model ?? LLM_MODEL_OVERRIDE ?? requestedModel ?? DEFAULT_MODEL;
    return {
      kind: 'openai',
      info: { provider: 'openai', label: 'OpenAI-compatible provider', model, supportsImages: true },
      endpoint: { baseUrl: userCfg.baseUrl, apiKey: userCfg.apiKey },
    };
  }

  // Operator env chain (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_OVERRIDE;
  // OLLAMA_BASE legacy alias).
  //
  // ADR-384 amendment (F1): when the operator configured a real hosted LLM
  // (PLATFORM_LLM_CONFIGURED), that env chain IS the paid Colabonate-hosted
  // endpoint. An unresolved request (no BYOK, no stored selection) must not
  // reach it for free — route it through `platform` so the caller reserves a
  // credit. The env chain stays free only when no hosted LLM is configured
  // (local dev / Ollama).
  if (PLATFORM_LLM_CONFIGURED) {
    return {
      kind: 'openai',
      platform: true,
      info: { provider: 'platform', label: 'Colabonate Hosted', model: LLM_MODEL_OVERRIDE, supportsImages: true },
      endpoint: { baseUrl: LLM_BASE_URL, apiKey: LLM_API_KEY },
    };
  }

  const model = LLM_MODEL_OVERRIDE || requestedModel || DEFAULT_MODEL;
  const provider: 'openai' | 'local' = LLM_MODEL_OVERRIDE ? 'openai' : 'local';
  return {
    kind: 'openai',
    info: {
      provider,
      label: provider === 'openai' ? 'Platform default' : 'Local (Ollama)',
      model,
      supportsImages: true,
    },
    endpoint: { baseUrl: LLM_BASE_URL, apiKey: LLM_API_KEY },
  };
}

// Assistant plan F3 — tools the in-app chat must never advertise. `submit_private_verdict`
// needs an arbiter-signed Nostr event the LLM can never produce, and
// `accept_ticket_arbiter` commits the acting user to an arbiter role. Both stay
// on the external /mcp gateway for a deliberate client; here they are simply
// not registered, so `tools/list` cannot offer them.
const CHAT_EXCLUDED_TOOLS = new Set(['submit_private_verdict', 'accept_ticket_arbiter']);

function excludeTools(server: McpServer, excluded: ReadonlySet<string>): void {
  const registerTool = server.registerTool.bind(server) as unknown as {
    (name: string, config: Record<string, unknown>, cb: (...args: unknown[]) => unknown): void;
    (name: string, cb: (...args: unknown[]) => unknown): void;
  };
  server.registerTool = ((name: string, ...rest: unknown[]) => {
    if (excluded.has(name)) return;
    const raw = rest.length >= 2 ? rest[1] : rest[0];
    if (rest.length >= 2) {
      registerTool(name, rest[0] as Record<string, unknown>, raw as (...args: unknown[]) => Promise<unknown>);
    } else {
      registerTool(name, raw as (...args: unknown[]) => Promise<unknown>);
    }
  }) as unknown as typeof server.registerTool;
}

export function createAdapterServer(ctx: ToolContext, pendingImages: string[] = []): { server: McpServer; client: Client; ready: Promise<void> } {
  const adapterServer = new McpServer(
    { name: 'colabonate-adapter-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  excludeTools(adapterServer, CHAT_EXCLUDED_TOOLS);

  const imageCtx = { ...ctx, pendingImages };

  registerOfferTools(adapterServer, imageCtx);
  registerCooperationTools(adapterServer, imageCtx);
  registerCompanyTools(adapterServer, ctx);
  registerTicketTools(adapterServer, ctx);
  registerBountyTools(adapterServer, ctx);
  registerIdentityTools(adapterServer, ctx);
  registerDaoTools(adapterServer, ctx);
  registerImageTools(adapterServer, imageCtx);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const mcpClient = new Client({
    name: 'colabonate-ai-adapter',
    version: '1.0.0',
  });

  const ready = (async () => {
    await adapterServer.connect(serverTransport);
    await mcpClient.connect(clientTransport);
  })();

  return { server: adapterServer, client: mcpClient, ready };
}

async function* streamAIChat(
  message: string,
  ctx: ToolContext,
  endpoint: { baseUrl: string; apiKey: string },
  model: string = DEFAULT_MODEL,
  history: Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }> = [],
  ollamaParams: OllamaParams = {},
  images: string[] = [],
  customInstructions?: string,
  limits?: { maxTokens?: number; maxToolRounds?: number; maxInputTokens?: number },
  noTools = false,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent, void, unknown> {
  const { server: adapterServer, client: mcpClient, ready } = createAdapterServer(ctx, images);
  await ready;

  try {

  // ADR-390: a client "Stop" aborts the shared signal; stop before doing any
  // further provider work instead of streaming into a dead socket.
  if (signal?.aborted) return;

  // ADR-384 D10: an anonymous guest never gets a tool surface, period.
  const toolsResult = noTools ? { tools: [] } : await mcpClient.listTools();
  const tools = (toolsResult as { tools?: MCPTool[] }).tools ?? [];
  const toolSchemas = tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema,
    },
  }));

  const olly = new OpenAI({ baseURL: endpoint.baseUrl, apiKey: endpoint.apiKey });
  // Assistant plan F7/F8/1.1: guests get the guide prompt (never the tool/safety
  // rules); the signed-in prompt lists the tools actually registered this turn
  // and the real category slugs.
  const systemPrompt = noTools
    ? buildGuestSystemPrompt({ escrowEnabled: AI_ESCROW_ACTIVE })
    : buildSystemPrompt({
        identityLevel: ctx.identityLevel,
        customInstructions,
        escrowEnabled: AI_ESCROW_ACTIVE,
        categories: await getCategorySlugs(),
        availableTools: toolSchemas.map((t) => t.function.name),
      });

  const userContent = images.length > 0
    ? [
        { type: 'text' as const, text: message },
        ...images.map(img => ({
          type: 'image_url' as const,
          image_url: { url: img },
        })),
      ]
    : message;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => {
      if (h.images && h.images.length > 0) {
        return {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: h.content },
            ...h.images.map(img => ({
              type: 'image_url' as const,
              image_url: { url: img },
            })),
          ],
        };
      }
      return { role: h.role, content: h.content } as OpenAI.Chat.ChatCompletionMessageParam;
    }),
    { role: 'user', content: userContent },
  ];

  const extraBody: Record<string, unknown> = {};
  if (ollamaParams.temperature !== undefined) extraBody.temperature = ollamaParams.temperature;
  if (ollamaParams.top_p !== undefined) extraBody.top_p = ollamaParams.top_p;
  if (ollamaParams.top_k !== undefined) extraBody.top_k = ollamaParams.top_k;
  if (ollamaParams.num_ctx !== undefined) extraBody.num_ctx = ollamaParams.num_ctx;
  if (ollamaParams.repeat_penalty !== undefined) extraBody.repeat_penalty = ollamaParams.repeat_penalty;
  if (ollamaParams.seed !== undefined) extraBody.seed = ollamaParams.seed;
  if (ollamaParams.frequency_penalty !== undefined) extraBody.frequency_penalty = ollamaParams.frequency_penalty;
  if (ollamaParams.presence_penalty !== undefined) extraBody.presence_penalty = ollamaParams.presence_penalty;
  if (ollamaParams.stop !== undefined) extraBody.stop = ollamaParams.stop;
  if (limits?.maxTokens !== undefined) extraBody.max_tokens = limits.maxTokens;

  // ADR-389: trim history and tool output to the model's input budget before
  // every provider call, so a long chat or a large tool payload can never
  // overflow the context window with a raw 400.
  const maxInputTokens = limits?.maxInputTokens;
  const prepareMessages = (): { messages: OpenAI.Chat.ChatCompletionMessageParam[]; overflow: boolean } => {
    if (!maxInputTokens || maxInputTokens <= 0) return { messages, overflow: false };
    const fit = fitMessagesToBudget(messages, maxInputTokens);
    return { messages: fit.messages, overflow: fit.overflow };
  };
  const contextOverflowEvent = (): SSEEvent => ({
    type: 'error',
    code: 'AI_CONTEXT_TOO_LARGE',
    message: 'This request is too large for the AI model context. Start a new chat or shorten your message.',
  });

  let completion: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
  const firstRequest = prepareMessages();
  if (firstRequest.overflow) {
    yield contextOverflowEvent();
    return;
  }
  try {
    completion = await olly.chat.completions.create({
      model,
      messages: firstRequest.messages,
      ...(toolSchemas.length > 0 ? { tools: toolSchemas } : {}),
      stream: true,
      ...extraBody,
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming, { signal });
  } catch (err) {
    if (signal?.aborted) return;
    yield llmErrorEvent(err, 'LLM request failed');
    return;
  }

  const MAX_TOOL_ROUNDS = limits?.maxToolRounds ?? 5;
  let currentStream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk> = completion;

  // F5: MAX_TOOL_ROUNDS counts tool rounds; one final answer-only round follows
  // so the last tool results are always turned into text instead of being paid
  // for and discarded. On that final round the model is called with
  // tool_choice: 'none'.
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const isFinalRound = round === MAX_TOOL_ROUNDS;
    const toolCallMap = new Map<number, { name: string; arguments: string; id: string }>();
    let lastText = '';
    const thinkFilter = createThinkTagFilter();

    for await (const chunk of currentStream) {
      if (signal?.aborted) return;
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        const visible = thinkFilter.push(delta.content);
        if (visible) {
          lastText += visible;
          yield { type: 'text-delta', delta: visible };
        }
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (tc.id && tc.function?.name) {
            toolCallMap.set(idx, { name: tc.function.name, arguments: '', id: tc.id });
          }
          const entry = toolCallMap.get(idx);
          if (tc.function?.arguments && entry) {
            entry.arguments += tc.function.arguments;
          }
        }
      }

      const finishReason = chunk.choices[0]?.finish_reason;
      if (finishReason === 'tool_calls' && toolCallMap.size > 0) {
        // The final round asked for tool_choice: 'none'; if the model still
        // emitted a tool call, stop with whatever text already streamed.
        if (isFinalRound) break;

        const toolCalls = Array.from(toolCallMap.values());

        const assistantToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
        const toolResults: Array<{ id: string; content: string }> = [];

        for (const { name, arguments: argsStr, id } of toolCalls) {
          if (signal?.aborted) return;
          yield { type: 'tool-start', tool: name, label: TOOL_LABELS[name] ?? 'Running tool…' };

          // F4: malformed JSON from the model must not abort the whole turn —
          // hand the parse failure back as a tool result so it can self-correct.
          let args: Record<string, unknown> = {};
          let parseError: string | null = null;
          try {
            args = JSON.parse(argsStr || '{}') as Record<string, unknown>;
          } catch {
            parseError = 'Invalid JSON in tool arguments.';
          }

          let toolResultText: string;
          if (parseError) {
            toolResultText = JSON.stringify({ error: `${parseError} Re-issue the tool call with valid JSON.` });
          } else {
            try {
              const result = await mcpClient.callTool({ name, arguments: args }) as { content: Array<{ text?: string }> };
              toolResultText = result.content[0]?.text ?? '{}';
              const payload = parseToolResult(name, toolResultText);
              yield { type: 'tool-result', payload };
            } catch (err) {
              // F4: a failed tool becomes a model-visible result (self-correction)
              // rather than a stream-killing error event.
              const message = err instanceof Error ? err.message : String(err);
              toolResultText = JSON.stringify({ error: `Tool ${name} failed: ${message}` });
            }
          }

          assistantToolCalls.push({ id, type: 'function', function: { name, arguments: argsStr || '{}' } });
          toolResults.push({ id, content: toolResultText });
        }

        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: assistantToolCalls,
        } as unknown as OpenAI.Chat.ChatCompletionMessageParam);

        for (const { id, content } of toolResults) {
          messages.push({ role: 'tool' as const, tool_call_id: id, content });
        }

        const nextRequest = prepareMessages();
        if (nextRequest.overflow) {
          yield contextOverflowEvent();
          return;
        }
        if (signal?.aborted) return;
        const nextIsFinal = round + 1 === MAX_TOOL_ROUNDS;
        try {
          currentStream = await olly.chat.completions.create({
            model,
            messages: nextRequest.messages,
            ...(toolSchemas.length > 0 ? { tools: toolSchemas } : {}),
            ...(nextIsFinal ? { tool_choice: 'none' } : {}),
            stream: true,
            // F5: sampling params ride along on follow-up rounds too (was max_tokens only).
            ...extraBody,
          } as OpenAI.Chat.ChatCompletionCreateParamsStreaming, { signal });
        } catch (err) {
          if (signal?.aborted) return;
          yield llmErrorEvent(err, 'LLM request failed');
          return;
        }

        lastText = '';
        break;
      }
    }

    if (toolCallMap.size === 0) {
      const tail = thinkFilter.flush();
      if (tail) {
        lastText += tail;
        yield { type: 'text-delta', delta: tail };
      }
      if (lastText) {
        messages.push({ role: 'assistant', content: lastText });
      }
      break;
    }
  }

  yield { type: 'done' };
  } finally {
    await mcpClient.close().catch(() => {});
    await adapterServer.close().catch(() => {});
  }
}

export async function handleAIChat(
  req: Request,
  writer: WritableStreamDefaultWriter<Uint8Array>,
  disconnectSignal?: AbortSignal
): Promise<void> {
  // ADR-384 D3: a reserved credit is refunded only if the turn failed before
  // any output reached the user (never for a user-side abort mid-stream).
  let reservedPayer: CreditPayer | null = null;
  let producedOutput = false;

  // ADR-390: the socket close (client pressed Stop, navigated away, lost the
  // connection) aborts this controller; it is threaded into the provider SDK and
  // the CLI adapter so a cancelled turn stops costing tokens/CPU immediately.
  const abortController = new AbortController();
  if (disconnectSignal) {
    if (disconnectSignal.aborted) abortController.abort();
    else disconnectSignal.addEventListener('abort', () => abortController.abort(), { once: true });
  }
  const signal = abortController.signal;

  try {
    const body = await req.json() as {
      message: string;
      token?: string;
      guestSessionId?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string; images?: string[] }>;
      model?: string;
      ollama?: OllamaParams;
      images?: string[];
      provider?: string;
      customInstructions?: string;
    };

    const emit = (event: SSEEvent) => {
      if (signal.aborted) return;
      try {
        writer.write(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
      } catch {
        // The client is gone — stop the upstream work rather than streaming on.
        abortController.abort();
      }
    };

    // ADR-384 D10: the ONLY unauthenticated path — `platform` mode with a
    // guest session id, no tools, no per-user config. Every other mode still
    // requires a real login.
    const guestSessionId = !body.token && body.provider === 'platform' && typeof body.guestSessionId === 'string' && body.guestSessionId
      ? body.guestSessionId
      : null;

    if (!body.message || (!body.token && !guestSessionId)) {
      emit({ type: 'error', message: 'message and token required' });
      writer.close();
      return;
    }

    const authResult = guestSessionId ? { pubkey: '', identityLevel: 0 } : await validateToken(body.token as string);
    if (!authResult) {
      emit({ type: 'error', message: 'Authentication failed: invalid or expired token' });
      writer.close();
      return;
    }

    const ctx: ToolContext = {
      pubkey: authResult.pubkey,
      token: body.token ?? '',
      identityLevel: authResult.identityLevel,
    };

    const ollamaParams = body.ollama ?? {};
    const images = Array.isArray(body.images)
      ? (body.images as unknown[]).filter((i): i is string => typeof i === 'string')
      : [];
    // F7: guests get the dedicated guest prompt (buildGuestSystemPrompt), not a
    // "custom instruction" layered onto the tool rules; no user preferences apply.
    const customInstructions = guestSessionId ? undefined : sanitizeCustomInstructions(body.customInstructions);

    // ADR-281 D2/D4: resolve the effective provider (client preference → user
    // config on the API server → operator env) before the first SSE event.
    const userCfg = guestSessionId ? null : await fetchUserAiConfig(body.token as string);
    const resolved = await resolveProvider(body.provider, body.model, userCfg);

    if (resolved.kind === 'error') {
      emit({ type: 'provider-info', info: resolved.info });
      emit({ type: 'error', message: resolved.message });
      writer.close();
      return;
    }

    if (resolved.kind === 'openai' && resolved.platform) {
      const payer: CreditPayer = guestSessionId ? { guestSessionId } : { token: body.token as string };
      const reservation = await reserveAiCredit(payer);
      if (!reservation.ok) {
        emit({ type: 'provider-info', info: resolved.info });
        emit({
          type: 'error',
          code: reservation.code,
          message: reservation.code === 'AI_CREDITS_EXHAUSTED'
            ? 'You are out of Colabonate AI credits'
            : 'AI credits are temporarily unavailable',
        });
        writer.close();
        return;
      }
      reservedPayer = payer;
      resolved.info.requestsRemaining = reservation.requestsRemaining;
    }

    // provider-info is ALWAYS the first event (ADR-281 D7).
    emit({ type: 'provider-info', info: resolved.info });

    if (resolved.kind === 'adapter') {
      if (images.length > 0) {
        emit({ type: 'error', message: 'Image attachments are not supported in CLI adapter mode' });
        writer.close();
        return;
      }
      const adapterContext = buildAdapterContextPrefix({ identityLevel: ctx.identityLevel, customInstructions });
      const prompt = [adapterContext, ...(body.history ?? []).map((h) => `${h.role}: ${h.content}`), body.message].join('\n\n');
      const { onStdout, flush } = makeAdapterStdoutEmitter(resolved.adapter, emit);
      const { exitCode, timedOut, stderrTail } = await spawnAdapter(
        resolved.adapter.id,
        resolved.runtime,
        resolved.adapter.runArgs(prompt, resolved.extraArgs ?? undefined),
        signal,
        onStdout,
      );
      flush();
      if (timedOut) {
        emit({ type: 'error', message: 'CLI agent timed out after 120s' });
      } else if (exitCode !== 0) {
        // v1: stderr tail is folded into the error event; stdout already
        // streamed as text-delta (D10).
        emit({ type: 'error', message: `CLI agent exited with code ${exitCode ?? 'unknown'}${stderrTail ? `\n${stderrTail.slice(0, 400)}` : ''}` });
      } else {
        emit({ type: 'done' });
      }
      writer.close();
      return;
    }

    // ADR-389: every provider mode gets an input budget (history + tool output
    // are trimmed to it). Hosted mode uses the tighter cost ceiling from
    // ADR-384 D3; a local Ollama is bounded by its own num_ctx; BYOK/operator
    // endpoints get the generic (env-overridable) budget.
    const maxInputTokens = resolved.platform
      ? PLATFORM_MAX_INPUT_TOKENS
      : resolved.info.provider === 'local'
        ? Math.max(2048, (ollamaParams.num_ctx ?? 8192) - PLATFORM_MAX_OUTPUT_TOKENS)
        : LLM_MAX_INPUT_TOKENS;
    const limits = {
      maxTokens: resolved.platform ? PLATFORM_MAX_OUTPUT_TOKENS : undefined,
      maxToolRounds: resolved.platform ? PLATFORM_MAX_TOOL_ROUNDS : undefined,
      maxInputTokens,
    };
    for await (const event of streamAIChat(body.message, ctx, resolved.endpoint, resolved.info.model ?? DEFAULT_MODEL, body.history, ollamaParams, images, customInstructions, limits, Boolean(guestSessionId), signal)) {
      if (signal.aborted) break;
      if (event.type === 'text-delta' || event.type === 'tool-result') producedOutput = true;
      if (event.type === 'error' && !producedOutput && reservedPayer) {
        await refundAiCredit(reservedPayer);
        reservedPayer = null;
      }
      emit(event);
    }

    writer.close().catch(() => {});
  } catch (err) {
    // A client-side Stop is not an upstream failure: never refund on it
    // (ADR-384 D3) and never write to a socket that is already gone.
    if (signal.aborted) {
      writer.close().catch(() => {});
      return;
    }
    if (reservedPayer && !producedOutput) await refundAiCredit(reservedPayer);
    try {
      // F4: serialize via JSON.stringify — a raw `${err}` could contain quotes or
      // newlines and produce a malformed SSE event the client silently drops.
      const message = err instanceof Error ? err.message : String(err);
      writer.write(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`));
      writer.close();
    } catch {
      // socket already closed
    }
  }
}
