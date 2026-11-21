import type { PrismaClient } from '@prisma/client'
import type { IVotingPowerStrategy, VotingPowerResult } from './voting-power.interface.js'

export class ColPointsVotingStrategy implements IVotingPowerStrategy {
  readonly type = 'colpoints'

  constructor(private prisma: PrismaClient) {}

  async calculate(params: {
    voterPubkey: string
    daoId: string
    snapshotTimestamp: number
    strategyParams: string
  }): Promise<number> {
    const { voterPubkey, snapshotTimestamp } = params

    const snapshotDate = new Date(snapshotTimestamp * 1000)

    const user = await this.prisma.user.findUnique({
      where: { pubkey: voterPubkey },
      select: {
        colPoints: true,
        colPointsEvents: {
          where: {
            createdAt: { gt: snapshotDate },
          },
          select: { delta: true },
        },
      },
    })

    if (!user) {
      return 0
    }

    const pointsAfterSnapshot = user.colPointsEvents.reduce((sum, e) => sum + e.delta, 0)
    const basePoints = user.colPoints - pointsAfterSnapshot

    return Math.max(0, basePoints)
  }
}

export function createColPointsVotingStrategy(prisma: PrismaClient): IVotingPowerStrategy {
  return new ColPointsVotingStrategy(prisma)
}
