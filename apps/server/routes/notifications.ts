import { Router, type Response } from 'express'
import type { PrismaClient, Prisma } from '@prisma/client'
import type { AuthenticatedRequest } from '../types/express.js'

// ADR-374 — server-backed in-app notifications.
// Read/manage the account-scoped notification feed (written at ticket /
// cooperation / dispute lifecycle events). Mounted under /api/notifications
// with requireAuth applied at the mount site, so req.authPubkey is always set.

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function createNotificationsRouter(prisma: PrismaClient) {
  const router = Router()

  // GET /api/notifications — the current user's notifications (newest first).
  // ?unreadOnly=1  → only unread
  // ?archived=1    → only archived (default: non-archived)
  // ?limit=N       → page size (default 50, max 200)
  // ?cursor=<iso>  → createdAt before this timestamp (simple keyset pagination)
  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pubkey = req.authPubkey!
      const q = req.query as Record<string, unknown>
      const unreadOnly = q.unreadOnly === '1' || q.unreadOnly === 'true'
      const archived = q.archived === '1' || q.archived === 'true'
      const limit = Math.min(Math.max(parseInt(String(q.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
      const cursor = typeof q.cursor === 'string' && q.cursor ? q.cursor : undefined

      const where: Prisma.NotificationWhereInput = {
        ownerPubkey: pubkey,
        archived,
        ...(unreadOnly ? { read: false } : {}),
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      }

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit,
        }),
        prisma.notification.count({ where: { ownerPubkey: pubkey, archived } }),
      ])
      const unread = await prisma.notification.count({ where: { ownerPubkey: pubkey, archived: false, read: false } })

      const last = notifications[notifications.length - 1]
      res.json({
        notifications,
        total,
        unread,
        nextCursor: notifications.length === limit && last ? last.createdAt.toISOString() : null,
      })
    } catch (error) {
      console.error('Failed to fetch notifications:', error)
      res.status(500).json({ error: 'Failed to fetch notifications' })
    }
  })

  // PATCH /api/notifications/:id — mark read and/or archive (own rows only).
  router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pubkey = req.authPubkey!
      const { id } = req.params
      const { read, archived } = req.body as { read?: unknown; archived?: unknown }

      if (read === undefined && archived === undefined) {
        return res.status(400).json({ error: 'read or archived is required' })
      }
      const data: Prisma.NotificationUpdateInput = {}
      if (typeof read === 'boolean') data.read = read
      if (typeof archived === 'boolean') data.archived = archived

      const result = await prisma.notification.updateMany({
        where: { id, ownerPubkey: pubkey },
        data,
      })
      if (result.count === 0) {
        return res.status(404).json({ error: 'Notification not found' })
      }
      res.json({ success: true, id })
    } catch (error) {
      console.error('Failed to update notification:', error)
      res.status(500).json({ error: 'Failed to update notification' })
    }
  })

  // POST /api/notifications/read-all — mark every unread notification as read.
  router.post('/read-all', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const pubkey = req.authPubkey!
      const result = await prisma.notification.updateMany({
        where: { ownerPubkey: pubkey, read: false },
        data: { read: true },
      })
      res.json({ success: true, updated: result.count })
    } catch (error) {
      console.error('Failed to mark notifications read:', error)
      res.status(500).json({ error: 'Failed to mark notifications read' })
    }
  })

  return router
}
