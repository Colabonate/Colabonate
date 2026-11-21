import { describe, it, expect } from 'vitest'
import { gateFromScopes, GUEST_GATE, FULL_GATE } from './gate.js'

describe('tool gate (ADR-371 D8)', () => {
  it('FULL_GATE is the in-app adapter surface', () => {
    expect(FULL_GATE.isGuest).toBe(false)
    expect(FULL_GATE.canWrite('offers')).toBe(true)
    expect(FULL_GATE.canWrite('dao')).toBe(true)
  })

  it('GUEST_GATE allows public reads only', () => {
    expect(GUEST_GATE.isGuest).toBe(true)
    expect(GUEST_GATE.canWrite('offers')).toBe(false)
    expect(GUEST_GATE.canWrite('images')).toBe(false)
  })

  it('gateFromScopes grants exactly the minted write families', () => {
    const gate = gateFromScopes(['read', 'offers:write'])
    expect(gate.isGuest).toBe(false)
    expect(gate.canWrite('offers')).toBe(true)
    expect(gate.canWrite('cooperations')).toBe(false)
    expect(gate.canWrite('tickets')).toBe(false)
    expect(gate.canWrite('dao')).toBe(false)
    expect(gate.canWrite('identity')).toBe(false)
    expect(gate.canWrite('images')).toBe(false)
  })

  it('a guest scope set can never write (defense in depth)', () => {
    const gate = gateFromScopes(['read', 'offers:write'], true)
    expect(gate.isGuest).toBe(true)
    expect(gate.canWrite('offers')).toBe(false)
  })
})
