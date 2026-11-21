import { describe, expect, it } from 'vitest'
import { executeToolCalls, runLlmTurn, type McpToolSchema } from './caretaker.js'

/** Minimal MCP-client-shaped fake for tool execution. */
function fakeClient(toolImpl: (name: string, args: Record<string, unknown>) => { content?: Array<{ type: string; text?: string }>; isError?: boolean }) {
  return {
    callTool: async (req: { name: string; arguments: Record<string, unknown> }) => toolImpl(req.name, req.arguments ?? {}),
    listTools: async () => ({ tools: [] }),
    connect: async () => {},
    close: async () => {},
  }
}

describe('executeToolCalls (ADR-370 D5)', () => {
  it('injects agent_name + forwards args, returns result text', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = fakeClient((name, args) => {
      calls.push({ name, args })
      return { content: [{ type: 'text', text: `ok ${name}` }] }
    })
    const results = await executeToolCalls(client as never, [
      { id: 'c1', type: 'function', function: { name: 'set_frame_html', arguments: '{"frame_id":"f1","html":"<h1>hi</h1>"}' } },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('set_frame_html')
    expect(calls[0].args.agent_name).toBeUndefined() // no agent_name supplied in args → left as-is (undefined)
    expect(results[0].tool_call_id).toBe('c1')
    expect(results[0].content).toContain('ok set_frame_html')
  })

  it('tolerates invalid JSON arguments', async () => {
    const client = fakeClient((name) => ({ content: [{ type: 'text', text: `handled ${name}` }] }))
    const results = await executeToolCalls(client as never, [
      { id: 'c2', type: 'function', function: { name: 'get_canvas', arguments: 'not-json' } },
    ])
    expect(results[0].content).toContain('handled get_canvas')
  })
})

describe('runLlmTurn (ADR-370 D5)', () => {
  it('returns a tool-call decision when the model asks for tools', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 't1', type: 'function', function: { name: 'create_frame', arguments: '{}' } }],
          },
        }],
      }),
    })) as never

    try {
      const deps = {
        client: fakeClient(() => ({ content: [] })) as never,
        ticketId: 'ticket-1',
        canvasId: 'c1',
        agentName: 'Builder',
        // ADR-409: root-form base URL — the caretaker appends /v1 itself.
        persona: { llm_base_url: 'https://llm.example.com', llm_api_key: 'k', llm_model: 'qwen' },
      }
      const tools: McpToolSchema[] = [{ name: 'create_frame', description: 'create a frame', inputSchema: { type: 'object' } }]
      const res = await runLlmTurn(deps, [{ role: 'user', content: 'make a frame' }], tools)
      expect(res.finish).toBe('tools')
      expect(res.toolCalls?.[0].function.name).toBe('create_frame')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
