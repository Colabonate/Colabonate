export interface IProposalValidationStrategy {
  readonly type: string
  validate(params: {
    authorPubkey: string
    entityType: 'cooperation' | 'proposal' | 'governance'
    strategyParams: string
  }): Promise<{ valid: boolean; reason?: string }>
}

export interface ValidationResult {
  valid: boolean
  reason?: string
  strategy: string
}

export type AnyProposalValidationStrategy = IProposalValidationStrategy
