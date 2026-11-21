import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { LnurlAuthService } from '../services/lnurl-auth.js'

function getStringParam(param: unknown): string | undefined {
  if (Array.isArray(param)) return param[0] as string
  if (typeof param === 'string') return param
  return undefined
}

export function createLnurlRouter(prisma: PrismaClient) {
  const router = Router()
  const lnurlAuthService = new LnurlAuthService(prisma)

  router.get('/', (_req: Request, res: Response) => {
    try {
      const { lnurl, k1 } = lnurlAuthService.generateLnurlChallenge()
      res.json({ lnurl, k1 })
    } catch (error) {
      console.error('Error generating LNURL challenge:', error)
      res.status(500).json({ error: 'Failed to generate LNURL challenge' })
    }
  })

  router.get('/details', (req: Request, res: Response) => {
    const k1Str = getStringParam(req.query.k1)
    if (!k1Str) {
      return res.status(400).json({ status: 'ERROR', reason: 'Missing k1' })
    }
    const callbackUrl = `${process.env.BASE_URL || 'http://localhost:4001'}/api/auth/lnurl/callback`
    res.json({
      tag: 'login',
      callback: callbackUrl,
      k1: k1Str,
      action: 'login',
    })
  })

  router.get('/callback', async (req: Request, res: Response) => {
    try {
      const { k1, sig, key, event, lud16 } = req.query
      console.log('[LNURL callback]', { k1, sig: sig ? '(set)' : '(missing)', key: key ? '(set)' : '(missing)', event: event ? '(set)' : '(missing)', lud16: lud16 ? '(set)' : '(missing)' })

      const k1Str = getStringParam(k1)
      const keyStr = getStringParam(key)
      const sigStr = getStringParam(sig) ?? ''
      const eventStr = getStringParam(event)
      const lud16Str = getStringParam(lud16)

      if (!k1Str || !keyStr) {
        return res.status(400).json({ status: 'ERROR', reason: 'Missing k1 or key' })
      }

      const result = await lnurlAuthService.verifyChallenge(k1Str, sigStr, keyStr, eventStr, lud16Str ?? undefined)

      console.log('[LNURL callback] success, pubkey:', result?.pubkey)
      res.json({ status: 'OK', pubkey: result?.pubkey, lnAddress: result?.lnAddress, token: result?.token })
    } catch (error) {
      console.error('[LNURL callback] ERROR:', error)
      res.status(400).json({
        status: 'ERROR',
        reason: error instanceof Error ? error.message : 'Verification failed'
      })
    }
  })

  router.get('/status/:k1', async (req: Request, res: Response) => {
    try {
      const k1Str = getStringParam(req.params.k1)
      if (!k1Str) {
        return res.status(400).json({ error: 'Invalid k1 parameter' })
      }
      const result = await lnurlAuthService.checkAuthStatus(k1Str)
      res.json(result)
    } catch (error) {
      console.error('Auth status error:', error)
      res.status(500).json({ error: 'Failed to check auth status' })
    }
  })

  return router
}
