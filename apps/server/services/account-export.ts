/**
 * ADR-252 D6 / FU-11 — GDPR Art. 15 (Right of Access) self-service data export.
 *
 * Read-only sibling of account-deletion.ts's Art. 17 cascade — reuses the same
 * "what data do we hold for this pubkey" entity model (User, Offer, Ticket,
 * Review, Cooperation, DmMessage, Company, Wallet, Session), but returns full
 * records instead of counts, and never mutates anything.
 *
 * Secrets are deliberately excluded even though they're "about" the user:
 * Wallet.nwcConnectionUriEnc (still spend-capable ciphertext) and
 * Session.token/k1 (live bearer credentials) — an Art. 15 export is not the
 * right channel to hand back a live secret, and the user already holds both
 * client-side.
 */

import type { PrismaClient } from '@prisma/client'

export async function exportUserData(prisma: PrismaClient, pubkey: string) {
  const user = await prisma.user.findUnique({ where: { pubkey } })
  if (!user) return null

  const [offers, tickets, reviewsWritten, reviewsReceived, cooperations, dmMessages, companies, wallets, sessions] =
    await Promise.all([
      prisma.offer.findMany({ where: { creatorPubkey: pubkey } }),
      prisma.ticket.findMany({ where: { OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }] } }),
      prisma.review.findMany({ where: { reviewerPubkey: pubkey } }),
      prisma.review.findMany({ where: { revieweePubkey: pubkey } }),
      prisma.cooperation.findMany({ where: { OR: [{ initiatorPubkey: pubkey }, { partnerPubkey: pubkey }] } }),
      prisma.dmMessage.findMany({ where: { ownerPubkey: pubkey } }),
      prisma.company.findMany({ where: { ownerPubkey: pubkey } }),
      prisma.wallet.findMany({
        where: { user: { pubkey } },
        select: {
          id: true, provider: true, mode: true, status: true, balanceSats: true, isActive: true,
          nwcWalletPubkey: true, nwcRelayUrls: true, nwcConnectedAt: true,
          cashuReceivePubkey: true, cashuReceiveMintUrl: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.session.findMany({
        where: { pubkey },
        select: { id: true, createdAt: true, expiresAt: true },
      }),
    ])

  return {
    exportedAt: new Date().toISOString(),
    gdprLegalBasis: 'Art. 15 DSGVO – Right of Access',
    user,
    offers,
    tickets,
    reviews: { written: reviewsWritten, received: reviewsReceived },
    cooperations,
    dmMessages,
    companies,
    wallets,
    sessions,
  }
}
