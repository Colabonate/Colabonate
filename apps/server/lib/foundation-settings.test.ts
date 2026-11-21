import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  FOUNDATION_SETTINGS_DEFAULTS,
  getFoundationSettings,
  normalizeFoundationSettings,
  parseSettingsPatch,
  updateFoundationSettings,
} from './foundation-settings.js'

describe('normalizeFoundationSettings (ADR-405 D5)', () => {
  it('returns all-default flags for a null row', () => {
    expect(normalizeFoundationSettings(null)).toEqual(FOUNDATION_SETTINGS_DEFAULTS)
  })

  it('keeps stored values and defaults the missing ones', () => {
    expect(normalizeFoundationSettings({ aiSalesPaused: true, mcpSectionHidden: true })).toEqual({
      ...FOUNDATION_SETTINGS_DEFAULTS,
      aiSalesPaused: true,
      mcpSectionHidden: true,
    })
  })

  it('keeps a stored timer value and defaults it to null when absent (ADR-423)', () => {
    expect(normalizeFoundationSettings({ remoteCandidatesAutoApproveDays: 7 })).toEqual({
      ...FOUNDATION_SETTINGS_DEFAULTS,
      remoteCandidatesAutoApproveDays: 7,
    })
    expect(normalizeFoundationSettings({}).remoteCandidatesAutoApproveDays).toBeNull()
  })
})

describe('parseSettingsPatch (ADR-405 D4, ADR-423)', () => {
  it('accepts a subset of the toggleable booleans', () => {
    expect(parseSettingsPatch({ aiSalesPaused: true })).toEqual({ ok: true, patch: { aiSalesPaused: true } })
  })

  it('accepts remoteCandidatesAutoApprove as a boolean (ADR-423)', () => {
    expect(parseSettingsPatch({ remoteCandidatesAutoApprove: true })).toEqual({
      ok: true,
      patch: { remoteCandidatesAutoApprove: true },
    })
  })

  it('accepts remoteCandidatesAutoApproveDays as null or an integer 1–29 (ADR-423)', () => {
    expect(parseSettingsPatch({ remoteCandidatesAutoApproveDays: null })).toEqual({
      ok: true,
      patch: { remoteCandidatesAutoApproveDays: null },
    })
    expect(parseSettingsPatch({ remoteCandidatesAutoApproveDays: 1 })).toEqual({ ok: true, patch: { remoteCandidatesAutoApproveDays: 1 } })
    expect(parseSettingsPatch({ remoteCandidatesAutoApproveDays: 29 })).toEqual({ ok: true, patch: { remoteCandidatesAutoApproveDays: 29 } })
  })

  it('rejects out-of-range, non-integer and string timer values', () => {
    expect(parseSettingsPatch({ remoteCandidatesAutoApproveDays: 0 }).ok).toBe(false)
    expect(parseSettingsPatch({ remoteCandidatesAutoApproveDays: 30 }).ok).toBe(false)
    expect(parseSettingsPatch({ remoteCandidatesAutoApproveDays: 3.5 }).ok).toBe(false)
    expect(parseSettingsPatch({ remoteCandidatesAutoApproveDays: '7' }).ok).toBe(false)
    expect(parseSettingsPatch({ remoteCandidatesAutoApproveDays: true }).ok).toBe(false)
  })

  it('rejects unknown / read-only keys, wrong types and empty bodies', () => {
    expect(parseSettingsPatch({ nope: true }).ok).toBe(false)
    expect(parseSettingsPatch({ aiSalesPaused: 'yes' }).ok).toBe(false)
    expect(parseSettingsPatch({}).ok).toBe(false)
    expect(parseSettingsPatch(null).ok).toBe(false)
    expect(parseSettingsPatch([]).ok).toBe(false)
  })
})

describe('getFoundationSettings', () => {
  it('falls back to defaults when the singleton row is absent', async () => {
    const prisma = { foundationSettings: { findUnique: vi.fn(async () => null) } } as unknown as PrismaClient
    expect(await getFoundationSettings(prisma)).toEqual(FOUNDATION_SETTINGS_DEFAULTS)
  })
})

describe('updateFoundationSettings', () => {
  it('upserts id=1 with the patch and updatedBy, then normalises the result', async () => {
    const upsert = vi.fn(async () => ({
      id: 1,
      remoteCandidatesAutoApprove: false,
      remoteCandidatesAutoApproveDays: null,
      aiSalesPaused: true,
      mcpSalesPaused: false,
      aiAssistantSectionHidden: false,
      mcpSectionHidden: false,
      updatedBy: 'admin-pubkey',
      updatedAt: new Date(),
    }))
    const prisma = { foundationSettings: { upsert } } as unknown as PrismaClient
    const result = await updateFoundationSettings(prisma, { aiSalesPaused: true }, 'admin-pubkey')
    expect(upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, aiSalesPaused: true, updatedBy: 'admin-pubkey' },
      update: { aiSalesPaused: true, updatedBy: 'admin-pubkey' },
    })
    expect(result.aiSalesPaused).toBe(true)
    expect(result.mcpSalesPaused).toBe(false)
  })
})
