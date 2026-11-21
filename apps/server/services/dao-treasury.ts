import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'

export interface TreasuryTransactionParams {
  treasuryId: string
  type: 'FUND' | 'RELEASE' | 'SPEND'
  amountSats: bigint
  toPubkey?: string
  proposalId?: string
}

export async function createTreasuryTransaction(
  prisma: PrismaClient,
  params: TreasuryTransactionParams
): Promise<{ transaction: Awaited<ReturnType<PrismaClient['treasuryTransaction']['create']>>, treasury: Awaited<ReturnType<PrismaClient['daoTreasury']['update']>> }> {
  const { treasuryId, type, amountSats, toPubkey, proposalId } = params

  const [transaction, treasury] = await prisma.$transaction([
    prisma.treasuryTransaction.create({
      data: {
        treasuryId,
        type,
        amountSats,
        toPubkey,
        proposalId,
        status: 'PENDING',
      },
    }),
    prisma.daoTreasury.update({
      where: { id: treasuryId },
      data: {
        balanceSats: {
          increment: type === 'FUND' ? amountSats : type === 'RELEASE' || type === 'SPEND' ? -amountSats : 0n,
        },
      },
    }),
  ])

  return { transaction, treasury }
}

export async function confirmTreasuryTransaction(
  prisma: PrismaClient,
  transactionId: string
): Promise<void> {
  await prisma.treasuryTransaction.update({
    where: { id: transactionId },
    data: { status: 'CONFIRMED' },
  })
}

export async function failTreasuryTransaction(
  prisma: PrismaClient,
  transactionId: string
): Promise<{ treasury: Awaited<ReturnType<PrismaClient['daoTreasury']['update']>> }> {
  const transaction = await prisma.treasuryTransaction.findUnique({
    where: { id: transactionId },
    include: { treasury: true },
  })

  if (!transaction) {
    throw new Error('Transaction not found')
  }

  // Reverse the balance change: FUND added, RELEASE/SPEND subtracted — undo both on failure
  const balanceReversal =
    transaction.type === 'FUND' ? -transaction.amountSats : transaction.amountSats

  const [, treasury] = await prisma.$transaction([
    prisma.treasuryTransaction.update({
      where: { id: transactionId },
      data: { status: 'FAILED' },
    }),
    prisma.daoTreasury.update({
      where: { id: transaction.treasuryId },
      data: { balanceSats: { increment: balanceReversal } },
    }),
  ])

  return { treasury }
}

export interface DaoTreasuryService {
  getOrCreateTreasury(daoId: string): Promise<{
    id: string
    daoId: string
    balanceSats: bigint
    escrowAccountId: string | null
    multisigPubkey: string | null
  }>
  fundTreasury(params: {
    daoId: string
    amountSats: bigint
    proposalId?: string
  }): Promise<{
    transactionId: string
    balanceSats: bigint
  }>
  releaseFromTreasury(params: {
    daoId: string
    amountSats: bigint
    toPubkey: string
    proposalId?: string
  }): Promise<{
    transactionId: string
    balanceSats: bigint
  }>
}

export function createDaoTreasuryService(
  prisma: PrismaClient,
  _payments: PaymentProvider
): DaoTreasuryService {
  return {
    async getOrCreateTreasury(daoId) {
      let treasury = await prisma.daoTreasury.findUnique({ where: { daoId } })
      if (!treasury) {
        treasury = await prisma.daoTreasury.create({ data: { daoId } })
      }
      return treasury
    },

    async fundTreasury({ daoId, amountSats, proposalId }) {
      const treasury = await this.getOrCreateTreasury(daoId)
      const { transaction } = await createTreasuryTransaction(prisma, {
        treasuryId: treasury.id,
        type: 'FUND',
        amountSats,
        proposalId,
      })
      await confirmTreasuryTransaction(prisma, transaction.id)
      const updated = await prisma.daoTreasury.findUnique({ where: { id: treasury.id } })
      return { transactionId: transaction.id, balanceSats: updated!.balanceSats }
    },

    async releaseFromTreasury({ daoId, amountSats, toPubkey, proposalId }) {
      const treasury = await this.getOrCreateTreasury(daoId)
      if (treasury.balanceSats < amountSats) {
        throw new Error('Insufficient treasury balance')
      }
      const { transaction } = await createTreasuryTransaction(prisma, {
        treasuryId: treasury.id,
        type: 'RELEASE',
        amountSats,
        toPubkey,
        proposalId,
      })
      await confirmTreasuryTransaction(prisma, transaction.id)
      const updated = await prisma.daoTreasury.findUnique({ where: { id: treasury.id } })
      return { transactionId: transaction.id, balanceSats: updated!.balanceSats }
    },
  }
}
