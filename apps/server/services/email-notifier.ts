import type { PrismaClient } from '@prisma/client'
import { FOUNDATION_DAO_ID } from '../middleware/require-admin.js'
import { escapeHtml } from './email-layout.js'

export type NotificationEvent =
  | { type: 'dispute_opened'; disputeId: string; ticketId: string; ticketShortId: string }
  | { type: 'dispute_escalated'; disputeId: string; ticketId: string; ticketShortId: string }
  | { type: 'verdict_issued'; disputeId: string; ticketId: string; ticketShortId: string; outcome: 'RELEASE' | 'CANCEL'; reasoning?: string | null }
  | { type: 'appeal_opened'; disputeId: string; ticketId: string; ticketShortId: string }
  | { type: 'verdict_finalized'; disputeId: string; ticketId: string; ticketShortId: string; outcome: 'RELEASE' | 'CANCEL' }
  | { type: 'proposal_voting_started'; proposalId: string; daoId: string; title: string }
  | { type: 'proposal_passed'; proposalId: string; daoId: string; title: string }
  | { type: 'proposal_rejected'; proposalId: string; daoId: string; title: string }
  | { type: 'proposal_comment_period'; proposalId: string; daoId: string; title: string }
  | { type: 'proposal_executed'; proposalId: string; daoId: string; title: string; codexHash?: string }
  | { type: 'offer_unpublished_no_payment_rail'; offerId: string; offerTitle: string }

export interface EmailPayload {
  to: string
  subject: string
  text: string
  html: string
}

const BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173'

export function buildNotification(event: NotificationEvent, to: string): EmailPayload {
  switch (event.type) {
    case 'dispute_opened': {
      const link = `${BASE_URL}/dao/${FOUNDATION_DAO_ID}/council/disputes/${event.disputeId}`
      const subject = `[Colabonate Council] New dispute — ticket ${event.ticketShortId}`
      const text =
        `A new dispute has been opened.\n\n` +
        `Dispute: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from the Colabonate Arbitration Council.`
      const html =
        `<p>A new dispute has been opened.</p>` +
        `<p><a href="${link}">Review dispute</a></p>` +
        `<hr/><p><small>Automated notification from the Colabonate Arbitration Council.</small></p>`
      return { to, subject, text, html }
    }
    case 'dispute_escalated': {
      const link = `${BASE_URL}/dao/${FOUNDATION_DAO_ID}/council/disputes/${event.disputeId}`
      const subject = `[Colabonate Council] Dispute escalated — ticket ${event.ticketShortId}`
      const text =
        `A dispute has been escalated to the Council.\n\n` +
        `Dispute: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from the Colabonate Arbitration Council.`
      const html =
        `<p>A dispute has been escalated to the Council.</p>` +
        `<p><a href="${link}">Review dispute</a></p>` +
        `<hr/><p><small>Automated notification from the Colabonate Arbitration Council.</small></p>`
      return { to, subject, text, html }
    }
    case 'verdict_issued': {
      const link = `${BASE_URL}/dao/${FOUNDATION_DAO_ID}/council/disputes/${event.disputeId}`
      const outcomeText = event.outcome === 'RELEASE' ? 'funds released to seller' : 'funds refunded to buyer'
      const reasoningText = event.reasoning ? `\n\nArbitrator's reasoning: ${event.reasoning}` : ''
      const reasoningHtml = event.reasoning ? `<p><em>Arbitrator's reasoning:</em> ${escapeHtml(event.reasoning)}</p>` : ''
      const subject = `[Colabonate Council] Verdict issued — ticket ${event.ticketShortId}`
      const text =
        `A verdict has been issued on your dispute: ${outcomeText}.${reasoningText}\n\n` +
        `Ticket: ${BASE_URL}/tickets/${event.ticketId}\n\n` +
        `---\n` +
        `This is an automated notification from the Colabonate Arbitration Council.`
      const html =
        `<p>A verdict has been issued on your dispute: <strong>${outcomeText}</strong>.</p>` +
        reasoningHtml +
        `<p><a href="${BASE_URL}/tickets/${event.ticketId}">View ticket</a> · <a href="${link}">View on Council</a></p>` +
        `<hr/><p><small>Automated notification from the Colabonate Arbitration Council.</small></p>`
      return { to, subject, text, html }
    }
    case 'appeal_opened': {
      const link = `${BASE_URL}/dao/${FOUNDATION_DAO_ID}/council/disputes/${event.disputeId}`
      const subject = `[Colabonate Council] Dispute appeal requested — ticket ${event.ticketShortId}`
      const text =
        `An appeal has been requested for your dispute.\n\n` +
        `Dispute: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from the Colabonate Arbitration Council.`
      const html =
        `<p>An appeal has been requested for your dispute.</p>` +
        `<p><a href="${link}">Review dispute</a></p>` +
        `<hr/><p><small>Automated notification from the Colabonate Arbitration Council.</small></p>`
      return { to, subject, text, html }
    }
    case 'verdict_finalized': {
      const link = `${BASE_URL}/tickets/${event.ticketId}`
      const outcomeText = event.outcome === 'RELEASE' ? 'funds released to seller' : 'funds refunded to buyer'
      const subject = `[Colabonate Council] Dispute #${event.ticketShortId} final — no appeal filed`
      const text =
        `Your dispute has been finalized with no appeal filed: ${outcomeText}.\n\n` +
        `Ticket: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from the Colabonate Arbitration Council.`
      const html =
        `<p>Your dispute has been finalized with no appeal filed: <strong>${outcomeText}</strong>.</p>` +
        `<p><a href="${link}">View ticket</a></p>` +
        `<hr/><p><small>Automated notification from the Colabonate Arbitration Council.</small></p>`
      return { to, subject, text, html }
    }
    case 'proposal_voting_started': {
      const link = `${BASE_URL}/dao/${event.daoId}/proposals/${event.proposalId}`
      const subject = `[Colabonate DAO] Voting started — "${event.title}"`
      const text =
        `Voting has started on your proposal.\n\n` +
        `Proposal: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from Colabonate DAO.`
      const html =
        `<p>Voting has started on your proposal: <strong>${escapeHtml(event.title)}</strong>.</p>` +
        `<p><a href="${link}">View proposal</a></p>` +
        `<hr/><p><small>Automated notification from Colabonate DAO.</small></p>`
      return { to, subject, text, html }
    }
    case 'proposal_passed': {
      const link = `${BASE_URL}/dao/${event.daoId}/proposals/${event.proposalId}`
      const subject = `[Colabonate DAO] Proposal passed — "${event.title}"`
      const text =
        `Your proposal has passed.\n\n` +
        `Proposal: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from Colabonate DAO.`
      const html =
        `<p>Your proposal has passed: <strong>${escapeHtml(event.title)}</strong>.</p>` +
        `<p><a href="${link}">View proposal</a></p>` +
        `<hr/><p><small>Automated notification from Colabonate DAO.</small></p>`
      return { to, subject, text, html }
    }
    case 'proposal_rejected': {
      const link = `${BASE_URL}/dao/${event.daoId}/proposals/${event.proposalId}`
      const subject = `[Colabonate DAO] Proposal rejected — "${event.title}"`
      const text =
        `Your proposal has been rejected.\n\n` +
        `Proposal: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from Colabonate DAO.`
      const html =
        `<p>Your proposal has been rejected: <strong>${escapeHtml(event.title)}</strong>.</p>` +
        `<p><a href="${link}">View proposal</a></p>` +
        `<hr/><p><small>Automated notification from Colabonate DAO.</small></p>`
      return { to, subject, text, html }
    }
    case 'proposal_comment_period': {
      const link = `${BASE_URL}/dao/${event.daoId}/proposals/${event.proposalId}`
      const subject = `[Colabonate DAO] Comment period open — "${event.title}"`
      const text =
        `A Codex amendment has been proposed. The 14-day comment period is now open.\n\n` +
        `Proposal: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from Colabonate DAO.`
      const html =
        `<p>A Codex amendment has been proposed: <strong>${escapeHtml(event.title)}</strong>. The 14-day comment period is now open.</p>` +
        `<p><a href="${link}">View and comment</a></p>` +
        `<hr/><p><small>Automated notification from Colabonate DAO.</small></p>`
      return { to, subject, text, html }
    }
    case 'proposal_executed': {
      const link = `${BASE_URL}/dao/${event.daoId}/proposals/${event.proposalId}`
      const hashNote = event.codexHash ? ` New hash: ${event.codexHash.slice(0, 16)}...` : ''
      const subject = `[Colabonate DAO] Proposal executed — "${event.title}"`
      const text =
        `A proposal has been executed.${hashNote}\n\n` +
        `Proposal: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from Colabonate DAO.`
      const html =
        `<p>A proposal has been executed: <strong>${escapeHtml(event.title)}</strong>.${hashNote}</p>` +
        `<p><a href="${link}">View proposal</a></p>` +
        `<hr/><p><small>Automated notification from Colabonate DAO.</small></p>`
      return { to, subject, text, html }
    }
    case 'offer_unpublished_no_payment_rail': {
      // ADR-255 D5: mainnet cutover audit — the listing was ACTIVE only
      // because its Beta demo wallet counted as "configured" (ADR-255 D1);
      // once BETA_MODE is off it doesn't, so it was downgraded to DRAFT
      // rather than left live for a real buyer to hit SELLER_UNCONFIGURED at
      // checkout.
      const link = `${BASE_URL}/offers/${event.offerId}`
      const subject = `[Colabonate] Your listing "${event.offerTitle}" was unpublished — no payment method`
      const text =
        `Your listing "${event.offerTitle}" was moved back to Draft during the switch to production, ` +
        `because it had no real Lightning address, NWC wallet, or Cashu receiving setup — only the ` +
        `Beta demo wallet, which no longer counts.\n\n` +
        `Add a Lightning address, NWC wallet, or Cashu receiving setup in Settings, then republish.\n\n` +
        `Listing: ${link}\n\n` +
        `---\n` +
        `This is an automated notification from Colabonate.`
      const html =
        `<p>Your listing <strong>${escapeHtml(event.offerTitle)}</strong> was moved back to Draft during the switch ` +
        `to production, because it had no real Lightning address, NWC wallet, or Cashu receiving setup — ` +
        `only the Beta demo wallet, which no longer counts.</p>` +
        `<p>Add a Lightning address, NWC wallet, or Cashu receiving setup in Settings, then republish.</p>` +
        `<p><a href="${link}">View listing</a></p>` +
        `<hr/><p><small>Automated notification from Colabonate.</small></p>`
      return { to, subject, text, html }
    }
  }
}

async function sendMail(payload: EmailPayload): Promise<void> {
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP_NOT_CONFIGURED')
  }
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
    ...payload,
  })
}

async function resolveEmail(prisma: PrismaClient, pubkey: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { pubkey }, select: { email: true } })
  return user?.email ?? null
}

function getEventRefId(event: NotificationEvent): string {
  switch (event.type) {
    case 'dispute_opened':
    case 'dispute_escalated':
    case 'verdict_issued':
    case 'appeal_opened':
    case 'verdict_finalized':
      return event.disputeId
    case 'proposal_voting_started':
    case 'proposal_passed':
    case 'proposal_rejected':
    case 'proposal_comment_period':
    case 'proposal_executed':
      return event.proposalId
    case 'offer_unpublished_no_payment_rail':
      return event.offerId
  }
}

async function recordLog(
  prisma: PrismaClient,
  event: NotificationEvent,
  recipient: string,
  status: string,
  errorMsg?: string,
): Promise<void> {
  try {
    await prisma.notificationLog.create({
      data: {
        eventType: event.type,
        recipient,
        refId: getEventRefId(event),
        status,
        errorMsg: errorMsg ?? null,
      },
    })
  } catch (err) {
    console.error('[EmailNotifier] Failed to write NotificationLog:', err)
  }
}

export async function notifyArbitrators(
  prisma: PrismaClient,
  daoId: string,
  event: NotificationEvent,
): Promise<void> {
  if (!process.env.SMTP_HOST) {
    console.warn('[EmailNotifier] SMTP not configured, skipping arbitrator notification')
    return
  }

  const members = await prisma.daoMember.findMany({
    where: { daoId, status: 'ACTIVE', role: { in: ['ADMIN', 'ARBITRATOR'] } },
  })

  for (const m of members) {
    const email = await resolveEmail(prisma, m.pubkey)
    if (!email) {
      await recordLog(prisma, event, m.pubkey, 'skipped_no_email')
      continue
    }
    try {
      await sendMail(buildNotification(event, email))
      await recordLog(prisma, event, email, 'sent')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await recordLog(
        prisma,
        event,
        email,
        msg === 'SMTP_NOT_CONFIGURED' ? 'skipped_no_smtp' : 'failed',
        msg,
      )
      console.warn(`[EmailNotifier] arbitrator notify failed for ${m.pubkey}: ${msg}`)
    }
  }
}

export async function notifyDisputants(
  prisma: PrismaClient,
  buyerPubkey: string,
  sellerPubkey: string,
  event: NotificationEvent,
): Promise<void> {
  if (!process.env.SMTP_HOST) {
    console.warn('[EmailNotifier] SMTP not configured, skipping disputant notification')
    return
  }

  for (const pubkey of [buyerPubkey, sellerPubkey]) {
    const email = await resolveEmail(prisma, pubkey)
    if (!email) {
      await recordLog(prisma, event, pubkey, 'skipped_no_email')
      continue
    }
    try {
      await sendMail(buildNotification(event, email))
      await recordLog(prisma, event, email, 'sent')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await recordLog(
        prisma,
        event,
        email,
        msg === 'SMTP_NOT_CONFIGURED' ? 'skipped_no_smtp' : 'failed',
        msg,
      )
      console.warn(`[EmailNotifier] disputant notify failed for ${pubkey}: ${msg}`)
    }
  }
}

// ADR-255 D5: single-recipient notify, for cutover-audit-style events that
// have exactly one addressee (unlike notifyArbitrators/notifyDisputants,
// which fan out to a DAO/dispute-party set). Same resolve→send→log shape.
export async function notifyUser(
  prisma: PrismaClient,
  pubkey: string,
  event: NotificationEvent,
): Promise<void> {
  if (!process.env.SMTP_HOST) {
    console.warn('[EmailNotifier] SMTP not configured, skipping user notification')
    return
  }

  const email = await resolveEmail(prisma, pubkey)
  if (!email) {
    await recordLog(prisma, event, pubkey, 'skipped_no_email')
    return
  }
  try {
    await sendMail(buildNotification(event, email))
    await recordLog(prisma, event, email, 'sent')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await recordLog(
      prisma,
      event,
      email,
      msg === 'SMTP_NOT_CONFIGURED' ? 'skipped_no_smtp' : 'failed',
      msg,
    )
    console.warn(`[EmailNotifier] user notify failed for ${pubkey}: ${msg}`)
  }
}
