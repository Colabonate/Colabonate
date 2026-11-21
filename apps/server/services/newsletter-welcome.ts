// ADR-401 FU-892 — one welcome mail when a newsletter subscription becomes
// CONFIRMED with recorded consent (ADR-402 D16). Transactional, not a campaign:
// it goes to exactly one person, right after their own proven opt-in, and
// carries their unsubscribe link.

import { sendTransactionalEmail } from './transactional-email.js'
import { EMAIL, emailButton, emailShell, emailWordmark, escapeHtml } from './email-layout.js'

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 4001}`
const APP_URL = (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'https://colabonate.com').replace(/\/+$/, '')

export interface WelcomeMail {
  subject: string
  text: string
  html: string
}

/** Pure builder so the content can be tested without a transport. */
export function buildNewsletterWelcomeMail(unsubscribeUrl: string, appUrl = APP_URL): WelcomeMail {
  const subject = 'Welcome to the Colabonate community'
  const community =
    `You are now part of the Colabonate community. We will keep you posted on Colabonate's ` +
    `development and on the wider Nostr and open-markets movement — trading, cooperating and ` +
    `building trust without a middleman.`
  const accompany =
    `You can accompany us on this path and support it, and we are delighted that you do.`
  const expect =
    `What to expect: occasional updates on new features, community news, and notes on Nostr and ` +
    `open markets. No spam, and never more than we think is worth your time.`

  const text =
    `Welcome to the Colabonate community\n` +
    `===================================\n\n` +
    `${community}\n\n${accompany}\n\n${expect}\n\n` +
    `Visit Colabonate: ${appUrl}\n\n` +
    `---\n` +
    `You receive this because you subscribed to the Colabonate newsletter. ` +
    `Unsubscribe at any time: ${unsubscribeUrl}\n`

  const safeUnsubscribe = escapeHtml(unsubscribeUrl)
  const contentHtml = `
    <h1 style="margin:0 0 8px;font-size:20px;color:${EMAIL.ink}">Welcome to the community</h1>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${EMAIL.body}">${community}</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${EMAIL.body}">${accompany}</p>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:${EMAIL.body}">${expect}</p>
    ${emailButton('Visit Colabonate', escapeHtml(appUrl))}
    <p style="margin:24px 0 0;font-size:11px;line-height:1.5;color:${EMAIL.subtle}">
      You receive this because you subscribed to the Colabonate newsletter.
      <a href="${safeUnsubscribe}" style="color:${EMAIL.subtle};text-decoration:underline">Unsubscribe</a> at any time.
    </p>`

  return { subject, text, html: emailShell(emailWordmark(), contentHtml) }
}

/**
 * Fire-and-forget: never blocks or fails the confirming request. The token is a
 * capability link, so neither it nor the URL is ever logged.
 */
export function sendNewsletterWelcome(email: string, token: string): void {
  const unsubscribeUrl = `${BASE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(token)}`
  const mail = buildNewsletterWelcomeMail(unsubscribeUrl)
  sendTransactionalEmail({ to: email, ...mail }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg !== 'NO_EMAIL_TRANSPORT') console.warn('[Newsletter] welcome mail failed (non-fatal):', msg)
  })
}
