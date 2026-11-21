import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { LnurlAuthService } from '../services/lnurl-auth.js'
import { randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { Resend } from 'resend'
import { isBetaMode } from '../services/betaMode.js'
import { emailShell, emailButton, emailNotice, emailWordmark, EMAIL } from '../services/email-layout.js'
import { recordNewsletterConsent, type NewsletterConsentSource } from '../services/newsletter.js'
import { sendNewsletterWelcome } from '../services/newsletter-welcome.js'

// Load the brand wordmark once at boot and base64-encode it for inlining into
// the email `<img>` tag (most clients block remote image fetches by default;
// a data: URI survives Gmail/Outlook/Apple Mail without round-trips).
// Resolved relative to this file, so it survives tsx/dev and built/prod layouts.
const __filenameHere = fileURLToPath(import.meta.url)
const __dirnameHere = dirname(__filenameHere)
const LOGO_SVG_PATH = resolve(__dirnameHere, '../assets/colabonate.svg')

function loadLogoDataUri(): string | null {
  try {
    const svg = readFileSync(LOGO_SVG_PATH, 'utf8')
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
  } catch {
    return null
  }
}
const LOGO_DATA_URI = loadLogoDataUri()

const BRAND_WEBSITE_URL = process.env.BRAND_WEBSITE_URL || 'https://colabonate.com'
const BRAND_GITHUB_URL = process.env.BRAND_GITHUB_URL || 'https://github.com/Colabonate'
const BRAND_DISCUSSIONS_URL = process.env.BRAND_DISCUSSIONS_URL || 'https://github.com/Colabonate/discussions'
const BRAND_OPENCOLLECT_URL = process.env.BRAND_OPENCOLLECT_URL || 'https://opencollective.com/colabonate'
const BRAND_YOUTUBE_URL = process.env.BRAND_YOUTUBE_URL || 'https://youtube.com/@colabonate'
const BRAND_TWITTER_URL = process.env.BRAND_TWITTER_URL || 'https://x.com/Colabonate'
const BRAND_INSTAGRAM_URL = process.env.BRAND_INSTAGRAM_URL || 'https://instagram.com/colabonate'
const BRAND_PATREON_URL = process.env.BRAND_PATREON_URL || 'https://patreon.com/c/Colabonate'
const BRAND_SIGNATURE_NAME = process.env.BRAND_SIGNATURE_NAME || 'Deniz Yilmaz'
const BRAND_SIGNATURE_ROLE = process.env.BRAND_SIGNATURE_ROLE || 'Colabonate Beta Team'

export function createEmailAuthRouter(prisma: PrismaClient) {
  const router = Router()
  const lnurlAuthService = new LnurlAuthService(prisma)

  // ADR-401 D9: light on-brand header, mode-gated service notice (beta vs
  // production), brand-red CTA, and the D10 community/open-markets note.
  async function sendMagicLinkMail(to: string, magicLink: string, newsletterOptIn = false): Promise<void> {
    const subject = 'Your Colabonate sign-in link'
    const frontendHelp =
      process.env.FRONTEND_URL?.replace(/\/+$/, '') || process.env.APP_BASE_URL?.replace(/\/+$/, '') || 'http://localhost:5173'

    // ADR-401 D9/D10: mode-gated notice (beta demo vs production) + community note.
    const communityNote =
      `Join the Colabonate community and follow our open-markets approach: we will keep you ` +
      `posted on Colabonate's development and on the wider Nostr and open-markets movement. ` +
      `You can accompany us on this path and support it — and we would be delighted if you did.`

    const notice = isBetaMode()
      ? {
          kind: 'warning' as const,
          title: 'Beta environment',
          text:
            'This is a Colabonate Beta instance: demo wallets and simulated payments only, ' +
            'no real sats. The Beta may be reset or taken down at any time.',
          html:
            '<p style="font-size:13px;line-height:1.6;margin:0">This is a Colabonate <strong>Beta</strong> ' +
            'instance: demo wallets and simulated payments only, no real sats. The Beta may be reset or ' +
            'taken down at any time.</p>',
        }
      : {
          kind: 'info' as const,
          title: 'Service notice',
          text:
            'Colabonate is operated by agantila; your account data is processed in the EU. ' +
            `Privacy: ${frontendHelp}/legal/privacy · Terms: ${frontendHelp}/legal/terms`,
          html:
            '<p style="font-size:13px;line-height:1.6;margin:0">Colabonate is operated by agantila; ' +
            'your account data is processed in the EU. ' +
            `<a href="${frontendHelp}/legal/privacy" style="color:${EMAIL.infoInk};font-weight:600">Privacy</a> · ` +
            `<a href="${frontendHelp}/legal/terms" style="color:${EMAIL.infoInk};font-weight:600">Terms</a></p>`,
        }

    const text =
      `Sign in to Colabonate\n` +
      `=========================================\n\n` +
      `${magicLink}\n\n` +
      `This link expires in 15 minutes and can only be used once.\n\n` +

      `-----------------------------------------\n` +
      `Important — read before signing in\n` +
      `-----------------------------------------\n\n` +
      `After clicking the link you sign in at Level 0 (anonymous). You can browse the ` +
      `marketplace and set up a profile, but creating offers, opening tickets, or joining ` +
      `governance needs a real Nostr key at Level 1 — the onboarding will help you create one.\n\n` +
      `Your account is bound to your email address, but the private key that signs your Nostr ` +
      `events lives only in this browser. If you clear your browser data without first linking ` +
      `a Nostr signer (Alby, nos2x, NIP-46) or a Lightning wallet, you keep your account but ` +
      `lose the key — and with it, your offers, reviews, COL-Points, and reputation.\n` +
      `Learn more: ${frontendHelp}/help/login-providers#lp-4\n\n` +

      `-----------------------------------------\n` +
      `${notice.title}\n` +
      `-----------------------------------------\n\n` +
      `${notice.text}\n\n` +

      `-----------------------------------------\n` +
      `Stay close to the community\n` +
      `-----------------------------------------\n\n` +
      `${communityNote}\n\n` +

      `With friendly regards,\n` +
      `${BRAND_SIGNATURE_NAME}\n` +
      `${BRAND_SIGNATURE_ROLE}\n\n` +

      `  Website:    ${BRAND_WEBSITE_URL}\n` +
      `  Instagram:  ${BRAND_INSTAGRAM_URL}\n` +
      `  X/Twitter:  ${BRAND_TWITTER_URL}\n` +
      `  GitHub:     ${BRAND_GITHUB_URL}\n\n` +
      `  Full community list: ${BRAND_WEBSITE_URL}/community\n\n` +
      (newsletterOptIn
        ? `You chose to receive the Colabonate newsletter. It starts once you sign in with this ` +
          `link; every newsletter carries an unsubscribe link.\n\n`
        : '') +
      `If you did not request this email, you can ignore it — nothing was changed on your account.`

    const headerHtml = LOGO_DATA_URI
      ? `<img src="${LOGO_DATA_URI}" alt="Colabonate" width="170" height="31" style="display:block;margin:0 auto;height:auto;max-width:170px"/>`
      : emailWordmark()

    const contentHtml = `
    <h2 style="margin:0 0 6px;font-size:22px;line-height:1.25;color:${EMAIL.ink}">Sign in to Colabonate</h2>
    <p style="margin:0 0 22px;color:${EMAIL.body};font-size:14px;line-height:1.55">Click the button below. This link expires in 15&nbsp;minutes and can only be used once.</p>
    ${emailButton('Sign in to Colabonate', magicLink)}
    <p style="color:${EMAIL.muted};font-size:12px;margin:0;word-break:break-all;line-height:1.5">Or paste this link:<br/><a href="${magicLink}" style="color:${EMAIL.primary}">${magicLink}</a></p>

    ${emailNotice(
      'info',
      'Before you sign in',
      `<p style="font-size:13px;line-height:1.6;margin:0 0 10px">After clicking the link you sign in at <strong>Level&nbsp;0 (anonymous)</strong>. You can browse the marketplace and set up a profile — creating offers, opening tickets, or joining governance needs a real Nostr key at Level&nbsp;1, which the onboarding will help you create.</p><p style="font-size:13px;line-height:1.6;margin:0">Your account is bound to your email address, but the private key that signs your Nostr events lives only in <strong>this browser</strong>. If you clear your browser data without first linking a Nostr signer (Alby, nos2x, NIP-46) or a Lightning wallet, you keep your account but lose the key — and your offers, reviews, COL-Points and reputation with it. <a href="${frontendHelp}/help/login-providers#lp-4" style="color:${EMAIL.infoInk};font-weight:600">How login providers work →</a></p>`,
    )}

    ${emailNotice(notice.kind, notice.title, notice.html)}

    <div style="border-top:1px solid ${EMAIL.border};margin:28px 0 0;padding:22px 0 4px">
      <h3 style="font-size:14px;margin:0 0 10px;color:${EMAIL.ink}">Stay close to the community</h3>
      <p style="font-size:13px;line-height:1.6;margin:0 0 16px;color:#1f2937">${communityNote}</p>
      <p style="font-size:13px;line-height:1.55;margin:0;color:${EMAIL.ink}">With friendly regards,<br/><strong style="font-size:14px">${BRAND_SIGNATURE_NAME}</strong><br/><span style="color:${EMAIL.muted};font-size:12px">${BRAND_SIGNATURE_ROLE}</span></p>
      ${newsletterOptIn
        ? `<p style="font-size:11px;line-height:1.5;margin:14px 0 0;color:${EMAIL.subtle}">You chose to receive the Colabonate newsletter. It starts once you sign in with this link; every newsletter carries an unsubscribe link.</p>`
        : ''}
    </div>

    <div style="background:${EMAIL.bg};border-radius:10px;padding:16px 18px;margin:18px 0 0;text-align:center">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.7px;color:${EMAIL.body};text-transform:uppercase;margin:0 0 10px">Stay in touch</div>
      <a href="${BRAND_WEBSITE_URL}" style="display:inline-block;margin:4px;padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;color:${EMAIL.ink};text-decoration:none;font-size:13px;font-weight:600">Website</a>
      <a href="${BRAND_INSTAGRAM_URL}" style="display:inline-block;margin:4px;padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;color:${EMAIL.ink};text-decoration:none;font-size:13px;font-weight:600">Instagram</a>
      <a href="${BRAND_TWITTER_URL}" style="display:inline-block;margin:4px;padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;color:${EMAIL.ink};text-decoration:none;font-size:13px;font-weight:600">X / Twitter</a>
      <a href="${BRAND_GITHUB_URL}" style="display:inline-block;margin:4px;padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;color:${EMAIL.ink};text-decoration:none;font-size:13px;font-weight:600">GitHub</a>
    </div>

    <p style="color:${EMAIL.subtle};font-size:11px;line-height:1.55;margin:16px 0 0;text-align:center">Full community list: <a href="${BRAND_WEBSITE_URL}/community" style="color:${EMAIL.subtle};text-decoration:underline">${BRAND_WEBSITE_URL.replace(/^https?:\/\//, '')}/community</a></p>
    <p style="color:${EMAIL.subtle};font-size:11px;line-height:1.5;margin:18px 0 0;text-align:center">If you did not request this email you can ignore it — nothing was changed on your account.</p>`

    const html = emailShell(headerHtml, contentHtml)

    // Prefer Resend (matches admin feedback-reply path; same SDK already a dep).
    if (process.env.RESEND_API_KEY) {
      let resend: Resend
      try {
        resend = new Resend(process.env.RESEND_API_KEY)
      } catch (e) {
        throw new Error(`Resend SDK init: ${e instanceof Error ? e.message : String(e)}`)
      }
      const from = process.env.RESEND_FROM_EMAIL || 'Colabonate Team <noreply@agantila.com>'
      let sendResult: { data?: unknown; error?: unknown }
      try {
        sendResult = (await resend.emails.send({ from, to: [to], subject, html, text })) as { data?: unknown; error?: unknown }
      } catch (e) {
        throw new Error(`Resend send (sync throw): ${e instanceof Error ? e.message : String(e)}`)
      }
      if (sendResult.error) {
        const e = sendResult.error as { message?: string; name?: string; statusCode?: number | null }
        throw new Error(
          `Resend API ${e.statusCode ?? '???'} [${e.name ?? 'error'}]: ${e.message ?? 'unknown error'} (from="${from}", to="${to}") — ` +
          `verify the domain is verified in your Resend dashboard`,
        )
      }
      return
    }

    // Fallback: generic SMTP (nodemailer).
    if (process.env.SMTP_HOST) {
      const nodemailer = await import('nodemailer')
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      })
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@colabonate.local',
        to,
        subject,
        text,
        html,
      })
      return
    }

    throw new Error('NO_EMAIL_TRANSPORT')
  }

  router.post('/send', async (req: Request, res: Response) => {
    try {
      const { email, pubkey, returnTo, newsletterOptIn } = req.body as {
        email: string
        pubkey?: string
        returnTo?: string
        newsletterOptIn?: boolean
      }

      if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email required' })
      }

      // ADR-402 D16.3: /send is unauthenticated, so the newsletter opt-in is
      // NOT written as a subscriber row here (anyone could submit someone
      // else's address). It is stored with this magic-link token and only
      // applied when that exact token is verified — which proves the address.
      const optInSource: NewsletterConsentSource | null =
        newsletterOptIn === true
          ? typeof returnTo === 'string' && returnTo.startsWith('/onboarding') ? 'signup-onboarding' : 'signup-email'
          : null

      // ADR-158: client passes its real Nostr pubkey so the new account is non-custodial.
      const token = await lnurlAuthService.createMagicLinkToken(email, pubkey, optInSource)

      // BUGFIX: the magic link MUST open the SPA (so the client-side useEffect in
      // TabEmail.tsx can call /api/auth/email/verify and persist the session).
      // Using BASE_URL (= server) used to point the user at a raw-JSON 200 page.
      const appBaseUrl = process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:5173'

      // Allow a same-origin SPA path to receive the token (e.g. the unified
      // Nostr-creation stepper at /onboarding/generate-nostr-key). Validate it is a
      // root-relative path to prevent open-redirect abuse (no protocol-relative `//`,
      // no absolute URLs). Defaults to /login for the standard magic-link login.
      let path = '/login'
      if (typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
        path = returnTo
      }
      const magicLink = `${appBaseUrl.replace(/\/+$/, '')}${path}?token=${encodeURIComponent(token)}`

      console.log(`[Email Auth] Magic link for ${email}: ${magicLink}`)

      let transport: 'resend' | 'smtp' | 'dev' = 'dev'
      try {
        if (process.env.RESEND_API_KEY) transport = 'resend'
        else if (process.env.SMTP_HOST) transport = 'smtp'
        else throw new Error('NO_EMAIL_TRANSPORT')

        await sendMagicLinkMail(email, magicLink, optInSource !== null)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[Email Auth] transport="${transport}" send failed:`, msg)
        if (msg === 'NO_EMAIL_TRANSPORT') {
          // In dev: surface the link in the response so the SPA can show it.
          // In prod: hard-fail — the frontend must NOT claim "Link sent" if nothing was sent.
          if (process.env.NODE_ENV === 'production') {
            return res.status(503).json({ error: 'Email transport not configured on server' })
          }
          console.warn(`[Email Auth] No email transport configured; dev mode — returning debugLink`)
        } else {
          // DEV: echo the real cause so the operator sees it in the network tab.
          // PROD: opaque "Failed to send magic link" — never leak provider internals.
          return res.status(502).json({
            error: process.env.NODE_ENV === 'production'
              ? 'Failed to send magic link'
              : `Magic-link send failed: ${msg}`,
          })
        }
      }

      res.json({
        success: true,
        transport,
        message: transport === 'dev' ? 'Dev mode: link returned in debugLink' : 'Link sent',
        debugLink: process.env.NODE_ENV !== 'production' ? magicLink : undefined,
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'PUBKEY_ALREADY_LINKED') {
        return res.status(409).json({
          error:
            'This browser is already linked to a different Colabonate account. Sign in with that account\'s email, or use a different browser/device to create a new one.',
        })
      }
      console.error('[Email Auth] Send error:', error)
      res.status(500).json({ error: 'Failed to send magic link' })
    }
  })

  router.get('/verify', async (req: Request, res: Response) => {
    try {
      const { token } = req.query as { token?: string }

      if (!token) {
        return res.status(400).json({ error: 'Token required' })
      }

      const result = await lnurlAuthService.verifyMagicLinkToken(token)

      if (!result) {
        return res.status(400).json({ error: 'Invalid or expired token' })
      }

      const user = await prisma.user.findFirst({
        where: { email: result.email },
      })

      const needsLightningLink = user ? !user.linkedPubkey : true

      // ADR-284 D6: a blocked account can't mint a new session either.
      if (user?.blockedAt) {
        return res.status(403).json({ error: 'ACCOUNT_BLOCKED', message: user.blockedReason ?? 'This account has been blocked.' })
      }

      const sessionToken = randomBytes(32).toString('hex')
      await prisma.session.create({
        data: {
          pubkey: user?.pubkey || result.pubkey,
          k1: `email-${Date.now()}-${randomBytes(8).toString('hex')}`,
          token: sessionToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      // ADR-402 D16.3: only the opt-in carried by THIS token counts; the click
      // proves the address, so it becomes CONFIRMED right away. Without an
      // opt-in nothing happens — signing in is not a newsletter signup.
      // Non-fatal: newsletter bookkeeping must never block sign-in.
      try {
        if (result.newsletterOptIn) {
          const subscriber = await recordNewsletterConsent(prisma, result.email, user?.pubkey || result.pubkey, {
            source: result.newsletterOptIn as NewsletterConsentSource,
            confirm: true,
          })
          // ADR-401 FU-892: welcome mail on the proven opt-in (fire-and-forget).
          if (subscriber?.newlyConfirmed) sendNewsletterWelcome(result.email, subscriber.token)
        }
      } catch (err) {
        console.warn('[Email Auth] Newsletter subscriber ensure failed (non-fatal):', err)
      }

      res.json({
        success: true,
        pubkey: user?.pubkey || result.pubkey,
        email: result.email,
        needsLightningLink,
        token: sessionToken,
      })
    } catch (error) {
      console.error('[Email Auth] Verify error:', error)
      res.status(500).json({ error: 'Verification failed' })
    }
  })

  router.post('/link-lightning', async (req: Request, res: Response) => {
    try {
      const { currentPubkey, lightningPubkey, k1, sig, event } = req.body as {
        currentPubkey: string
        lightningPubkey: string
        k1: string
        sig: string
        event: string
      }

      if (!currentPubkey || !lightningPubkey) {
        return res.status(400).json({ error: 'Missing parameters' })
      }

      const user = await prisma.user.findFirst({
        where: { OR: [{ pubkey: currentPubkey }, { email: currentPubkey }] },
      })

      if (!user) {
        return res.status(404).json({ error: 'Account not found' })
      }

      if (lightningPubkey === user.linkedPubkey) {
        return res.json({ success: true, linkedPubkey: lightningPubkey })
      }

      if (!k1 || (!sig && !event)) {
        return res.status(400).json({ error: 'Missing signature verification (k1, sig, or event required)' })
      }

      const validSignature = await lnurlAuthService.verifyLightningLinkChallenge(
        lightningPubkey,
        k1,
        sig,
        event
      )

      if (!validSignature) {
        return res.status(401).json({ error: 'Invalid signature - Lightning pubkey ownership not verified' })
      }

      const result = await lnurlAuthService.linkPubkeyToAccount(user.pubkey, lightningPubkey)
      res.json(result)
    } catch (error) {
      console.error('[Email Auth] Link Lightning error:', error)
      res.status(500).json({ error: 'Failed to link Lightning wallet' })
    }
  })

  router.get('/link-challenge', (_req: Request, res: Response) => {
    try {
      const { k1 } = lnurlAuthService.generateLinkChallenge()
      res.json({ k1 })
    } catch (error) {
      console.error('[Email Auth] Link challenge error:', error)
      res.status(500).json({ error: 'Failed to generate challenge' })
    }
  })

  return router
}