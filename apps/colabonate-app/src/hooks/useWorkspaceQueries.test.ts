import { describe, it, expect } from 'vitest'
import { parseTimeline, type WorkspaceOutput } from './useWorkspaceQueries'

function chatOutput(role: string, content: string, createdAt: string): WorkspaceOutput {
  return { outputType: 'chat', uri: 'inline:chat', metadata: JSON.stringify({ role, content }), createdAt, signature: null }
}

function toolOutput(url: string, status: number, body: string, createdAt: string): WorkspaceOutput {
  return { outputType: 'tool', uri: url, metadata: JSON.stringify({ status, body }), createdAt, signature: null }
}

describe('parseTimeline (ADR-314 D5)', () => {
  it('interleaves chat and tool outputs in chronological order', () => {
    const outputs = [
      chatOutput('user', 'hello', '2026-08-21T10:00:00.000Z'),
      toolOutput('https://api.example.com/x', 200, '{"ok":true}', '2026-08-21T10:00:01.000Z'),
      chatOutput('assistant', 'done', '2026-08-21T10:00:02.000Z'),
    ]
    const timeline = parseTimeline(outputs)
    expect(timeline).toHaveLength(3)
    expect(timeline.map((i) => i.kind)).toEqual(['chat', 'tool', 'chat'])
  })

  it('sorts out-of-order outputs by createdAt', () => {
    const outputs = [
      chatOutput('assistant', 'second', '2026-08-21T10:00:02.000Z'),
      chatOutput('user', 'first', '2026-08-21T10:00:00.000Z'),
    ]
    const timeline = parseTimeline(outputs)
    expect(timeline.map((i) => (i.kind === 'chat' ? i.content : ''))).toEqual(['first', 'second'])
  })

  it('parses tool status/body correctly', () => {
    const timeline = parseTimeline([toolOutput('https://api.example.com/x', 404, 'not found', '2026-08-21T10:00:00.000Z')])
    expect(timeline[0]).toMatchObject({ kind: 'tool', url: 'https://api.example.com/x', status: 404, body: 'not found' })
  })

  it('still shows a tool activity with malformed metadata (status/body null, not dropped)', () => {
    const outputs: WorkspaceOutput[] = [{ outputType: 'tool', uri: 'https://api.example.com/x', metadata: 'not-json', createdAt: '2026-08-21T10:00:00.000Z', signature: null }]
    const timeline = parseTimeline(outputs)
    expect(timeline).toEqual([{ kind: 'tool', url: 'https://api.example.com/x', status: null, body: null, createdAt: '2026-08-21T10:00:00.000Z' }])
  })

  it('drops malformed chat metadata rather than crashing', () => {
    const outputs: WorkspaceOutput[] = [{ outputType: 'chat', uri: 'inline:chat', metadata: 'not-json', createdAt: '2026-08-21T10:00:00.000Z', signature: null }]
    expect(parseTimeline(outputs)).toEqual([])
  })

  it('ignores unrelated output types (e.g. text/file)', () => {
    const outputs: WorkspaceOutput[] = [{ outputType: 'text', uri: 'canister://out/1', metadata: '{}', createdAt: '2026-08-21T10:00:00.000Z', signature: null }]
    expect(parseTimeline(outputs)).toEqual([])
  })
})
