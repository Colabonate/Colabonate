/**
 * ADR-409 D2 — shared LLM provider catalog for the agent wizard
 * (/coop/agents/new, "LLM provider & credentials") and the Settings AI tab
 * (D8). One typed vocabulary so both surfaces never drift apart.
 *
 * Two-axis model (D1): the SEALED config keeps the executor flavor
 * ('openai' | 'anthropic' | 'ollama' — canister KNOWN_LLM_PROVIDERS,
 * FU-470); a catalog entry is purely a UI-level preset that derives that
 * flavor plus a suggested root-form base URL.
 *
 * Path-suffix invariant (D2): the Workspace-Canister appends fixed paths to
 * `llm_base_url` — `{base}/v1/chat/completions` (openai flavor),
 * `{base}/v1/messages` (anthropic), `{base}/api/chat` + `{base}/v1/embeddings`
 * (ollama). Every entry's baseUrl is the exact prefix for which those paths
 * resolve on the provider's documented OpenAI-compatible endpoint. Providers
 * whose chat path is not `…/v1/chat/completions` are excluded and documented
 * in ADR-409 (Google Gemini native `/v1beta/openai/…`, Novita `/v3/openai/…`,
 * Perplexity `/chat/completions`, Zhipu GLM `/v4/…`, DeepInfra
 * `/v1/openai/…`) — use them through an aggregator (OpenRouter) today, or
 * FU-929 once the canister gains path flexibility.
 *
 * Model suggestions are a FALLBACK only (stale by design — provider catalogs
 * move faster than this repo); the live list comes from the wizard's
 * "Test connection" (D5, POST /api/ai/config/test → GET /models). Where the
 * current ids could not be verified, the list stays empty on purpose.
 */

export type LlmFlavor = 'openai' | 'anthropic' | 'ollama'

export type LlmCatalogGroup = 'first-party' | 'aggregator' | 'open-weight' | 'local' | 'custom'

export interface LlmProviderCatalogEntry {
  id: string
  label: string
  group: LlmCatalogGroup
  flavor: LlmFlavor
  /**
   * Root-form base URL (no trailing slash, no trailing `/v1`) that the
   * executor's fixed paths append to. `null` = seller-entered (required for
   * local runtimes and custom endpoints).
   */
  baseUrl: string | null
  /** Whether an API key is expected (all flavors require a non-empty value per OD-2). */
  keyRequired: boolean
  docsUrl?: string
  modelSuggestions: string[]
  hint?: string
}

export const LLM_CATALOG: LlmProviderCatalogEntry[] = [
  // ── First-party providers ────────────────────────────────────────────────
  {
    id: 'openai', label: 'OpenAI', group: 'first-party', flavor: 'openai',
    baseUrl: 'https://api.openai.com', keyRequired: true, docsUrl: 'https://platform.openai.com/docs/api-reference',
    modelSuggestions: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
  },
  {
    id: 'anthropic', label: 'Anthropic', group: 'first-party', flavor: 'anthropic',
    baseUrl: 'https://api.anthropic.com', keyRequired: true, docsUrl: 'https://docs.anthropic.com/en/api/messages',
    modelSuggestions: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'],
  },
  {
    id: 'deepseek', label: 'DeepSeek', group: 'first-party', flavor: 'openai',
    baseUrl: 'https://api.deepseek.com', keyRequired: true, docsUrl: 'https://api-docs.deepseek.com/',
    modelSuggestions: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'xai', label: 'xAI (Grok)', group: 'first-party', flavor: 'openai',
    baseUrl: 'https://api.x.ai', keyRequired: true, docsUrl: 'https://docs.x.ai/',
    modelSuggestions: [],
  },
  {
    id: 'mistral', label: 'Mistral AI', group: 'first-party', flavor: 'openai',
    baseUrl: 'https://api.mistral.ai', keyRequired: true, docsUrl: 'https://docs.mistral.ai/',
    modelSuggestions: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
  },
  {
    id: 'minimax', label: 'MiniMax', group: 'first-party', flavor: 'openai',
    baseUrl: 'https://api.minimax.io', keyRequired: true, docsUrl: 'https://platform.minimax.io/',
    modelSuggestions: ['MiniMax-M2'],
  },
  {
    id: 'qwen-dashscope', label: 'Qwen (DashScope)', group: 'first-party', flavor: 'openai',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode', keyRequired: true, docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/',
    modelSuggestions: ['qwen-max', 'qwen-plus'],
  },
  {
    id: 'cohere', label: 'Cohere', group: 'first-party', flavor: 'openai',
    baseUrl: 'https://api.cohere.ai/compatibility', keyRequired: true, docsUrl: 'https://docs.cohere.com/reference/chat',
    modelSuggestions: [],
  },

  // ── Aggregators (one endpoint, many providers) ───────────────────────────
  {
    id: 'openrouter', label: 'OpenRouter', group: 'aggregator', flavor: 'openai',
    baseUrl: 'https://openrouter.ai/api', keyRequired: true, docsUrl: 'https://openrouter.ai/docs',
    modelSuggestions: ['deepseek/deepseek-chat', 'anthropic/claude-sonnet-5', 'qwen/qwen3-coder'],
    hint: 'Routes 300+ models (incl. GPT, Claude, Gemini) through one OpenAI-compatible endpoint.',
  },
  {
    id: 'hf-router', label: 'Hugging Face Router', group: 'aggregator', flavor: 'openai',
    baseUrl: 'https://router.huggingface.co', keyRequired: true, docsUrl: 'https://huggingface.co/docs/inference-providers',
    modelSuggestions: [],
  },

  // ── Open-weight hosts ────────────────────────────────────────────────────
  {
    id: 'groq', label: 'Groq', group: 'open-weight', flavor: 'openai',
    baseUrl: 'https://api.groq.com/openai', keyRequired: true, docsUrl: 'https://console.groq.com/docs/',
    modelSuggestions: ['llama-3.3-70b-versatile'],
  },
  {
    id: 'cerebras', label: 'Cerebras', group: 'open-weight', flavor: 'openai',
    baseUrl: 'https://api.cerebras.ai', keyRequired: true, docsUrl: 'https://inference-docs.cerebras.ai/',
    modelSuggestions: [],
    hint: 'Drops some sampling parameters (frequency_penalty, logit_bias, presence_penalty).',
  },
  {
    id: 'together', label: 'Together AI', group: 'open-weight', flavor: 'openai',
    baseUrl: 'https://api.together.xyz', keyRequired: true, docsUrl: 'https://docs.together.ai/',
    modelSuggestions: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-Coder'],
  },
  {
    id: 'fireworks', label: 'Fireworks AI', group: 'open-weight', flavor: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference', keyRequired: true, docsUrl: 'https://docs.fireworks.ai/',
    modelSuggestions: [],
  },
  {
    id: 'sambanova', label: 'SambaNova', group: 'open-weight', flavor: 'openai',
    baseUrl: 'https://api.sambanova.ai', keyRequired: true, docsUrl: 'https://docs.sambanova.ai/',
    modelSuggestions: [],
  },
  {
    id: 'siliconflow', label: 'SiliconFlow', group: 'open-weight', flavor: 'openai',
    baseUrl: 'https://api.siliconflow.com', keyRequired: true, docsUrl: 'https://docs.siliconflow.com/',
    modelSuggestions: [],
  },

  // ── Local runtimes (OD-2: OpenAI-flavor + auth proxy is the default) ─────
  {
    id: 'ollama', label: 'Ollama (self-hosted)', group: 'local', flavor: 'ollama',
    baseUrl: null, keyRequired: true, docsUrl: 'https://docs.ollama.com/',
    modelSuggestions: ['llama3.1', 'qwen2.5', 'mistral'],
    hint: 'Native Ollama protocol — the workspace sends NO auth header for it (OD-2): prefer the Ollama (OpenAI-compatible) entry behind an auth-enforcing proxy.',
  },
  {
    id: 'ollama-openai', label: 'Ollama (OpenAI-compatible)', group: 'local', flavor: 'openai',
    baseUrl: null, keyRequired: true, docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
    modelSuggestions: ['llama3.1', 'qwen2.5', 'mistral'],
    hint: 'OD-2 default for Ollama: serve /v1 behind an HTTPS reverse proxy that checks the Bearer token.',
  },
  {
    id: 'lm-studio', label: 'LM Studio', group: 'local', flavor: 'openai',
    baseUrl: null, keyRequired: true, docsUrl: 'https://lmstudio.ai/docs/developer/rest',
    modelSuggestions: [],
    hint: 'Developer tab → Start Server (port 1234); supports API-key auth. Expose it via an HTTPS tunnel.',
  },
  {
    id: 'vllm', label: 'vLLM', group: 'local', flavor: 'openai',
    baseUrl: null, keyRequired: true, docsUrl: 'https://docs.vllm.ai/',
    modelSuggestions: [],
    hint: 'OpenAI-compatible server on :8000 with bearer-key auth.',
  },
  {
    id: 'llamacpp', label: 'llama.cpp server', group: 'local', flavor: 'openai',
    baseUrl: null, keyRequired: true, docsUrl: 'https://github.com/ggml-org/llama.cpp',
    modelSuggestions: [],
  },
  {
    id: 'localai', label: 'LocalAI', group: 'local', flavor: 'openai',
    baseUrl: null, keyRequired: true, docsUrl: 'https://localai.io/',
    modelSuggestions: [],
  },
  {
    id: 'litellm', label: 'LiteLLM proxy', group: 'local', flavor: 'openai',
    baseUrl: null, keyRequired: true, docsUrl: 'https://docs.litellm.ai/',
    modelSuggestions: [],
    hint: 'One OpenAI-compatible endpoint in front of many backends, with its own key layer.',
  },

  // ── Custom (D3 — always flavor-mapped, the FU-470-safe "other") ─────────
  {
    id: 'custom-openai', label: 'Custom (OpenAI-compatible)', group: 'custom', flavor: 'openai',
    baseUrl: null, keyRequired: true,
    modelSuggestions: [],
    hint: 'Any HTTPS endpoint whose chat API is {server}/v1/chat/completions.',
  },
  {
    id: 'custom-anthropic', label: 'Custom (Anthropic-compatible)', group: 'custom', flavor: 'anthropic',
    baseUrl: null, keyRequired: true,
    modelSuggestions: [],
    hint: 'Any HTTPS endpoint implementing the Anthropic /v1/messages API.',
  },
]

export const LLM_CATALOG_BY_ID: Readonly<Record<string, LlmProviderCatalogEntry>> = Object.fromEntries(
  LLM_CATALOG.map((e) => [e.id, e]),
)

export const LLM_CATALOG_GROUP_LABELS: Record<LlmCatalogGroup, string> = {
  'first-party': 'First-party providers',
  aggregator: 'Aggregators',
  'open-weight': 'Open-weight hosts',
  local: 'Local runtimes (your own hardware)',
  custom: 'Custom',
}

export function getCatalogEntry(id: string): LlmProviderCatalogEntry {
  return LLM_CATALOG_BY_ID[id] ?? LLM_CATALOG_BY_ID['custom-openai']
}

/** Entries shown in the wizard's grouped select, in display order. */
export function catalogEntriesGrouped(): Array<{ group: LlmCatalogGroup; label: string; entries: LlmProviderCatalogEntry[] }> {
  const order: LlmCatalogGroup[] = ['first-party', 'aggregator', 'open-weight', 'local', 'custom']
  return order.map((group) => ({
    group,
    label: LLM_CATALOG_GROUP_LABELS[group],
    entries: LLM_CATALOG.filter((e) => e.group === group),
  }))
}

/**
 * Map a recovered/public runtime config back onto a catalog entry (edit-mode
 * prefill). Falls back to the matching custom entry when the base URL matches
 * nothing — the sealed flavor always wins because the canister only accepts
 * the three known values.
 */
export function matchCatalogEntry(input: {
  flavor: LlmFlavor
  baseUrl?: string | null
  catalogId?: string | null
}): LlmProviderCatalogEntry {
  const normalizedBase = input.baseUrl?.trim().replace(/\/+$/, '').replace(/\/v1$/, '') || null
  if (input.catalogId && LLM_CATALOG_BY_ID[input.catalogId]) {
    const entry = LLM_CATALOG_BY_ID[input.catalogId]
    if (entry.flavor === input.flavor) return entry
  }
  if (normalizedBase) {
    const byBase = LLM_CATALOG.find((e) => e.baseUrl && e.baseUrl === normalizedBase && e.flavor === input.flavor)
    if (byBase) return byBase
    return input.flavor === 'anthropic' ? LLM_CATALOG_BY_ID['custom-anthropic'] : LLM_CATALOG_BY_ID['custom-openai']
  }
  // No base URL: official first-party endpoint for the flavor, or the local
  // ollama entry (its base URL is always seller-entered).
  if (input.flavor === 'anthropic') return LLM_CATALOG_BY_ID['anthropic']
  if (input.flavor === 'ollama') return LLM_CATALOG_BY_ID['ollama']
  return LLM_CATALOG_BY_ID['openai']
}

/**
 * Assistant/test-convention helpers. The AI-Assistant stack (UserAiConfig,
 * POST /api/ai/config/test, OpenAI SDK) uses a base URL that already includes
 * `/v1`; the agent workspace uses the root form and appends `/v1/…` itself.
 * These two helpers translate losslessly in both directions (D4/D5).
 */
export function assistantBaseUrlToAgentBase(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
}

export function agentBaseToAssistantBaseUrl(url: string): string {
  const root = assistantBaseUrlToAgentBase(url)
  return root.endsWith('/v1') ? root : `${root}/v1`
}

/** Hosted openai-flavor presets in the Settings AI tab convention (D8). */
export function assistantBaseUrlPresets(): Array<{ label: string; baseUrl: string }> {
  return LLM_CATALOG
    .filter((e) => e.baseUrl && e.flavor === 'openai' && e.group !== 'local' && e.group !== 'custom')
    .map((e) => ({ label: e.label, baseUrl: agentBaseToAssistantBaseUrl(e.baseUrl as string) }))
}
