import type { PrismaClient } from '@prisma/client'
import type { IProposalValidationStrategy } from './proposal-validation.interface.js'

interface ColPointsThresholdParams {
  minPoints: number
}

export class ColPointsThresholdValidation implements IProposalValidationStrategy {
  readonly type = 'colpoints_threshold'

  constructor(private prisma: PrismaClient) {}

  async validate(params: {
    authorPubkey: string
    entityType: 'cooperation' | 'proposal' | 'governance'
    strategyParams: string
  }): Promise<{ valid: boolean; reason?: string }> {
    const { authorPubkey } = params

    let threshold = 0
    try {
      const parsed = JSON.parse(params.strategyParams) as ColPointsThresholdParams
      threshold = parsed.minPoints ?? 0
    } catch {
      threshold = 0
    }

    const user = await this.prisma.user.findUnique({
      where: { pubkey: authorPubkey },
      select: { colPoints: true },
    })

    if (!user) {
      return { valid: false, reason: 'User not found' }
    }

    if (user.colPoints < threshold) {
      return {
        valid: false,
        reason: `Insufficient COL-Points: ${user.colPoints} < ${threshold}`,
      }
    }

    return { valid: true }
  }
}

export function createColPointsThresholdValidation(prisma: PrismaClient): IProposalValidationStrategy {
  return new ColPointsThresholdValidation(prisma)
}
