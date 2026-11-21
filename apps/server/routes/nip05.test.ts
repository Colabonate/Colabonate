// ADR-412 FU-947: HTTP contract test for the public NIP-05 (nostr.json) router.
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createNip05Router } from './nip05'

function makeApp(companyFindUnique: ReturnType<typeof vi.fn>, userFindUnique: ReturnType<typeof vi.fn>) {
  const prisma = {
    company: { findUnique: companyFindUnique },
    user: { findUnique: userFindUnique },
  } as unknown as PrismaClient
  const app = express()
  app.use('/.well-known/nostr.json', createNip05Router(prisma))
  return app
}

describe('GET /.well-known/nostr.json', () => {
  let companyFindUnique: ReturnType<typeof vi.fn>
  let userFindUnique: ReturnType<typeof vi.fn>

  beforeEach(() => {
    companyFindUnique = vi.fn()
    userFindUnique = vi.fn()
  })

  it('returns empty names when no name query param is given', async () => {
    const app = makeApp(companyFindUnique, userFindUnique)
    const res = await request(app).get('/.well-known/nostr.json')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ names: {} })
    expect(companyFindUnique).not.toHaveBeenCalled()
  })

  it('resolves a Company id to its persistent listing pubkey', async () => {
    companyFindUnique.mockResolvedValue({ nostrListingPubkey: 'a'.repeat(64) })
    const app = makeApp(companyFindUnique, userFindUnique)
    const res = await request(app).get('/.well-known/nostr.json?name=company-123')
    expect(res.status).toBe(200)
    expect(res.body.names['company-123']).toBe('a'.repeat(64))
    expect(res.body.relays['a'.repeat(64)]).toBeInstanceOf(Array)
    expect(userFindUnique).not.toHaveBeenCalled()
  })

  it('falls back to a User id when no Company matches', async () => {
    companyFindUnique.mockResolvedValue(null)
    userFindUnique.mockResolvedValue({ nostrListingPubkey: 'b'.repeat(64) })
    const app = makeApp(companyFindUnique, userFindUnique)
    const res = await request(app).get('/.well-known/nostr.json?name=user-123')
    expect(res.status).toBe(200)
    expect(res.body.names['user-123']).toBe('b'.repeat(64))
  })

  it('returns empty names when neither a Company nor a User has a listing key yet', async () => {
    companyFindUnique.mockResolvedValue(null)
    userFindUnique.mockResolvedValue(null)
    const app = makeApp(companyFindUnique, userFindUnique)
    const res = await request(app).get('/.well-known/nostr.json?name=unknown-id')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ names: {} })
  })

  it('answers 200 with empty names on a lookup error, never a 500/HTML error page', async () => {
    companyFindUnique.mockRejectedValue(new Error('db down'))
    const app = makeApp(companyFindUnique, userFindUnique)
    const res = await request(app).get('/.well-known/nostr.json?name=company-123')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ names: {} })
  })
})
