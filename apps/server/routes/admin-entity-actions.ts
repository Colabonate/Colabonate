// ADR-201: Declarative action registry for the admin /entities page.
// Each row in the admin /entities view can expose one or more named server
// actions. The registry maps (model, action) → metadata + handler, and the
// route file admin-entity-actions.ts (mounted in admin.ts) provides
//
//   GET  /api/admin/entities/:model/actions         → metadata for UI
//   POST /api/admin/entities/:model/:id/:action     → executes handler
//
// All handlers are wrapped in a strict safety net:
//   * NODE_ENV !== 'production' guard (writes are dev/beta only by default)
//   * Whitelist enforcement (the model + action pair must be registered)
//   * Type-safe payload validation
//   * AdminAuditLog entry on every successful write
//   * Type-id confirmation enforced by the client (the UI also enforces it)
//
// Destructive actions also check FK references before deleting.

import type { PrismaClient } from '@prisma/client'
import { resetDemoBalance } from '../services/demoLedger.js'
import { revokeAllMcpConnections } from '../lib/mcp-connections.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export type EntityActionVariant = 'danger' | 'primary' | 'neutral'

export type EntityActionConfirm =
  | { type: 'none' }
  | { type: 'checkbox'; prompt: string }
  | { type: 'type-id'; prompt: string } // user must type the row's id

export type EntityActionField =
  | { field: string; label: string; type: 'string' }
  | { field: string; label: string; type: 'enum'; values: string[]; default?: string }

export type EntityActionMeta = {
  key: string
  label: string
  description: string
  icon?: string
  variant: EntityActionVariant
  confirm: EntityActionConfirm
  payloadSchema?: EntityActionField[]
  /** Whether this action may run over a multi-row selection via the bulk-action
   *  endpoint (ADR-284 D3). Defaults to true — every registered action here
   *  runs the same per-row handler either way, so bulk is safe unless a
   *  specific action opts out. */
  bulkEligible?: boolean
}

export type EntityActionContext = {
  /** Prisma model name (e.g. "Account", "Offer") */
  model: string
  /** Row id (string) */
  id: string
  /** Caller's admin pubkey (already validated by requireFoundationAdminBySession, ADR-273) */
  adminPubkey: string
  /** Request IP — for audit + rate limiting */
  ip: string
  /** Validated payload (already type-checked) */
  payload: Record<string, unknown>
  /** Prisma client */
  prisma: PrismaClient
}

export type EntityActionResult =
  | { ok: true; message: string; row?: Record<string, unknown> }
  | { ok: false; error: string; detail?: string }

export type EntityActionHandler = (ctx: EntityActionContext) => Promise<EntityActionResult>

// ─── Registry ───────────────────────────────────────────────────────────────

const handlers: Record<string, Record<string, EntityActionHandler>> = {}
const meta: Record<string, Record<string, EntityActionMeta>> = {}

export function registerEntityAction(
  model: string,
  handler: EntityActionHandler,
  metaEntry: EntityActionMeta,
): void {
  if (!handlers[model]) handlers[model] = {}
  if (!meta[model]) meta[model] = {}
  handlers[model][metaEntry.key] = handler
  meta[model][metaEntry.key] = metaEntry
}

export function getEntityAction(
  model: string,
  key: string,
): { handler: EntityActionHandler; meta: EntityActionMeta } | null {
  const h = handlers[model]?.[key]
  const m = meta[model]?.[key]
  if (!h || !m) return null
  return { handler: h, meta: m }
}

export function listEntityActions(model: string): EntityActionMeta[] {
  return Object.values(meta[model] ?? {})
}

export function listRegisteredModels(): string[] {
  return Object.keys(meta).sort()
}

// ─── Whitelist of deletable models ──────────────────────────────────────────
// Every public-schema table is deletable EXCEPT the 5 below — see NEVER_DELETABLE.
// Prisma model name → physical table name. Some Prisma names diverge from
// their SQL table names (e.g. Ticket → "Ticket" — usually the same — but
// Account/User are special-cased below).

/** Tables that MUST never be exposed via the per-row delete action.
 *  - `_prisma_migrations`        — would corrupt the migration history
 *  - `AdminAuditLog`             — compliance trail; deleting defeats the purpose of auditing
 *  - `Session`                   — would instantly log out the admin who clicked
 *  - `OutboxEvent`               — pending event-bus entries; deletion drops in-flight messages
 *  - `User`                      — cascade failure: Offer/Session/ColPointsEvent FK to User;
 *                                   account deletion must go through the GDPR flow (ADR-156) */
export const NEVER_DELETABLE = new Set<string>([
  '_prisma_migrations',
  'AdminAuditLog',
  'Session',
  'OutboxEvent',
  'User',
])

export const DELETABLE_MODELS = new Set<string>([
  // ── Always-deletable (no incoming FKs — leaf nodes) ────────────────────
  'AccountDeletionLog',
  'AppealRequest',
  'ArbitrationVerdict',
  'BetaFeedback',
  'CashuToken',
  'Catalog',
  'ColPointsEvent',
  'CollectionShippingOption',
  'CompanyReview',
  'CoopMilestone',
  'CoopMilestoneApplication',
  'CoopMilestoneMessage',
  'CooperationTemplate',
  'DaoConfig',
  'DaoGovernanceConfig',
  'DaoGovernanceTypeOverride',
  'DaoMember',
  'DaoProposalComment',
  'DaoTreasury',
  'DaoVote',
  'DeliveryTemplate',
  'Dispute',
  'DmMessage',
  'GeoLookup',
  'Milestone',
  'NostrAuthChallenge',
  'NotificationLog',
  'OfferMilestone',
  'PayloadDisclosure',
  'PrivateArbiter',
  'ProductCollection',
  'ProductCollectionMember',
  'RemoteOfferCandidate',
  'Review',
  'ShippingOption',
  'StandardCategory',
  'TreasuryTransaction',
  'Wallet',
  // ── Deletable but FK-blocked if children exist (server returns 409) ─────
  // NOTE: 'Account' deliberately does NOT belong here. It's a virtual name
  // used only by the AccountsSection admin page action registry — the
  // physical table is "User", which is (correctly) in NEVER_DELETABLE above
  // for the GDPR-flow reason documented there. 'Account' has no matching
  // Postgres table, so defaultDelete("Account") would 500.
  'Company',
  'Cooperation',
  'Dao',
  'DaoProposal',
  'Escrow',
  'Offer',
  'Product',
  'Ticket',
])

/** Returns a short FK-reference count for a given Prisma model + id, OR null
 *  if the model is not registered for delete. Used to block delete of rows
 *  that are still referenced by child tables. */
export async function getFkReferenceCount(
  prisma: PrismaClient,
  model: string,
  id: string,
): Promise<{ child: string; count: number }[] | null> {
  if (!DELETABLE_MODELS.has(model)) return null
  if (NEVER_DELETABLE.has(model)) return null
  // Safety: model must be a public-schema PascalCase identifier (no quotes, no spaces).
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(model)) return null
  const tableName = model
  // Query the FK graph from information_schema. We use $1 for the id value
  // and a literal quoted table name (validated above) for the parent.
  // Per-child-row counting is done client-side via the JSON column list —
  // the SQL only finds *which* child tables have an FK to this parent.
  // We CAST $1 to text explicitly so Postgres does not need to infer the
  // parameter type from $queryRawUnsafe (which produces ERROR 42P18).
  const fkRows = await prisma.$queryRawUnsafe<{ child_table: string; child_col: string }[]>(
    [
      'SELECT',
      '  tc.table_name  AS child_table,',
      '  kcu.column_name AS child_col',
      'FROM information_schema.table_constraints tc',
      'JOIN information_schema.key_column_usage kcu',
      '  ON tc.constraint_name = kcu.constraint_name',
      ' AND tc.table_schema = kcu.table_schema',
      'JOIN information_schema.constraint_column_usage ccu',
      '  ON tc.constraint_name = ccu.constraint_name',
      ' AND tc.table_schema = ccu.table_schema',
      'WHERE tc.constraint_type = \'FOREIGN KEY\'',
      '  AND ccu.table_name = $1::text',
    ].join('\n'),
    tableName,
  )
  if (fkRows.length === 0) return []
  // Per-child-table existence check (single row, fast for typical id counts).
  // Each FK row gives us (child_table, child_col). We deduplicate child tables
  // and emit a count of how many of the FK columns match the id (any single
  // non-zero match is enough to block deletion).
  const seen = new Set<string>()
  const result: { child: string; count: number }[] = []
  for (const r of fkRows) {
    if (seen.has(r.child_table)) continue
    seen.add(r.child_table)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.child_table)) continue
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.child_col)) continue
    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "${r.child_table}" WHERE "${r.child_col}" = $1::text`,
      id,
    )
    const c = Number(rows[0]?.count ?? 0)
    if (c > 0) result.push({ child: r.child_table, count: c })
  }
  return result
}

// ─── Default delete handler ────────────────────────────────────────────────

async function defaultDelete(ctx: EntityActionContext): Promise<EntityActionResult> {
  const { model, id, prisma } = ctx
  if (NEVER_DELETABLE.has(model)) {
    return { ok: false, error: 'NEVER_DELETABLE', detail: `Model "${model}" is protected and can never be deleted from the admin UI` }
  }
  if (!DELETABLE_MODELS.has(model)) {
    return { ok: false, error: 'NOT_DELETABLE', detail: `Model "${model}" is not in the delete whitelist` }
  }
  const tableName = model
  // FK check
  const refs = await getFkReferenceCount(prisma, model, id)
  if (refs && refs.length > 0) {
    const summary = refs.map(r => `${r.child} (${r.count})`).join(', ')
    return {
      ok: false,
      error: 'FK_REFERENCED',
      detail: `Row is referenced by: ${summary}. Resolve references first.`,
    }
  }
  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM "${tableName}" WHERE id = $1`,
    id,
  )
  return {
    ok: true,
    message: `Deleted 1 row from ${model}`,
    row: { id, deletedRows: Number(result) },
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

const handleResetDemoBalance: EntityActionHandler = async (ctx) => {
  const startBalance = Number(ctx.payload.startBalance ?? 1000)
  if (!Number.isFinite(startBalance) || startBalance < 0 || startBalance > 1_000_000) {
    return { ok: false, error: 'INVALID_PAYLOAD', detail: 'startBalance must be 0-1_000_000 sats' }
  }
  // The id passed in is the User.pubkey for this action
  const balance = await resetDemoBalance(ctx.prisma, ctx.id, startBalance)
  return {
    ok: true,
    message: `Demo balance reset to ${balance} sats`,
    row: { pubkey: ctx.id, balanceSats: balance },
  }
}

const handleSetStatus: EntityActionHandler = async (ctx) => {
  const { model } = ctx
  const status = String(ctx.payload.status ?? '').trim()
  if (!status) return { ok: false, error: 'INVALID_PAYLOAD', detail: 'status is required' }
  // Whitelisted status columns per model
  const statusColumnMap: Record<string, string> = {
    Offer: 'status',
    Ticket: 'status',
    DaoProposal: 'status',
    Review: 'status',
  }
  const col = statusColumnMap[model]
  if (!col) return { ok: false, error: 'NO_STATUS_COLUMN', detail: `Model "${model}" has no whitelisted status column` }
  try {
    const tableId = model
    await ctx.prisma.$executeRawUnsafe(
      `UPDATE "${tableId}" SET "${col}" = $1, "updatedAt" = NOW() WHERE id = $2`,
      status,
      ctx.id,
    )
    return { ok: true, message: `Set ${model}.${col} = ${status}` }
  } catch (err) {
    return { ok: false, error: 'DB_ERROR', detail: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Blocking (ADR-284) ─────────────────────────────────────────────────────
// Moderation block, deliberately independent of any `status` column — a
// block must survive a later `set-status` write (e.g. back to ACTIVE).
// Whitelisted per model, same pattern as DELETABLE_MODELS above. Enforcement
// (excluding blocked rows from public discover/detail reads) lives outside
// this registry, in the read paths themselves (search.ts, index.ts offers
// routes, company.ts, etc.) — this file only owns the write side + audit.

export const BLOCKABLE_MODELS = new Set<string>(['Offer', 'Company'])

const handleBlock: EntityActionHandler = async (ctx) => {
  const { model, id, prisma, adminPubkey } = ctx
  if (!BLOCKABLE_MODELS.has(model)) {
    return { ok: false, error: 'NOT_BLOCKABLE', detail: `Model "${model}" is not in the block whitelist` }
  }
  const reason = String(ctx.payload.reason ?? '').trim()
  if (!reason) return { ok: false, error: 'INVALID_PAYLOAD', detail: 'reason is required' }
  const tableName = model
  await prisma.$executeRawUnsafe(
    `UPDATE "${tableName}" SET "blockedAt" = NOW(), "blockedReason" = $1, "blockedByPubkey" = $2, "updatedAt" = NOW() WHERE id = $3`,
    reason,
    adminPubkey,
    id,
  )
  return { ok: true, message: `Blocked ${model} — hidden from public surfaces immediately` }
}

const handleUnblock: EntityActionHandler = async (ctx) => {
  const { model, id, prisma } = ctx
  if (!BLOCKABLE_MODELS.has(model)) {
    return { ok: false, error: 'NOT_BLOCKABLE', detail: `Model "${model}" is not in the block whitelist` }
  }
  const tableName = model
  await prisma.$executeRawUnsafe(
    `UPDATE "${tableName}" SET "blockedAt" = NULL, "blockedReason" = NULL, "blockedByPubkey" = NULL, "updatedAt" = NOW() WHERE id = $1`,
    id,
  )
  return { ok: true, message: `Unblocked ${model}` }
}

// Account block is a SEPARATE mechanism from the generic block above — it
// also has to kill the ability to log in, not just visibility, so it can't
// reuse the raw-SQL-by-table-name handler (the physical table is "User";
// "Account" itself has no table, see the DELETABLE_MODELS note above).
//
// Registered under BOTH 'Account' (the AccountsSection admin page, which
// always passes pubkey as the row id) AND 'User' (the physical table, also
// browsable via the generic Entities page — detectIdColumn() picks the
// literal "id" column there, i.e. the cuid, not pubkey). ctx.id can
// therefore be either — resolve by whichever one matches.
async function findAccountByIdOrPubkey(ctx: EntityActionContext) {
  return ctx.prisma.user.findFirst({ where: { OR: [{ id: ctx.id }, { pubkey: ctx.id }] } })
}

const handleBlockAccount: EntityActionHandler = async (ctx) => {
  const reason = String(ctx.payload.reason ?? '').trim()
  if (!reason) return { ok: false, error: 'INVALID_PAYLOAD', detail: 'reason is required' }
  const existing = await findAccountByIdOrPubkey(ctx)
  if (!existing) return { ok: false, error: 'NOT_FOUND', detail: `No account matching "${ctx.id}"` }
  await ctx.prisma.user.update({
    where: { id: existing.id },
    data: { blockedAt: new Date(), blockedReason: reason, blockedByPubkey: ctx.adminPubkey },
  })
  // Force-logout: revoke every live session immediately (founder-confirmed
  // behavior, ADR-284 D6 — not a soft "takes effect on next login" block).
  const { count } = await ctx.prisma.session.deleteMany({ where: { pubkey: existing.pubkey } })
  // ADR-284 parity for ADR-371 MCP connections: a blocked account must not keep
  // acting through external-agent tokens or their derived relay sessions.
  const mcpRevoked = await revokeAllMcpConnections(ctx.prisma, existing.pubkey)
  return {
    ok: true,
    message: `Account blocked · ${count} active session${count === 1 ? '' : 's'} revoked${mcpRevoked ? ` · ${mcpRevoked} MCP connection${mcpRevoked === 1 ? '' : 's'} revoked` : ''}`,
  }
}

const handleUnblockAccount: EntityActionHandler = async (ctx) => {
  const existing = await findAccountByIdOrPubkey(ctx)
  if (!existing) return { ok: false, error: 'NOT_FOUND', detail: `No account matching "${ctx.id}"` }
  await ctx.prisma.user.update({
    where: { id: existing.id },
    data: { blockedAt: null, blockedReason: null, blockedByPubkey: null },
  })
  return { ok: true, message: 'Account unblocked — login access restored' }
}

// ─── Register ──────────────────────────────────────────────────────────────

registerEntityAction(
  'Account',
  handleResetDemoBalance,
  {
    key: 'reset-demo-balance',
    label: 'Reset Demo Balance',
    description: 'Reset the DEMO wallet balance to a fixed amount (default 1000 sats).',
    icon: 'restart_alt',
    variant: 'neutral',
    confirm: {
      type: 'type-id',
      prompt: 'Type the user pubkey to confirm the demo balance reset.',
    },
    payloadSchema: [
      { field: 'startBalance', label: 'New balance (sats)', type: 'string' },
    ],
  },
)

// Default delete for every whitelisted model
for (const model of DELETABLE_MODELS) {
  registerEntityAction(
    model,
    defaultDelete,
    {
      key: 'delete',
      label: 'Delete row',
      description: 'Permanently delete this row. FK references are checked first.',
      icon: 'delete',
      variant: 'danger',
      confirm: { type: 'type-id', prompt: 'Type the row id to confirm deletion.' },
    },
  )
}

// Status transition for models that have one
const STATUS_MODELS = ['Offer', 'Ticket', 'DaoProposal', 'Review'] as const
const STATUS_ENUMS: Record<string, string[]> = {
  Offer: ['DRAFT', 'ACTIVE', 'PAUSED', 'SOLD_OUT', 'ARCHIVED', 'REMOVED'],
  Ticket: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CANCELLED'],
  DaoProposal: ['DRAFT', 'OPEN', 'CLOSED', 'EXECUTED', 'REJECTED'],
  Review: ['VISIBLE', 'HIDDEN', 'REMOVED'],
}
for (const model of STATUS_MODELS) {
  registerEntityAction(
    model,
    handleSetStatus,
    {
      key: 'set-status',
      label: 'Set status',
      description: `Change the ${model} status to one of the whitelisted values.`,
      icon: 'flag',
      variant: 'primary',
      confirm: { type: 'checkbox', prompt: 'I understand this changes a public field.' },
      payloadSchema: [
        { field: 'status', label: 'New status', type: 'enum', values: STATUS_ENUMS[model] ?? [] },
      ],
    },
  )
}

// Moderation block/unblock for whitelisted models (ADR-284 D2).
for (const model of BLOCKABLE_MODELS) {
  registerEntityAction(
    model,
    handleBlock,
    {
      key: 'block',
      label: 'Block',
      description: 'Block this row — hides it from public/marketplace surfaces immediately. Independent of status; a later status change will not undo it.',
      icon: 'flag',
      variant: 'danger',
      confirm: { type: 'checkbox', prompt: 'I understand this immediately hides the item from public surfaces.' },
      payloadSchema: [
        { field: 'reason', label: 'Reason', type: 'string' },
      ],
    },
  )
  registerEntityAction(
    model,
    handleUnblock,
    {
      key: 'unblock',
      label: 'Unblock',
      description: 'Remove the moderation block and restore normal visibility.',
      icon: 'restart_alt',
      variant: 'neutral',
      confirm: { type: 'none' },
    },
  )
}

// Account block/unblock (ADR-284 D6) — separate mechanism from the generic
// block above, see handleBlockAccount's comment. Registered under both
// 'Account' (the AccountsSection admin page) and 'User' (the physical table,
// also browsable via the generic Entities page) — same handlers, both id
// shapes resolved by findAccountByIdOrPubkey().
for (const model of ['Account', 'User']) {
  registerEntityAction(
    model,
    handleBlockAccount,
    {
      key: 'block-account',
      label: 'Block Account',
      description: 'Block this account — revokes all active sessions immediately and prevents future logins.',
      icon: 'flag',
      variant: 'danger',
      confirm: { type: 'type-id', prompt: 'Type the row id shown above to confirm the block.' },
      payloadSchema: [
        { field: 'reason', label: 'Reason', type: 'string' },
      ],
    },
  )
  registerEntityAction(
    model,
    handleUnblockAccount,
    {
      key: 'unblock-account',
      label: 'Unblock Account',
      description: 'Remove the block and allow this account to log in again.',
      icon: 'restart_alt',
      variant: 'neutral',
      confirm: { type: 'checkbox', prompt: 'Restore login access for this account.' },
    },
  )
}
