// ADR-400: Newsletter double opt-in — shared domain helpers.
//
// Kept separate from routes/newsletter.ts so the audience-building and email
// normalisation rules can be unit-tested without a database or HTTP layer.

import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'

export type NewsletterStatusValue = 'PENDING' | 'CONFIRMED' | 'UNSUBSCRIBED'

/**
 * Audience status. `NO_CONSENT` = a registered account email that never opted
 * in (ADR-402 D16): visible to the admin, never a campaign recipient.
 */
export type NewsletterAudienceStatus = NewsletterStatusValue | 'NO_CONSENT'

/**
 * ADR-402 D16.4: version id of the opt-in wording shown at signup / in
 * Settings. Bump it whenever that wording changes, so each recorded consent
 * points at the text the person actually saw.
 */
export const NEWSLETTER_CONSENT_TEXT_VERSION = 'adr402-2026-09-26'

export type NewsletterConsentSource =
  | 'footer'
  | 'signup-email'
  | 'signup-onboarding'
  | 'signup-alby'
  | 'settings'

// An unconfirmed signup is purged after this many days. Kept short so the
// table does not accumulate typo'd / abandoned addresses.
export const NEWSLETTER_PENDING_TTL_DAYS = 7

export const NEWSLETTER_EMAIL_MAX_LENGTH = 254

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Trim, lowercase and validate a submitted email. Returns null when invalid. */
export function normalizeNewsletterEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed || trimmed.length > NEWSLETTER_EMAIL_MAX_LENGTH) return null
  if (!EMAIL_RE.test(trimmed)) return null
  return trimmed
}

export interface NewsletterSubscriberRow {
  email: string
  source: string
  status: NewsletterStatusValue
  pubkey: string | null
  confirmedAt: Date | null
  unsubscribedAt: Date | null
  /** ADR-402 D16.4 — null/absent means no recorded consent. */
  consentAt?: Date | null
  createdAt: Date
}

export interface NewsletterAccountRow {
  pubkey: string
  email: string | null
  emailVerified: boolean
  createdAt: Date
}

export type NewsletterOrigin = 'subscriber' | 'account'

export interface NewsletterAudienceRow {
  email: string
  origin: NewsletterOrigin
  status: NewsletterAudienceStatus
  /** True when a recorded opt-in exists (ADR-402 D16). Campaigns need it. */
  consent: boolean
  /** True only when the address itself was proven (double opt-in or account verification). */
  emailVerified: boolean
  pubkey: string | null
  source: string
  confirmedAt: Date | null
  unsubscribedAt: Date | null
  createdAt: Date
}

/**
 * Build the single newsletter audience from both sources:
 *   - explicit footer signups (`NewsletterSubscriber`), and
 *   - registered accounts that carry an email (`User.email`).
 *
 * Deduped by lowercase email. An explicit subscriber row always wins over the
 * account row for the same address, so an unsubscribe can never be silently
 * undone by re-importing the account list.
 */
export function buildNewsletterAudience(
  subscribers: NewsletterSubscriberRow[],
  users: NewsletterAccountRow[],
): NewsletterAudienceRow[] {
  const rows: NewsletterAudienceRow[] = []
  const seen = new Set<string>()

  for (const s of subscribers) {
    const email = s.email.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    rows.push({
      email,
      origin: 'subscriber',
      status: s.status,
      consent: !!s.consentAt,
      emailVerified: s.status === 'CONFIRMED',
      pubkey: s.pubkey,
      source: s.source,
      confirmedAt: s.confirmedAt,
      unsubscribedAt: s.unsubscribedAt,
      createdAt: s.createdAt,
    })
  }

  for (const u of users) {
    if (!u.email) continue
    const email = u.email.trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    rows.push({
      email,
      origin: 'account',
      // ADR-402 D16: an account email alone is not a newsletter signup.
      status: 'NO_CONSENT',
      consent: false,
      emailVerified: u.emailVerified,
      pubkey: u.pubkey,
      source: 'account',
      confirmedAt: u.emailVerified ? u.createdAt : null,
      unsubscribedAt: null,
      createdAt: u.createdAt,
    })
  }

  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

/** CSPRNG token for the confirm/unsubscribe capability link (URL-safe). */
export function generateNewsletterToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * ADR-402 D16: record an explicit newsletter opt-in for an address.
 *
 * Called only when the person actively chose the newsletter (signup checkbox,
 * footer form, Settings switch).
 *
 * `confirm: true` only where the address is already proven (the magic-link
 * token that carried the opt-in, or a verified account email); otherwise the
 * row stays PENDING until the double-opt-in link is clicked. An already
 * consented, CONFIRMED row is a no-op. A row bound to another identity keeps
 * its pubkey.
 *
 * Suppression: an unproven opt-in never clears an earlier unsubscribe. The
 * row goes PENDING but keeps `unsubscribedAt`; only a proven confirmation
 * clears it, and maintenance restores UNSUBSCRIBED if nobody confirms.
 */
export async function recordNewsletterConsent(
  prisma: PrismaClient,
  emailRaw: unknown,
  pubkey: string | null,
  opts: { source: NewsletterConsentSource; confirm: boolean },
): Promise<{ token: string; status: NewsletterStatusValue; newlyConfirmed: boolean } | null> {
  const email = normalizeNewsletterEmail(emailRaw)
  if (!email) return null

  const now = new Date()
  const consent = {
    consentAt: now,
    consentSource: opts.source,
    consentTextVersion: NEWSLETTER_CONSENT_TEXT_VERSION,
  }
  const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } })

  if (existing) {
    if (existing.status === 'CONFIRMED' && existing.consentAt) {
      if (pubkey && !existing.pubkey) {
        await prisma.newsletterSubscriber.update({ where: { email }, data: { pubkey } })
      }
      return { token: existing.token, status: 'CONFIRMED', newlyConfirmed: false }
    }
    const confirmed = opts.confirm || existing.status === 'CONFIRMED'
    const updated = await prisma.newsletterSubscriber.update({
      where: { email },
      data: {
        ...consent,
        pubkey: existing.pubkey ?? pubkey,
        status: confirmed ? 'CONFIRMED' : 'PENDING',
        confirmedAt: confirmed ? existing.confirmedAt ?? now : null,
        unsubscribedAt: confirmed ? null : existing.unsubscribedAt,
      },
    })
    // ADR-401 FU-892: a consented CONFIRMED row is new here (the no-op case returned above).
    return { token: updated.token, status: updated.status, newlyConfirmed: confirmed }
  }

  const created = await prisma.newsletterSubscriber.create({
    data: {
      ...consent,
      email,
      pubkey,
      source: opts.source,
      token: generateNewsletterToken(),
      status: opts.confirm ? 'CONFIRMED' : 'PENDING',
      confirmedAt: opts.confirm ? now : null,
    },
  })
  return { token: created.token, status: created.status, newlyConfirmed: opts.confirm }
}

export interface NewsletterMaintenanceResult {
  pendingPurged: number
  /** Stale re-subscribe attempts on a suppressed address, restored to UNSUBSCRIBED. */
  suppressionRestored: number
}

/**
 * Daily maintenance: purge signups that never confirmed within the TTL.
 *
 * Anchored on `updatedAt`, not `createdAt`: a re-subscribe flips an old row
 * back to PENDING without touching `createdAt`, so keying on the creation date
 * would delete a freshly re-subscribed (and freshly emailed) row.
 *
 * CONFIRMED and UNSUBSCRIBED rows are intentionally never deleted —
 * UNSUBSCRIBED is the suppression list that prevents a re-import from
 * re-adding someone who opted out. A stale PENDING row that still carries
 * `unsubscribedAt` (an unconfirmed re-subscribe, ADR-402) is restored to
 * UNSUBSCRIBED instead of deleted, so the suppression entry survives.
 */
export async function runNewsletterMaintenance(
  prisma: PrismaClient,
  opts: { pendingTtlDays?: number; now?: Date } = {},
): Promise<NewsletterMaintenanceResult> {
  const ttlDays = opts.pendingTtlDays ?? NEWSLETTER_PENDING_TTL_DAYS
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000)

  const restored = await prisma.newsletterSubscriber.updateMany({
    where: { status: 'PENDING', unsubscribedAt: { not: null }, updatedAt: { lt: cutoff } },
    data: { status: 'UNSUBSCRIBED' },
  })
  const { count } = await prisma.newsletterSubscriber.deleteMany({
    where: { status: 'PENDING', confirmedAt: null, unsubscribedAt: null, updatedAt: { lt: cutoff } },
  })

  return { pendingPurged: count, suppressionRestored: restored.count }
}
