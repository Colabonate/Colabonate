import type { PrismaClient } from '@prisma/client'
import type { IVotingPowerStrategy } from './voting-power.interface.js'

interface IdentityWeights {
  L0: number
  L1: number
  L2: number
  L3: number
}

const DEFAULT_WEIGHTS: IdentityWeights = {
  L0: 1,
  L1: 2,
  L2: 3,
  L3: 5,
}

export class IdentityWeightedStrategy implements IVotingPowerStrategy {
  readonly type = 'identity_weighted'

  private weights: IdentityWeights

  constructor(
    private prisma: PrismaClient,
    strategyParams: string = '{}',
  ) {
    try {
      const parsed = JSON.parse(strategyParams)
      this.weights = {
        L0: parsed.L0 ?? DEFAULT_WEIGHTS.L0,
        L1: parsed.L1 ?? DEFAULT_WEIGHTS.L1,
        L2: parsed.L2 ?? DEFAULT_WEIGHTS.L2,
        L3: parsed.L3 ?? DEFAULT_WEIGHTS.L3,
      }
    } catch {
      this.weights = DEFAULT_WEIGHTS
    }
  }

  async calculate(params: {
    voterPubkey: string
    daoId: string
    snapshotTimestamp: number
    strategyParams: string
  }): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { pubkey: params.voterPubkey },
      select: { identityLevel: true },
    })

    if (!user) return 0

    switch (user.identityLevel) {
      case 0: return this.weights.L0
      case 1: return this.weights.L1
      case 2: return this.weights.L2
      case 3: return this.weights.L3
      default: return this.weights.L0
    }
  }
}

export function createIdentityWeightedStrategy(
  prisma: PrismaClient,
  strategyParams?: string,
): IVotingPowerStrategy {
  return new IdentityWeightedStrategy(prisma, strategyParams)
}
