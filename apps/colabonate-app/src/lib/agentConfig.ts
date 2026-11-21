/**
 * Agent Setup config sealing (ADR-306 D1/D2) — the client-side seam between
 * a seller's plaintext AGENT_SETUP config (LLM API keys, tool credentials,
 * system prompt) and the opaque blob the server stores as
 * `Offer.agentConfigSealed`. The server only ever sees ciphertext.
 *
 * D2 targets the Agent-Sub-Key from ADR-316 once it exists; that ADR is not
 * built yet, so this seals to the owner's own key (self-ECDH conversation
 * key, the same pattern `lib/cashu.ts:createNip44Codec` uses for NIP-60
 * wallet events) — the ADR's documented fallback ("Owner-Pubkey wenn kein
 * Sub-Key existiert"). Swapping in the sub-key later is a one-line change at
 * the call site (pass the sub-key's privkey instead of the owner's).
 */

import { createNip44Codec } from './cashu'
import * as nip44 from 'nostr-tools/nip44'

/**
 * ADR-342 D1: collaboration-canvas config — the declarative, cleartext
 * `canvas` sub-object of `Offer.agentConfigMeta` (mirror of the server-side
 * contract in apps/server/lib/canvas-config.ts; the server is authoritative
 * on validation).
 */
export type CanvasProvider = 'none' | 'doop-local' | 'doop-hosted'

export type CanvasProbeStatus = 'ok' | 'unreachable' | 'unchecked'

// ADR-372 D2 (revised 2026-09-21): hosted-canvas service fee is now a FLAT
// amount (2,600 sats), matching the server's PLATFORM_MIN_PAYMENT_SATS.
// Display-only — the server is authoritative and snapshots the exact sats onto
// the ticket at purchase. Only doop-hosted carries a fee (doop-local +
// agentInCanvas stay free, D6).
export const HOSTED_CANVAS_FEE_SATS = 2600

export interface AgentCanvasConfig {
  provider: CanvasProvider
  /** doop-local only — the seller's own doop instance (any reachable host). */
  instanceUrl?: string
  /** Optional pre-existing canvas to link (both doop modes). */
  canvasId?: string
  /** doop-hosted only (D4a); default 'edit'. */
  buyerAccess?: 'edit' | 'none'
  /** ADR-370 D6: doop-hosted only, opt-in — the seller's agent also works on
   *  the ticket canvas (buyer-facing disclosure + search facet). */
  agentInCanvas?: boolean
  /** Server-managed health-probe cache (D2) — read-only for clients. */
  probeStatus?: CanvasProbeStatus
  probeAt?: string
}

/** Build the `canvas` value for agentConfigMeta; null when provider is 'none'. */
export function buildCanvasConfig(input: {
  provider: CanvasProvider
  instanceUrl?: string
  canvasId?: string
  buyerAccess?: 'edit' | 'none'
  agentInCanvas?: boolean
}): AgentCanvasConfig | null {
  if (input.provider === 'none') return null
  const config: AgentCanvasConfig = { provider: input.provider }
  const instanceUrl = input.instanceUrl?.trim().replace(/\/+$/, '')
  if (input.provider === 'doop-local' && instanceUrl) config.instanceUrl = instanceUrl
  const canvasId = input.canvasId?.trim()
  if (canvasId) config.canvasId = canvasId
  if (input.provider === 'doop-hosted') {
    config.buyerAccess = input.buyerAccess ?? 'edit'
    // Persist the flag on hosted configs so an edit turning it off actually
    // clears it server-side (the server allow-list keeps explicit false).
    config.agentInCanvas = input.agentInCanvas === true
  }
  return config
}

/**
 * ADR-370 D6 (Phase 2, FU-671): map an offer's canvas declaration into the
 * cart-item shape used for the pre-purchase / review-step disclosure (G1).
 * Single shared derivation so BuyProductDetail, makeBasketItem and any future
 * entry point stay identical (ADR-237 mapper discipline).
 */
export function canvasCartFields(offer: {
  agentConfigMeta?: { canvas?: AgentCanvasConfig | null } | null
}): { canvasProvider: 'doop-local' | 'doop-hosted' | null; canvasAgentInCanvas: boolean } {
  const canvas = offer.agentConfigMeta?.canvas
  const provider = canvas?.provider
  return {
    canvasProvider: provider === 'doop-local' || provider === 'doop-hosted' ? provider : null,
    canvasAgentInCanvas: canvas?.agentInCanvas === true,
  }
}

/**
 * ADR-396 D1 (FU-848): one entry of the tool allowlist the executing agent may
 * call. `url` is an HTTPS prefix matched by the Workspace-Canister
 * (`harness.rs::find_tool`); `requiresApproval` parks each call for the
 * buyer's signed approval. `name`/`description` are the public labels shown on
 * the agent profile — the URL itself stays sealed.
 */
export interface AgentToolSecret {
  name: string
  description?: string
  url: string
  requiresApproval: boolean
}

/** Everything that must never reach the server in plaintext (ADR-306 D1). */
export interface AgentConfigSecrets {
  provider?: string
  apiKey?: string
  model?: string
  /** ADR-396 D1: required for Ollama, optional OpenAI/Anthropic-compatible endpoint otherwise. */
  baseUrl?: string
  systemPrompt?: string
  /** ADR-396 D1: sealed tool allowlist, injected as the canister's `tools`. */
  tools?: AgentToolSecret[]
  toolCredentials?: Record<string, Record<string, string>>
  orchestrationConfig?: Record<string, unknown>
  [key: string]: unknown
}

/** Seal a config object into the base64 NIP-44 blob stored as `agentConfigSealed`. */
export async function sealAgentConfig(privkeyHex: string, config: AgentConfigSecrets): Promise<string> {
  const codec = createNip44Codec(privkeyHex)
  return codec.encrypt(JSON.stringify(config))
}

/** Reverse of `sealAgentConfig` — rejects if the blob was sealed with a different key. */
export async function unsealAgentConfig(privkeyHex: string, sealed: string): Promise<AgentConfigSecrets> {
  const codec = createNip44Codec(privkeyHex)
  const plaintext = await codec.decrypt(sealed)
  return JSON.parse(plaintext) as AgentConfigSecrets
}

/**
 * FU-470 (ADR-306 D4 / ADR-311 D5, FU-434 Slice B): the config the
 * Workspace-Canister actually expects — `packages/icp-workspace-canister/
 * src/types.rs::WorkspaceConfig`, snake_case, distinct from
 * `AgentConfigSecrets` above. Built from the seller's secrets by
 * `toWorkspaceInjectedConfig` (ADR-396 D1: model, base URL and tool allowlist
 * are collected by the wizard and sealed).
 */
export interface WorkspaceInjectedConfig {
  llm_provider: 'openai' | 'anthropic' | 'ollama'
  llm_model: string
  llm_api_key: string
  llm_base_url: string | null
  system_prompt: string | null
  tools: string[]
}

export type AgentLlmProvider = WorkspaceInjectedConfig['llm_provider']

/** Fallback when a (legacy) sealed config carries no model — ADR-396 D1 collects it explicitly. */
export const DEFAULT_AGENT_MODEL: Record<AgentLlmProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-5',
  ollama: 'llama3',
}

export function toKnownProvider(value: string | undefined): AgentLlmProvider {
  if (value === 'anthropic' || value === 'ollama') return value
  return 'openai'
}

/**
 * Root-form normalization (ADR-409): the workspace appends fixed paths
 * (`{base}/v1/chat/completions` etc.), so a stored base must never carry a
 * trailing slash — nor a trailing `/v1`, which would double up. Users
 * pasting an OpenAI-SDK-style base URL ("https://api.openai.com/v1") are
 * silently corrected instead of failing after a booking.
 */
function normalizeBaseUrl(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  return trimmed ? trimmed : null
}

/**
 * ADR-396 D1 (FU-847/848): map the seller's sealed secrets onto the exact
 * config the Workspace-Canister executes (`types.rs::WorkspaceConfig`).
 * Shared by workspace injection and the canvas runner so both receive the
 * same shape. Tools become canister allowlist entries: HTTPS prefix, with a
 * leading `!` when each call needs the buyer's approval.
 */
export function toWorkspaceInjectedConfig(secrets: AgentConfigSecrets): WorkspaceInjectedConfig {
  const provider = toKnownProvider(secrets.provider)
  const tools = (secrets.tools ?? [])
    .map(t => ({ url: t.url?.trim() ?? '', requiresApproval: t.requiresApproval === true }))
    .filter(t => t.url.startsWith('https://'))
    .map(t => (t.requiresApproval ? `!${t.url}` : t.url))
  return {
    llm_provider: provider,
    llm_model: secrets.model?.trim() || DEFAULT_AGENT_MODEL[provider],
    llm_api_key: secrets.apiKey ?? '',
    llm_base_url: normalizeBaseUrl(secrets.baseUrl),
    system_prompt: secrets.systemPrompt?.trim() ? secrets.systemPrompt : null,
    tools,
  }
}

/** Field keys validateAgentRuntimeConfig attributes its errors to. */
export type AgentRuntimeConfigField = 'apiKey' | 'model' | 'baseUrl' | 'tools'

export interface AgentRuntimeConfigError {
  field: AgentRuntimeConfigField
  message: string
}

/**
 * ADR-396 D1 + ADR-409 OD-2: everything the canister would reject (or
 * silently ignore) is caught in the wizard instead of after a booking.
 * OD-2: an API key is required for EVERY flavor — the canister demands a
 * non-empty `llm_api_key` (lib.rs validate_config), and for the native
 * ollama flavor the value doubles as the auth-proxy token. Returns a
 * field-keyed error the wizard can highlight and scroll to, or null when
 * the runtime config is executable.
 */
export function validateAgentRuntimeConfig(input: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  tools: Array<{ name: string; url: string }>
}): AgentRuntimeConfigError | null {
  const provider = toKnownProvider(input.provider)
  if (!input.apiKey.trim()) {
    return {
      field: 'apiKey',
      message: provider === 'ollama'
        ? 'Enter an API key or proxy token — the workspace requires a non-empty key even when your Ollama server ignores it.'
        : 'An API key is required for this provider.',
    }
  }
  if (!input.model.trim()) return { field: 'model', message: 'Choose the model your agent runs on.' }
  const baseUrl = input.baseUrl.trim()
  if (provider === 'ollama' && !baseUrl) return { field: 'baseUrl', message: 'Ollama needs the public HTTPS address of your Ollama server.' }
  if (baseUrl && !/^https:\/\/[^\s/]+/.test(baseUrl)) return { field: 'baseUrl', message: 'The server address must start with https:// (the workspace only makes HTTPS calls).' }
  for (const tool of input.tools) {
    if (!tool.name.trim() && !tool.url.trim()) continue
    if (!tool.name.trim()) return { field: 'tools', message: 'Give every tool a name.' }
    if (!/^https:\/\/[^\s/]+/.test(tool.url.trim())) return { field: 'tools', message: `Tool "${tool.name.trim()}" needs an HTTPS address the agent may call.` }
  }
  return null
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
}

/**
 * Seals `config` to an arbitrary recipient pubkey (the canister's own
 * output-key, from `GET /api/workspaces/:id/output-key`) — unlike
 * `sealAgentConfig`'s self-ECDH, this is a real two-party NIP-44 encryption
 * (`nip44.getConversationKey(senderSk, recipientPubkeyHex)`), the same
 * construction `lib/nostr.ts` already uses for NIP-17 DMs.
 */
export function sealForRecipient(privkeyHex: string, recipientPubkeyHex: string, config: WorkspaceInjectedConfig): string {
  const conversationKey = nip44.getConversationKey(hexToBytes(privkeyHex), recipientPubkeyHex)
  return nip44.v2.encrypt(JSON.stringify(config), conversationKey)
}
