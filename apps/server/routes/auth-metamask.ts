import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import {
  issueMetamaskChallenge,
  verifyMetamaskLogin,
} from '../services/metamask-auth.js'
import { isProductionDirectPayOnly } from '../services/betaMode.js'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function createMetamaskAuthRouter(prisma: PrismaClient) {
  const router = Router()

  // GET /api/auth/metamask/challenge?address=0x...
  router.get('/challenge', async (req: Request, res: Response) => {
    try {
      const address = req.query.address as string | undefined
      if (!address) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'address query parameter is required' })
      }

      const challenge = issueMetamaskChallenge(address)
      res.json(challenge)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown'
      if (msg === 'INVALID_ADDRESS') {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid Ethereum address' })
      }
      console.error('[MetamaskAuth] Failed to issue challenge:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to issue challenge' })
    }
  })

  // POST /api/auth/metamask/verify
  router.post('/verify', async (req: Request, res: Response) => {
    try {
      const { address, pubkey, derivationMessage, derivationSignature, authMessage, authSignature } = req.body as {
        address?: string
        pubkey?: string
        derivationMessage?: string
        derivationSignature?: string
        authMessage?: string
        authSignature?: string
      }

      if (!address || !pubkey || !derivationMessage || !derivationSignature || !authMessage || !authSignature) {
        return res.status(400).json({
          error: 'BAD_REQUEST',
          message: 'address, pubkey, derivationMessage, derivationSignature, authMessage, and authSignature are required',
        })
      }

      const result = await verifyMetamaskLogin({
        address,
        pubkey,
        derivationMessage,
        derivationSignature,
        authMessage,
        authSignature,
      })

      // Upsert user. If a user already exists with this pubkey but no evmAddress,
      // bind the address. If a user exists with this evmAddress but a different
      // pubkey, prefer the derived pubkey (this should not happen for a fresh
      // deterministic derivation).
      let user = await prisma.user.findUnique({ where: { pubkey: result.pubkey } })
      if (!user) {
        user = await prisma.user.findUnique({ where: { evmAddress: result.evmAddress } })
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            pubkey: result.pubkey,
            nostrPubkey: result.pubkey,
            evmAddress: result.evmAddress,
            // ADR-240 A4/FU-754: never synthesize a `<x>@metamask.local`
            // placeholder — it is not a resolvable LUD-16 address, and it made
            // MetaMask sellers pass the publish gate with an unpayable listing.
            // `lnAddress` is nullable; the user sets a real one later.
            lnAddress: null,
          },
        })

        // ADR-253/381: no platform-held custodial wallet on a Direct-Pay-only
        // host — a MetaMask signup must connect a real Lightning rail itself.
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
              console.log(`[Metamask Auth] Auto-created custodial wallet for user ${user.id}`)
            }
          } catch (walletError) {
            console.error(`[Metamask Auth] Failed to auto-create wallet for user ${user.id}:`, walletError)
          }
        }
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            pubkey: result.pubkey,
            nostrPubkey: result.pubkey,
            evmAddress: result.evmAddress,
          },
        })
        console.log(`[Metamask Auth] Logged in existing user ${user.id} via MetaMask`)
      }

      // ADR-284 D6: a blocked account can't mint a new session either.
      if (user.blockedAt) {
        return res.status(403).json({ error: 'ACCOUNT_BLOCKED', message: user.blockedReason ?? 'This account has been blocked.' })
      }

      // Mint a Session.
      const sessionToken = randomBytes(32).toString('hex')
      await prisma.session.create({
        data: {
          pubkey: user.pubkey,
          k1: `metamask-${Date.now()}-${randomBytes(8).toString('hex')}`,
          token: sessionToken,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      })

      // Hand control back to the browser via the frontend token-login route.
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
      const redirect = new URL('/login/demo', frontendUrl)
      redirect.searchParams.set('token', sessionToken)
      res.redirect(redirect.toString())
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown'
      if (
        msg === 'INVALID_ADDRESS' ||
        msg === 'INVALID_PUBKEY' ||
        msg === 'DERIVATION_SIGNATURE_MISMATCH' ||
        msg === 'PUBKEY_DERIVATION_MISMATCH' ||
        msg === 'AUTH_SIGNATURE_MISMATCH' ||
        msg === 'AUTH_MESSAGE_MISSING_NONCE' ||
        msg === 'CHALLENGE_INVALID_OR_EXPIRED'
      ) {
        return res.status(403).json({ error: 'AUTH_FAILED', message: msg })
      }
      console.error('[Metamask Auth] Verify error:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'MetaMask authentication failed' })
    }
  })

  return router
}
