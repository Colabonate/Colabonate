import { Resend } from 'resend'

export interface TransactionalEmail {
  to: string
  subject: string
  html: string
  text: string
}

/**
 * Send a single transactional email through the first configured transport:
 * Resend → generic SMTP. Throws `NO_EMAIL_TRANSPORT` when neither is set so
 * callers can decide how to surface that (never silently pretend it was sent).
 *
 * Shared so the Resend/SMTP fallback order and the from-address defaults live
 * in one place instead of drifting across routes.
 */
export async function sendTransactionalEmail({ to, subject, html, text }: TransactionalEmail): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'Colabonate Team <noreply@agantila.com>'
    const result = (await resend.emails.send({ from, to: [to], subject, html, text })) as {
      error?: { message?: string; name?: string; statusCode?: number | null }
    }
    if (result.error) {
      const e = result.error
      throw new Error(`Resend API ${e.statusCode ?? '???'} [${e.name ?? 'error'}]: ${e.message ?? 'unknown error'}`)
    }
    return
  }

  if (process.env.SMTP_HOST) {
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
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
