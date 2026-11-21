import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  buildNewsletterAudience,
  runNewsletterMaintenance,
  generateNewsletterToken,
  NEWSLETTER_CONSENT_TEXT_VERSION,
  recordNewsletterConsent,
  normalizeNewsletterEmail,
  type NewsletterAccountRow,
  type NewsletterSubscriberRow,
} from './newsletter.js'

const d = (iso: string) => new Date(iso)

function subscriber(overrides: Partial<NewsletterSubscriberRow> = {}): NewsletterSubscriberRow {
  return {
    email: 'a@example.com',
    source: 'footer',
    status: 'CONFIRMED',
    pubkey: null,
    confirmedAt: d('2026-01-01T00:00:00Z'),
    unsubscribedAt: null,
    consentAt: d('2026-01-01T00:00:00Z'),
    createdAt: d('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

function account(overrides: Partial<NewsletterAccountRow> = {}): NewsletterAccountRow {
  return {
    pubkey: 'pk-account',
    email: 'b@example.com',
    emailVerified: true,
    createdAt: d('2026-02-01T00:00:00Z'),
    ...overrides,
  }
}

describe('normalizeNewsletterEmail', () => {
  it('trims and lowercases a valid address', () => {
    expect(normalizeNewsletterEmail('  Foo.Bar@Example.COM ')).toBe('foo.bar@example.com')
  })

  it('rejects non-strings, empty strings and malformed addresses', () => {
    expect(normalizeNewsletterEmail(undefined)).toBeNull()
    expect(normalizeNewsletterEmail(42)).toBeNull()
    expect(normalizeNewsletterEmail('   ')).toBeNull()
    expect(normalizeNewsletterEmail('no-at-sign')).toBeNull()
    expect(normalizeNewsletterEmail('a@b')).toBeNull()
    expect(normalizeNewsletterEmail('a@b.')).toBeNull()
  })

  it('rejects addresses over 254 characters', () => {
    const local = 'x'.repeat(250)
    expect(normalizeNewsletterEmail(`${local}@example.com`)).toBeNull()
  })
})

describe('generateNewsletterToken', () => {
  it('returns a URL-safe, sufficiently long, unique token', () => {
    const a = generateNewsletterToken()
    const b = generateNewsletterToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).not.toBe(b)
  })
})

describe('buildNewsletterAudience (ADR-400)', () => {
  it('includes explicit subscribers with their status', () => {
    const rows = buildNewsletterAudience([subscriber()], [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ email: 'a@example.com', origin: 'subscriber', status: 'CONFIRMED', emailVerified: true, consent: true })
  })

  it('lists account emails as NO_CONSENT, never as confirmed recipients (ADR-402 D16)', () => {
    const rows = buildNewsletterAudience([], [account()])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ email: 'b@example.com', origin: 'account', status: 'NO_CONSENT', consent: false, emailVerified: true, pubkey: 'pk-account' })
  })

  it('reports consent=false for a subscriber row without a recorded opt-in', () => {
    const rows = buildNewsletterAudience([subscriber({ consentAt: null })], [])
    expect(rows[0]).toMatchObject({ status: 'CONFIRMED', consent: false })
  })

  it('skips accounts without an email', () => {
    expect(buildNewsletterAudience([], [account({ email: null })])).toHaveLength(0)
  })

  it('dedupes by lowercase email and lets the subscriber row win', () => {
    const rows = buildNewsletterAudience(
      [subscriber({ email: 'Same@Example.com', status: 'UNSUBSCRIBED', unsubscribedAt: d('2026-03-01T00:00:00Z') })],
      [account({ email: 'same@example.com' })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ email: 'same@example.com', origin: 'subscriber', status: 'UNSUBSCRIBED' })
  })

  it('never resurrects an unsubscribed address from the account list', () => {
    const rows = buildNewsletterAudience(
      [subscriber({ email: 'gone@example.com', status: 'UNSUBSCRIBED', unsubscribedAt: d('2026-03-01T00:00:00Z') })],
      [account({ email: 'gone@example.com' })],
    )
    expect(rows.filter((r) => r.status === 'CONFIRMED')).toHaveLength(0)
    expect(rows[0].status).toBe('UNSUBSCRIBED')
  })

  it('marks unverified account emails as not verified', () => {
    const rows = buildNewsletterAudience([], [account({ emailVerified: false })])
    expect(rows[0]).toMatchObject({ emailVerified: false, confirmedAt: null })
  })

  it('sorts by createdAt descending', () => {
    const rows = buildNewsletterAudience(
      [subscriber({ email: 'old@example.com', createdAt: d('2026-01-01T00:00:00Z') })],
      [account({ email: 'new@example.com', createdAt: d('2026-05-01T00:00:00Z') })],
    )
    expect(rows.map((r) => r.email)).toEqual(['new@example.com', 'old@example.com'])
  })
})

// ── ADR-402 D16: consent recording ──────────────────────────────────────────

interface FakeRow {
  email: string
  pubkey: string | null
  source: string
  token: string
  status: 'PENDING' | 'CONFIRMED' | 'UNSUBSCRIBED'
  confirmedAt: Date | null
  unsubscribedAt: Date | null
  consentAt: Date | null
  consentSource: string | null
  consentTextVersion: string | null
}

const EMPTY_ROW: Omit<FakeRow, 'email' | 'token'> = {
  pubkey: null,
  source: 'footer',
  status: 'PENDING',
  confirmedAt: null,
  unsubscribedAt: null,
  consentAt: null,
  consentSource: null,
  consentTextVersion: null,
}

function fakePrisma(initial: Array<Partial<FakeRow> & { email: string }> = []) {
  const rows = new Map<string, FakeRow>()
  for (const r of initial) rows.set(r.email, { ...EMPTY_ROW, token: `tok-${r.email}`, ...r })
  const prisma = {
    newsletterSubscriber: {
      findUnique: async ({ where }: { where: { email: string } }) => rows.get(where.email) ?? null,
      update: async ({ where, data }: { where: { email: string }; data: Partial<FakeRow> }) => {
        const row = { ...rows.get(where.email)!, ...data }
        rows.set(where.email, row)
        return row
      },
      create: async ({ data }: { data: Partial<FakeRow> & { email: string; token: string } }) => {
        const row: FakeRow = { ...EMPTY_ROW, ...data }
        rows.set(row.email, row)
        return row
      },
    },
  }
  return { prisma: prisma as unknown as PrismaClient, rows }
}

describe('recordNewsletterConsent (ADR-402 D16)', () => {
  it('creates a PENDING row with consent proof when the address is not yet proven', async () => {
    const { prisma, rows } = fakePrisma()
    const r = await recordNewsletterConsent(prisma, ' New@Example.com ', 'pk1', { source: 'signup-email', confirm: false })
    expect(r?.status).toBe('PENDING')
    const row = rows.get('new@example.com')!
    expect(row).toMatchObject({
      status: 'PENDING',
      pubkey: 'pk1',
      consentSource: 'signup-email',
      consentTextVersion: NEWSLETTER_CONSENT_TEXT_VERSION,
    })
    expect(row.consentAt).toBeInstanceOf(Date)
  })

  it('confirms directly when the address is already proven', async () => {
    const { prisma, rows } = fakePrisma()
    await recordNewsletterConsent(prisma, 'v@example.com', 'pk1', { source: 'settings', confirm: true })
    expect(rows.get('v@example.com')).toMatchObject({ status: 'CONFIRMED' })
    expect(rows.get('v@example.com')!.confirmedAt).toBeInstanceOf(Date)
  })

  it('keeps the suppression marker when an unproven opt-in re-subscribes an unsubscribed address', async () => {
    const unsubscribedAt = new Date('2026-03-01T00:00:00Z')
    const { prisma, rows } = fakePrisma([{ email: 'u@example.com', status: 'UNSUBSCRIBED', unsubscribedAt }])
    await recordNewsletterConsent(prisma, 'u@example.com', null, { source: 'settings', confirm: false })
    expect(rows.get('u@example.com')).toMatchObject({ status: 'PENDING', unsubscribedAt, consentSource: 'settings' })
  })

  it('clears the suppression marker only for a proven opt-in', async () => {
    const { prisma, rows } = fakePrisma([{ email: 'p@example.com', status: 'UNSUBSCRIBED', unsubscribedAt: new Date() }])
    await recordNewsletterConsent(prisma, 'p@example.com', 'pk', { source: 'signup-email', confirm: true })
    expect(rows.get('p@example.com')).toMatchObject({ status: 'CONFIRMED', unsubscribedAt: null })
  })

  it('never re-binds a row that belongs to another identity', async () => {
    const { prisma, rows } = fakePrisma([{ email: 'o@example.com', pubkey: 'owner' }])
    await recordNewsletterConsent(prisma, 'o@example.com', 'someone-else', { source: 'settings', confirm: false })
    expect(rows.get('o@example.com')!.pubkey).toBe('owner')
  })

  it('is a no-op for an already consented, confirmed row', async () => {
    const consentAt = new Date('2026-01-01T00:00:00Z')
    const { prisma, rows } = fakePrisma([{ email: 'c@example.com', status: 'CONFIRMED', consentAt, consentSource: 'footer' }])
    await recordNewsletterConsent(prisma, 'c@example.com', 'pk', { source: 'signup-email', confirm: false })
    expect(rows.get('c@example.com')).toMatchObject({ status: 'CONFIRMED', consentAt, consentSource: 'footer' })
  })

  it('rejects an invalid address', async () => {
    const { prisma } = fakePrisma()
    expect(await recordNewsletterConsent(prisma, 'nope', null, { source: 'footer', confirm: false })).toBeNull()
  })
  // ADR-401 FU-892: newlyConfirmed drives the one-time welcome mail.
  it('reports newlyConfirmed only on the transition to a consented CONFIRMED row', async () => {
    const { prisma } = fakePrisma([
      { email: 'c@example.com', status: 'CONFIRMED', consentAt: new Date('2026-01-01T00:00:00Z') },
      { email: 'u@example.com', status: 'UNSUBSCRIBED', unsubscribedAt: new Date() },
    ])
    expect((await recordNewsletterConsent(prisma, 'new@example.com', 'pk', { source: 'settings', confirm: true }))?.newlyConfirmed).toBe(true)
    expect((await recordNewsletterConsent(prisma, 'pend@example.com', 'pk', { source: 'settings', confirm: false }))?.newlyConfirmed).toBe(false)
    expect((await recordNewsletterConsent(prisma, 'c@example.com', 'pk', { source: 'settings', confirm: true }))?.newlyConfirmed).toBe(false)
    expect((await recordNewsletterConsent(prisma, 'u@example.com', 'pk', { source: 'signup-email', confirm: true }))?.newlyConfirmed).toBe(true)
  })
})

describe('runNewsletterMaintenance (ADR-400 D5 + ADR-402 suppression)', () => {
  const now = new Date('2026-09-26T12:00:00Z')
  const stale = new Date('2026-09-10T12:00:00Z')
  const fresh = new Date('2026-09-25T12:00:00Z')

  interface MaintRow {
    email: string
    status: 'PENDING' | 'CONFIRMED' | 'UNSUBSCRIBED'
    confirmedAt: Date | null
    unsubscribedAt: Date | null
    updatedAt: Date
  }

  type Where = { status?: string; confirmedAt?: null; unsubscribedAt?: null | { not: null }; updatedAt: { lt: Date } }

  function matches(r: MaintRow, w: Where): boolean {
    if (w.status && r.status !== w.status) return false
    if ('confirmedAt' in w && r.confirmedAt !== null) return false
    if ('unsubscribedAt' in w) {
      if (w.unsubscribedAt === null && r.unsubscribedAt !== null) return false
      if (w.unsubscribedAt !== null && r.unsubscribedAt === null) return false
    }
    return r.updatedAt < w.updatedAt.lt
  }

  function maintPrisma(initial: MaintRow[]) {
    const rows = new Map(initial.map((r) => [r.email, { ...r }]))
    const prisma = {
      newsletterSubscriber: {
        updateMany: async ({ where, data }: { where: Where; data: Partial<MaintRow> }) => {
          let count = 0
          for (const r of rows.values()) if (matches(r, where)) { Object.assign(r, data); count++ }
          return { count }
        },
        deleteMany: async ({ where }: { where: Where }) => {
          let count = 0
          for (const [k, r] of rows) if (matches(r, where)) { rows.delete(k); count++ }
          return { count }
        },
      },
    }
    return { prisma: prisma as unknown as PrismaClient, rows }
  }

  it('purges stale unconfirmed signups but restores a stale re-subscribe of a suppressed address', async () => {
    const { prisma, rows } = maintPrisma([
      { email: 'stale@x.io', status: 'PENDING', confirmedAt: null, unsubscribedAt: null, updatedAt: stale },
      { email: 'fresh@x.io', status: 'PENDING', confirmedAt: null, unsubscribedAt: null, updatedAt: fresh },
      { email: 'resub@x.io', status: 'PENDING', confirmedAt: null, unsubscribedAt: stale, updatedAt: stale },
      { email: 'gone@x.io', status: 'UNSUBSCRIBED', confirmedAt: null, unsubscribedAt: stale, updatedAt: stale },
    ])
    const r = await runNewsletterMaintenance(prisma, { now })
    expect(r).toEqual({ pendingPurged: 1, suppressionRestored: 1 })
    expect(rows.has('stale@x.io')).toBe(false)
    expect(rows.get('fresh@x.io')!.status).toBe('PENDING')
    expect(rows.get('resub@x.io')!.status).toBe('UNSUBSCRIBED')
    expect(rows.get('gone@x.io')!.status).toBe('UNSUBSCRIBED')
  })
})
