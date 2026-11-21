import { describe, it, expect } from 'vitest'
import { canBuildReputation, isDaoArbitrable, describeTradeMode, ticketCanBuildReputation, isProfileIndexable } from './tradeVisibility.js'

// ADR-152 §A3 — Reputation-Gating. The function must be the single source of
// truth for "is this thing allowed in private mode?".

describe('canBuildReputation (ADR-152 §A3)', () => {
  it('PUBLIC tickets can build reputation', () => {
    expect(canBuildReputation('PUBLIC')).toBe(true)
  })

  it('PRIVATE tickets cannot build reputation', () => {
    expect(canBuildReputation('PRIVATE')).toBe(false)
  })

  it('null/undefined fallback to no-reputation (fail-closed)', () => {
    expect(canBuildReputation(null)).toBe(false)
    expect(canBuildReputation(undefined)).toBe(false)
    expect(canBuildReputation('')).toBe(false)
  })

  it('unknown values fail closed (no reputation)', () => {
    expect(canBuildReputation('INTERNAL')).toBe(false)
    expect(canBuildReputation('public')).toBe(false) // case-sensitive
  })
})

describe('isDaoArbitrable', () => {
  it('PUBLIC dispute mode is DAO-arbitrable', () => {
    expect(isDaoArbitrable('PUBLIC')).toBe(true)
  })

  it('PRIVATE dispute mode is NOT DAO-arbitrable (uses mutual arbiter)', () => {
    expect(isDaoArbitrable('PRIVATE')).toBe(false)
  })

  it('NONE dispute mode is not arbitrable at all', () => {
    expect(isDaoArbitrable('NONE')).toBe(false)
  })

  it('null/undefined fail closed', () => {
    expect(isDaoArbitrable(null)).toBe(false)
    expect(isDaoArbitrable(undefined)).toBe(false)
  })
})

describe('isProfileIndexable (ADR-152 §D3 / ADR-159)', () => {
  it('PUBLIC profiles are indexable', () => {
    expect(isProfileIndexable('PUBLIC')).toBe(true)
  })

  it('PSEUDO_PRIVATE profiles are indexable (stammdaten-only, not offer-hidden)', () => {
    expect(isProfileIndexable('PSEUDO_PRIVATE')).toBe(true)
  })

  it('PRIVATE profiles are NOT indexable (KEIN globaler Index)', () => {
    expect(isProfileIndexable('PRIVATE')).toBe(false)
  })

  it('null/undefined default to indexable (missing profile row ≡ PUBLIC)', () => {
    // The field is non-null with @default(PUBLIC), so null never occurs in
    // practice; fail-open here matches default-PUBLIC and the authoritative
    // DB browse/search filter (`profileVisibility <> 'PRIVATE'`).
    expect(isProfileIndexable(null)).toBe(true)
    expect(isProfileIndexable(undefined)).toBe(true)
    expect(isProfileIndexable('')).toBe(true)
  })
})

describe('describeTradeMode', () => {
  it('PUBLIC tickets label as "Public"', () => {
    expect(describeTradeMode('PUBLIC', 'PUBLIC')).toBe('Public')
    expect(describeTradeMode('PUBLIC', 'PRIVATE')).toBe('Public')
    expect(describeTradeMode('PUBLIC', 'NONE')).toBe('Public')
  })

  it('PRIVATE + PRIVATE labels as "Private (with mutual arbiter)"', () => {
    expect(describeTradeMode('PRIVATE', 'PRIVATE')).toBe('Private (with mutual arbiter)')
  })

  it('PRIVATE + NONE labels as "Private (no dispute protection)"', () => {
    expect(describeTradeMode('PRIVATE', 'NONE')).toBe('Private (no dispute protection)')
  })

  it('PRIVATE + unknown defaults to "Private"', () => {
    expect(describeTradeMode('PRIVATE', 'UNKNOWN')).toBe('Private')
  })
})

describe('ticketCanBuildReputation (Prisma integration)', () => {
  // Minimal Prisma mock for the visibility lookup
  function makeMockPrisma(visibility: string | null) {
    return {
      ticket: {
        findUnique: async () => (visibility === null ? null : { visibility }),
      },
    } as unknown as Parameters<typeof ticketCanBuildReputation>[0]
  }

  it('returns true for PUBLIC tickets', async () => {
    const prisma = makeMockPrisma('PUBLIC')
    expect(await ticketCanBuildReputation(prisma, 'ticket-1')).toBe(true)
  })

  it('returns false for PRIVATE tickets', async () => {
    const prisma = makeMockPrisma('PRIVATE')
    expect(await ticketCanBuildReputation(prisma, 'ticket-1')).toBe(false)
  })

  it('returns false for missing tickets (fail-closed)', async () => {
    const prisma = makeMockPrisma(null)
    expect(await ticketCanBuildReputation(prisma, 'missing')).toBe(false)
  })
})
