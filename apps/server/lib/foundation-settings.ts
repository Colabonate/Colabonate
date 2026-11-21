// ADR-405 — runtime sales & visibility switches for the AI Assistant and MCP
// surfaces, stored on the FoundationSettings singleton (id = 1). The switches
// are close-only / hide-only: the environment gates (AI_HOSTED_ENABLED,
// MCP_PAYWALL_ENABLED) stay authoritative, so a flag can never open a gate the
// environment closed (ADR-402 D7/D9 invariant). All flags default false, so
// behaviour is unchanged until an admin flips one.
// ADR-423 — remote-candidate auto-approval: remoteCandidatesAutoApprove
// (immediate mode) is now admin-writable, joined by the nullable int
// remoteCandidatesAutoApproveDays (timer mode, 1–29, null = off). Immediate
// mode takes precedence over the timer; both default off, so curation stays
// manual until an admin opts in.
import type { PrismaClient } from '@prisma/client'

export interface FoundationSettingsFlags {
  remoteCandidatesAutoApprove: boolean
  remoteCandidatesAutoApproveDays: number | null
  aiSalesPaused: boolean
  mcpSalesPaused: boolean
  aiAssistantSectionHidden: boolean
  mcpSectionHidden: boolean
}

export const FOUNDATION_SETTINGS_DEFAULTS: FoundationSettingsFlags = {
  remoteCandidatesAutoApprove: false,
  remoteCandidatesAutoApproveDays: null,
  aiSalesPaused: false,
  mcpSalesPaused: false,
  aiAssistantSectionHidden: false,
  mcpSectionHidden: false,
}

// The boolean flags an admin may toggle via PATCH (ADR-405 D4; ADR-423 added
// remoteCandidatesAutoApprove — previously reserved for ADR-363 / FU-636).
export const TOGGLEABLE_SETTINGS = [
  'remoteCandidatesAutoApprove',
  'aiSalesPaused',
  'mcpSalesPaused',
  'aiAssistantSectionHidden',
  'mcpSectionHidden',
] as const
export type ToggleableSetting = (typeof TOGGLEABLE_SETTINGS)[number]

// The nullable-int settings an admin may PATCH (ADR-423): the auto-approve
// timer in days. Capped below the subscriber's 30-day candidate expiry
// (EXPIRE_DAYS) — a longer timer would never fire before the candidate
// expires.
export const INT_SETTINGS = ['remoteCandidatesAutoApproveDays'] as const
export type IntSetting = (typeof INT_SETTINGS)[number]
export const REMOTE_AUTO_APPROVE_DAYS_MIN = 1
export const REMOTE_AUTO_APPROVE_DAYS_MAX = 29

export function isToggleableSetting(key: string): key is ToggleableSetting {
  return (TOGGLEABLE_SETTINGS as readonly string[]).includes(key)
}

export function isIntSetting(key: string): key is IntSetting {
  return (INT_SETTINGS as readonly string[]).includes(key)
}

/** Anything a settings PATCH may carry (ADR-405 booleans + ADR-423 ints). */
export type SettingsPatch = Partial<Record<ToggleableSetting, boolean> & Record<IntSetting, number | null>>

type SettingsRow = { [K in keyof FoundationSettingsFlags]?: FoundationSettingsFlags[K] } | null | undefined

/** Pure: normalises a row (or null) into the full flag set with code defaults. */
export function normalizeFoundationSettings(row: SettingsRow): FoundationSettingsFlags {
  return {
    remoteCandidatesAutoApprove:
      row?.remoteCandidatesAutoApprove ?? FOUNDATION_SETTINGS_DEFAULTS.remoteCandidatesAutoApprove,
    remoteCandidatesAutoApproveDays:
      row?.remoteCandidatesAutoApproveDays ?? FOUNDATION_SETTINGS_DEFAULTS.remoteCandidatesAutoApproveDays,
    aiSalesPaused: row?.aiSalesPaused ?? FOUNDATION_SETTINGS_DEFAULTS.aiSalesPaused,
    mcpSalesPaused: row?.mcpSalesPaused ?? FOUNDATION_SETTINGS_DEFAULTS.mcpSalesPaused,
    aiAssistantSectionHidden:
      row?.aiAssistantSectionHidden ?? FOUNDATION_SETTINGS_DEFAULTS.aiAssistantSectionHidden,
    mcpSectionHidden: row?.mcpSectionHidden ?? FOUNDATION_SETTINGS_DEFAULTS.mcpSectionHidden,
  }
}

export interface SettingsPatchResult {
  ok: boolean
  patch?: SettingsPatch
  error?: string
}

/** Pure: validates a PATCH body — whitelisted booleans/ints, at least one. */
export function parseSettingsPatch(body: unknown): SettingsPatchResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object' }
  }
  const patch: SettingsPatch = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (isToggleableSetting(key)) {
      if (typeof value !== 'boolean') return { ok: false, error: `${key} must be a boolean` }
      patch[key] = value
      continue
    }
    if (isIntSetting(key)) {
      if (value === null) {
        patch[key] = null
        continue
      }
      if (
        typeof value !== 'number' || !Number.isInteger(value) ||
        value < REMOTE_AUTO_APPROVE_DAYS_MIN || value > REMOTE_AUTO_APPROVE_DAYS_MAX
      ) {
        return {
          ok: false,
          error: `${key} must be null or an integer between ${REMOTE_AUTO_APPROVE_DAYS_MIN} and ${REMOTE_AUTO_APPROVE_DAYS_MAX}`,
        }
      }
      patch[key] = value
      continue
    }
    return { ok: false, error: `Unknown or read-only setting: ${key}` }
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'No settings provided' }
  return { ok: true, patch }
}

const SETTINGS_ID = 1

/** Flags plus the audit meta the admin surface shows. */
export interface FoundationSettingsRecord extends FoundationSettingsFlags {
  updatedBy: string | null
  updatedAt: Date | null
}

/** Reads the singleton; returns code defaults when the row is absent. */
export async function getFoundationSettings(prisma: PrismaClient): Promise<FoundationSettingsFlags> {
  const row = await prisma.foundationSettings.findUnique({ where: { id: SETTINGS_ID } })
  return normalizeFoundationSettings(row)
}

/** Reads the singleton with updatedBy/updatedAt for the admin view. */
export async function getFoundationSettingsRecord(prisma: PrismaClient): Promise<FoundationSettingsRecord> {
  const row = await prisma.foundationSettings.findUnique({ where: { id: SETTINGS_ID } })
  return {
    ...normalizeFoundationSettings(row),
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row?.updatedAt ?? null,
  }
}

/** Upserts a whitelisted flag patch, sets updatedBy, returns the new record. */
export async function updateFoundationSettings(
  prisma: PrismaClient,
  patch: SettingsPatch,
  adminPubkey: string,
): Promise<FoundationSettingsRecord> {
  const row = await prisma.foundationSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...patch, updatedBy: adminPubkey },
    update: { ...patch, updatedBy: adminPubkey },
  })
  return {
    ...normalizeFoundationSettings(row),
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt ?? null,
  }
}
