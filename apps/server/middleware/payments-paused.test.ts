import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Request, Response } from 'express'
import { blockIfPaymentsPaused } from './payments-paused.js'

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res as unknown as Response & { statusCode: number; body: unknown }
}

describe('blockIfPaymentsPaused', () => {
  const originalPaused = process.env.PAYMENTS_PAUSED
  const originalReason = process.env.PAYMENTS_PAUSED_REASON

  afterEach(() => {
    if (originalPaused === undefined) delete process.env.PAYMENTS_PAUSED
    else process.env.PAYMENTS_PAUSED = originalPaused
    if (originalReason === undefined) delete process.env.PAYMENTS_PAUSED_REASON
    else process.env.PAYMENTS_PAUSED_REASON = originalReason
  })

  beforeEach(() => {
    delete process.env.PAYMENTS_PAUSED
    delete process.env.PAYMENTS_PAUSED_REASON
  })

  it('calls next() and does not touch the response when unset', () => {
    const next = vi.fn()
    const res = mockRes()
    blockIfPaymentsPaused({} as Request, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
  })

  it('blocks with 503 when PAYMENTS_PAUSED=true', () => {
    process.env.PAYMENTS_PAUSED = 'true'
    const next = vi.fn()
    const res = mockRes()
    blockIfPaymentsPaused({} as Request, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(503)
    expect(res.body).toMatchObject({ error: 'PAYMENTS_PAUSED' })
  })

  it('blocks with 503 when PAYMENTS_PAUSED=1', () => {
    process.env.PAYMENTS_PAUSED = '1'
    const next = vi.fn()
    const res = mockRes()
    blockIfPaymentsPaused({} as Request, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(503)
  })

  it('surfaces PAYMENTS_PAUSED_REASON in the response message', () => {
    process.env.PAYMENTS_PAUSED = 'true'
    process.env.PAYMENTS_PAUSED_REASON = 'Investigating a settlement issue'
    const next = vi.fn()
    const res = mockRes()
    blockIfPaymentsPaused({} as Request, res, next)
    expect(res.body).toMatchObject({ message: 'Investigating a settlement issue' })
  })

  it('does not block on unrelated values', () => {
    process.env.PAYMENTS_PAUSED = 'false'
    const next = vi.fn()
    const res = mockRes()
    blockIfPaymentsPaused({} as Request, res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})
