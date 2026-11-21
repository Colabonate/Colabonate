/**
 * ADR-401 FU-892 — welcome mail content: community narrative, a working
 * unsubscribe link in both parts, no beta/demo wording.
 */

import { describe, it, expect } from 'vitest'
import { buildNewsletterWelcomeMail } from './newsletter-welcome'

const unsubscribe = 'https://api.example.com/api/newsletter/unsubscribe?token=abc&x=1'

describe('buildNewsletterWelcomeMail', () => {
  const mail = buildNewsletterWelcomeMail(unsubscribe, 'https://colabonate.app')

  it('carries the community + open-markets narrative', () => {
    expect(mail.subject).toMatch(/Welcome/)
    expect(mail.text).toContain('open-markets movement')
    expect(mail.html).toContain('open-markets movement')
  })

  it('includes the unsubscribe link in text and (escaped) in HTML', () => {
    expect(mail.text).toContain(unsubscribe)
    expect(mail.html).toContain('unsubscribe?token=abc&amp;x=1')
  })

  it('links back to the app', () => {
    expect(mail.html).toContain('href="https://colabonate.app"')
  })

  it('has no beta or demo wording', () => {
    expect(`${mail.text} ${mail.html}`).not.toMatch(/\bbeta\b|\bdemo\b|regtest/i)
  })
})
