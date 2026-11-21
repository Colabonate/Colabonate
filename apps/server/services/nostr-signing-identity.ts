/**
 * Persistent Nostr signing identity for marketplace-facing commerce listings
 * (ADR-412 D2, resolves FU-277-C for the Offer/Company/ProductCollection/
 * ShippingOption surface).
 *
 * Every `publish*` call in nostr-relay.ts used to sign with a fresh
 * `generateSecretKey()`, discarded immediately, a different, anonymous
 * author on every publish. NIP-99 defines the event's pubkey as the seller;
 * external clients (Conduit, Shopstr, Plebeian Market) index authorship and
 * reputation by that pubkey. This module gives each selling entity (a
 * Company, or a User selling without a company) ONE persistent sub-key,
 * generated once and reused for every subsequent publish.
 *
 * This is explicitly NOT the user's login/account identity (User.nostrPubkey,
 * NIP-07-sourced, governed by ADR-141's "server never holds the privkey"
 * rule for identity/auth events). It is a purpose-built delegate key the
 * platform mints and custodies on the seller's behalf solely for public
 * commerce listings, same category as AgentProfile.nostrPubkey (ADR-316).
 */
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import type { PrismaClient } from '@prisma/client'
import { encrypt, decrypt, hasSecretKey } from '../lib/secretbox.js'

export type SigningIdentity = { sk: Uint8Array; pubkey: string; isNew: boolean }

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

/** Get-or-create the persistent listing signing key for a Company. Idempotent. */
export async function getOrCreateCompanySigningKey(prisma: PrismaClient, companyId: string): Promise<SigningIdentity> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { nostrListingPubkey: true, nostrListingPrivkeyEnc: true },
  })
  if (company?.nostrListingPubkey && company.nostrListingPrivkeyEnc) {
    return { sk: hexToBytes(decrypt(company.nostrListingPrivkeyEnc)), pubkey: company.nostrListingPubkey, isNew: false }
  }
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  await prisma.company.update({
    where: { id: companyId },
    data: { nostrListingPubkey: pubkey, nostrListingPrivkeyEnc: encrypt(bytesToHex(sk)) },
  })
  return { sk, pubkey, isNew: true }
}

/** Get-or-create the persistent listing signing key for an individual (non-company) seller. Idempotent. */
export async function getOrCreateUserListingSigningKey(prisma: PrismaClient, userPubkey: string): Promise<SigningIdentity> {
  const user = await prisma.user.findUnique({
    where: { pubkey: userPubkey },
    select: { nostrListingPubkey: true, nostrListingPrivkeyEnc: true },
  })
  if (user?.nostrListingPubkey && user.nostrListingPrivkeyEnc) {
    return { sk: hexToBytes(decrypt(user.nostrListingPrivkeyEnc)), pubkey: user.nostrListingPubkey, isNew: false }
  }
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  await prisma.user.update({
    where: { pubkey: userPubkey },
    data: { nostrListingPubkey: pubkey, nostrListingPrivkeyEnc: encrypt(bytesToHex(sk)) },
  })
  return { sk, pubkey, isNew: true }
}

/** Resolves the signing identity for an offer: the owning Company's key if present, else the creator's own listing key. */
export async function resolveOfferSigningKey(prisma: PrismaClient, offer: { companyId?: string | null; creatorPubkey: string }): Promise<SigningIdentity> {
  if (offer.companyId) return getOrCreateCompanySigningKey(prisma, offer.companyId)
  return getOrCreateUserListingSigningKey(prisma, offer.creatorPubkey)
}

/**
 * Get-or-create the single stable platform-level signing key (FoundationSettings
 * singleton row, id=1), used for bidirectional transaction mirror events
 * (Ticket/Cooperation/Milestone/Dispute) where neither buyer nor seller is the
 * sole "author". Fixes a correctness bug, not just a discoverability one: these
 * events are addressable (kind 30407-30409/30414, NIP-01 replaceable-event
 * range), so a fresh pubkey on every publish meant no two events in the same
 * ticket's lifecycle ever shared a (kind, pubkey, d) coordinate, i.e. they
 * never replaced each other and were unresolvable by standard NIP-01 tooling.
 */
export async function getOrCreatePlatformSigningKey(prisma: PrismaClient): Promise<SigningIdentity> {
  const existing = await prisma.foundationSettings.findUnique({
    where: { id: 1 },
    select: { platformNostrPubkey: true, platformNostrPrivkeyEnc: true },
  })
  if (existing?.platformNostrPubkey && existing.platformNostrPrivkeyEnc) {
    return { sk: hexToBytes(decrypt(existing.platformNostrPrivkeyEnc)), pubkey: existing.platformNostrPubkey, isNew: false }
  }
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const data = { platformNostrPubkey: pubkey, platformNostrPrivkeyEnc: encrypt(bytesToHex(sk)) }
  await prisma.foundationSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data })
  return { sk, pubkey, isNew: true }
}

/** True when at-rest encryption is configured (NWC_SECRET_KEY). Callers should skip persistent-key resolution and fall back gracefully otherwise. */
export function hasSigningIdentityKey(): boolean {
  return hasSecretKey()
}
