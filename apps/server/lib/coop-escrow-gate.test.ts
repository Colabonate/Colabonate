import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Request, Response } from 'express'
import { isCoopEscrowEnabled, rejectCoopEscrowIfDisabled } from './coop-escrow-gate.js'

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

function mockReq(body: unknown = {}): Request {
  return { body } as Request
}

describe('coop-escrow-gate', () => {
  const original = process.env.COOP_ESCROW_ENABLED

  afterEach(() => {
    if (original === undefined) delete process.env.COOP_ESCROW_ENABLED
    else process.env.COOP_ESCROW_ENABLED = original
  })

  beforeEach(() => {
    delete process.env.COOP_ESCROW_ENABLED
  })

  describe('isCoopEscrowEnabled', () => {
    it('is disabled by default', () => {
      expect(isCoopEscrowEnabled()).toBe(false)
    })

    it('is enabled when COOP_ESCROW_ENABLED=true', () => {
      process.env.COOP_ESCROW_ENABLED = 'true'
      expect(isCoopEscrowEnabled()).toBe(true)
    })

    it('is enabled when COOP_ESCROW_ENABLED=1', () => {
      process.env.COOP_ESCROW_ENABLED = '1'
      expect(isCoopEscrowEnabled()).toBe(true)
    })

    it('stays disabled on unrelated values', () => {
      process.env.COOP_ESCROW_ENABLED = 'yes'
      expect(isCoopEscrowEnabled()).toBe(false)
    })
  })

  describe('rejectCoopEscrowIfDisabled', () => {
    it('blocks with 403 COOP_ESCROW_DISABLED when the gate is closed', () => {
      const res = mockRes()
      const blocked = rejectCoopEscrowIfDisabled(mockReq(), res)
      expect(blocked).toBe(true)
      expect(res.statusCode).toBe(403)
      expect(res.body).toMatchObject({ error: 'COOP_ESCROW_DISABLED' })
    })

    it('does not block when COOP_ESCROW_ENABLED=1', () => {
      process.env.COOP_ESCROW_ENABLED = '1'
      const res = mockRes()
      const blocked = rejectCoopEscrowIfDisabled(mockReq(), res)
      expect(blocked).toBe(false)
      expect(res.statusCode).toBe(200)
    })
  })
})
