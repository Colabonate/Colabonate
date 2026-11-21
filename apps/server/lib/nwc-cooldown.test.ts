import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isNwcCoolingDown, markNwcFailure, clearNwcCooldown } from './nwc-cooldown.js'

describe('nwc-cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearNwcCooldown('seller-1')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not cooling down for a seller with no recorded failure', () => {
    expect(isNwcCoolingDown('seller-1')).toBe(false)
  })

  it('cools down immediately after a failure', () => {
    markNwcFailure('seller-1')
    expect(isNwcCoolingDown('seller-1')).toBe(true)
  })

  it('stops cooling down after the window elapses', () => {
    markNwcFailure('seller-1')
    vi.advanceTimersByTime(60_001)
    expect(isNwcCoolingDown('seller-1')).toBe(false)
  })

  it('does not cool down within the window', () => {
    markNwcFailure('seller-1')
    vi.advanceTimersByTime(59_000)
    expect(isNwcCoolingDown('seller-1')).toBe(true)
  })

  it('clearNwcCooldown lifts the cooldown immediately', () => {
    markNwcFailure('seller-1')
    clearNwcCooldown('seller-1')
    expect(isNwcCoolingDown('seller-1')).toBe(false)
  })

  it('tracks cooldowns independently per seller', () => {
    markNwcFailure('seller-1')
    expect(isNwcCoolingDown('seller-2')).toBe(false)
  })
})
