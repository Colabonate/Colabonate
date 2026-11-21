/**
 * ADR-370 D3/D4/D5 (Phase 4, FU-673): runner core — per-ticket key material,
 * persona decryption, doop MCP session + caretaker loop.
 *
 * Identity: a deterministic per-ticket ECDH keypair is derived from a runner
 * master secret (CANVAS_RUNNER_MASTER_SECRET) + the ticket id via sha256
 * (RFC 5869-style simple KDF). Derivation is stable across runner restarts so
 * a persona the seller sealed earlier stays decryptable — no key store, no
 * persistence of any private material (FU-195-C).
 *
 * Persona: the sealed blob the seller relayed is NIP-44 (v2) encrypted with
 * the conversation key between the SELLER's key and the RUNNER's per-ticket
 * pubkey (sealForRecipient on the client). We derive the same conversation
 * key from our per-ticket secret + the sellerPubkey (symmetric) and decrypt in
 * memory only. The plaintext (LLM provider apiKey + system prompt) exists for
 * the session duration only.
 *
 * Session: mint a short-lived doop MCP session via the fork's
 * `POST {DOOP_SERVICE_URL}/api/service/mcp-session` (FU-672) using
 * DOOP_SERVICE_TOKEN, then speak streamable HTTP over /mcp with that token.
 * The fork pins agentName itself (agentNameOverride), so attribution and
 * HUMAN FEEDBACK targeting stay consistent.
 *
 * Caretaker loop (V1, feedback-only steering — Owner decisions 2/8): the
 * agent acts when it observes new HUMAN FEEDBACK or an initial directive. Each
 * turn: read feedback + canvas state, ask the LLM (OpenAI-compatible chat
 * completions) with the doop MCP tools as function schemas, execute the tool
 * calls it chooses, self-review with a frame screenshot, then narrate via
 * set_status. No comments/tasks tools exist for external agents (doop MCP
 * surface is 25 tools; tasks are a set_status side effect) — V1 steering is
 * task feedback only, matching FU-676 deferred.
 *
 * Key-management rule (FU-195-C): no provider key, sealed blob, or MCP token
 * is ever logged or echoed to the server.
 */
import { createHash } from 'node:crypto'
import * as nip44 from 'nostr-tools/nip44'
import { getPublicKey } from 'nostr-tools'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { checkEndpointSafe } from './endpoint-guard.js'

export interface InjectedPersona {
  llm_provider?: string
  llm_model?: string
  llm_api_key?: string
  llm_base_url?: string | null
  system_prompt?: string | null
  tools?: string[]
}

export interface RunnerSessionConfig {
  ticketId: string
  canvasId: string
  agentName: string
  sellerPubkey: string
  sealed: string
}

// ── deterministic per-ticket keypair ─────────────────────────────────────────

function masterSecret(): Buffer {
  const hex = process.env.CANVAS_RUNNER_MASTER_SECRET ?? ''
  if (!hex) throw new Error('CANVAS_RUNNER_MASTER_SECRET is not set')
  // Accept 64-hex or a utf-8 string (same leniency as AI_KEY_ENCRYPTION_SECRET).
  return /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : Buffer.from(hex, 'utf8')
}

/** sha256(masterSecret || ':' || ticketId) → 32-byte per-ticket secret key. */
function deriveTicketSecretKey(ticketId: string): Uint8Array {
  const h = createHash('sha256')
  h.update(masterSecret())
  h.update(':')
  h.update(ticketId)
  return new Uint8Array(h.digest())
}

export function resolveTicketPubkey(ticketId: string): string {
  return getPublicKey(deriveTicketSecretKey(ticketId))
}

// ── persona decryption ───────────────────────────────────────────────────────

/** Decrypt the seller's re-sealed persona (NIP-44 v2, two-party). */
export function decryptPersona(sellerPubkey: string, ticketId: string, sealed: string): InjectedPersona {
  const sk = deriveTicketSecretKey(ticketId)
  const conversationKey = nip44.getConversationKey(sk, sellerPubkey)
  const plaintext = nip44.v2.decrypt(sealed, conversationKey)
  return JSON.parse(plaintext) as InjectedPersona
}

// ── persona endpoint guard (ADR-409 D9) ─────────────────────────────────────

/**
 * Validate every endpoint the persona could make this process fetch: the LLM
 * base URL (required — the old runner-local Ollama default is gone) and any
 * HTTPS tool-allowlist prefixes carried over from the canister persona shape.
 */
async function assertPersonaEndpointsSafe(persona: InjectedPersona): Promise<void> {
  const base = (persona.llm_base_url ?? '').replace(/\/+$/, '').replace(/\/v1$/, '')
  if (!base) {
    throw new Error('persona is missing the LLM server address (llm_base_url)')
  }
  const baseCheck = await checkEndpointSafe(base, 'llm_base_url')
  if (!baseCheck.ok) throw new Error(baseCheck.error ?? 'llm_base_url rejected by the endpoint guard')

  for (const tool of persona.tools ?? []) {
    const prefix = tool.replace(/^!/, '').trim()
    if (!prefix) continue
    const toolCheck = await checkEndpointSafe(prefix, 'tool')
    if (!toolCheck.ok) throw new Error(toolCheck.error ?? 'tool address rejected by the endpoint guard')
  }
}

// ── doop MCP session ─────────────────────────────────────────────────────────

async function doopServiceUrl(): Promise<string> {
  const base = (process.env.DOOP_SERVICE_URL ?? '').replace(/\/+$/, '')
  if (!base) throw new Error('DOOP_SERVICE_URL is not set')
  return base
}

/** Mint a doop MCP session token via the fork service router (FU-672). */
async function mintMcpSession(canvasId: string, sellerPubkey: string, agentName: string): Promise<string> {
  const base = await doopServiceUrl()
  const res = await fetch(`${base}/api/service/mcp-session`, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${process.env.DOOP_SERVICE_TOKEN ?? ''}`,
    },
    body: JSON.stringify({ canvasId, userId: sellerPubkey, agentName }),
  })
  if (!res.ok) throw new Error(`doop mcp-session failed with HTTP ${res.status}`)
  const data = (await res.json()) as { token?: unknown }
  if (typeof data.token !== 'string' || !data.token) throw new Error('doop mcp-session returned no token')
  return data.token
}

/** Revoke the minted token (best-effort on teardown). */
async function revokeMcpSession(token: string): Promise<void> {
  const base = await doopServiceUrl().catch(() => null)
  if (!base) return
  try {
    await fetch(`${base}/api/service/mcp-session/revoke`, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${process.env.DOOP_SERVICE_TOKEN ?? ''}`,
      },
      body: JSON.stringify({ token }),
    })
  } catch {
    // best-effort — the token self-expires (TTL 6h, fork in-memory map).
  }
}

// ── caretaker loop ───────────────────────────────────────────────────────────

interface ActiveSession {
  /** Set by /control/stop — the caretaker polls this to know when to stop. */
  stopped: boolean
  stop: () => void
}

const activeSessions = new Map<string, ActiveSession>()

/**
 * Open a doop MCP client for the session. The transport is stateless per POST
 * (fork builds a fresh server per request), so we keep one connected Client
 * and issue tool calls through it; presence is refreshed by every tool call
 * with agent_name + an explicit get_canvas heartbeat ≤ 60s (doop sweep: 60 s
 * with a status set, 20 s without — research finding §4).
 */
export async function startTicketSession(config: RunnerSessionConfig): Promise<void> {
  const existing = activeSessions.get(config.ticketId)
  if (existing && !existing.stopped) return // already running — idempotent

  const persona = decryptPersona(config.sellerPubkey, config.ticketId, config.sealed)
  // ADR-409 D9 (OD-3): the persona's endpoints were sealed by the seller and
  // are only decrypted HERE, on Colabonate infrastructure — validate them
  // against the blocklist before the caretaker can fetch. A rejected target
  // fails the session start loudly (ticket → 'failed'); guard errors are
  // category-level, never echo the URL (FU-195-C).
  await assertPersonaEndpointsSafe(persona)
  const mcpToken = await mintMcpSession(config.canvasId, config.sellerPubkey, config.agentName)
  const base = await doopServiceUrl()

  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } },
  })
  const client = new Client({ name: `canvas-runner:${config.ticketId}`, version: '0.0.1' })
  await client.connect(transport)

  // Lazy-import the loop so control.ts stays import-light and the loop module
  // can be unit-tested in isolation.
  const { runCaretaker } = await import('./caretaker.js')

  const session: ActiveSession = {
    stopped: false,
    stop: () => { session.stopped = true },
  }
  activeSessions.set(config.ticketId, session)

  // Run detached; failures tear the session down (bounded restart is the
  // server outbox's job via a re-enqueued start).
  runCaretaker({ client, ...config, persona }, () => session.stopped).finally(async () => {
    await client.close().catch(() => {})
    await revokeMcpSession(mcpToken).catch(() => {})
    activeSessions.delete(config.ticketId)
  }).catch((err) => {
    console.error(`[runner] caretaker ${config.ticketId} failed:`, err instanceof Error ? err.message : err)
  })
}

export async function stopTicketSession(ticketId: string): Promise<void> {
  const session = activeSessions.get(ticketId)
  if (!session) return
  session.stop()
  // Detach via the running caretaker's finally (client close + revoke).
}

export async function closeAllSessions(): Promise<void> {
  for (const ticketId of [...activeSessions.keys()]) {
    await stopTicketSession(ticketId)
  }
  // Give the caretakers a beat to close their clients/transports.
  await new Promise((r) => setTimeout(r, 500))
}
