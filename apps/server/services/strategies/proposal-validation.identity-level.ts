import type { PrismaClient } from '@prisma/client'
import type { IProposalValidationStrategy } from './proposal-validation.interface.js'

interface IdentityLevelParams {
  minLevel: number
}

export class IdentityLevelValidation implements IProposalValidationStrategy {
  readonly type = 'identity_level'

  constructor(private prisma: PrismaClient) {}

  async validate(params: {
    authorPubkey: string
    entityType: 'cooperation' | 'proposal' | 'governance'
    strategyParams: string
  }): Promise<{ valid: boolean; reason?: string }> {
    const { authorPubkey } = params

    let minLevel = 1
    try {
      const parsed = JSON.parse(params.strategyParams) as IdentityLevelParams
      minLevel = parsed.minLevel ?? 1
    } catch {
      minLevel = 1
    }

    const user = await this.prisma.user.findUnique({
      where: { pubkey: authorPubkey },
      select: { identityLevel: true },
    })

    if (!user) {
      return { valid: false, reason: 'User not found' }
    }

    if (user.identityLevel < minLevel) {
      return {
        valid: false,
        reason: `Insufficient identity level: ${user.identityLevel} < ${minLevel}`,
      }
    }

    return { valid: true }
  }
}

export function createIdentityLevelValidation(prisma: PrismaClient): IProposalValidationStrategy {
  return new IdentityLevelValidation(prisma)
}
