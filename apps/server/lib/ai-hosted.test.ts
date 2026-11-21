import { describe, expect, it } from 'vitest'
import { aiHostedEnabled } from './ai-hosted.js'

describe('aiHostedEnabled (ADR-384 hard gate)', () => {
  it('is off by default and for anything but an explicit yes', () => {
    for (const v of [undefined, '', ' ', 'false', '0', 'no', 'TRUEISH']) expect(aiHostedEnabled(v)).toBe(false)
  })
  it('is on only for true / 1 (case and whitespace tolerant)', () => {
    for (const v of ['true', 'TRUE', ' True ', '1']) expect(aiHostedEnabled(v)).toBe(true)
  })
})
