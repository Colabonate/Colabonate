import { createHash, randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

// ADR-371 — MCP connection token service.
//
// Design invariants (see docs/decisions/371-user-agent-mcp-connect-access.md):
// - The raw MCP token is 256-bit random hex, shown exactly once at mint time,
//   never stored and never logged (FU-195-C). Only sha256(token) is persisted.
// - Connections are REST-inert (D7): requireAuth does NOT accept them. The only
//   consumer of a connection is the public /mcp gateway, which exchanges it —
//   via the internal-secret relay route (routes/mcp.ts) — for a short-lived
//   derived REST Session (kind='MCP'). That relay mints/refreshes derived rows
//   and deletes the previous one; revoking a connection kills its derived rows.
// - Expired/revoked/blocked connections fail validation as "not found" (no
//   oracle that distinguishes invalid from expired/revoked).

export type McpScopeFamily = 'offers' | 'cooperations' | 'tickets' | 'dao' | 'identity' | 'images'

export const READ_SCOPE = 'read'
export const MCP_SCOPE_FAMILIES: McpScopeFamily[] = ['offers', 'cooperations', 'tickets', 'dao', 'identity', 'images']
export const MCP_WRITE_SCOPES: string[] = MCP_SCOPE_FAMILIES.map((f) => `${f}:write`)
export const MCP_ALL_SCOPES: string[] = [READ_SCOPE, ...MCP_WRITE_SCOPES]
export const MCP_DERIVED_SESSION_KIND = 'MCP'

export function isMcpScope(value: unknown): value is string {
  return typeof value === 'string' && MCP_ALL_SCOPES.includes(value)
}

// Read lazily inside callers/tests: env is loaded at index.ts boot, so a
// module-level capture would be empty in dev (tsx) and in the compiled bundle.
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Connection TTL (hours). Default 24 h — hours-range short-lived per D2. */
export function mcpTokenTtlMs(): number {
  return envNumber('MCP_TOKEN_TTL_HOURS', 24) * 60 * 60 * 1000
}

/** Derived REST session TTL (minutes). Well under the connection TTL; the
 *  gateway refreshes before expiry. Default 30 min. */
export function mcpDerivedSessionTtlMs(): number {
  return envNumber('MCP_DERIVED_SESSION_TTL_MINUTES', 30) * 60 * 1000
}

export function hashMcpToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function generateMcpToken(): string {
  return randomBytes(32).toString('hex')
}

export interface McpConnectionWithUser {
  id: string
  pubkey: string
  tokenHash: string
  scope: string[]
  label: string | null
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
  user: { pubkey: string; identityLevel: number; blockedAt: Date | null }
}

export async function findMcpConnectionByToken(
  prisma: PrismaClient,
  token: string
): Promise<McpConnectionWithUser | null> {
  return prisma.mcpConnection.findUnique({
    where: { tokenHash: hashMcpToken(token) },
    include: { user: { select: { pubkey: true, identityLevel: true, blockedAt: true } } },
  })
}

/**
 * Active-connection validation. Returns null (uniform "not found") when the
 * connection does not exist, is revoked, is expired, its owner is blocked, or
 * the owner's ADR-402 D7 `mcpAccess` policy is SUSPENDED — and revokes the
 * connection (plus its derived relay sessions) when the owner is blocked or
 * suspended (a suspended identity must not keep acting through MCP tokens).
 */
export async function validateMcpConnection(
  prisma: PrismaClient,
  token: string
): Promise<McpConnectionWithUser | null> {
  const conn = await findMcpConnectionByToken(prisma, token)
  if (!conn) return null
  if (conn.revokedAt || conn.expiresAt < new Date()) return null
  if (conn.user.blockedAt) {
    await revokeMcpConnection(prisma, conn.id)
    return null
  }
  const policy = await prisma.userAiPolicy.findUnique({
    where: { pubkey: conn.pubkey },
    select: { mcpAccess: true },
  })
  if (policy?.mcpAccess === 'SUSPENDED') {
    await revokeMcpConnection(prisma, conn.id)
    return null
  }
  return conn
}

export interface IssueMcpConnectionInput {
  pubkey: string
  scope: string[]
  label?: string
  ttlMs?: number
  /** ADR-384 D11: trial | day | week | month (unset = legacy free connection). */
  passTier?: string
}

/** Mint a connection. Returns the raw token (caller shows it exactly once). */
export async function issueMcpConnection(
  prisma: PrismaClient,
  input: IssueMcpConnectionInput
): Promise<{ token: string; connectionId: string }> {
  const token = generateMcpToken()
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? mcpTokenTtlMs()))
  const scope = input.scope.includes(READ_SCOPE) ? input.scope : [READ_SCOPE, ...input.scope]
  const conn = await prisma.mcpConnection.create({
    data: {
      pubkey: input.pubkey,
      tokenHash: hashMcpToken(token),
      scope,
      label: input.label?.trim() ? input.label.trim().slice(0, 120) : null,
      expiresAt,
      passTier: input.passTier ?? null,
    },
  })
  return { token, connectionId: conn.id }
}

/** Revoke a connection and kill any derived relay sessions it minted. */
export async function revokeMcpConnection(
  prisma: PrismaClient,
  connectionId: string,
  pubkey?: string
): Promise<boolean> {
  const where = pubkey
    ? { id: connectionId, pubkey }
    : { id: connectionId }
  const result = await prisma.mcpConnection.updateMany({
    where: { ...where, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (result.count === 0) return false
  await prisma.session
    .deleteMany({ where: { mcpConnectionId: connectionId, kind: MCP_DERIVED_SESSION_KIND } })
    .catch(() => {})
  return true
}

/** Revoke all active connections of a user (block-time parity hook). */
export async function revokeAllMcpConnections(prisma: PrismaClient, pubkey: string): Promise<number> {
  const active = await prisma.mcpConnection.findMany({
    where: { pubkey, revokedAt: null },
    select: { id: true },
  })
  for (const { id } of active) {
    await prisma.session
      .deleteMany({ where: { mcpConnectionId: id, kind: MCP_DERIVED_SESSION_KIND } })
      .catch(() => {})
  }
  const result = await prisma.mcpConnection.updateMany({
    where: { pubkey, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return active.length > 0 ? result.count : 0
}

export interface DerivedSession {
  token: string
  expiresAt: Date
  ttlMs: number
}

/**
 * ADR-371 D7 — mint (or refresh) the short-lived derived REST session for an
 * active connection. Deletes the previous derived row first so each connection
 * keeps at most one live derived credential. The returned token is a normal
 * Session bearer (requireAuth accepts it) but is handed out only to the trusted
 * mcp-server process via the internal relay.
 */
export async function issueDerivedSession(
  prisma: PrismaClient,
  conn: McpConnectionWithUser,
  now = new Date()
): Promise<DerivedSession> {
  const ttlMs = Math.min(mcpDerivedSessionTtlMs(), Math.max(conn.expiresAt.getTime() - now.getTime(), 1_000))
  await prisma.session.deleteMany({
    where: { mcpConnectionId: conn.id, kind: MCP_DERIVED_SESSION_KIND },
  })
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(now.getTime() + ttlMs)
  await prisma.session.create({
    data: {
      pubkey: conn.user.pubkey,
      k1: `mcp-${conn.id}-${randomBytes(6).toString('hex')}`,
      token,
      expiresAt,
      kind: MCP_DERIVED_SESSION_KIND,
      mcpConnectionId: conn.id,
    },
  })
  return { token, expiresAt, ttlMs }
}

/** Ledger cap per connection (rows kept, newest wins). Default 500. */
export function mcpConnectionEventMax(): number {
  return envNumber('MCP_CONNECTION_EVENT_MAX', 500)
}

export interface McpConnectionEventInput {
  tool: string
  outcome: 'success' | 'error'
  agentLabel?: string
}

/**
 * ADR-371 D5/Phase 3 — append a row to a connection's activity ledger
 * ("was passiert ist"). The MCP bearer is validated first (active connection
 * only), so a revoked/expired connection or a blocked owner stops recording
 * immediately. The ledger is bounded per connection: once a new row would push
 * the count past `mcpConnectionEventMax()`, the oldest rows are pruned. Only
 * tool + outcome + agent label are stored — never token material or request
 * payloads (FU-195-C).
 */
export async function recordMcpConnectionEvent(
  prisma: PrismaClient,
  token: string,
  input: McpConnectionEventInput
): Promise<boolean> {
  const conn = await validateMcpConnection(prisma, token)
  if (!conn) return false
  const agentLabel = input.agentLabel?.trim() ? input.agentLabel.trim().slice(0, 120) : null
  await prisma.mcpConnectionEvent.create({
    data: {
      connectionId: conn.id,
      tool: input.tool.trim().slice(0, 120),
      outcome: input.outcome,
      agentLabel,
    },
  })
  const max = mcpConnectionEventMax()
  const total = await prisma.mcpConnectionEvent.count({ where: { connectionId: conn.id } })
  if (total > max) {
    const keep = await prisma.mcpConnectionEvent.findMany({
      where: { connectionId: conn.id },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      take: max,
      select: { id: true },
    })
    await prisma.mcpConnectionEvent.deleteMany({
      where: { connectionId: conn.id, id: { notIn: keep.map((e) => e.id) } },
    })
  }
  return true
}
