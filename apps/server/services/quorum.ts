import type { PrismaClient, QuorumType } from '@prisma/client'

const FOUNDATION_DAO_ID = 'colabonate-foundation'

export interface QuorumEvaluation {
  quorumMet: boolean
  verdictCount: number
  requiredCount: number
  majorityOutcome: 'RELEASE' | 'CANCEL' | null
  isTie: boolean
}

export async function evaluateQuorum(
  prisma: PrismaClient,
  disputeId: string,
): Promise<QuorumEvaluation> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { verdicts: true },
  })

  if (!dispute) {
    throw new Error('Dispute not found')
  }

  const daoConfig = await prisma.daoConfig.findUnique({
    where: { daoId: FOUNDATION_DAO_ID },
  })

  let quorumType = dispute.quorumTypeSnapshot ?? daoConfig?.quorumType ?? 'SINGLE'
  let thresholdN = dispute.thresholdNSnapshot ?? daoConfig?.thresholdN ?? 1

  if (dispute.status === 'APPEALED') {
    if (daoConfig?.appealQuorumType) {
      quorumType = daoConfig.appealQuorumType
      thresholdN = daoConfig.appealThresholdN ?? thresholdN
    }

    const round1VoterPubkeys = dispute.verdicts
      .filter(v => v.round === 1)
      .map(v => v.arbitratorPubkey)

    const activeArbitrators = await prisma.daoMember.count({
      where: {
        daoId: FOUNDATION_DAO_ID,
        status: 'ACTIVE',
        role: { in: ['ADMIN', 'ARBITRATOR'] },
        pubkey: { notIn: round1VoterPubkeys },
      },
    })

    let requiredCount = 1
    switch (quorumType) {
      case 'SINGLE':
        requiredCount = 1
        break
      case 'MAJORITY':
        requiredCount = Math.floor(activeArbitrators / 2) + 1
        break
      case 'THRESHOLD':
        requiredCount = Math.min(thresholdN, activeArbitrators)
        break
    }

    const releaseCount = dispute.verdicts.filter(v => v.outcome === 'RELEASE').length
    const cancelCount = dispute.verdicts.filter(v => v.outcome === 'CANCEL').length

    let majorityOutcome: 'RELEASE' | 'CANCEL' | null = null
    let isTie = false

    if (dispute.verdicts.length >= requiredCount) {
      if (releaseCount > cancelCount) {
        majorityOutcome = 'RELEASE'
      } else if (cancelCount > releaseCount) {
        majorityOutcome = 'CANCEL'
      } else {
        isTie = true
      }
    }

    return {
      quorumMet: dispute.verdicts.length >= requiredCount && !isTie,
      verdictCount: dispute.verdicts.length,
      requiredCount,
      majorityOutcome,
      isTie,
    }
  }

  const activeArbitrators = await prisma.daoMember.count({
    where: {
      daoId: FOUNDATION_DAO_ID,
      status: 'ACTIVE',
      role: { in: ['ADMIN', 'ARBITRATOR'] },
    },
  })

  const verdictCount = dispute.verdicts.length
  let requiredCount = 1

  switch (quorumType) {
    case 'SINGLE':
      requiredCount = 1
      break
    case 'MAJORITY':
      requiredCount = Math.floor(activeArbitrators / 2) + 1
      break
    case 'THRESHOLD':
      requiredCount = Math.min(thresholdN, activeArbitrators)
      break
  }

  const releaseCount = dispute.verdicts.filter(v => v.outcome === 'RELEASE').length
  const cancelCount = dispute.verdicts.filter(v => v.outcome === 'CANCEL').length

  let majorityOutcome: 'RELEASE' | 'CANCEL' | null = null
  let isTie = false

  if (verdictCount >= requiredCount) {
    if (releaseCount > cancelCount) {
      majorityOutcome = 'RELEASE'
    } else if (cancelCount > releaseCount) {
      majorityOutcome = 'CANCEL'
    } else {
      isTie = true
    }
  }

  return {
    quorumMet: verdictCount >= requiredCount && !isTie,
    verdictCount,
    requiredCount,
    majorityOutcome,
    isTie,
  }
}

export function requireQuorumMet(evaluation: QuorumEvaluation): void {
  if (!evaluation.quorumMet) {
    throw new Error(`Quorum not yet met: ${evaluation.verdictCount}/${evaluation.requiredCount}`)
  }
  if (evaluation.isTie) {
    throw new Error('Tie-breaker required: equal RELEASE/CANCEL votes')
  }
}