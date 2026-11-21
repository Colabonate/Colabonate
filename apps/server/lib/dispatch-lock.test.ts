import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { acquireDispatchLock } from './dispatch-lock.js'

describe('acquireDispatchLock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('acquires the lock on first call for a key', () => {
    expect(acquireDispatchLock(`k1-${Math.random()}`)).toBe(true)
  })

  it('rejects a second acquire for the same key within the TTL', () => {
    const key = `k2-${Math.random()}`
    expect(acquireDispatchLock(key, 30_000)).toBe(true)
    vi.setSystemTime(10_000)
    expect(acquireDispatchLock(key, 30_000)).toBe(false)
  })

  it('allows re-acquiring the same key after the TTL expires', () => {
    const key = `k3-${Math.random()}`
    expect(acquireDispatchLock(key, 30_000)).toBe(true)
    vi.setSystemTime(30_001)
    expect(acquireDispatchLock(key, 30_000)).toBe(true)
  })

  it('does not let different keys interfere with each other', () => {
    const keyA = `k4a-${Math.random()}`
    const keyB = `k4b-${Math.random()}`
    expect(acquireDispatchLock(keyA, 30_000)).toBe(true)
    expect(acquireDispatchLock(keyB, 30_000)).toBe(true)
  })
})
