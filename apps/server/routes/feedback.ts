import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'

const VALID_KINDS = ['bug', 'idea', 'question'] as const
type FeedbackKind = (typeof VALID_KINDS)[number]

export function createFeedbackRouter(prisma: PrismaClient) {
  const router = Router()

  router.post('/', async (req: Request, res: Response) => {
    const { kind, title, body, email, context } = req.body as {
      kind?: string
      title?: string
      body?: string
      email?: string
      context?: { route?: string; pubkey?: string; userAgent?: string }
    }

    if (email !== undefined && email !== '') {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRe.test(email) || email.length > 254) {
        res.status(400).json({ error: 'Invalid email address' })
        return
      }
    }

    if (!kind || !VALID_KINDS.includes(kind as FeedbackKind)) {
      res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` })
      return
    }
    const trimmedTitle = (title ?? '').trim()
    if (trimmedTitle.length < 5 || trimmedTitle.length > 120) {
      res.status(400).json({ error: 'title must be 5–120 characters' })
      return
    }
    const trimmedBody = (body ?? '').trim()
    if (trimmedBody.length < 10 || trimmedBody.length > 4000) {
      res.status(400).json({ error: 'body must be 10–4000 characters' })
      return
    }
    if (context && JSON.stringify(context).length > 4096) {
      res.status(400).json({ error: 'context payload exceeds 4 KB' })
      return
    }

    try {
      const entry = await prisma.betaFeedback.create({
        data: {
          kind,
          title: trimmedTitle,
          body: trimmedBody,
          route: context?.route ?? null,
          userAgent: context?.userAgent ?? null,
          pubkey: context?.pubkey ?? null,
          userEmail: email?.trim() || null,
        },
      })
      res.status(201).json({ id: entry.id, status: 'received' })
    } catch (error) {
      console.error('[Feedback] DB error:', error)
      res.status(500).json({ error: 'Failed to save feedback' })
    }
  })

  return router
}
