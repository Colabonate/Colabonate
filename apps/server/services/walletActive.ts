import type { PrismaClient, Wallet } from '@prisma/client'

// ADR-228: a user can hold one Wallet row per provider (CUSTODIAL/LNBITS,
// NWC, ALBY_OAUTH, ... as peers). Exactly one row is the "active" wallet —
// the one payment actions and balance displays default to. The invariant
// (exactly one isActive=true per user) is enforced here, not in the DB
// schema (see Wallet.isActive comment in prisma/schema.prisma).

export async function getActiveWallet(prisma: PrismaClient, userId: string): Promise<Wallet | null> {
  const active = await prisma.wallet.findFirst({ where: { userId, isActive: true } })
  if (active) return active
  // Fallback if the invariant was ever violated (e.g. a wallet deleted
  // out-of-band) — most recently touched wallet, promoted to active.
  const fallback = await prisma.wallet.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } })
  if (fallback) {
    await prisma.wallet.update({ where: { id: fallback.id }, data: { isActive: true } })
  }
  return fallback
}

export async function setActiveWalletId(prisma: PrismaClient, userId: string, walletId: string): Promise<void> {
  await prisma.$transaction([
    prisma.wallet.updateMany({ where: { userId, NOT: { id: walletId } }, data: { isActive: false } }),
    prisma.wallet.update({ where: { id: walletId }, data: { isActive: true } }),
  ])
}

// Deactivate a wallet and promote a fallback (typically the CUSTODIAL wallet)
// to active in its place — used when a non-custodial connection is dropped.
export async function deactivateAndPromote(
  prisma: PrismaClient,
  userId: string,
  walletIdToDeactivate: string,
  promoteWalletId: string
): Promise<void> {
  await prisma.$transaction([
    prisma.wallet.update({ where: { id: walletIdToDeactivate }, data: { isActive: false } }),
    prisma.wallet.update({ where: { id: promoteWalletId }, data: { isActive: true } }),
  ])
}
