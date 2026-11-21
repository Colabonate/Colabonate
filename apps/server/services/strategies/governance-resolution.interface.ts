export type ProposalStatus = 'DRAFT' | 'ACTIVE' | 'PASSED' | 'REJECTED' | 'EXECUTED' | 'CANCELLED'

export interface GovernanceParams {
  quorumThreshold: number
  votingDelaySeconds?: number
}

export interface VoteAggregate {
  votesFor: number
  votesAgainst: number
  votesAbstain: number
}

export interface IGovernanceResolutionStrategy {
  readonly type: string
  getStatus(params: {
    votes: VoteAggregate
    params: GovernanceParams
    votingStart?: number
    votingEnd?: number
    currentTimestamp?: number
  }): ProposalStatus
}

export type AnyGovernanceResolutionStrategy = IGovernanceResolutionStrategy
