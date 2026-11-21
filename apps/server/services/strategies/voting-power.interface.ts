export interface IVotingPowerStrategy {
  readonly type: string
  calculate(params: {
    voterPubkey: string
    daoId: string
    snapshotTimestamp: number
    strategyParams: string
  }): Promise<number>
}

export interface VotingPowerResult {
  power: number
  strategy: string
  calculatedAt: number
}

export type AnyVotingPowerStrategy = IVotingPowerStrategy
