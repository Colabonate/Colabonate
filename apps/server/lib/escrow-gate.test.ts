import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Request, Response } from 'express'
import { isEscrowEnabled, rejectEscrowIfDisabled } from './escrow-gate.js'

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

function mockReq(body: unknown): Request {
  return { body } as Request
}

describe('escrow-gate', () => {
  const original = process.env.ESCROW_ENABLED

  afterEach(() => {
    if (original === undefined) delete process.env.ESCROW_ENABLED
    else process.env.ESCROW_ENABLED = original
  })

  beforeEach(() => {
    delete process.env.ESCROW_ENABLED
  })

  describe('isEscrowEnabled', () => {
    it('is disabled by default', () => {
      expect(isEscrowEnabled()).toBe(false)
    })

    it('is enabled when ESCROW_ENABLED=true', () => {
      process.env.ESCROW_ENABLED = 'true'
      expect(isEscrowEnabled()).toBe(true)
    })

    it('is enabled when ESCROW_ENABLED=1', () => {
      process.env.ESCROW_ENABLED = '1'
      expect(isEscrowEnabled()).toBe(true)
    })

    it('stays disabled on unrelated values', () => {
      process.env.ESCROW_ENABLED = 'yes'
      expect(isEscrowEnabled()).toBe(false)
    })
  })

  describe('rejectEscrowIfDisabled', () => {
    it('does not block when useEscrow is not set', () => {
      const res = mockRes()
      const blocked = rejectEscrowIfDisabled(mockReq({}), res)
      expect(blocked).toBe(false)
      expect(res.statusCode).toBe(200)
    })

    it('does not block when useEscrow is false', () => {
      const res = mockRes()
      const blocked = rejectEscrowIfDisabled(mockReq({ useEscrow: false }), res)
      expect(blocked).toBe(false)
    })

    it('blocks with 403 when useEscrow:true and the gate is closed', () => {
      const res = mockRes()
      const blocked = rejectEscrowIfDisabled(mockReq({ useEscrow: true }), res)
      expect(blocked).toBe(true)
      expect(res.statusCode).toBe(403)
      expect(res.body).toMatchObject({ error: 'ESCROW_DISABLED' })
    })

    it('allows useEscrow:true when ESCROW_ENABLED=1', () => {
      process.env.ESCROW_ENABLED = '1'
      const res = mockRes()
      const blocked = rejectEscrowIfDisabled(mockReq({ useEscrow: true }), res)
      expect(blocked).toBe(false)
      expect(res.statusCode).toBe(200)
    })
  })
})
