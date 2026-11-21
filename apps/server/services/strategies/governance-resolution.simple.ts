import type { IGovernanceResolutionStrategy, ProposalStatus, GovernanceParams, VoteAggregate } from './governance-resolution.interface.js'

export class SimpleQuorumGovernance implements IGovernanceResolutionStrategy {
  readonly type = 'simple_quorum'

  getStatus(params: {
    votes: VoteAggregate
    params: GovernanceParams
    votingStart?: number
    votingEnd?: number
    currentTimestamp?: number
  }): ProposalStatus {
    const { votes, params: govParams, votingEnd, currentTimestamp } = params
    const { votesFor, votesAgainst, votesAbstain } = votes
    const { quorumThreshold } = govParams

    const now = currentTimestamp ?? Math.floor(Date.now() / 1000)
    const votingExpired = votingEnd !== undefined && now > votingEnd
    const total = votesFor + votesAgainst + votesAbstain

    if (total < quorumThreshold) {
      return votingExpired ? 'REJECTED' : 'ACTIVE'
    }

    if (votesFor > votesAgainst) {
      return 'PASSED'
    }

    return 'REJECTED'
  }
}

export function createSimpleQuorumGovernance(): IGovernanceResolutionStrategy {
  return new SimpleQuorumGovernance()
}
