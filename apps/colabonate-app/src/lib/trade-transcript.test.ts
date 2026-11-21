import { describe, it, expect } from 'vitest'
import { transcriptFingerprint } from './trade-transcript'

describe('transcriptFingerprint (ADR-358 D3)', () => {
  it('is deterministic and 64-hex for the same trade + event order', () => {
    const a = transcriptFingerprint('trade-1', ['e1', 'e2'])
    const b = transcriptFingerprint('trade-1', ['e1', 'e2'])
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs across trades', () => {
    expect(transcriptFingerprint('trade-1', ['e1'])).not.toBe(transcriptFingerprint('trade-2', ['e1']))
  })

  it('is order-sensitive', () => {
    expect(transcriptFingerprint('trade-1', ['e1', 'e2'])).not.toBe(transcriptFingerprint('trade-1', ['e2', 'e1']))
  })

  it('extends deterministically as messages append', () => {
    const base = transcriptFingerprint('trade-1', ['e1'])
    const extended = transcriptFingerprint('trade-1', ['e1', 'e2'])
    expect(base).not.toBe(extended)
    expect(extended).toBe(transcriptFingerprint('trade-1', ['e1', 'e2']))
  })
})
