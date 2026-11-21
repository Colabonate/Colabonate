import { Router, type Request, type Response } from 'express'

export function createContactRouter() {
  const router = Router()

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { name, email, subject, message } = req.body as {
        name?: string
        email?: string
        subject?: string
        message?: string
      }

      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: 'Name is required (min 2 characters)' })
      }
      if (!email || !email.includes('@') || !email.includes('.')) {
        return res.status(400).json({ error: 'Valid email is required' })
      }
      if (!subject || subject.trim().length < 3) {
        return res.status(400).json({ error: 'Subject is required (min 3 characters)' })
      }
      if (!message || message.trim().length < 10) {
        return res.status(400).json({ error: 'Message is required (min 10 characters)' })
      }

      const contactEmail = process.env.COLABONATE_CONTACT_EMAIL || 'hello@colabonate.com'
      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a2e;">New Contact Form Submission</h2>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #666; width: 100px;"><strong>Name:</strong></td>
      <td style="padding: 8px 0;">${escapeHtml(name)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #666;"><strong>Email:</strong></td>
      <td style="padding: 8px 0;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #666;"><strong>Subject:</strong></td>
      <td style="padding: 8px 0;">${escapeHtml(subject)}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #666; vertical-align: top;"><strong>Message:</strong></td>
      <td style="padding: 8px 0; white-space: pre-wrap;">${escapeHtml(message)}</td>
    </tr>
  </table>
  <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
  <p style="color: #999; font-size: 12px;">Sent from colabonate.com/contact</p>
</body>
</html>`

      const text = `New Contact Form Submission\n\nName: ${name}\nEmail: ${email}\nSubject: ${subject}\nMessage: ${message}`

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
          to: contactEmail,
          replyTo: email,
          subject: `[Contact] ${subject}`,
          text,
          html,
        })
      } else {
        console.log('[Contact] SMTP not configured, skipping email send')
        console.log('[Contact] Would have sent to:', contactEmail)
        console.log('[Contact] Subject:', subject)
        console.log('[Contact] Message:', message)
      }

      res.json({ success: true })
    } catch (error) {
      console.error('[Contact] Submit error:', error)
      res.status(500).json({ error: 'Failed to send message' })
    }
  })

  return router
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
