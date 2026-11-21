import { Router, type Request, type RequestHandler, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import {
  generateNewsletterToken,
  normalizeNewsletterEmail,
  recordNewsletterConsent,
  NEWSLETTER_CONSENT_TEXT_VERSION,
} from '../services/newsletter.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js'
import { sendTransactionalEmail } from '../services/transactional-email.js'
import { emailShell, emailButton, emailWordmark, EMAIL } from '../services/email-layout.js'
import { sendNewsletterWelcome } from '../services/newsletter-welcome.js'

// ADR-400: public newsletter surface.
//   POST /api/newsletter            — start/refresh a double-opt-in signup
//   GET  /api/newsletter/confirm     — email link: page with a confirm button
//   POST /api/newsletter/confirm     — PENDING → CONFIRMED
//   GET  /api/newsletter/unsubscribe — email link: page with an unsubscribe button
//   POST /api/newsletter/unsubscribe — → UNSUBSCRIBED (also RFC 8058 one-click)
//
// ADR-402: GET never changes state. Mail security scanners (e.g. Safe Links)
// prefetch every link in a message; a state-changing GET would confirm or
// unsubscribe on their behalf, and a prefetched confirm is not proof of consent.
//
// ADR-402 D15: signed-in self-service (requireAuth):
//   GET  /api/newsletter/me              — status of the caller's addresses
//   POST /api/newsletter/me/unsubscribe  — opt out (all or one bound address)
//   POST /api/newsletter/me/subscribe    — opt in (records consent)
//
// The admin audience list/export lives behind /api/admin (routes/admin.ts).

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 4001}`
const APP_URL = (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'https://colabonate.com').replace(/\/+$/, '')

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface PageAction {
  label: string
  /** Absolute or root-relative URL the button POSTs to. */
  postUrl: string
}

function renderPage(title: string, message: string, action?: PageAction): string {
  const primary = action
    ? `<form method="post" action="${escapeAttr(action.postUrl)}" style="margin:0 0 12px">
        <button type="submit" style="display:inline-block;padding:10px 18px;background:#E84541;color:#ffffff;border:0;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">${action.label}</button>
      </form>
      <a href="${APP_URL}" style="font-size:14px;color:#475569">Back to Colabonate</a>`
    : `<a href="${APP_URL}" style="display:inline-block;padding:10px 18px;background:#E84541;color:#ffffff;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600">Back to Colabonate</a>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · Colabonate</title>
</head>
<body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <main style="max-width:520px;margin:0 auto;padding:64px 24px">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0f172a">${title}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569">${message}</p>
      ${primary}
    </div>
  </main>
</body>
</html>`
}

function sendPage(res: Response, status: number, title: string, message: string, action?: PageAction): void {
  res.status(status).type('html').send(renderPage(title, message, action))
}

async function sendConfirmationMail(to: string, confirmUrl: string): Promise<void> {
  const subject = 'Confirm your Colabonate newsletter subscription'

  // ADR-401 D10: community + open-markets narrative on every newsletter surface.
  const communityNote =
    `Join the Colabonate community and follow our open-markets approach: we will keep you ` +
    `posted on Colabonate's development and on the wider Nostr and open-markets movement. ` +
    `You can accompany us on this path and support it — and we would be delighted if you did.`

  const text =
    `Confirm your Colabonate newsletter subscription\n` +
    `================================================\n\n` +
    `Click the link below to confirm that you want product updates, community news and\n` +
    `notes on Colabonate, Nostr and the open-markets movement:\n\n` +
    `${confirmUrl}\n\n` +
    `${communityNote}\n\n` +
    `No spam, ever. If you did not request this, you can ignore this email — nothing\n` +
    `happens until the link above is clicked.\n`

  const contentHtml = `
    <h1 style="margin:0 0 8px;font-size:20px;color:${EMAIL.ink}">Stay in the loop</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${EMAIL.body}">
      Confirm your email address to get product updates, community news and notes on Colabonate,
      Nostr and the open-markets movement — no spam, ever.
    </p>
    ${emailButton('Confirm subscription', confirmUrl)}
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:${EMAIL.body}">${communityNote}</p>
    <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${EMAIL.subtle}">
      If you did not request this, you can ignore this email — nothing happens until the link is clicked.
    </p>`

  const html = emailShell(emailWordmark(), contentHtml)
  await sendTransactionalEmail({ to, subject, html, text })
}

/** Sends the double-opt-in mail for a subscriber token. Throws on transport failure. */
export async function sendNewsletterConfirmation(email: string, token: string): Promise<void> {
  const confirmUrl = `${BASE_URL}/api/newsletter/confirm?token=${encodeURIComponent(token)}`
  await sendConfirmationMail(email, confirmUrl)
}

/**
 * Maps a confirmation-mail failure to an HTTP result. Returns true when the
 * request may still succeed (dev without transport), false when the caller
 * must answer with the error already sent here.
 */
function handleConfirmationSendError(err: unknown, email: string, res: Response): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === 'NO_EMAIL_TRANSPORT') {
    // Never log the tokenized confirm URL — it is a capability link.
    if (process.env.NODE_ENV === 'production') {
      console.error('[Newsletter] No email transport configured; confirmation email not sent')
      res.status(502).json({ error: 'Email transport not configured on server' })
      return false
    }
    console.warn(`[Newsletter] No email transport configured (dev); confirmation email for ${email} not sent`)
    return true
  }
  console.error('[Newsletter] confirmation send failed:', msg)
  res.status(502).json({ error: 'Failed to send confirmation email' })
  return false
}

type MyNewsletterStatus = 'CONFIRMED' | 'PENDING' | 'UNSUBSCRIBED' | 'NOT_SUBSCRIBED'

interface MyNewsletterAddress {
  email: string
  status: MyNewsletterStatus
  accountEmail: boolean
  emailVerified: boolean
  confirmedAt: Date | null
  unsubscribedAt: Date | null
}

export function createNewsletterRouter(prisma: PrismaClient, postLimiter?: RequestHandler) {
  const router = Router()
  // The spam limiter applies to the signup POST only — the GET confirm and
  // unsubscribe links are opened by recipients and must never be throttled by
  // the same 5/hour bucket (a shared/NAT IP would otherwise block clicks).
  const postHandlers = postLimiter ? [postLimiter] : []

  router.post('/', ...postHandlers, async (req: Request, res: Response) => {
    const email = normalizeNewsletterEmail((req.body as { email?: unknown } | undefined)?.email)
    if (!email) {
      res.status(400).json({ error: 'Valid email is required' })
      return
    }

    try {
      const user = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { pubkey: true },
      })
      const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } })

      // Already confirmed → idempotent no-op; never re-send on every page view.
      if (existing?.status === 'CONFIRMED') {
        res.status(200).json({ success: true, status: 'CONFIRMED' })
        return
      }

      // ADR-402 D16.4: typing an address into the newsletter form is the
      // opt-in; the confirm link then proves the address.
      const consent = {
        consentAt: new Date(),
        consentSource: 'footer',
        consentTextVersion: NEWSLETTER_CONSENT_TEXT_VERSION,
      }
      const subscriber = existing
        ? await prisma.newsletterSubscriber.update({
            where: { email },
            data: {
              ...consent,
              status: 'PENDING',
              confirmedAt: null,
              // ADR-402: an unproven re-subscribe keeps the suppression marker;
              // only the confirm click clears it (maintenance restores
              // UNSUBSCRIBED if nobody confirms).
              pubkey: user?.pubkey ?? existing.pubkey,
            },
          })
        : await prisma.newsletterSubscriber.create({
            data: { ...consent, email, pubkey: user?.pubkey ?? null, token: generateNewsletterToken() },
          })

      try {
        await sendNewsletterConfirmation(email, subscriber.token)
      } catch (err) {
        if (!handleConfirmationSendError(err, email, res)) return
      }

      res.status(201).json({ success: true, status: 'PENDING' })
    } catch (error) {
      console.error('[Newsletter] DB error:', error)
      res.status(500).json({ error: 'Failed to subscribe' })
    }
  })

  function tokenOf(req: Request): string {
    return typeof req.query.token === 'string' ? req.query.token : ''
  }

  router.get('/confirm', async (req: Request, res: Response) => {
    const token = tokenOf(req)
    if (!token) {
      sendPage(res, 400, 'Invalid link', 'This confirmation link is missing its token.')
      return
    }
    try {
      const subscriber = await prisma.newsletterSubscriber.findUnique({ where: { token } })
      if (!subscriber) {
        sendPage(res, 404, 'Link not found', 'This confirmation link is invalid or has expired.')
        return
      }
      if (subscriber.status === 'CONFIRMED') {
        sendPage(res, 200, 'Already confirmed', 'You are already on the list.')
        return
      }
      if (subscriber.status === 'UNSUBSCRIBED') {
        sendPage(
          res,
          410,
          'Address unsubscribed',
          'This address was unsubscribed from the newsletter. Sign up again from the site if that was a mistake.',
        )
        return
      }
      sendPage(res, 200, 'Confirm your subscription', 'Please confirm that you want to receive the Colabonate newsletter.', {
        label: 'Confirm subscription',
        postUrl: `${BASE_URL}/api/newsletter/confirm?token=${encodeURIComponent(token)}`,
      })
    } catch (error) {
      console.error('[Newsletter] confirm page error:', error)
      sendPage(res, 500, 'Something went wrong', 'We could not process this link right now. Please try again later.')
    }
  })

  router.post('/confirm', async (req: Request, res: Response) => {
    const token = tokenOf(req)
    if (!token) {
      sendPage(res, 400, 'Invalid link', 'This confirmation link is missing its token.')
      return
    }
    try {
      const subscriber = await prisma.newsletterSubscriber.findUnique({ where: { token } })
      if (!subscriber) {
        sendPage(res, 404, 'Link not found', 'This confirmation link is invalid or has expired.')
        return
      }
      if (subscriber.status === 'UNSUBSCRIBED') {
        sendPage(
          res,
          410,
          'Address unsubscribed',
          'This address was unsubscribed from the newsletter. Sign up again from the site if that was a mistake.',
        )
        return
      }
      if (subscriber.status !== 'CONFIRMED') {
        await prisma.newsletterSubscriber.update({
          where: { token },
          data: { status: 'CONFIRMED', confirmedAt: new Date(), unsubscribedAt: null },
        })
        // ADR-401 FU-892: welcome mail on the proven opt-in (fire-and-forget).
        if (subscriber.consentAt) sendNewsletterWelcome(subscriber.email, subscriber.token)
      }
      sendPage(res, 200, 'Subscription confirmed', 'You are on the list. Thanks for confirming your email address.')
    } catch (error) {
      console.error('[Newsletter] confirm error:', error)
      sendPage(res, 500, 'Something went wrong', 'We could not process this link right now. Please try again later.')
    }
  })

  async function unsubscribeByToken(token: string): Promise<'ok' | 'not-found'> {
    const subscriber = await prisma.newsletterSubscriber.findUnique({ where: { token } })
    if (!subscriber) return 'not-found'
    if (subscriber.status !== 'UNSUBSCRIBED') {
      await prisma.newsletterSubscriber.update({
        where: { token },
        data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() },
      })
    }
    return 'ok'
  }

  router.get('/unsubscribe', async (req: Request, res: Response) => {
    const token = tokenOf(req)
    if (!token) {
      sendPage(res, 400, 'Invalid link', 'This unsubscribe link is missing its token.')
      return
    }
    try {
      const subscriber = await prisma.newsletterSubscriber.findUnique({ where: { token } })
      if (!subscriber) {
        sendPage(res, 404, 'Link not found', 'This unsubscribe link is invalid or has expired.')
        return
      }
      if (subscriber.status === 'UNSUBSCRIBED') {
        sendPage(res, 200, 'Already unsubscribed', 'You no longer receive newsletter emails from Colabonate.')
        return
      }
      sendPage(res, 200, 'Unsubscribe from the newsletter?', 'You will no longer receive newsletter emails from Colabonate.', {
        label: 'Unsubscribe',
        postUrl: `${BASE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`,
      })
    } catch (error) {
      console.error('[Newsletter] unsubscribe page error:', error)
      sendPage(res, 500, 'Something went wrong', 'We could not process this link right now. Please try again later.')
    }
  })

  // The button on the page above, and RFC 8058 one-click (List-Unsubscribe-Post)
  // from mail clients. The token stays in the query string for both.
  router.post('/unsubscribe', async (req: Request, res: Response) => {
    const token = tokenOf(req)
    if (!token) {
      sendPage(res, 400, 'Invalid link', 'This unsubscribe link is missing its token.')
      return
    }
    try {
      if ((await unsubscribeByToken(token)) === 'not-found') {
        sendPage(res, 404, 'Link not found', 'This unsubscribe link is invalid or has expired.')
        return
      }
      sendPage(
        res,
        200,
        'Unsubscribed',
        'You will no longer receive newsletter emails from Colabonate. If you have an account, you can ' +
          'change this any time under Settings → Account → Notifications.',
      )
    } catch (error) {
      console.error('[Newsletter] unsubscribe error:', error)
      sendPage(res, 500, 'Something went wrong', 'We could not process this link right now. Please try again later.')
    }
  })

  // ── ADR-402 D15: signed-in self-service ──────────────────────────────────
  // Only addresses bound to the caller's identity (User.email or a subscriber
  // row with pubkey = caller) can be read or unsubscribed here. Subscribing an
  // address that is not bound only starts a double opt-in, exactly like the
  // public footer form — the inbox owner decides.

  const auth = requireAuth(prisma)

  async function loadMyAddresses(pubkey: string): Promise<MyNewsletterAddress[]> {
    const user = await prisma.user.findUnique({ where: { pubkey }, select: { email: true, emailVerified: true } })
    const accountEmail = normalizeNewsletterEmail(user?.email)
    const rows = await prisma.newsletterSubscriber.findMany({
      where: { OR: [{ pubkey }, ...(accountEmail ? [{ email: accountEmail }] : [])] },
      orderBy: { createdAt: 'asc' },
    })
    const byEmail = new Map(rows.map((r) => [r.email, r]))
    const emails = [...new Set([...(accountEmail ? [accountEmail] : []), ...rows.map((r) => r.email)])]
    return emails.map((email) => {
      const row = byEmail.get(email)
      const isAccount = email === accountEmail
      let status: MyNewsletterStatus = 'NOT_SUBSCRIBED'
      if (row) {
        // A confirmed row without a recorded opt-in is not a subscription (ADR-402 D16).
        status = row.status === 'CONFIRMED' && !row.consentAt ? 'NOT_SUBSCRIBED' : row.status
      }
      return {
        email,
        status,
        accountEmail: isAccount,
        emailVerified: isAccount ? !!user?.emailVerified : row?.status === 'CONFIRMED',
        confirmedAt: row?.confirmedAt ?? null,
        unsubscribedAt: row?.unsubscribedAt ?? null,
      }
    })
  }

  router.get('/me', auth, async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      res.json({ addresses: await loadMyAddresses(pubkey) })
    } catch (error) {
      console.error('[Newsletter] /me error:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  router.post('/me/unsubscribe', auth, async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      const mine = await loadMyAddresses(pubkey)
      const requested = (req.body as { email?: unknown } | undefined)?.email
      let targets = mine.map((a) => a.email)
      if (requested !== undefined) {
        const email = normalizeNewsletterEmail(requested)
        if (!email || !targets.includes(email)) {
          return void res.status(403).json({ error: 'ADDRESS_NOT_BOUND', message: 'This address is not linked to your account.' })
        }
        targets = [email]
      }
      const now = new Date()
      for (const email of targets) {
        await prisma.newsletterSubscriber.upsert({
          where: { email },
          // An account email without a row gets a suppression row, so no later
          // audience import can put it back on the list (ADR-400 D7).
          create: {
            email,
            pubkey,
            source: 'settings',
            token: generateNewsletterToken(),
            status: 'UNSUBSCRIBED',
            unsubscribedAt: now,
          },
          update: { status: 'UNSUBSCRIBED', unsubscribedAt: now },
        })
      }
      res.json({ addresses: await loadMyAddresses(pubkey) })
    } catch (error) {
      console.error('[Newsletter] /me/unsubscribe error:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  router.post('/me/subscribe', auth, ...postHandlers, async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      const user = await prisma.user.findUnique({ where: { pubkey }, select: { email: true, emailVerified: true } })
      const accountEmail = normalizeNewsletterEmail(user?.email)
      const requested = (req.body as { email?: unknown } | undefined)?.email
      const email = requested !== undefined ? normalizeNewsletterEmail(requested) : accountEmail
      if (!email) {
        return void res.status(400).json({ error: 'EMAIL_REQUIRED', message: 'Enter an email address for the newsletter.' })
      }

      const mine = await loadMyAddresses(pubkey)
      const bound = mine.some((a) => a.email === email)
      // A verified account email is already proven — no second confirmation mail.
      const proven = email === accountEmail && !!user?.emailVerified
      // Bind the caller only to an address that is theirs, or to a row this
      // call creates — never to someone else's existing subscription.
      const existed = bound ? true : !!(await prisma.newsletterSubscriber.findUnique({ where: { email }, select: { id: true } }))
      const result = await recordNewsletterConsent(prisma, email, bound || !existed ? pubkey : null, {
        source: 'settings',
        confirm: proven,
      })
      if (!result) {
        return void res.status(400).json({ error: 'EMAIL_REQUIRED', message: 'Enter a valid email address.' })
      }

      if (result.newlyConfirmed) sendNewsletterWelcome(email, result.token)
      if (result.status !== 'CONFIRMED') {
        try {
          await sendNewsletterConfirmation(email, result.token)
        } catch (err) {
          if (!handleConfirmationSendError(err, email, res)) return
        }
      }

      res.json({ addresses: await loadMyAddresses(pubkey) })
    } catch (error) {
      console.error('[Newsletter] /me/subscribe error:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
