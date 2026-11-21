import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { nip19 } from 'nostr-tools'
import { isValidPubkeyHex } from '../services/nostr-auth.js'
import { encryptAlbyToken, last4 } from '../services/albyTokenCrypto.js'
import { setActiveWalletId, getActiveWallet } from '../services/walletActive.js'
import { isProductionDirectPayOnly } from '../services/betaMode.js'
import { recordNewsletterConsent } from '../services/newsletter.js'
import { sendNewsletterConfirmation } from './newsletter.js'

const ALBY_AUTHORIZE_URL = 'https://getalby.com/oauth'
const ALBY_TOKEN_URL = 'https://api.getalby.com/oauth/token'
const ALBY_USER_URL = 'https://api.getalby.com/user/me'
const STATE_TTL_MS = 10 * 60 * 1000 // 10 min — enough for the Alby round-trip
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
// ADR-228 D1: full wallet scope requested at login, single-shot consent.
// FU-191-H: env override (ALBY_SCOPE) wins over the default — useful for
// login-only deployments that don't yet run the BetaOAuthProvider.
const ALBY_SCOPE = process.env.ALBY_SCOPE || 'account:read invoices:create invoices:read transactions:read balance:read payments:send'

// In-memory CSRF state store (keyed by the random `state` value).
// Sufficient for single-instance deployments; the OAuth round-trip is seconds.
// For multi-instance, replace with Redis (ADR follow-up).
// ADR-402 D16.1: the state also carries the login screen's newsletter choice
// across the OAuth round trip (never taken from the callback query).
interface PendingState {
  issuedAt: number
  newsletterOptIn: boolean
}
const pendingStates = new Map<string, PendingState>()

function consumeState(state: string): PendingState | null {
  const entry = pendingStates.get(state)
  if (entry === undefined) return null
  pendingStates.delete(state)
  return Date.now() - entry.issuedAt < STATE_TTL_MS ? entry : null
}

// Opportunistic cleanup: drop expired entries. Called on each initiate so the
// Map cannot grow unbounded when flows are started but never completed.
function sweepExpiredStates() {
  const now = Date.now()
  for (const [key, entry] of pendingStates) {
    if (now - entry.issuedAt >= STATE_TTL_MS) pendingStates.delete(key)
  }
}

interface AlbyTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

function albyPubkeyCandidates(user: Record<string, unknown>): unknown[] {
  const nostrKeys = (user.keys as Record<string, unknown> | undefined)?.nostr as Record<string, unknown> | undefined
  return [
    user.nostr_pubkey,
    user.nostrPubkey,
    user.nostr_public_key,
    user.pubkey,
    nostrKeys?.public_key,
    nostrKeys?.nostr_pubkey,
  ]
}

function toHexPubkey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate: string = value
  if (isValidPubkeyHex(candidate)) return candidate
  try {
    const decoded = nip19.decode(value)
    return decoded.type === 'npub' && typeof decoded.data === 'string' ? decoded.data : undefined
  } catch {
    return undefined
  }
}

function extractAlbyPubkey(user: Record<string, unknown>): string | undefined {
  for (const value of albyPubkeyCandidates(user)) {
    const hex = toHexPubkey(value)
    if (hex) return hex
  }
  return undefined
}

// ADR-225 D3: the `/callback` handler does a top-level browser navigation
// (see TabAlby.tsx), so a JSON error response dead-ends as a raw body in the
// browser — the SPA never sees it. Redirect to a contextual SPA error page
// instead, carrying an error `code` the SPA maps to copy via alby-error-codes.
function redirectToAlbyError(res: Response, code: 'STATE_INVALID' | 'TOKEN_EXCHANGE_FAILED' | 'NOSTR_NOT_LINKED' | 'SERVER_ERROR' | 'ACCESS_DENIED') {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const redirect = new URL('/login/alby/error', frontendUrl)
  redirect.searchParams.set('code', code)
  res.redirect(redirect.toString())
}

export function createAlbyAuthRouter(prisma: PrismaClient) {
  const router = Router()

  // GET /api/auth/alby — initiates the OAuth2 Authorization Code flow.
  // ADR-228 D1: requests the full wallet scope in one consent screen.
  // ADR-228 D6: ?prompt=consent re-runs the flow for a pre-cutover user who
  // only ever granted `account:read`, replacing their AlbyOauthToken row.
  router.get('/', (req: Request, res: Response) => {
    const clientId = process.env.ALBY_CLIENT_ID
    const redirectUri = process.env.ALBY_REDIRECT_URI
    if (!clientId || !redirectUri) {
      return redirectToAlbyError(res, 'SERVER_ERROR')
    }

    const state = randomBytes(16).toString('hex')
    sweepExpiredStates()
    pendingStates.set(state, { issuedAt: Date.now(), newsletterOptIn: req.query.newsletter === '1' })

    const authorizeUrl = new URL(ALBY_AUTHORIZE_URL)
    authorizeUrl.searchParams.set('client_id', clientId)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('redirect_uri', redirectUri)
    authorizeUrl.searchParams.set('scope', ALBY_SCOPE)
    authorizeUrl.searchParams.set('state', state)
    if (req.query.prompt === 'consent') {
      authorizeUrl.searchParams.set('prompt', 'consent')
    }

    res.redirect(authorizeUrl.toString())
  })

  // GET /api/auth/alby/callback — Alby redirects here with ?code=&state=
  router.get('/callback', async (req: Request, res: Response) => {
    try {
      const { code, state, error } = req.query as { code?: string; state?: string; error?: string }

      // ADR-228 D6: the user clicked "Cancel" on Alby's consent screen — fail
      // closed, no User row created, same shape as ADR-225 D3.
      if (error === 'access_denied') {
        return redirectToAlbyError(res, 'ACCESS_DENIED')
      }

      // CSRF: state must be present and match one we issued (single-use).
      if (!code || !state) {
        return redirectToAlbyError(res, 'STATE_INVALID')
      }
      const stateEntry = consumeState(state)
      if (!stateEntry) {
        return redirectToAlbyError(res, 'STATE_INVALID')
      }

      const clientId = process.env.ALBY_CLIENT_ID
      const clientSecret = process.env.ALBY_CLIENT_SECRET
      const redirectUri = process.env.ALBY_REDIRECT_URI
      if (!clientId || !clientSecret || !redirectUri) {
        return redirectToAlbyError(res, 'SERVER_ERROR')
      }

      // 1) Exchange the authorization code for an access token (server-to-server).
      const tokenRes = await fetch(ALBY_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      })

      const tokenJson = (await tokenRes.json()) as AlbyTokenResponse
      if (!tokenRes.ok || !tokenJson.access_token) {
        console.error('[Alby Auth] Token exchange failed:', tokenJson.error, tokenJson.error_description)
        return redirectToAlbyError(res, 'TOKEN_EXCHANGE_FAILED')
      }
      const accessToken = tokenJson.access_token

      // 2) Fetch the user profile — real Nostr pubkey + Lightning address.
      const userRes = await fetch(ALBY_USER_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const albyUser = (await userRes.json()) as Record<string, unknown>
      if (!userRes.ok) {
        console.error('[Alby Auth] /user/me failed:', userRes.status, 'body=', JSON.stringify(albyUser))
        return redirectToAlbyError(res, 'TOKEN_EXCHANGE_FAILED')
      }

      const nostrPubkey = extractAlbyPubkey(albyUser)
      if (!nostrPubkey) {
        // Ad-hoc debug: log the response keys so we can see the actual shape.
        // Logged at error level because the dev console swallows info-level
        // from the docker container in this Compose setup.
        console.error('[Alby Auth] /user/me response shape=', Object.keys(albyUser), 'identifier=', albyUser.identifier)
        return redirectToAlbyError(res, 'NOSTR_NOT_LINKED')
      }

      const lightningAddress = (albyUser.lightning_address as string | undefined) ?? (albyUser.identifier as string | undefined) ?? null
      const email = (albyUser.email as string | undefined) ?? null

      // 3) Upsert the User. The Alby npub is the user's real, stable Nostr identity.
      let user = await prisma.user.findUnique({ where: { pubkey: nostrPubkey } })
      if (!user && email) {
        user = await prisma.user.findUnique({ where: { email } })
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            pubkey: nostrPubkey,
            nostrPubkey,
            email,
            emailVerified: true,
            // ADR-252 D1: never synthesize a getalby.com address — a real,
            // resolvable domain the user does not necessarily control (fixed
            // per ADR-240's rejected-alternative A4 "black-hole address").
            // `lnAddress` is nullable (schema + ADR-240 D0); leave it unset
            // when Alby's /user/me returns neither lightning_address nor
            // identifier, same as the Nostr-only login path.
            lnAddress: lightningAddress,
          },
        })

        // ADR-253/381: a real production host is Direct-Pay only — there is no
        // platform-held custodial wallet to auto-create. The ALBY_OAUTH peer
        // row below is created regardless and is the actual rail (ADR-298).
        if (!isProductionDirectPayOnly()) {
          try {
            const existing = await prisma.wallet.findUnique({ where: { userId_provider: { userId: user.id, provider: 'LNBITS' } } })
            if (!existing) {
              await prisma.wallet.create({
                data: {
                  userId: user.id,
                  provider: 'LNBITS',
                  mode: 'CUSTODIAL',
                  status: 'ACTIVE',
                  balanceSats: 0,
                },
              })
              console.log(`[Alby Auth] Auto-created custodial wallet for user ${user.id}`)
            }
          } catch (walletError) {
            console.error(`[Alby Auth] Failed to auto-create wallet for user ${user.id}:`, walletError)
          }
        }
      } else {
        // Bind the Alby identity onto the existing account. Only backfill email
        // when the account has none AND no other account already claims it
        // (the `email` column is @unique — a collision would throw).
        let emailUpdate: string | undefined
        if (!user.email && email) {
          const claimer = await prisma.user.findFirst({
            where: { email },
            select: { id: true },
          })
          emailUpdate = claimer ? undefined : email
        }

        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            nostrPubkey,
            lnAddress: lightningAddress || user.lnAddress,
            email: user.email ?? emailUpdate,
            emailVerified: user.emailVerified || Boolean(email),
          },
        })
        console.log(`[Alby Auth] Logged in existing user ${user.id} via Alby`)
      }

      // ADR-402 D16.3: newsletter only when the login screen checkbox was
      // ticked. The address comes from Alby, not from us, so it goes through
      // the normal double opt-in (PENDING + confirmation mail). Non-fatal.
      if (stateEntry.newsletterOptIn && user.email) {
        try {
          const subscriber = await recordNewsletterConsent(prisma, user.email, user.pubkey, {
            source: 'signup-alby',
            confirm: false,
          })
          if (subscriber && subscriber.status !== 'CONFIRMED') {
            await sendNewsletterConfirmation(user.email, subscriber.token)
          }
        } catch (err) {
          console.warn('[Alby Auth] Newsletter opt-in failed (non-fatal):', err instanceof Error ? err.message : err)
        }
      }

      // 3.5) ADR-228 D2/D5: persist the OAuth token (encrypted) and create the
      // ALBY_OAUTH wallet as a peer row — never auto-activated, so an
      // existing user's active wallet (NWC/CUSTODIAL) is left untouched.
      // No log line here may echo the access/refresh token (AGENTS.md FU-195-C).
      const grantedScopes = (tokenJson.scope ?? ALBY_SCOPE).split(' ').filter(Boolean)
      const expiresAt = tokenJson.expires_in ? new Date(Date.now() + tokenJson.expires_in * 1000) : null
      await prisma.albyOauthToken.upsert({
        where: { userId: user.id },
        update: {
          encryptedAccess: encryptAlbyToken(accessToken),
          accessTokenLast4: last4(accessToken),
          ...(tokenJson.refresh_token
            ? { encryptedRefresh: encryptAlbyToken(tokenJson.refresh_token), refreshTokenLast4: last4(tokenJson.refresh_token) }
            : {}),
          expiresAt,
          grantedScopes,
          clientId,
          revokedAt: null,
          revokedReason: null,
        },
        create: {
          userId: user.id,
          encryptedAccess: encryptAlbyToken(accessToken),
          accessTokenLast4: last4(accessToken),
          ...(tokenJson.refresh_token
            ? { encryptedRefresh: encryptAlbyToken(tokenJson.refresh_token), refreshTokenLast4: last4(tokenJson.refresh_token) }
            : {}),
          expiresAt,
          grantedScopes,
          clientId,
        },
      })
      const albyWallet = await prisma.wallet.upsert({
        where: { userId_provider: { userId: user.id, provider: 'ALBY_OAUTH' } },
        update: { status: 'ACTIVE' },
        create: {
          userId: user.id,
          provider: 'ALBY_OAUTH',
          mode: 'NON_CUSTODIAL',
          status: 'ACTIVE',
          balanceSats: 0,
          isActive: false,
        },
      })

      // ADR-228 D2/D5 refinement (2026-09-23): the user just authenticated with
      // Alby, so their Alby wallet is the natural spending rail. Activate it
      // unless the current active wallet is one they clearly want to keep — NWC
      // (a user-managed NIP-47 spend wallet) or any CUSTODIAL-mode wallet (the
      // beta/dev demo rail). This fixes the production case where a fresh Alby
      // login left the ALBY_OAUTH row inactive while a stale, empty WebLN row
      // (or the hidden LNBITS row) stayed active: the wallet page reported
      // "connect a wallet" and payments could not be sent over the Alby rail,
      // even though `hasSellerPaymentMethodConfigured` already counted the Alby
      // wallet and reported the account as publish-ready.
      const active = await getActiveWallet(prisma, user.id)
      const keepActive = active && (active.provider === 'NWC' || active.mode === 'CUSTODIAL')
      if (!keepActive) {
        await setActiveWalletId(prisma, user.id, albyWallet.id)
      }
      console.log(`[Alby Auth] Persisted OAuth token for user ${user.id} (clientId=${clientId}, last4=${last4(accessToken)}, scopes=${grantedScopes.join(',')})`)

      // ADR-284 D6: a blocked account can't mint a new session either.
      if (user.blockedAt) {
        return res.status(403).json({ error: 'ACCOUNT_BLOCKED', message: user.blockedReason ?? 'This account has been blocked.' })
      }

      // 4) Mint a Session (same shape as the other login methods).
      const sessionToken = randomBytes(32).toString('hex')
      await prisma.session.create({
        data: {
          pubkey: user.pubkey,
          k1: `alby-${Date.now()}-${randomBytes(8).toString('hex')}`,
          token: sessionToken,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      })

      // 5) Hand control back to the browser via the frontend token-login route.
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
      const redirect = new URL('/login/demo', frontendUrl)
      redirect.searchParams.set('token', sessionToken)
      res.redirect(redirect.toString())
    } catch (error) {
      console.error('[Alby Auth] Callback error:', error)
      redirectToAlbyError(res, 'SERVER_ERROR')
    }
  })

  return router
}
