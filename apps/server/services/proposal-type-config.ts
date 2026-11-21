import { createHash } from 'node:crypto'

export interface ProposalTypeGovernanceDefaults {
  votingPeriodSeconds: number
  quorumPercent: number
  majorityPercent: number
  hasCommentPeriod: boolean
  commentPeriodSeconds: number
}

export const CODEX_DEFAULTS: Record<string, ProposalTypeGovernanceDefaults> = {
  NORMAL_DECISION: {
    votingPeriodSeconds: 7 * 86400,
    quorumPercent: 10,
    majorityPercent: 50,
    hasCommentPeriod: false,
    commentPeriodSeconds: 0,
  },
  CODEX_AMENDMENT: {
    votingPeriodSeconds: 21 * 86400,
    quorumPercent: 20,
    majorityPercent: 67,
    hasCommentPeriod: true,
    commentPeriodSeconds: 14 * 86400,
  },
  TREASURY_SPENDING: {
    votingPeriodSeconds: 14 * 86400,
    quorumPercent: 15,
    majorityPercent: 50,
    hasCommentPeriod: false,
    commentPeriodSeconds: 0,
  },
  SANCTION: {
    votingPeriodSeconds: 7 * 86400,
    quorumPercent: 10,
    majorityPercent: 67,
    hasCommentPeriod: false,
    commentPeriodSeconds: 0,
  },
  PROTOCOL_UPGRADE: {
    votingPeriodSeconds: 30 * 86400,
    quorumPercent: 25,
    majorityPercent: 75,
    hasCommentPeriod: true,
    commentPeriodSeconds: 14 * 86400,
  },
  NEW_DAO_CREATION: {
    votingPeriodSeconds: 14 * 86400,
    quorumPercent: 20,
    majorityPercent: 67,
    hasCommentPeriod: false,
    commentPeriodSeconds: 0,
  },
}

const VALID_PROPOSAL_TYPES = ['NORMAL_DECISION', 'CODEX_AMENDMENT', 'TREASURY_SPENDING', 'SANCTION'] as const

export function isValidProposalType(type: string): boolean {
  return VALID_PROPOSAL_TYPES.includes(type as typeof VALID_PROPOSAL_TYPES[number])
}

export function isPhase4Type(type: string): boolean {
  return type === 'PROTOCOL_UPGRADE' || type === 'NEW_DAO_CREATION'
}

export function getEffectiveGovernance(
  proposalType: string,
  overrides?: { quorumPercent: number; majorityPercent: number; votingPeriodSeconds: number } | null
): ProposalTypeGovernanceDefaults {
  const defaults = CODEX_DEFAULTS[proposalType]
  if (!defaults) return CODEX_DEFAULTS.NORMAL_DECISION

  if (!overrides) return defaults

  return {
    votingPeriodSeconds: Math.max(overrides.votingPeriodSeconds, defaults.votingPeriodSeconds),
    quorumPercent: Math.max(overrides.quorumPercent, defaults.quorumPercent),
    majorityPercent: Math.max(overrides.majorityPercent, defaults.majorityPercent),
    hasCommentPeriod: defaults.hasCommentPeriod,
    commentPeriodSeconds: defaults.commentPeriodSeconds,
  }
}

export function validateExecutionPayload(
  proposalType: string,
  payload: unknown
): { valid: boolean; errors: string[] } {
  if (payload === null || payload === undefined) {
    payload = {}
  }

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return { valid: false, errors: ['executionPayload is not valid JSON'] }
    }
  }

  const p = payload as Record<string, unknown>
  const errors: string[] = []

  switch (proposalType) {
    case 'NORMAL_DECISION':
      break

    case 'CODEX_AMENDMENT': {
      if (!p.newCodexHash || typeof p.newCodexHash !== 'string' || !/^[0-9a-f]{64}$/.test(p.newCodexHash)) {
        errors.push('newCodexHash must be a 64-char hex string')
      }
      if (!p.newCodexVersion || typeof p.newCodexVersion !== 'string') {
        errors.push('newCodexVersion is required')
      }
      if (!p.codexUrl || typeof p.codexUrl !== 'string') {
        errors.push('codexUrl is required')
      }
      if (p.diffSummary && typeof p.diffSummary === 'string' && p.diffSummary.length > 500) {
        errors.push('diffSummary must be max 500 chars')
      }
      break
    }

    case 'TREASURY_SPENDING': {
      if (!p.recipientPubkey || typeof p.recipientPubkey !== 'string') {
        errors.push('recipientPubkey is required')
      }
      if (typeof p.amountSats !== 'number' || p.amountSats <= 0 || !Number.isInteger(p.amountSats)) {
        errors.push('amountSats must be a positive integer')
      }
      if (p.lightningInvoice && typeof p.lightningInvoice !== 'string') {
        errors.push('lightningInvoice must be a string')
      }
      if (!p.justification || typeof p.justification !== 'string') {
        errors.push('justification is required')
      } else if (p.justification.length > 1000) {
        errors.push('justification must be max 1000 chars')
      }
      break
    }

    case 'SANCTION': {
      if (!p.targetPubkey || typeof p.targetPubkey !== 'string') {
        errors.push('targetPubkey is required')
      }
      if (![1, 2, 3].includes(p.sanctionLevel as number)) {
        errors.push('sanctionLevel must be 1, 2, or 3')
      }
      if (!p.reason || typeof p.reason !== 'string') {
        errors.push('reason is required')
      } else if (p.reason.length > 1000) {
        errors.push('reason must be max 1000 chars')
      }
      if (p.durationDays !== null && p.durationDays !== undefined) {
        if (typeof p.durationDays !== 'number' || p.durationDays <= 0) {
          errors.push('durationDays must be a positive integer')
        }
      }
      break
    }

    default:
      break
  }

  return { valid: errors.length === 0, errors }
}

const REQUIRED_CODEX_SECTIONS = [
  'Purpose & Scope',
  'Membership Criteria',
  'Governance Rules',
  'Dispute Resolution Clause',
  'Sanction Levels',
  'Amendment Procedure',
  'Dissolution Clause',
]

export function validateCodexSections(content: string): {
  valid: boolean
  missingSections: string[]
  codexHash: string
} {
  const missingSections = REQUIRED_CODEX_SECTIONS.filter(
    section => !content.includes(section)
  )

  const hashHex = createHash('sha256').update(content, 'utf8').digest('hex')

  return {
    valid: missingSections.length === 0,
    missingSections,
    codexHash: hashHex,
  }
}
