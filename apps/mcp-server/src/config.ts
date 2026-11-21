export const API_BASE = process.env.API_BASE ?? 'http://localhost:4001';

// OpenAI-compatible LLM endpoint (ADR-234, MiniMax binding removed 2026-08-17
// per user request). Defaults back to a local Ollama instance; operators can
// still point at any OpenAI-compatible provider via LLM_BASE_URL (or the
// legacy alias OLLAMA_BASE) and LLM_API_KEY, and pin a model via
// LLM_MODEL_OVERRIDE. Adapter/per-user provider selection (ADR-281) takes
// precedence over these operator defaults at request time.
// `||` (not `??`) on purpose: Docker Compose's `${VAR:-}` interpolation sets
// an unconfigured var to an empty string rather than leaving it absent from
// the container env, which `??` would not treat as "unset".
const EXPLICIT_LLM_BASE = process.env.LLM_BASE_URL || process.env.OLLAMA_BASE;
export const LLM_BASE_URL = EXPLICIT_LLM_BASE || 'http://localhost:11434/v1';
export const LLM_API_KEY = process.env.LLM_API_KEY || 'ollama';
export const LLM_MODEL_OVERRIDE = process.env.LLM_MODEL_OVERRIDE || '';

// ADR-384 D1: `platform` (Colabonate-hosted, credit-pack-paid) mode is only
// offered when the operator configured a REAL provider - an explicit base URL,
// key and model. Without all three, a purchase would buy nothing consumable,
// so the mode fails BEFORE any credit is reserved.
export const PLATFORM_LLM_CONFIGURED = Boolean(EXPLICIT_LLM_BASE && process.env.LLM_API_KEY && LLM_MODEL_OVERRIDE);
// ADR-384 D3: per-turn ceilings so a flat per-request price stays defensible.
export const PLATFORM_MAX_OUTPUT_TOKENS = parseInt(process.env.PLATFORM_MAX_OUTPUT_TOKENS ?? '2048', 10) || 2048;
export const PLATFORM_MAX_TOOL_ROUNDS = parseInt(process.env.PLATFORM_MAX_TOOL_ROUNDS ?? '3', 10) || 3;
// ADR-389: input-side ceiling for Colabonate Hosted. ADR-384 D3 only capped the
// output, so a tool-heavy turn (large search payloads, attached images echoed
// as text) could grow past the provider's context window and fail with a raw
// 400. History and tool results are trimmed to fit this budget.
export const PLATFORM_MAX_INPUT_TOKENS = parseInt(process.env.PLATFORM_MAX_INPUT_TOKENS ?? '32000', 10) || 32000;
// ADR-389: input budget for non-hosted modes (BYOK / operator chain). BYOK token
// cost is the user's own, so a generous default is fine; the operator can raise
// it for 1M-context models via env.
export const LLM_MAX_INPUT_TOKENS = parseInt(process.env.LLM_MAX_INPUT_TOKENS ?? '128000', 10) || 128000;

export const DEFAULT_MODEL = process.env.DEFAULT_MODEL ?? 'qwen2.5:7b-instruct-q4_K_M';
export const MCP_SERVER_PORT = parseInt(process.env.MCP_SERVER_PORT ?? '4002', 10);

// ADR-281 D8: CLI-adapter provider mode. On deployments without local agent
// CLIs (beta stack, docker) this must be set to "false"; local dev defaults to
// enabled so the mode is testable out of the box.
export const ADAPTER_ENABLED = process.env.ADAPTER_ENABLED !== 'false';

// ADR-281 D4: shared secret for the backend-to-backend call that hands the
// user's decrypted provider key (and adapter selection) from the API server to
// this process. Never set from the frontend; empty string disables the
// internal channel (user provider keys then cannot be resolved here).
export const AI_INTERNAL_SECRET = process.env.AI_INTERNAL_SECRET ?? '';

// ADR-397 / Assistant plan F2: true only when a custodial escrow stack is
// actually active on this deployment. Production hard-pins both flags to
// "false" (docker-compose.production.yml), so the assistant must not promise
// escrow protection that does not exist. A dev deployment that turns escrow on
// has to forward the same ESCROW_ENABLED / COOP_ESCROW_ENABLED values to this
// service for the prompt to reflect it.
function flagOn(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}
export const ESCROW_ENABLED = flagOn(process.env.ESCROW_ENABLED);
export const COOP_ESCROW_ENABLED = flagOn(process.env.COOP_ESCROW_ENABLED);
/** Escrow is real only when at least one of the two independent stacks is on. */
export const AI_ESCROW_ACTIVE = ESCROW_ENABLED || COOP_ESCROW_ENABLED;
