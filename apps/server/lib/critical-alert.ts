/**
 * ADR-252 D7 / FU-252-A — routes CRITICAL-level money-safety logs to a real
 * notification channel. ADR-250 accepted loud console CRITICAL logging as the
 * mitigation for the settle-then-DB-crash edge case on the explicit condition
 * that those logs "are routed to on-call alerting; don't treat them as noise"
 * — before this, nothing read them but a human tailing the container.
 *
 * Resend (already configured for magic-link email + admin feedback replies,
 * see routes/auth-email.ts / routes/admin.ts) is the lowest-friction channel
 * available today. Swap to Slack/PagerDuty later if the team wants richer
 * on-call routing — this is intentionally a single small function so that
 * swap touches one file.
 *
 * Fire-and-forget by design: alerting must never become another way for a
 * money-safety code path to throw or block. Failures are logged, not thrown.
 *
 * `dispatchCriticalAlert()` is the awaitable core (used by the admin test
 * endpoint, Gate G4 of the launch plan, so an operator can prove delivery on
 * a fresh production host without waiting for a real incident);
 * `logCritical()` is the fire-and-forget wrapper every money-safety path uses.
 */

import { Resend } from 'resend'

export interface CriticalAlertResult {
  /** RESEND_API_KEY + CRITICAL_ALERT_EMAIL both set. */
  configured: boolean
  /** Provider accepted the email. Always false when not configured. */
  sent: boolean
  /** Recipient (only when configured). */
  to?: string
  /** Provider error message (only when configured and delivery failed). */
  error?: string
}

// Injected in unit tests so no real Resend client is constructed.
export type CriticalAlertSender = (input: { from: string; to: string; subject: string; text: string; html: string }) => Promise<void>

const resendSender: CriticalAlertSender = async ({ from, to, subject, text, html }) => {
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({ from, to: [to], subject, text, html })
}

export function logCritical(source: string, message: string): void {
  // Always keep the existing console.error behavior — Loki/Promtail scraping
  // and any log-based tooling must keep working unchanged.
  console.error(`[${source}] CRITICAL: ${message}`)
  void dispatchCriticalAlert(source, message)
}

export async function dispatchCriticalAlert(
  source: string,
  message: string,
  send: CriticalAlertSender = resendSender,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CriticalAlertResult> {
  const apiKey = env.RESEND_API_KEY
  const to = env.CRITICAL_ALERT_EMAIL
  if (!apiKey || !to) {
    console.warn('[CriticalAlert] RESEND_API_KEY or CRITICAL_ALERT_EMAIL not set — CRITICAL log not routed to on-call')
    return { configured: false, sent: false }
  }
  try {
    const from = env.RESEND_FROM_EMAIL ?? 'Colabonate Team <noreply@agantila.com>'
    await send({
      from,
      to,
      subject: `[Colabonate CRITICAL] ${source}`,
      text: message,
      html: `<p><strong>${source}</strong></p><p>${message}</p>`,
    })
    return { configured: true, sent: true, to }
  } catch (err) {
    // Never let alert delivery itself throw into the caller's money-safety path.
    console.error('[CriticalAlert] failed to send on-call notification:', err)
    return { configured: true, sent: false, to, error: err instanceof Error ? err.message : String(err) }
  }
}
