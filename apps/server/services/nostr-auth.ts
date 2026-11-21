import { verifyEvent, type NostrEvent } from 'nostr-tools'
import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days, same as demo login

export function isValidPubkeyHex(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s)
}

export interface ChallengeResult {
  nonce: string
  expiresAt: Date
}

export async function issueChallenge(
  prisma: PrismaClient,
  expectedPubkey?: string,
): Promise<ChallengeResult> {
  if (expectedPubkey !== undefined && !isValidPubkeyHex(expectedPubkey)) {
    throw new Error('INVALID_PUBKEY')
  }

  const nonce = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)

  await prisma.nostrAuthChallenge.create({
    data: {
      nonce,
      issuedFor: expectedPubkey ?? null,
      createdAt: new Date(),
    },
  })

  return { nonce, expiresAt }
}

export interface VerificationResult {
  pubkey: string
  token: string
  expiresAt: Date
  consumedAt: Date
}

/**
 * ADR-158 Part A: verify a NIP-42-style kind-27235 challenge event,
 * upsert the User, and mint a Bearer Session token so the frontend
 * can authenticate follow-up API calls.
 *
 * Pubkey ownership proof: `verifyEvent(signedEvent)` from nostr-tools
 * checks the Schnorr signature against the event id. Since the
 * challenge tag binds the nonce to this auth attempt, an attacker
 * cannot replay another user's signed event — they would need to
 * forge the signature against a new nonce.
 *
 * Upsert: the user is auto-created on first login so Nostr-only
 * accounts (no Lightning, no Email, no Google) work out of the box.
 */
export async function verifyChallenge(
  prisma: PrismaClient,
  signedEvent: NostrEvent,
): Promise<VerificationResult | null> {
  if (signedEvent.kind !== 27235) {
    return null
  }

  if (!isValidPubkeyHex(signedEvent.pubkey)) {
    return null
  }

  const challengeTag = signedEvent.tags.find(t => t[0] === 'challenge')
  if (!challengeTag || !challengeTag[1]) {
    return null
  }
  const nonce = challengeTag[1]

  // Defense-in-depth: bind the consumed challenge to the pubkey that
  // signed the event. Even though verifyEvent() already authenticates
  // the pubkey, this prevents a future regression where a malicious
  // party captures a signed event from pubkey A and submits it after
  // issuing a challenge under their own session.
  const challenge = await prisma.nostrAuthChallenge.findUnique({
    where: { nonce },
  })

  if (!challenge) {
    return null
  }

  if (challenge.consumedAt) {
    return null
  }

  if (Date.now() > challenge.createdAt.getTime() + CHALLENGE_TTL_MS) {
    return null
  }

  if (challenge.issuedFor && challenge.issuedFor !== signedEvent.pubkey) {
    return null
  }

  const valid = verifyEvent(signedEvent)
  if (!valid) {
    return null
  }

  // F-D2-01: Atomic CAS consumption — prevents replay within the race window.
  // updateMany with consumedAt: null in the WHERE clause ensures only one
  // concurrent request can consume the challenge; the other gets count=0.
  const consumedAt = new Date()
  const consumed = await prisma.nostrAuthChallenge.updateMany({
    where: { nonce, consumedAt: null },
    data: { consumedAt },
  })
  if (consumed.count === 0) {
    return null
  }

  // ADR-401 D7.4: sovereign-key account recovery. The onboarding flow keys the
  // account by a persisted device signer and binds the sovereign key as
  // `nostrPubkey`, so a signer holding that key should return to the SAME
  // account on any device.
  //
  // Only when NO account is keyed by the signing pubkey itself: an exact
  // `pubkey` match always wins (User.nostrPubkey is not unique, so a key bound
  // elsewhere must never redirect the account it already owns, e.g. the admin
  // login). Fail-closed: only an unambiguous `nostrPubkey` match resolves;
  // anything else falls through to the normal upsert below.
  const ownAccount = await prisma.user.findUnique({
    where: { pubkey: signedEvent.pubkey },
    select: { pubkey: true },
  })
  const accountsByNostr = ownAccount
    ? []
    : await prisma.user.findMany({
        where: { nostrPubkey: signedEvent.pubkey },
        select: { pubkey: true, blockedAt: true },
        take: 2,
      })
  if (accountsByNostr.length === 1) {
    const account = accountsByNostr[0]
    // ADR-284 D6: a blocked account can't mint a new session either.
    if (account.blockedAt) return null
    const recoveryToken = randomBytes(32).toString('hex')
    const recoveryExpiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await prisma.session.create({
      data: {
        pubkey: account.pubkey,
        k1: `nostr-${nonce}`,
        token: recoveryToken,
        expiresAt: recoveryExpiresAt,
      },
    })
    return {
      pubkey: account.pubkey,
      token: recoveryToken,
      expiresAt: recoveryExpiresAt,
      consumedAt,
    }
  }

  // Upsert the User so a Nostr-only account exists. We do NOT mint a
  // random lnAddress here — Nostr-only users have no Lightning address
  // until they link one via /api/auth/email/link-lightning or the
  // LNURL-Auth flow.
  //
  // The verified signature proves control of signedEvent.pubkey, so bind it
  // as `nostrPubkey` (fill-once) — for NIP-07 logins the login pubkey IS the
  // Nostr key. This lets /api/identity/sync-nostr-profile work from the DB
  // binding alone, no client body param needed.
  const user = await prisma.user.upsert({
    where: { pubkey: signedEvent.pubkey },
    update: {},
    create: {
      pubkey: signedEvent.pubkey,
      nostrPubkey: signedEvent.pubkey,
      identityLevel: 0,
    },
  })
  // ADR-284 D6: a blocked account can't mint a new session either. Same
  // null-return contract as every other failure branch above — callers
  // already treat null as "auth failed", so a blocked account surfaces as a
  // generic challenge-verification failure, not a distinct blocked message.
  if (user.blockedAt) {
    return null
  }
  // Fill-once on the existing row (upsert cannot express "set only if null"):
  await prisma.user.updateMany({
    where: { pubkey: signedEvent.pubkey, nostrPubkey: null },
    data: { nostrPubkey: signedEvent.pubkey },
  })

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  // Session.k1 is @unique — synthesize one from the nonce. The k1 is
  // vestigial for Nostr login (no LNURL callback), but the column is
  // NOT NULL, so we need a value.
  await prisma.session.create({
    data: {
      pubkey: signedEvent.pubkey,
      k1: `nostr-${nonce}`,
      token,
      expiresAt,
    },
  })

  return {
    pubkey: signedEvent.pubkey,
    token,
    expiresAt,
    consumedAt,
  }
}