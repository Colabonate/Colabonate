import type { PrismaClient } from '@prisma/client'

export async function debitDemoWallet(
  prisma: PrismaClient,
  pubkey: string,
  amountSats: number
): Promise<number> {
  const user = await prisma.user.findUnique({ where: { pubkey } })
  if (!user) throw new Error(`User not found: ${pubkey}`)
  const wallet = await prisma.wallet.findUnique({ where: { userId_provider: { userId: user.id, provider: 'DEMO' } } })
  if (!wallet) throw new Error('No demo wallet for user')
  if (wallet.balanceSats < amountSats) {
    throw new Error('Demo balance exhausted — ask admin for top-up (/api/beta/demo-topup)')
  }
  const updated = await prisma.wallet.update({
    where: { id: wallet.id },
    data: { balanceSats: { decrement: amountSats } },
  })
  return updated.balanceSats
}

export async function creditDemoWallet(
  prisma: PrismaClient,
  pubkey: string,
  amountSats: number
): Promise<number> {
  const user = await prisma.user.findUnique({ where: { pubkey } })
  if (!user) throw new Error(`User not found: ${pubkey}`)
  const wallet = await prisma.wallet.findUnique({ where: { userId_provider: { userId: user.id, provider: 'DEMO' } } })
  if (!wallet) throw new Error('No demo wallet for user')
  const updated = await prisma.wallet.update({
    where: { id: wallet.id },
    data: { balanceSats: { increment: amountSats } },
  })
  return updated.balanceSats
}

export async function resetDemoBalance(
  prisma: PrismaClient,
  pubkey: string,
  startBalance: number
): Promise<number> {
  const user = await prisma.user.findUnique({ where: { pubkey } })
  if (!user) throw new Error(`User not found: ${pubkey}`)
  const wallet = await prisma.wallet.findUnique({ where: { userId_provider: { userId: user.id, provider: 'DEMO' } } })
  if (!wallet) throw new Error('No demo wallet for user')
  const updated = await prisma.wallet.update({
    where: { id: wallet.id },
    data: { balanceSats: startBalance },
  })
  return updated.balanceSats
}
