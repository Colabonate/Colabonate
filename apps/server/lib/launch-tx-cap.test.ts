import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_LAUNCH_MAX_TX_SATS,
  LAUNCH_CAP_ERROR_CODE,
  exceedsLaunchCap,
  rejectIfAboveLaunchCap,
  resolveLaunchMaxTxSats,
} from './launch-tx-cap.js'

describe('resolveLaunchMaxTxSats (FU-655)', () => {
  it('defaults to 210,000 when unset or empty', () => {
    expect(resolveLaunchMaxTxSats({})).toBe(DEFAULT_LAUNCH_MAX_TX_SATS)
    expect(resolveLaunchMaxTxSats({ LAUNCH_MAX_TX_SATS: '' })).toBe(210_000)
    expect(resolveLaunchMaxTxSats({ LAUNCH_MAX_TX_SATS: '   ' })).toBe(210_000)
  })

  it('accepts a positive integer override', () => {
    expect(resolveLaunchMaxTxSats({ LAUNCH_MAX_TX_SATS: '25000' })).toBe(25_000)
    expect(resolveLaunchMaxTxSats({ LAUNCH_MAX_TX_SATS: ' 1000 ' })).toBe(1_000)
  })

  it('"0" disables the cap explicitly', () => {
    expect(resolveLaunchMaxTxSats({ LAUNCH_MAX_TX_SATS: '0' })).toBeNull()
  })

  it('falls back to the default on garbage — never to "no cap" by accident', () => {
    expect(resolveLaunchMaxTxSats({ LAUNCH_MAX_TX_SATS: 'off' })).toBe(210_000)
    expect(resolveLaunchMaxTxSats({ LAUNCH_MAX_TX_SATS: '-5' })).toBe(210_000)
    expect(resolveLaunchMaxTxSats({ LAUNCH_MAX_TX_SATS: '1e9' })).toBe(210_000)
    expect(resolveLaunchMaxTxSats({ LAUNCH_MAX_TX_SATS: '210000.5' })).toBe(210_000)
  })
})

describe('exceedsLaunchCap', () => {
  it('is inclusive at the cap: 210,000 passes, 210,001 is rejected', () => {
    expect(exceedsLaunchCap(210_000, 210_000)).toBe(false)
    expect(exceedsLaunchCap(210_001, 210_000)).toBe(true)
    expect(exceedsLaunchCap(1, 210_000)).toBe(false)
  })

  it('never rejects when the cap is disabled', () => {
    expect(exceedsLaunchCap(10_000_000, null)).toBe(false)
  })

  it('treats non-finite amounts as above the cap', () => {
    expect(exceedsLaunchCap(Number.NaN, 210_000)).toBe(true)
    expect(exceedsLaunchCap(Number.POSITIVE_INFINITY, 210_000)).toBe(true)
  })
})

describe('rejectIfAboveLaunchCap', () => {
  function fakeRes() {
    const res = { status: vi.fn(), json: vi.fn() }
    res.status.mockReturnValue(res)
    return res
  }

  it('writes a 400 with error + code + capSats + amountSats and returns true', () => {
    const res = fakeRes()
    const rejected = rejectIfAboveLaunchCap(res as never, 300_000, 210_000)
    expect(rejected).toBe(true)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: LAUNCH_CAP_ERROR_CODE,
        code: LAUNCH_CAP_ERROR_CODE,
        capSats: 210_000,
        amountSats: 300_000,
      }),
    )
  })

  it('does not touch the response and returns false when within the cap', () => {
    const res = fakeRes()
    expect(rejectIfAboveLaunchCap(res as never, 210_000, 210_000)).toBe(false)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })
})
