import { generateSecretKey, verifyEvent, type NostrEvent } from 'nostr-tools'
import { bech32 } from 'bech32'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { isRoutableLnAddress } from './sellerPaymentResolver.js'
import { isProductionDirectPayOnly } from './betaMode.js'


export function generateRandomPubkey(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Decide which Lightning address an LNURL-auth login should persist.
 *
 * LUD-16 allows the wallet to append its own address to the auth callback
 * (`?lud16=`), so a Blink/Alby login can carry the user's real receiving rail.
 * Rules (ADR-240/381, same discipline as FU-754/760):
 *  · a routable address from the wallet always wins,
 *  · a routable stored address is never overwritten by a missing/unusable one,
 *  · a synthetic placeholder (`@colabonate.local`, `@demo.local`, …) is cleared
 *    instead of being kept as if it were a rail.
 */
export function pickLnurlAuthAddress(
  provided: string | null | undefined,
  existing: string | null | undefined,
): { lnAddress: string | null; changed: boolean } {
  if (isRoutableLnAddress(provided)) {
    const next = (provided as string).trim()
    return { lnAddress: next, changed: next !== (existing ?? null) }
  }
  if (isRoutableLnAddress(existing)) {
    return { lnAddress: existing as string, changed: false }
  }
  return { lnAddress: null, changed: Boolean(existing) }
}

/**
 * Validates a Nostr/Lightning public key: 64 lowercase/uppercase hex chars.
 * Used to accept only client-derived real pubkeys (ADR-158, non-custodial identity).
 */
export function isValidPubkeyHex(pk: unknown): pk is string {
  return typeof pk === 'string' && /^[0-9a-f]{64}$/i.test(pk)
}


export class LnurlAuthService {
  private prisma: PrismaClient
  private pendingChallenges: Map<string, {
    k1: string
    createdAt: number
    expiresAt: number
    callback?: string
  }> = new Map()

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient
  }

  generateLnurlChallenge(): { lnurl: string; k1: string } {
    const k1 = Buffer.from(generateSecretKey()).toString('hex')
    const baseUrl = process.env.BASE_URL || 'http://localhost:4001'
    const callbackUrl = `${baseUrl}/api/auth/lnurl/callback`
    // LUD-04: unlike pay/withdraw, lnurl-auth has no metadata-fetch step. The
    // decoded URL itself must carry tag=login&k1=&action= — the wallet parses
    // these query params directly, signs k1, then GETs this SAME URL again
    // with &sig=&key= appended. Pointing this at a JSON-metadata endpoint
    // (e.g. /details) instead breaks LUD-04-compliant wallets (Breez, Zeus):
    // they fall back to a generic fetch, get {"tag":"login",...} back, and
    // reject "login" as an unknown *response* tag (it's only valid as a
    // request query param).
    const lnurlEndpoint = `${callbackUrl}?tag=login&k1=${k1}&action=login`
    const lnurl = this.encodeLnurl(lnurlEndpoint)

    this.pendingChallenges.set(k1, {
      k1,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
      callback: callbackUrl,
    })

    setTimeout(() => {
      this.pendingChallenges.delete(k1)
    }, 5 * 60 * 1000)

    return { lnurl, k1 }
  }

  async verifyChallenge(k1: string, signature: string, key: string, eventJson?: string, lud16?: string): Promise<{ pubkey: string; lnAddress?: string; token?: string } | null> {
    const challenge = this.pendingChallenges.get(k1)

    if (!challenge) {
      throw new Error('Challenge not found or expired')
    }

    if (Date.now() > challenge.expiresAt) {
      this.pendingChallenges.delete(k1)
      throw new Error('Challenge expired')
    }

    let validSignature = false

    if (eventJson) {
      // Nostr-Event-Signatur (NIP-07 Flow via window.nostr)
      try {
        const event = JSON.parse(eventJson) as NostrEvent
        const challengeTag = event.tags?.find((t: string[]) => t[0] === 'challenge')?.[1]
        if (event.pubkey !== key) throw new Error('pubkey mismatch')
        if (challengeTag !== k1) throw new Error('challenge mismatch')
        validSignature = verifyEvent(event)
      } catch (e) {
        throw new Error('Invalid event: ' + (e instanceof Error ? e.message : String(e)))
      }
    } else {
      // Klassischer LNURL-Auth: Schnorr-Signatur direkt über k1-Bytes
      validSignature = await this.verifySchnorrSignature(k1, signature, key)
    }

    if (!validSignature) {
      throw new Error('Invalid signature')
    }

    let user = await this.prisma.user.findUnique({
      where: { pubkey: key },
    })

    // ADR-240/381: LUD-16 wallets (Blink, Alby, …) may append their own address
    // to the auth callback — that is the user's real receiving rail, so persist
    // it. Never keep a synthetic placeholder (`@colabonate.local`).
    const address = pickLnurlAuthAddress(lud16, user?.lnAddress)

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          pubkey: key,
          lnAddress: address.lnAddress,
        },
      })

      // ADR-253/381: a real production host is Direct-Pay only — no
      // platform-held custodial wallet to auto-create. Same gate as
      // auth-alby/auth-metamask (FU-753).
      if (!isProductionDirectPayOnly()) {
        try {
          const existing = await this.prisma.wallet.findUnique({ where: { userId_provider: { userId: user.id, provider: 'LNBITS' } } })
          if (!existing) {
            await this.prisma.wallet.create({
              data: {
                userId: user.id,
                provider: 'LNBITS',
                mode: 'CUSTODIAL',
                status: 'ACTIVE',
                balanceSats: 0,
              },
            })
            console.log(`[Wallet] Auto-created custodial wallet for user ${user.id}`)
          }
        } catch (walletError) {
          console.error(`[Wallet] Failed to auto-create wallet for user ${user.id}:`, walletError)
        }
      }
    } else if (address.changed) {
      // Later login carried a usable address (or the old placeholder has to go).
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { lnAddress: address.lnAddress },
      })
    }

    // ADR-284 D6: a blocked account can't mint a new session either.
    if (user.blockedAt) {
      throw new Error('Account blocked')
    }

    const token = randomBytes(32).toString('hex')

    await this.prisma.session.create({
      data: {
        pubkey: key,
        k1,
        token,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })

    this.pendingChallenges.delete(k1)

    return {
      pubkey: user.pubkey,
      lnAddress: user.lnAddress || undefined,
      token,
    }
  }

  async checkAuthStatus(k1: string): Promise<{ status: 'pending' | 'authenticated'; pubkey?: string; lnAddress?: string; token?: string }> {
    const session = await this.prisma.session.findUnique({
      where: { k1 },
      include: { user: true },
    })

    if (!session) {
      return { status: 'pending' }
    }

    if (session.expiresAt < new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } })
      return { status: 'pending' }
    }

    return {
      status: 'authenticated',
      pubkey: session.user.pubkey,
      lnAddress: session.user.lnAddress || undefined,
      token: session.token || undefined,
    }
  }

  private encodeLnurl(data: string): string {
    const bytes = Array.from(Buffer.from(data, 'utf8')) as number[]
    const words = bech32.toWords(bytes)
    return bech32.encode('lnurl', words, 2000)
  }

  async linkPubkeyToAccount(accountPubkey: string, lightningPubkey: string): Promise<{ success: boolean; linkedPubkey: string }> {
    await this.prisma.user.update({
      where: { pubkey: accountPubkey },
      data: { linkedPubkey: lightningPubkey },
    })
    return { success: true, linkedPubkey: lightningPubkey }
  }

  async getAccountByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } })
  }

  async createMagicLinkToken(email: string, clientPubkey?: string, newsletterOptIn: string | null = null): Promise<string> {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
    // ADR-158: non-custodial identity — bind the account to the real client-derived Nostr
    // pubkey when supplied, so a usable keypair (the user holds the nsec) backs the account
    // instead of a server-side random placeholder. Only applied on first creation; an existing
    // account keeps its pubkey (the FK target of Session) to avoid breaking the identity.
    const pubkey = isValidPubkeyHex(clientPubkey) ? clientPubkey : generateRandomPubkey()
    try {
      await this.prisma.user.upsert({
        where: { email },
        // ADR-402 D16.3: the opt-in travels with this token only; a newer
        // request (ticked or not) overwrites both together.
        update: { magicLinkToken: token, magicLinkExpires: expiresAt, emailVerified: false, magicLinkNewsletterOptIn: newsletterOptIn },
        create: { pubkey, email, magicLinkToken: token, magicLinkExpires: expiresAt, emailVerified: false, magicLinkNewsletterOptIn: newsletterOptIn },
      })
    } catch (e) {
      // The `create` branch only fires for a not-yet-known email, so a P2002 here means
      // the client-derived pubkey (persisted per-browser, sent on every /email/send call)
      // already belongs to a DIFFERENT account — e.g. the tester retried with a second
      // email from the same browser. Surface this distinctly so the route can return an
      // actionable message instead of a generic 500.
      if ((e as { code?: string })?.code === 'P2002') {
        throw new Error('PUBKEY_ALREADY_LINKED')
      }
      throw e
    }
    return token
  }

  async verifyMagicLinkToken(
    token: string,
  ): Promise<{ pubkey: string; email: string; emailVerified: boolean; newsletterOptIn: string | null } | null> {
    // F-D2-03: Read user data first, then CAS-consume the token atomically.
    // The CAS (updateMany with magicLinkToken in WHERE) ensures only one
    // concurrent request can consume — the loser gets count=0.
    const user = await this.prisma.user.findFirst({
      where: { magicLinkToken: token, magicLinkExpires: { gt: new Date() } },
    })
    if (!user || !user.email) return null

    const consumed = await this.prisma.user.updateMany({
      where: { id: user.id, magicLinkToken: token },
      data: { emailVerified: true, magicLinkToken: null, magicLinkExpires: null, magicLinkNewsletterOptIn: null },
    })
    if (consumed.count === 0) return null

    return { pubkey: user.pubkey, email: user.email, emailVerified: true, newsletterOptIn: user.magicLinkNewsletterOptIn }
  }

  async verifyLightningLinkChallenge(
    lightningPubkey: string,
    k1: string,
    signature: string,
    eventJson?: string
  ): Promise<boolean> {
    const challenge = this.pendingChallenges.get(k1)
    if (!challenge) {
      throw new Error('Challenge not found or expired')
    }
    if (Date.now() > challenge.expiresAt) {
      this.pendingChallenges.delete(k1)
      throw new Error('Challenge expired')
    }

    if (eventJson) {
      const event = JSON.parse(eventJson) as NostrEvent
      const challengeTag = event.tags?.find((t: string[]) => t[0] === 'challenge')?.[1]
      if (event.pubkey !== lightningPubkey) throw new Error('pubkey mismatch')
      if (challengeTag !== k1) throw new Error('challenge mismatch')
      // F-D2-02: Consume the challenge immediately — prevents k1 replay within
      // the 5-minute TTL window.
      this.pendingChallenges.delete(k1)
      return verifyEvent(event)
    }

    // F-D2-02: Same consumption for the Schnorr/ECDSA path.
    this.pendingChallenges.delete(k1)
    return this.verifySchnorrSignature(k1, signature, lightningPubkey)
  }

  generateLinkChallenge(): { k1: string } {
    const k1 = randomBytes(32).toString('hex')
    this.pendingChallenges.set(k1, {
      k1,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    })
    setTimeout(() => {
      this.pendingChallenges.delete(k1)
    }, 5 * 60 * 1000)
    return { k1 }
  }

  // LUD-04: real LNURL-auth wallets (Breez, Zeus, ...) sign k1 directly (no
  // extra hashing stage) with a classic secp256k1 ECDSA signature, DER-encoded,
  // over a compressed (33-byte) or uncompressed (65-byte) linking public key —
  // NOT a BIP-340 Schnorr signature over an x-only key. Schnorr is only used
  // by the separate NIP-07/Nostr browser-extension shortcut, which verifies
  // via `verifyEvent` in the `eventJson` branch of verifyChallenge().
  private async verifySchnorrSignature(message: string, signature: string, pubkey: string): Promise<boolean> {
    try {
      const msgBytes = Buffer.from(message, 'hex')
      const sigBytes = Buffer.from(signature, 'hex')
      const pubKeyBytes = Buffer.from(pubkey, 'hex')

      console.log('[verifyLnurlAuth] msgBytes.length:', msgBytes.length, '/ sigBytes.length:', sigBytes.length, '/ pubKeyBytes.length:', pubKeyBytes.length)

      if (msgBytes.length !== 32 || sigBytes.length === 0 || (pubKeyBytes.length !== 33 && pubKeyBytes.length !== 65)) {
        console.error('[verifyLnurlAuth] length check failed')
        return false
      }

      // lowS:false — noble's secp256k1 defaults to rejecting non-canonical
      // (high-S) signatures (a Bitcoin tx-relay convention), but LUD-04 has
      // no such requirement and real wallets don't normalize for it. This is
      // a one-time login challenge, not a transaction, so malleability (a
      // second valid signature over the same k1) grants no extra capability.
      const result = secp256k1.verify(sigBytes, msgBytes, pubKeyBytes, { format: 'der', lowS: false })
      console.log('[verifyLnurlAuth] result:', result)
      return result
    } catch (error) {
      console.error('[verifyLnurlAuth] exception:', error)
      return false
    }
  }
}
