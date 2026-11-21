/**
 * buildNotification — user-supplied text (proposal titles, arbitrator
 * reasoning, listing titles) must be escaped in the HTML part; the plain-text
 * part keeps the original characters.
 */

import { describe, it, expect } from 'vitest'
import { buildNotification } from './email-notifier'

const payload = '<a href="https://evil.example">Click</a> & "x"'

describe('buildNotification HTML escaping', () => {
  it('escapes a proposal title sent to other members', () => {
    const mail = buildNotification(
      { type: 'proposal_comment_period', proposalId: 'p1', daoId: 'd1', title: payload },
      'member@example.com',
    )
    expect(mail.html).not.toContain('<a href="https://evil.example">')
    expect(mail.html).toContain('&lt;a href=&quot;https://evil.example&quot;&gt;Click&lt;/a&gt; &amp; &quot;x&quot;')
    expect(mail.subject).toContain(payload) // plain text: no escaping
  })

  it('escapes the arbitrator reasoning', () => {
    const mail = buildNotification(
      { type: 'verdict_issued', disputeId: 'x', ticketId: 't', ticketShortId: 'T1', outcome: 'RELEASE', reasoning: payload },
      'party@example.com',
    )
    expect(mail.html).not.toContain('<a href="https://evil.example">')
    expect(mail.html).toContain('&lt;a href=')
  })

  it('escapes the listing title in the unpublished-listing mail', () => {
    const mail = buildNotification(
      { type: 'offer_unpublished_no_payment_rail', offerId: 'o1', offerTitle: payload },
      'seller@example.com',
    )
    expect(mail.html).not.toContain('<a href="https://evil.example">')
  })
})
