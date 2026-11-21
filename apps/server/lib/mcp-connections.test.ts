import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  hashMcpToken,
  generateMcpToken,
  issueMcpConnection,
  findMcpConnectionByToken,
  validateMcpConnection,
  revokeMcpConnection,
  revokeAllMcpConnections,
  issueDerivedSession,
  recordMcpConnectionEvent,
  MCP_DERIVED_SESSION_KIND,
  READ_SCOPE,
} from './mcp-connections.js'

interface FakeConn {
  id: string
  pubkey: string
  tokenHash: string
  scope: string[]
  label: string | null
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
}
interface FakeSession {
  id: string
  pubkey: string
  token: string
  expiresAt: Date
  kind: string | null
  mcpConnectionId: string | null
}
interface FakeEvent {
  id: string
  connectionId: string
  ts: Date
  tool: string
  outcome: string
  agentLabel: string | null
}

function makeDb(users: Array<{ pubkey: string; identityLevel: number; blockedAt?: Date | null }>) {
  const userOf = (pubkey: string) =>
    users.find((u) => u.pubkey === pubkey) ?? { pubkey, identityLevel: 0, blockedAt: null }
  const conns = new Map<string, FakeConn>()
  const sessions: FakeSession[] = []
  const events: FakeEvent[] = []

  const db = {
    // ADR-402 D7: these tests have no per-identity AI/MCP policy → DEFAULT.
    userAiPolicy: {
      findUnique: vi.fn(async () => null),
    },
    mcpConnection: {
      create: vi.fn(async ({ data }: { data: Omit<FakeConn, 'id' | 'createdAt' | 'revokedAt' | 'lastUsedAt'> }) => {
        const row: FakeConn = {
          ...data,
          id: `conn-${conns.size + 1}`,
          createdAt: new Date(),
          revokedAt: null,
          lastUsedAt: null,
        }
        conns.set(row.id, row)
        return row
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash?: string; id?: string } }) => {
        const row = where.tokenHash
          ? [...conns.values()].find((c) => c.tokenHash === where.tokenHash)
          : where.id
            ? conns.get(where.id)
            : undefined
        if (!row) return null
        return { ...row, user: userOf(row.pubkey) }
      }),
      findMany: vi.fn(async ({ where }: { where: { pubkey?: string; revokedAt?: Date | null } }) => {
        const rows = [...conns.values()].filter((c) => {
          if (where.pubkey && c.pubkey !== where.pubkey) return false
          if (where.revokedAt === null && c.revokedAt) return false
          return true
        })
        return rows.map((r) => ({ id: r.id }))
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string; pubkey?: string; revokedAt?: Date | null }; data: { revokedAt: Date } }) => {
        let count = 0
        for (const c of conns.values()) {
          if (where.id && c.id !== where.id) continue
          if (where.pubkey && c.pubkey !== where.pubkey) continue
          if (where.revokedAt === null && c.revokedAt) continue
          c.revokedAt = data.revokedAt
          count++
        }
        return { count }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { lastUsedAt: Date } }) => {
        const row = conns.get(where.id)
        if (row) row.lastUsedAt = data.lastUsedAt
        return row
      }),
    },
    session: {
      deleteMany: vi.fn(async ({ where }: { where: { mcpConnectionId?: string; kind?: string; token?: string } }) => {
        const before = sessions.length
        for (let i = sessions.length - 1; i >= 0; i--) {
          const s = sessions[i]
          if (where.mcpConnectionId && s.mcpConnectionId !== where.mcpConnectionId) continue
          if (where.kind && s.kind !== where.kind) continue
          if (where.token && s.token !== where.token) continue
          sessions.splice(i, 1)
        }
        return { count: before - sessions.length }
      }),
      create: vi.fn(async ({ data }: { data: Omit<FakeSession, 'id'> }) => {
        const row: FakeSession = { ...data, id: `ses-${sessions.length + 1}` }
        sessions.push(row)
        return row
      }),
    },
    mcpConnectionEvent: {
      create: vi.fn(async ({ data }: { data: Omit<FakeEvent, 'id' | 'ts'> }) => {
        const row: FakeEvent = { ...data, id: `evt-${events.length + 1}`, ts: new Date() }
        events.push(row)
        return row
      }),
      count: vi.fn(async ({ where }: { where: { connectionId?: string } }) => {
        return events.filter((e) => !where.connectionId || e.connectionId === where.connectionId).length
      }),
      findMany: vi.fn(async ({ where, orderBy, take }: { where: { connectionId?: string }; orderBy: Array<{ ts: 'desc'; id: 'desc' }>; take?: number }) => {
        const rows = events
          .filter((e) => !where.connectionId || e.connectionId === where.connectionId)
          .sort((a, b) => {
            const tsA = a.ts.getTime()
            const tsB = b.ts.getTime()
            if (tsA !== tsB) return orderBy[0]?.ts === 'desc' ? tsB - tsA : tsA - tsB
            return orderBy[0]?.ts === 'desc' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id)
          })
        const kept = take ? rows.slice(0, take) : rows
        return kept.map(({ id, connectionId, ts, tool, outcome, agentLabel }) => ({ id, connectionId, ts, tool, outcome, agentLabel }))
      }),
      deleteMany: vi.fn(async ({ where }: { where: { connectionId?: string; id?: { notIn: string[] } } }) => {
        const before = events.length
        const notIn = new Set(where.id?.notIn ?? [])
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i]
          if (where.connectionId && e.connectionId !== where.connectionId) continue
          if (where.id && notIn.has(e.id)) continue
          events.splice(i, 1)
        }
        return { count: before - events.length }
      }),
    },
  }
  return { db: db as unknown as PrismaClient, conns, sessions, events }
}

const PUBKEY = 'npubtest-user-1'

describe('mcp-connections (ADR-371)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('MCP_TOKEN_TTL_HOURS', '1')
    vi.stubEnv('MCP_DERIVED_SESSION_TTL_MINUTES', '30')
  })

  it('hashes tokens so the raw value is never persisted', async () => {
    const { db, conns } = makeDb([{ pubkey: PUBKEY, identityLevel: 2 }])
    const raw = generateMcpToken()
    expect(raw).toMatch(/^[0-9a-f]{64}$/)
    const { token, connectionId } = await issueMcpConnection(db, { pubkey: PUBKEY, scope: [READ_SCOPE] })
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(conns.get(connectionId)?.tokenHash).toBe(hashMcpToken(token))
    expect(conns.get(connectionId)?.tokenHash).not.toContain(token)
    expect(hashMcpToken(raw)).not.toBe(hashMcpToken(token))
  })

  it('forces read scope on mint and honors write families', async () => {
    const { db, conns } = makeDb([{ pubkey: PUBKEY, identityLevel: 2 }])
    const { connectionId } = await issueMcpConnection(db, { pubkey: PUBKEY, scope: ['offers:write'] })
    expect(conns.get(connectionId)?.scope).toEqual(['read', 'offers:write'])
  })

  it('rejects revoked, expired and unknown connections uniformly', async () => {
    const { db } = makeDb([{ pubkey: PUBKEY, identityLevel: 2 }])
    const { token } = await issueMcpConnection(db, { pubkey: PUBKEY, scope: [READ_SCOPE] })
    expect(await validateMcpConnection(db, token)).not.toBeNull()

    // unknown token
    expect(await validateMcpConnection(db, generateMcpToken())).toBeNull()
    // revoked
    await revokeMcpConnection(db, (await findMcpConnectionByToken(db, token))!.id, PUBKEY)
    expect(await validateMcpConnection(db, token)).toBeNull()
    // expired
    const expired = await issueMcpConnection(db, { pubkey: PUBKEY, scope: [READ_SCOPE], ttlMs: -1 })
    expect(await validateMcpConnection(db, expired.token)).toBeNull()
  })

  it('blocked owners are revoked at validation time (ADR-284 parity) and fail validation', async () => {
    const { db, conns } = makeDb([
      { pubkey: PUBKEY, identityLevel: 2, blockedAt: new Date() },
    ])
    const { token, connectionId } = await issueMcpConnection(db, { pubkey: PUBKEY, scope: [READ_SCOPE] })
    expect(await validateMcpConnection(db, token)).toBeNull()
    expect(conns.get(connectionId)?.revokedAt).not.toBeNull()
  })

  it('revokeAllMcpConnections revokes all active connections of a user', async () => {
    const { db, conns } = makeDb([{ pubkey: PUBKEY, identityLevel: 2 }])
    const a = await issueMcpConnection(db, { pubkey: PUBKEY, scope: [READ_SCOPE] })
    const b = await issueMcpConnection(db, { pubkey: PUBKEY, scope: [READ_SCOPE] })
    const count = await revokeAllMcpConnections(db, PUBKEY)
    expect(count).toBe(2)
    expect(conns.get(a.connectionId)?.revokedAt).not.toBeNull()
    expect(conns.get(b.connectionId)?.revokedAt).not.toBeNull()
  })

  it('issueDerivedSession deletes the previous derived row and mints kind=MCP sessions', async () => {
    const { db, sessions } = makeDb([{ pubkey: PUBKEY, identityLevel: 2 }])
    const { token } = await issueMcpConnection(db, { pubkey: PUBKEY, scope: [READ_SCOPE] })
    const connection = (await findMcpConnectionByToken(db, token))!
    const first = await issueDerivedSession(db, connection)
    expect(sessions.filter((s) => s.mcpConnectionId === connection.id)).toHaveLength(1)
    const second = await issueDerivedSession(db, connection)
    expect(sessions.filter((s) => s.mcpConnectionId === connection.id)).toHaveLength(1)
    expect(sessions.find((s) => s.token === first.token)).toBeUndefined()
    const row = sessions.find((s) => s.token === second.token)!
    expect(row.kind).toBe(MCP_DERIVED_SESSION_KIND)
    expect(row.mcpConnectionId).toBe(connection.id)
  })

  it('recordMcpConnectionEvent appends rows only for active connections', async () => {
    const { db, events } = makeDb([{ pubkey: PUBKEY, identityLevel: 2 }])
    const { token, connectionId } = await issueMcpConnection(db, { pubkey: PUBKEY, scope: [READ_SCOPE] })
    expect(await recordMcpConnectionEvent(db, token, { tool: 'search_offers', outcome: 'success', agentLabel: 'Claude Code 2.0' })).toBe(true)
    expect(await recordMcpConnectionEvent(db, token, { tool: 'create_offer', outcome: 'error' })).toBe(true)
    expect(events.filter((e) => e.connectionId === connectionId)).toHaveLength(2)
    expect(events[0].agentLabel).toBe('Claude Code 2.0')
    expect(events[0].tool).toBe('search_offers')
    // revoked → recording stops (uniform failure, no oracle)
    await revokeMcpConnection(db, connectionId, PUBKEY)
    expect(await recordMcpConnectionEvent(db, token, { tool: 'get_offer', outcome: 'success' })).toBe(false)
    expect(events.filter((e) => e.connectionId === connectionId)).toHaveLength(2)
  })

  it('recordMcpConnectionEvent bounds the ledger to the newest events', async () => {
    vi.stubEnv('MCP_CONNECTION_EVENT_MAX', '5')
    const { db, events } = makeDb([{ pubkey: PUBKEY, identityLevel: 2 }])
    const { token, connectionId } = await issueMcpConnection(db, { pubkey: PUBKEY, scope: [READ_SCOPE] })
    for (let i = 0; i < 8; i++) {
      await recordMcpConnectionEvent(db, token, { tool: `tool_${i}`, outcome: 'success' })
    }
    const mine = events.filter((e) => e.connectionId === connectionId)
    expect(mine).toHaveLength(5)
    expect(mine.map((e) => e.tool)).not.toContain('tool_0')
    expect(mine.map((e) => e.tool)).toContain('tool_7')
  })
})
