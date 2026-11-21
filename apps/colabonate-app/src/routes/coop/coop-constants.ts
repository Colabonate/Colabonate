// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
// Shared constants for Cooperation Templates

export const TYPE_COLORS: Record<string, { bar: string; bg: string; text: string }> = {
  transactional: { bar: '#6366F1', bg: 'rgba(99,102,241,0.18)', text: '#818CF8' },
  production:    { bar: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.18)', text: 'var(--color-status-success)' },
  sales:         { bar: '#F59E0B', bg: 'rgba(245,158,11,0.18)', text: '#FBBF24' },
  service:       { bar: 'var(--color-primary-50)', bg: 'rgba(99,179,237,0.18)', text: 'var(--color-primary-50)' },
  educational:   { bar: '#8B5CF6', bg: 'rgba(139,92,246,0.18)', text: '#A78BFA' },
  crowdfunding:  { bar: 'var(--color-accent-primary)', bg: 'rgba(59,130,246,0.18)', text: 'var(--color-accent-primary)' },
  barter:        { bar: 'var(--color-neutral-5)', bg: 'rgba(113,128,150,0.16)', text: 'var(--color-neutral-5)' },
  tender:        { bar: '#14B8A6', bg: 'rgba(20,184,166,0.18)', text: '#2DD4BF' },
}

export const TIMELINE_LABELS: Record<string, string> = {
  '2weeks': '2 weeks',
  '1month': '1 month',
  '3months': '3 months',
  ongoing: 'Ongoing',
}

export const COOPERATION_TYPES = [
  'transactional',
  'production',
  'sales',
  'service',
  'educational',
  'crowdfunding',
  'barter',
  'tender',
] as const

export const TIMELINE_PRESETS = ['2weeks', '1month', '3months', 'ongoing'] as const

export const MAX_TEMPLATE_IMAGES = 4

export type CooperationType = typeof COOPERATION_TYPES[number]
export type TimelinePreset = typeof TIMELINE_PRESETS[number]

// ─── Cooperation type explanations ───────────────────────────────────────────
// Human-readable descriptions of what each cooperation type means. Used by the
// template detail view to describe everything the chosen template implies.
export interface CooperationTypeInfo {
  subtitle: string
  description: string
  bullets: string[]
}

export const COOPERATION_TYPE_INFO: Record<string, CooperationTypeInfo> = {
  transactional: {
    subtitle: 'Short-term, one-off',
    description: 'Short-term, focused tasks like freelance work or one-time service exchanges.',
    bullets: [
      'One-time project with clear scope and deadline',
      'Direct payment on delivery — no long-term commitment',
      'Ideal for freelance tasks and short consulting engagements',
    ],
  },
  production: {
    subtitle: 'Joint creation',
    description: 'Joint manufacturing or creation of goods and digital products.',
    bullets: [
      'Joint creation of physical or digital goods',
      'Shared manufacturing resources, IP and responsibilities',
      'Split costs and revenue proportionally by contribution',
    ],
  },
  sales: {
    subtitle: 'Joint distribution',
    description: 'Joint distribution, cross-promotion and co-selling arrangements.',
    bullets: [
      'Co-sell or cross-promote products to new audiences',
      'Revenue sharing without exclusivity agreements',
      'Reach wider markets with trusted distribution partners',
    ],
  },
  service: {
    subtitle: 'Bundled services',
    description: 'Bundled service offerings between partners — combined expertise, single client.',
    bullets: [
      'Bundle complementary expertise into one combined offering',
      'One client relationship, multiple specialized partners',
      'Defined service scope with milestone-based payments',
    ],
  },
  educational: {
    subtitle: 'Knowledge sharing',
    description: 'Knowledge sharing, workshops, courses and community learning.',
    bullets: [
      'Share knowledge through workshops, courses or mentoring',
      'Build community reputation without monetary transactions',
      'Ideal for guilds, associations and learning networks',
    ],
  },
  crowdfunding: {
    subtitle: 'Collective financing',
    description: 'Collective financing for projects, initiatives and community goals.',
    bullets: [
      'Pool contributions from many backers around a shared goal',
      'Transparent milestone-based fund release protects backers',
      'Ideal for community, civic and open-source initiatives',
    ],
  },
  barter: {
    subtitle: 'Skill exchange',
    description: 'Skill exchange without monetary transactions — value for value.',
    bullets: [
      'Exchange skills or resources without money changing hands',
      'Value-for-value — both sides define their contribution',
      'Ideal for trusted peer relationships in close networks',
    ],
  },
  tender: {
    subtitle: 'Open call for proposals',
    description: 'Publish an open call for proposals — any partner can apply before the deadline.',
    bullets: [
      'Open call — any verified partner can apply before deadline',
      'Review proposals and select the best fit per milestone',
      'Pay the selected partner directly, milestone by milestone',
    ],
  },
}

export function getCooperationTypeInfo(type?: string | null): CooperationTypeInfo | null {
  if (!type) return null
  return COOPERATION_TYPE_INFO[type.toLowerCase()] ?? null
}