export type ProposalType = 'NORMAL_DECISION' | 'CODEX_AMENDMENT' | 'TREASURY_SPENDING' | 'SANCTION' | 'PROTOCOL_UPGRADE' | 'NEW_DAO_CREATION'

export type ProposalStatusType = 'DRAFT' | 'COMMENT_PERIOD' | 'ACTIVE' | 'PASSED' | 'REJECTED' | 'EXECUTED' | 'CANCELLED'

// ADR-200
export type DaoType = 'COMMUNITY' | 'PROTOCOL' | 'INVESTMENT' | 'SERVICE' | 'GRANT' | 'SOCIAL' | 'INDUSTRY' | 'COLLECTOR'
export type MembershipType = 'OPEN' | 'APPLICATION' | 'INVITE_ONLY' | 'TOKEN_GATED'

export const DAO_TYPE_META: Record<DaoType, { label: string; emoji: string; color: string }> = {
  COMMUNITY:  { label: 'Community',  emoji: '🏛',  color: 'var(--color-primary-50)' },
  PROTOCOL:   { label: 'Protocol',   emoji: '⚙️', color: '#9F7AEA' },
  INVESTMENT: { label: 'Investment', emoji: '💰',  color: '#ECC94B' },
  SERVICE:    { label: 'Service',    emoji: '🔧',  color: '#4FD1C5' },
  GRANT:      { label: 'Grant',      emoji: '🎁',  color: '#48BB78' },
  SOCIAL:     { label: 'Social',     emoji: '💚',  color: '#68D391' },
  INDUSTRY:   { label: 'Industry',   emoji: '🏭',  color: '#F6AD55' },
  COLLECTOR:  { label: 'Collector',  emoji: '🖼',  color: '#FC8181' },
}

export const MEMBERSHIP_TYPE_META: Record<MembershipType, { label: string; color: string; bg: string }> = {
  OPEN:        { label: 'Open',        color: 'var(--color-status-success)',  bg: 'rgba(72,187,120,0.12)' },
  APPLICATION: { label: 'Application', color: 'var(--color-warning-primary)', bg: 'rgba(255,192,57,0.12)' },
  INVITE_ONLY: { label: 'Invite Only', color: 'var(--color-status-error)',    bg: 'rgba(245,101,101,0.12)' },
  TOKEN_GATED: { label: 'Token Gated', color: '#9F7AEA',                      bg: 'rgba(159,122,234,0.12)' },
}

export const FOCUS_AREAS = [
  'Technologie', 'Umwelt', 'Kunst & Kultur', 'Bildung',
  'Gesundheit', 'Finanzen', 'Sport & Freizeit', 'Soziales',
  'Wissenschaft', 'Gewerbe', 'Musik', 'Politik',
] as const

export interface Dao {
  id: string
  name: string
  codexHash: string
  codexVersion: string
  codexUrl: string
  status: string
  _count: { proposals: number; members: number }
  governanceConfig: { quorumThreshold: number; votingStrategies: string } | null
  treasury: { balanceSats: string | number } | null
  // ADR-200: profile & location
  description?: string | null
  purpose?: string | null
  logoUrl?: string | null
  bannerUrl?: string | null
  website?: string | null
  foundedAt?: string | null
  daoType?: DaoType
  membershipType?: MembershipType
  focusAreas?: string | null
  language?: string | null
  country?: string | null
  region?: string | null
  city?: string | null
  isOnlineOnly?: boolean
  images?: string | null
}

export interface Proposal {
  id: string
  nostrEventId: string
  title: string
  content: string
  status: ProposalStatusType
  executionStrategy: string
  executionPayload: Record<string, unknown> | null
  proposalType: ProposalType
  votingStart: string | null
  votingEnd: string | null
  snapshotTimestamp: number | null
  commentPeriodEnd: string | null
  authorPubkey: string
  createdAt: string
  votes: ProposalVote[]
  comments?: ProposalComment[]
  dao?: {
    id: string
    name: string
    codexHash: string
    codexUrl: string
    codexVersion: string
    governanceConfig: {
      quorumThreshold: number
      votingStrategies: string
    } | null
  }
}

export interface ProposalVote {
  id: string
  voterPubkey: string
  choice: string
  votingPower: number
  strategyUsed: string
  createdAt: string
}

export interface ProposalComment {
  id: string
  authorPubkey: string
  nostrEventId: string
  content: string
  createdAt: string
}

export interface CodexDefaults {
  votingPeriodSeconds: number
  quorumPercent: number
  majorityPercent: number
  hasCommentPeriod: boolean
  commentPeriodSeconds: number
}

export const CODEX_DEFAULTS: Record<ProposalType, CodexDefaults> = {
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

export const PROPOSAL_TYPE_LABELS: Record<ProposalType, string> = {
  NORMAL_DECISION: 'Normal Decision',
  CODEX_AMENDMENT: 'Codex Amendment',
  TREASURY_SPENDING: 'Treasury Spending',
  SANCTION: 'Sanction / Ban',
  PROTOCOL_UPGRADE: 'Protocol Upgrade',
  NEW_DAO_CREATION: 'Recognize New DAO',
}

export const PHASE_4_TYPES: ProposalType[] = ['PROTOCOL_UPGRADE', 'NEW_DAO_CREATION']

export type { DaoMember } from '../council/council-types'
