// ADR-240 D1 — public LNURL-pay endpoint for self-serve Lightning Addresses.
//
//   GET /.well-known/lnurlp/:handle            → LUD-06 payRequest document
//   GET /.well-known/lnurlp/:handle/callback   → { pr: <bolt11> }
//
// The invoice is minted on the OWNER'S OWN rail by services/lnAddressResolver
// (external LUD-16 or their NWC wallet). This router holds no keys and no
// funds; it is mounted at the site root (not under /api) because LUD-16 fixes
// the `/.well-known/lnurlp/` path.
//
// ADR-387 D3 — this router ALSO serves Colabonate's own platform address
// (`pay@<LNURLP_DOMAIN>` by default). That is not a user row: the invoice is
// minted on the platform treasury by services/platformPaymentResolver (NWC to
// Colabonate's own Alby Hub, or the external LUD-16 fallback). The handle is
// reserved, so it can never collide with a user (lib/lnAddressHandle.ts).
import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import {
  buildPayRequest,
  normalizeHandle,
  parseCallbackAmount,
  readLnurlpBaseUrl,
  readLnurlpDomain,
  type LnurlpLimits,
} from '../lib/lnAddressHandle.js'
import { LnurlpError, resolveUserLnAddressInvoice } from '../services/lnAddressResolver.js'
import {
  isPlatformRailConfigured,
  platformLnHandle,
  resolvePlatformInvoice,
} from '../services/platformPaymentResolver.js'

const MIN_SENDABLE_MSAT = 1_000

function readLimits(): LnurlpLimits {
  const maxSats = Number(process.env.LNURLP_MAX_SATS ?? '1000000')
  const safeMax = Number.isFinite(maxSats) && maxSats >= 1 ? Math.floor(maxSats) : 1_000_000
  return { minSendable: MIN_SENDABLE_MSAT, maxSendable: safeMax * 1000 }
}

function isPlatformHandle(handle: string): boolean {
  return handle === platformLnHandle() && isPlatformRailConfigured()
}

export function createLnurlpRouter(prisma: PrismaClient) {
  const router = Router()

  // LUD-06 clients fetch this document cross-origin (browser-based wallets and
  // web pages). Helmet's default `Cross-Origin-Resource-Policy: same-origin`
  // would block that read even with the wildcard CORS origin (index.ts); the
  // resource is public by design, so it is explicitly cross-origin readable.
  router.use((_req, res, next) => {
    res.set('Cross-Origin-Resource-Policy', 'cross-origin')
    next()
  })

  async function findHandle(handle: string) {
    if (!handle) return null
    return prisma.user.findUnique({
      where: { lnAddressHandle: handle },
      select: { id: true, lnAddressMode: true },
    })
  }

  router.get('/:handle', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')
    try {
      const handle = normalizeHandle(req.params.handle as string)

      // ADR-387 D3 — the platform address is served before any user lookup.
      // When no platform rail is configured this falls through, so the reserved
      // handle answers the ordinary LUD-06 404.
      if (isPlatformHandle(handle)) {
        return res.json(buildPayRequest(handle, readLnurlpDomain(), readLnurlpBaseUrl(), readLimits()))
      }

      const user = await findHandle(handle)
      if (!user?.lnAddressMode) {
        return res.status(404).json({ status: 'ERROR', reason: 'Lightning address not found' })
      }
      return res.json(buildPayRequest(handle, readLnurlpDomain(), readLnurlpBaseUrl(), readLimits()))
    } catch (err) {
      // A lookup failure must still answer in the LUD-06 shape — never leak an
      // HTML/Express error page to a wallet client (ADR-240 D1).
      console.error('[lnurlp] metadata lookup failed:', err instanceof Error ? err.message : err)
      return res.status(502).json({ status: 'ERROR', reason: 'Lightning address lookup failed' })
    }
  })

  router.get('/:handle/callback', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store')

    let handle: string
    try {
      handle = normalizeHandle(req.params.handle as string)
    } catch (err) {
      console.error('[lnurlp] callback lookup failed:', err instanceof Error ? err.message : err)
      return res.status(502).json({ status: 'ERROR', reason: 'Lightning address lookup failed' })
    }

    // ADR-387 D3 — platform address: minted on Colabonate's own treasury rail.
    if (isPlatformHandle(handle)) {
      const limits = readLimits()
      const amount = parseCallbackAmount(req.query.amount, limits)
      if (!amount.ok) {
        return res.status(400).json({ status: 'ERROR', reason: amount.reason })
      }
      try {
        const resolution = await resolvePlatformInvoice(
          amount.sats,
          `Payment to ${handle}@${readLnurlpDomain()}`,
        )
        if (!resolution.ok || resolution.rail !== 'LN') {
          return res.status(503).json({ status: 'ERROR', reason: 'Platform payments are not configured' })
        }
        return res.json({ pr: resolution.invoice.bolt11, routes: [] })
      } catch (err) {
        // Never surface upstream detail (could echo a wallet URI or host).
        console.error('[lnurlp] platform callback failed:', err instanceof Error ? err.message : err)
        return res.status(502).json({ status: 'ERROR', reason: 'Could not create an invoice right now' })
      }
    }

    let user: Awaited<ReturnType<typeof findHandle>>
    try {
      user = await findHandle(handle)
    } catch (err) {
      console.error('[lnurlp] callback lookup failed:', err instanceof Error ? err.message : err)
      return res.status(502).json({ status: 'ERROR', reason: 'Lightning address lookup failed' })
    }
    if (!user?.lnAddressMode) {
      return res.status(404).json({ status: 'ERROR', reason: 'Lightning address not found' })
    }

    const limits = readLimits()
    const amount = parseCallbackAmount(req.query.amount, limits)
    if (!amount.ok) {
      return res.status(400).json({ status: 'ERROR', reason: amount.reason })
    }

    try {
      const invoice = await resolveUserLnAddressInvoice(
        prisma,
        user.id,
        amount.sats,
        `Payment to ${handle}@${readLnurlpDomain()}`,
      )
      return res.json({ pr: invoice.bolt11, routes: [] })
    } catch (err) {
      if (err instanceof LnurlpError) {
        return res.status(400).json({ status: 'ERROR', reason: err.reason })
      }
      // Never surface upstream detail (could echo the user's address/wallet).
      console.error('[lnurlp] callback failed:', err instanceof Error ? err.message : err)
      return res.status(502).json({ status: 'ERROR', reason: 'Could not create an invoice right now' })
    }
  })

  return router
}
