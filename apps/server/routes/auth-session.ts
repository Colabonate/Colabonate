import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'crypto'
import { FOUNDATION_DAO_ID } from '../middleware/require-admin.js'

export function createSessionRouter(prisma: PrismaClient) {
  const router = Router()

  router.get('/me', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing authorization header' })
    }

    const token = authHeader.slice(7)

    try {
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      })

      if (!session || session.expiresAt < new Date()) {
        if (session) {
          await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
        }
        return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' })
      }

      // ADR-273: server-confirmed Foundation-DAO admin role — replaces the old
      // VITE_ADMIN_PUBKEY/localStorage client-side gate. Single DAO-membership
      // index hit per /me call; if this becomes hot we can add a join to the
      // Session include above.
      const adminMembership = await prisma.daoMember.findFirst({
        where: {
          daoId: FOUNDATION_DAO_ID,
          pubkey: session.user.pubkey,
          status: 'ACTIVE',
          role: 'ADMIN',
        },
        select: { id: true },
      })

      res.json({
        pubkey: session.user.pubkey,
        lnAddress: session.user.lnAddress || undefined,
        evmAddress: session.user.evmAddress || undefined,
        identityLevel: session.user.identityLevel ?? 0,
        isAdmin: !!adminMembership,
      })
    } catch (error) {
      console.error('[auth/me] Error:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to verify session' })
    }
  })

  router.post('/demo', async (req: Request, res: Response) => {
    // FU-221-C (ADR-221 §"Demo-login flag-gate"): explicit opt-in kill switch.
    // NODE_ENV=production is the hard guard (docker-compose.beta.yml sets it). The
    // flag below closes the residual hole exposed by ADR-215: a tunnelled dev server
    // exempts /api/** from the tunnel basic-auth, so anyone reaching the dev
    // endpoint could otherwise mint a session for any pubkey incl. the admin.
    const demoLoginEnabled =
      process.env.DEMO_LOGIN_ENABLED === '1' || process.env.DEMO_LOGIN_ENABLED === 'true'
    if (process.env.NODE_ENV === 'production' || !demoLoginEnabled) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Demo login is disabled (set DEMO_LOGIN_ENABLED=1 to enable)',
      })
    }

    const { pubkey } = req.body as { pubkey?: string }
    if (!pubkey) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'pubkey is required' })
    }

    try {
      const user = await prisma.user.upsert({
        where: { pubkey },
        update: {},
        create: {
          pubkey,
          lnAddress: `${pubkey.slice(0, 8)}@demo.local`,
        },
      })
      // ADR-284 D6: a blocked account can't mint a new session either — the
      // force-logout at block time only clears sessions that already exist.
      if (user.blockedAt) {
        return res.status(403).json({ error: 'ACCOUNT_BLOCKED', message: user.blockedReason ?? 'This account has been blocked.' })
      }

      const token = randomBytes(32).toString('hex')

      await prisma.session.create({
        data: {
          pubkey,
          k1: `demo-${Date.now()}-${randomBytes(8).toString('hex')}`,
          token,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      res.json({ pubkey, token })
    } catch (error) {
      console.error('[auth/demo] Error:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Demo login failed' })
    }
  })

  router.post('/logout', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing authorization header' })
    }

    const token = authHeader.slice(7)

    try {
      await prisma.session.deleteMany({ where: { token } })
      res.json({ success: true })
    } catch (error) {
      console.error('[auth/logout] Error:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Logout failed' })
    }
  })

  return router
}
