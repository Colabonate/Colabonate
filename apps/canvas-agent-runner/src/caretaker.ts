/**
 * ADR-370 D5 (Phase 4, FU-673): the caretaker loop.
 *
 * V1 is feedback-only steering (Owner decisions 2/8; FU-676 deferred). The
 * loop is deliberately small and deterministic:
 *
 *   1. Every poll tick (2 s), call get_feedback for our agent_name. doop
 *      claims + returns all open HUMAN FEEDBACK on first identified call.
 *   2. If feedback arrived (or an initial empty-canvas directive), run ONE LLM
 *      turn: read canvas + guidelines context, send the LLM the MCP tool
 *      schemas (OpenAI function format) + the feedback text, execute every
 *      tool call the model chooses, then ask for a self-review pass. Narrate
 *      the working state with set_status.
 *   3. Keepalive: any tool call with agent_name refreshes presence (doop sweep
 *      is 60 s with a status set / 20 s without), so the loop re-posts
 *      set_status at least every 45 s when idle.
 *
 * Presence/attribution come from doop side effects: the fork pins agentName
 * for the whole service session (agentNameOverride), and mutations touch
 * presence. The runner never renders pixels itself — get_frame_screenshot is
 * handed to the LLM as a base64 image content block for self-review.
 *
 * The loop is intentionally not an agent framework: no tool-list curation, no
 * plan store. FU-550/FU-545-phase-C growth happens here later; today the goal
 * is a working proof that a seller-configured agent can take a buyer's canvas
 * feedback and act on it via doop MCP.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { InjectedPersona } from './runner-core.js'

interface CaretakerDeps {
  client: Client
  ticketId: string
  canvasId: string
  agentName: string
  persona: InjectedPersona
}

/** Wait helper (unref not needed — we always cleanly stop). */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const POLL_MS = 2_000
const KEEPALIVE_MS = 45_000
/** Idle backoff ceiling — bounded by the 20 s no-status presence sweep. */
const IDLE_MAX_POLL_MS = 15_000

export interface McpToolSchema {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

interface McpResult {
  content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}

/** Read the MCP tool catalog (converted to OpenAI function schemas later). */
async function listTools(client: Client): Promise<McpToolSchema[]> {
  const res = (await client.listTools()) as { tools?: McpToolSchema[] }
  return (res.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
  }))
}

/** Text of a tool result — MCP content blocks may be text or image. */
function resultText(result: McpResult): string {
  if (!result.content) return ''
  return result.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

function agentNameArg(args: Record<string, unknown>): Record<string, unknown> {
  return { agent_name: args.agent_name ?? undefined, ...args }
}

interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

/**
 * One LLM turn against an OpenAI-compatible chat completions endpoint using
 * the MCP tool catalog as function schemas. Returns the assistant's choice of
 * tool calls (the loop then executes them and calls back for the next turn).
 */
export async function runLlmTurn(
  deps: CaretakerDeps,
  messages: LlmMessage[],
  tools: McpToolSchema[],
): Promise<{ finish: 'tools' | 'stop' | 'error'; toolCalls: LlmMessage['tool_calls']; message: string }> {
  // ADR-409: the persona carries the ROOT-form base URL (same
  // `toWorkspaceInjectedConfig` shape the canister receives — it appends
  // `/v1/chat/completions` itself), so normalize any legacy assistant-style
  // `/v1` suffix away and use the root-form path here too. The old
  // `http://localhost:11434/v1` default is gone (OD-2/OD-3): a persona
  // without a base URL cannot run on a hosted runner.
  const base = (deps.persona.llm_base_url ?? '').replace(/\/+$/, '').replace(/\/v1$/, '')
  if (!base) return { finish: 'error', toolCalls: [], message: 'persona is missing the LLM server address (llm_base_url)' }
  const apiKey = deps.persona.llm_api_key ?? 'ollama'
  const model = deps.persona.llm_model ?? 'qwen2.5:7b-instruct-q4_K_M'

  const body: Record<string, unknown> = {
    model,
    messages,
    tools: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema },
    })),
  }

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    return { finish: 'error', toolCalls: [], message: `LLM request failed with HTTP ${res.status}` }
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: LlmMessage['tool_calls'] } }>
  }
  const choice = data.choices?.[0]
  if (!choice) return { finish: 'error', toolCalls: [], message: 'LLM returned no choices' }
  const toolCalls = choice.message?.tool_calls
  return {
    finish: toolCalls && toolCalls.length > 0 ? 'tools' : 'stop',
    toolCalls: toolCalls ?? [],
    message: choice.message?.content ?? '',
  }
}

/**
 * Execute MCP tool calls. The doop tool contract takes agent_name; every call
 * refreshes presence. Returns the concatenated tool result text to feed back
 * to the LLM.
 */
export async function executeToolCalls(
  client: Client,
  toolCalls: NonNullable<LlmMessage['tool_calls']>,
): Promise<Array<{ tool_call_id: string; role: 'tool'; content: string }>> {
  const out: Array<{ tool_call_id: string; role: 'tool'; content: string }> = []
  for (const call of toolCalls) {
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(call.function.arguments ?? '{}') as Record<string, unknown>
    } catch {
      parsed = {}
    }
    const args = agentNameArg(parsed)
    const result = (await client.callTool({ name: call.function.name, arguments: args })) as McpResult
    const text = resultText(result)
    out.push({ tool_call_id: call.id, role: 'tool', content: text || (result.isError ? 'tool error (no text)' : 'ok (no text)') })
  }
  return out
}

/**
 * The caretaker loop. Runs until `stop()` flips. Each iteration: heartbeat +
 * feedback poll; when feedback exists, run an LLM tool-calling turn until the
 * model stops, then self-review (screenshot → second LLM look) — kept simple.
 */
export async function runCaretaker(deps: CaretakerDeps, stop: () => boolean): Promise<void> {
  let lastHeartbeat = Date.now()

  async function heartbeat(): Promise<void> {
    if (Date.now() - lastHeartbeat >= KEEPALIVE_MS) {
      lastHeartbeat = Date.now()
      // Any canvas-scoped read with agent_name refreshes presence.
      try {
        await deps.client.callTool({ name: 'get_canvas', arguments: { canvas_id: deps.canvasId, agent_name: deps.agentName } })
      } catch { /* presence best-effort */ }
    }
  }

  async function pollFeedback(): Promise<string | null> {
    const res = (await deps.client.callTool({
      name: 'get_feedback',
      arguments: { canvas_id: deps.canvasId, agent_name: deps.agentName },
    })) as McpResult
    const text = resultText(res)
    // get_feedback claims on the first identified call. Empty result = no open
    // feedback right now.
    if (text.includes('No open feedback requests')) return null
    return text
  }

  async function runTurn(feedbackText: string): Promise<void> {
    const tools = await listTools(deps.client)
    // Context: canvas state + guidelines (doop design memory).
    const canvasRes = (await deps.client.callTool({
      name: 'get_canvas',
      arguments: { canvas_id: deps.canvasId, agent_name: deps.agentName },
    })) as McpResult
    const canvasContext = resultText(canvasRes).slice(0, 12_000)

    const system = deps.persona.system_prompt
      ?? 'You are a design collaborator working on a shared canvas. Follow the canvas style guide, act on human feedback, and narrate with set_status.'

    const messages: LlmMessage[] = [
      { role: 'system', content: `${system}\n\nYou act as an agent on the canvas. Use the provided canvas tools. Always pass agent_name. Review your work with get_frame_screenshot before finishing.` },
      { role: 'user', content: `Canvas state:\n${canvasContext}\n\nHuman feedback / directive:\n${feedbackText}` },
    ]

    for (let i = 0; i < 12; i++) {
      const turn = await runLlmTurn(deps, messages, tools)
      if (turn.finish === 'error') {
        await deps.client.callTool({ name: 'set_status', arguments: { canvas_id: deps.canvasId, status: `Error: ${turn.message.slice(0, 120)}`, agent_name: deps.agentName } }).catch(() => {})
        return
      }
      if (turn.finish === 'stop') {
        await deps.client.callTool({ name: 'set_status', arguments: { canvas_id: deps.canvasId, status: '', agent_name: deps.agentName } }).catch(() => {})
        return
      }
      if (!turn.toolCalls) return
      const toolResults = await executeToolCalls(deps.client, turn.toolCalls)
      messages.push({ role: 'assistant', content: turn.message || undefined, tool_calls: turn.toolCalls })
      messages.push(...toolResults)
      lastHeartbeat = Date.now()
    }
  }

  let idleDelayMs = POLL_MS
  while (!stop()) {
    try {
      await heartbeat()
      const feedback = await pollFeedback()
      if (feedback) {
        idleDelayMs = POLL_MS // reset — an active turn means fresh eyes
        await deps.client.callTool({ name: 'set_status', arguments: { canvas_id: deps.canvasId, status: 'Acting on your feedback…', agent_name: deps.agentName } }).catch(() => {})
        await runTurn(feedback)
      } else if (idleDelayMs < IDLE_MAX_POLL_MS) {
        // Back off when idle: no open feedback → fewer wasted round trips.
        // doop's presence sweep (60 s with status / 20 s without) still bounds
        // how long we can stay quiet — the 45 s get_canvas heartbeat keeps us
        // inside the window regardless of the poll delay.
        idleDelayMs = Math.min(idleDelayMs * 2, IDLE_MAX_POLL_MS)
      }
    } catch {
      // Transient tool/network error — keep looping; the outbox + fork lock
      // are the failure safety nets, not this loop.
    }
    await sleep(idleDelayMs)
  }
}
