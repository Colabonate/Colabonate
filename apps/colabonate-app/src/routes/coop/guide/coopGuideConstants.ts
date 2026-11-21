// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
// Cooperation Guide step definitions and types (ADR-033)
// 3-step unified FormStepper: Guide -> Model & Category -> Details (ADR-365 D2)

import {
  Building2, User, FolderKanban, Handshake, Network,
  Plus, Search, Settings, Megaphone, Users, Bot, Eye, Zap,
  type LucideIcon,
} from 'lucide-react'

// ─── Type Definitions ────────────────────────────────────────────────────────

export type CoopRole = 'corporate' | 'private'
export type CoopType = 'projects' | 'tenders' | 'network'
export type CoopAction = 'create' | 'find' | 'manage'

export type CooperationType =
  | 'TRANSACTIONAL'
  | 'PRODUCTION'
  | 'SALES'
  | 'SERVICE'
  | 'EDUCATIONAL'
  | 'CROWDFUNDING'
  | 'BARTER'
  | 'TENDER'

export interface StepOption<T extends string = string> {
  id: T
  label: string
  subtitle: string
  description: string
  bullets: readonly string[]
  icon: LucideIcon
  color: string
  bg: string
}

// ─── Step 1: Role Options ─────────────────────────────────────────────────────

export const ROLE_OPTIONS: StepOption<CoopRole>[] = [
  {
    id: 'corporate',
    label: 'Corporate',
    subtitle: 'Company or organization',
    description: 'Cooperate with your verified business profile. Partners see your company identity, catalog, and reputation score.',
    bullets: [
      'B2B cooperation backed by your company profile',
      'Verifiable reputation builds competitive advantage',
      'Access to global markets without platform lock-in',
    ],
    icon: Building2,
    color: 'var(--color-primary-50)',
    bg: 'rgba(232,69,65,0.10)',
  },
  {
    id: 'private',
    label: 'Private',
    subtitle: 'Individual · no company required',
    description: 'Cooperate under your personal Nostr identity. No company profile needed — your reputation is all you need.',
    bullets: [
      'Skill exchange, barter & neighborhood cooperation',
      'Peer-to-peer without intermediaries or fees',
      'Sovereign control over your interactions',
    ],
    icon: User,
    color: 'var(--coop-guide-neutral-color)',
    bg: 'var(--coop-guide-neutral-bg)',
  },
]

// ─── Step 2: Type Options ─────────────────────────────────────────────────────

export const TYPE_OPTIONS: StepOption<CoopType>[] = [
  {
    id: 'projects',
    label: 'Projects',
    subtitle: 'Milestone-based delivery',
    description: 'Define a joint project with clear deliverables, timeline, and phased Lightning payments made directly to your partner.',
    bullets: [
      'Milestone payments released on confirmation',
      'Define skills, timeline & partner roles upfront',
      'Smart contracts protect both sides automatically',
    ],
    icon: FolderKanban,
    color: 'var(--color-status-success)',
    bg: 'rgba(35,202,97,0.10)',
  },
  {
    id: 'tenders',
    label: 'Tenders',
    subtitle: 'Open call for proposals',
    description: 'Publish an open call for proposals. Partners apply on specific milestones — you choose the best fit.',
    bullets: [
      'Open call with deadline and requirements',
      'Partners apply per-milestone',
      'You choose the best fit for each deliverable',
    ],
    icon: Handshake,
    color: 'var(--color-primary-50)',
    bg: 'rgba(232,69,65,0.10)',
  },
  {
    id: 'network',
    label: 'Network',
    subtitle: 'Ongoing community',
    description: 'Build or join a professional network for long-term collaboration, resource sharing, and joint initiatives.',
    bullets: [
      'Open or closed membership with approval flow',
      'No fixed end date or payment milestones',
      'Ideal for associations, guilds & local initiatives',
    ],
    icon: Network,
    color: 'var(--color-warning-primary)',
    bg: 'rgba(245,124,42,0.10)',
  },
]

// ─── Step 3: Action Options ───────────────────────────────────────────────────

export const ACTION_OPTIONS: StepOption<CoopAction>[] = [
  {
    id: 'create',
    label: 'Create',
    subtitle: 'Publish something new',
    description: 'Start a project, offer, or network and let the right partners find you on the network.',
    bullets: [
      'Guided 3-step form with onboarding hints',
      'Published to the marketplace instantly',
      'Paid directly over Lightning — no platform holding your funds',
    ],
    icon: Plus,
    color: 'var(--color-status-success)',
    bg: 'rgba(35,202,97,0.10)',
  },
  {
    id: 'find',
    label: 'Find',
    subtitle: 'Discover opportunities',
    description: 'Browse existing cooperation opportunities from verified partners and respond directly.',
    bullets: [
      'Filter by category, type & cooperation model',
      'See reputation scores of all partners',
      'Respond directly to open listings',
    ],
    icon: Search,
    color: 'var(--color-primary-50)',
    bg: 'rgba(232,69,65,0.10)',
  },
  {
    id: 'manage',
    label: 'Manage',
    subtitle: 'Your active cooperations',
    description: 'View and manage your ongoing projects, offers, and networks in one place.',
    bullets: [
      'Track milestones, payments & confirmations',
      'Communicate with partners via Nostr chat',
      'Review and close completed cooperations',
    ],
    icon: Settings,
    color: 'var(--coop-guide-neutral-color)',
    bg: 'var(--coop-guide-neutral-bg)',
  },
]

// ─── Cooperation Types (from cooperation-protocol.md) ────────────────────────

export const COOPERATION_TYPES: StepOption<CooperationType>[] = [
  {
    id: 'TRANSACTIONAL',
    label: 'Transactional',
    subtitle: 'Short-term, one-off',
    description: 'Short-term, focused tasks like freelance work or one-time service exchanges.',
    bullets: [
      'One-time project with clear scope and deadline',
      'Direct payment on delivery — no long-term commitment',
      'Ideal for freelance tasks and short consulting engagements',
    ],
    icon: Handshake,
    color: 'var(--color-primary-50)',
    bg: 'rgba(232,69,65,0.10)',
  },
  {
    id: 'PRODUCTION',
    label: 'Production',
    subtitle: 'Joint creation',
    description: 'Joint manufacturing or creation of goods and digital products.',
    bullets: [
      'Joint creation of physical or digital goods',
      'Shared manufacturing resources, IP and responsibilities',
      'Split costs and revenue proportionally by contribution',
    ],
    icon: FolderKanban,
    color: 'var(--color-status-success)',
    bg: 'rgba(35,202,97,0.10)',
  },
  {
    id: 'SALES',
    label: 'Sales',
    subtitle: 'Joint distribution',
    description: 'Joint distribution, cross-promotion and co-selling arrangements.',
    bullets: [
      'Co-sell or cross-promote products to new audiences',
      'Revenue sharing without exclusivity agreements',
      'Reach wider markets with trusted distribution partners',
    ],
    icon: Building2,
    color: 'var(--color-secondary-50)',
    bg: 'rgba(61,76,83,0.10)',
  },
  {
    id: 'SERVICE',
    label: 'Service Bundle',
    subtitle: 'Bundled services',
    description: 'Bundled service offerings between partners — combined expertise, single client.',
    bullets: [
      'Bundle complementary expertise into one combined offering',
      'One client relationship, multiple specialized partners',
      'Defined service scope with milestone-based payments',
    ],
    icon: Settings,
    color: 'var(--color-info-primary)',
    bg: 'rgba(46,90,172,0.10)',
  },
  {
    id: 'EDUCATIONAL',
    label: 'Educational',
    subtitle: 'Knowledge sharing',
    description: 'Knowledge sharing, workshops, courses and community learning.',
    bullets: [
      'Share knowledge through workshops, courses or mentoring',
      'Build community reputation without monetary transactions',
      'Ideal for guilds, associations and learning networks',
    ],
    icon: User,
    color: 'var(--color-warning-primary)',
    bg: 'rgba(245,124,42,0.10)',
  },
  {
    id: 'CROWDFUNDING',
    label: 'Crowdfunding',
    subtitle: 'Collective financing',
    description: 'Collective financing for projects, initiatives and community goals.',
    bullets: [
      'Pool contributions from many backers around a shared goal',
      'Transparent milestone-based fund release protects backers',
      'Ideal for community, civic and open-source initiatives',
    ],
    icon: Network,
    color: 'var(--color-accent-primary)',
    bg: 'rgba(245,124,42,0.08)',
  },
  {
    id: 'BARTER',
    label: 'Barter',
    subtitle: 'Skill exchange',
    description: 'Skill exchange without monetary transactions — value for value.',
    bullets: [
      'Exchange skills or resources without money changing hands',
      'Value-for-value — both sides define their contribution',
      'Ideal for trusted peer relationships in close networks',
    ],
    icon: Handshake,
    color: 'var(--color-neutral-5)',
    bg: 'rgba(113,128,150,0.10)',
  },
  {
    id: 'TENDER',
    label: 'Tender',
    subtitle: 'Open call for proposals',
    description: 'Publish an open call for proposals — any partner can apply before the deadline.',
    bullets: [
      'Open call — any verified partner can apply before deadline',
      'Review proposals and select the best fit per milestone',
      'Pay the selected partner directly, milestone by milestone',
    ],
    icon: Megaphone,
    color: 'var(--color-primary-50)',
    bg: 'rgba(232,69,65,0.12)',
  },
]

// ─── Cooperation Types per Guide Type ────────────────────────────────────────

export const COOPERATION_TYPES_BY_COOP_TYPE: Record<CoopType, CooperationType[]> = {
  projects: ['TRANSACTIONAL', 'PRODUCTION', 'SALES', 'SERVICE'],
  tenders:  ['TENDER'],
  network:  ['EDUCATIONAL', 'CROWDFUNDING', 'BARTER'],
}

// FU-483 (ADR-328 D2/D4, scope call): Network+agent ("Agent Network") needs
// a real creation wizard (ADR-328 D3, FU-485/486/487 — server CRUD only,
// FU-484, is shipped) that's explicitly out of this round's scope. Rather
// than route into a dead end or build a throwaway wizard, the card shows
// accurate copy but stays disabled (see GuideStepContent's disabledIds).
// ADR-365 D6: tenders+agent is also relabeled — the agent flow routes to the
// Bounty Board (ADR-328 D2, renamed by ADR-336), so the card reads "Bounties"
// instead of "Tenders" regardless of the supervision choice.
export const AGENT_TYPE_COPY: Partial<Record<CoopType, { label: string; description: string }>> = {
  network: {
    label: 'Agent Network',
    description: 'Coming soon — form a standing team of agents that work together, discoverable and bookable as one unit.',
  },
  tenders: {
    label: 'Bounties',
    description: 'Post an open bounty for AI agents. Agents apply with a price and ETA — you choose the best fit and pay the winner directly.',
  },
}

// FU-483 (ADR-328 D2): "the same cards with agent-flavored copy" — only
// description/bullets change when executor==='agent'; the card component,
// id, icon and color stay identical (ModelStepContent picks the variant).
// Scoped to the 4 CooperationTypes Projects ever shows (see above).
export const AGENT_COOPERATION_TYPE_COPY: Partial<Record<CooperationType, { description: string; bullets: readonly string[] }>> = {
  TRANSACTIONAL: {
    description: 'A single agent completes a focused, one-off task against a clear deliverable.',
    bullets: [
      'One agent, one clear scope, one deadline',
      'Direct payment on delivery — no orchestration pipeline needed',
      'Ideal for a single well-defined task an agent can complete alone',
    ],
  },
  PRODUCTION: {
    description: 'PRODUCTION — your agent team builds this together, step by step.',
    bullets: [
      'Author a multi-step pipeline; each step names the capability it needs',
      'Matched agents are proposed per step — you review and confirm before publishing',
      'Milestone payments release as each step in the pipeline completes',
    ],
  },
  SALES: {
    description: 'Multiple agents jointly promote or distribute across their own channels.',
    bullets: [
      'Coordinate several agents around a shared distribution goal',
      'Each step can target a different capability (outreach, content, analysis)',
      'Revenue split via milestone payments, same as a human Sales cooperation',
    ],
  },
  SERVICE: {
    description: 'Bundle complementary agent capabilities into one combined service pipeline.',
    bullets: [
      'Chain specialized agents into a single deliverable for one client',
      'Each pipeline step is a distinct capability handoff',
      'Milestone-based payments track pipeline progress',
    ],
  },
}

// ─── Default Category Slugs per Cooperation Type ─────────────────────────────
// Pre-fills the merged Model & Category step with the most relevant standard category

export const COOPERATION_TYPE_DEFAULT_CATEGORY: Record<CooperationType, { category: string; subcategory: string }> = {
  TRANSACTIONAL: { category: 'services', subcategory: 'services/cooperation' },
  PRODUCTION:    { category: 'goods',    subcategory: '' },
  SALES:         { category: 'services', subcategory: 'services/cooperation' },
  SERVICE:       { category: 'services', subcategory: 'services/cooperation' },
  EDUCATIONAL:   { category: 'services', subcategory: 'services/education' },
  CROWDFUNDING:  { category: 'services', subcategory: 'services/cooperation' },
  BARTER:        { category: 'services', subcategory: 'services/cooperation' },
  TENDER:        { category: 'services', subcategory: 'services/cooperation' },
}

// ─── Unified FormStepper Step Definitions (ADR-330 D1) ──────────────────────

// FU-483 (ADR-328 D2): 'match-preview' — Projects+agent only, inserted after
// 'details' (where the orchestration-steps mini-editor authors the pipeline)
// and before the final Cooperation submit.
// ADR-365 D2: 'classification' was merged into 'model' (Model + Category
// Classification) — title/description moved to 'details' as Section 1.
export type CoopGuideStepId = 'guide' | 'model' | 'details' | 'match-preview' | 'result'

/** ADR-328 D1 forward-compat: the executor axis re-shapes flows later; the arg
 *  is accepted now so call sites don't churn again (plan rule O2/R1). */
export type CoopExecutor = 'human' | 'agent'

/** ADR-328 D1: coordination-layer "who oversees the work" property.
 *  Null when executor==='human' (the supervision axis collapses).
 *  At executor==='agent', distinguishes 'human' (per-step approval) from
 *  'autonomous' (agents self-coordinate) — composes with AgentProfile.humanInLoop
 *  (ADR-308, per-agent) and AgentNetwork.orchestrationMode (ADR-328 D3). */
export type CoopAgentSupervision = 'human' | 'autonomous'

export const GUIDE_STEP_META: Record<CoopGuideStepId, { label: string; description: string }> = {
  guide:          { label: 'Guide',          description: 'Role, Type & Action'      },
  model:          { label: 'Model & Category', description: 'Cooperation structure & category' },
  details:        { label: 'Details',        description: 'Title, schedule, terms & partner' },
  'match-preview': { label: 'Match Preview', description: 'Review matched agents'      },
  result:         { label: 'Result',         description: ''                          },
}

/** Dynamic step list per flow (ADR-330 D1): indices never appear in guide
 *  state — the visible steps are derived from (action, type, executor?).
 *  ADR-365 D2: 'classification' is gone — the 'model' step merged it in
 *  (Model + Category Classification), and title/description live on
 *  'details'. Tenders no longer skip 'model': they need the category half
 *  (ModelStepContent auto-selects the single TENDER card, so no dead dot).
 *  FU-483 (ADR-328 D2): Projects+agent+create gets an extra 'match-preview'
 *  step after 'details' — Tenders+agent hands off to the Bounty Board entirely
 *  (CoopGuide.tsx effect; renamed from "Task Board" by ADR-336) before any of
 *  these steps render, so it's excluded
 *  here even though this function can't see that redirect itself.
 *  Payment-structure parity (2026-08-22): a Projects+agent flow on
 *  SMART_ORDER runs the plain 3-phase path — no pipeline is authored, so
 *  'match-preview' drops out of the list exactly like the People flow.
 *  ADR-332 D2: an agent MILESTONE flow with NO authored steps (all-human
 *  milestones) also skips 'match-preview' — nothing to match.
 *  useCoopGuide's call sites omit ticketType/hasPipelineSteps (guide state
 *  has no form state) — the wider list is harmless there: goBack/breadcrumb
 *  guards only ever target steps present in both variants. */
export function getGuideSteps(
  action: CoopAction | null,
  type: CoopType | null,
  executor?: CoopExecutor,
  ticketType?: string,
  hasPipelineSteps?: boolean,
): CoopGuideStepId[] {
  if (!action || action === 'create') {
    if (type === 'projects' && executor === 'agent' && ticketType !== 'SMART_ORDER' && hasPipelineSteps !== false) {
      return ['guide', 'model', 'details', 'match-preview']
    }
    return ['guide', 'model', 'details']
  }
  return ['guide', 'result']
}

// ─── Model Step Labels ────────────────────────────────────────────────────────

export const MODEL_STEP_LABEL    = 'Which cooperation model fits best?'
export const MODEL_STEP_SUBTITLE = 'The model defines how value is exchanged between partners.'

// ─── ADR-328 D1: Executor + Supervision option sets ───────────────────────────

// "Who does the work?" — orthogonal to Role (whose identity). Selecting AI Agents
// reveals the Supervision control; selecting People keeps the entire downstream
// flow unchanged (today's behaviour — Type/Action/Model all stay the same).
export const EXECUTOR_OPTIONS: StepOption<CoopExecutor>[] = [
  {
    id: 'human',
    label: 'People',
    subtitle: 'Me, my company, or human partners',
    description: 'Work is done by humans — you, your team, or hired partners. Same flow as before, unchanged.',
    bullets: [
      'Default — no agent marketplace changes to the rest of the guide',
      'Hire, cooperate, and pay humans as you do today',
      'You can still assign individual milestones to an agent you own later',
    ],
    icon: Users,
    color: 'var(--coop-guide-neutral-color)',
    bg: 'var(--coop-guide-neutral-bg)',
  },
  {
    id: 'agent',
    label: 'AI Agents',
    subtitle: 'Mine, matched, or a team',
    description: 'Work is done by AI agents — yours, matched from the marketplace, or an Agent Network.',
    bullets: [
      'Routes Create/Find/Manage to the Agent Marketplace surfaces',
      'Picks a standing team for `Network` flows',
      'You can switch back to People anytime — it does not lock anything in',
    ],
    icon: Bot,
    // App-wide "Agent" purple identity — same values used for the Bot badge
    // on marketplace-cards.tsx / BuyProductDetail.tsx / ListingsTab.tsx.
    color: '#9F7AEA',
    bg: 'rgba(159,122,234,0.10)',
  },
]

// "Supervision" — only meaningful when executor==='agent'. Authority and
// accountability boundary (ADR-328 D1): even when "autonomous" the ownerPubkey
// stays liable (ADR-318). The disclosure copy here mirrors that explicitly so
// the platform's human-in-the-loop philosophy (ADR-308) is not silently
// undermined by the label.
export const SUPERVISION_OPTIONS: StepOption<CoopAgentSupervision>[] = [
  {
    id: 'human',
    label: "I'll stay in the loop",
    subtitle: 'Review and approve as it runs',
    description: 'You manually review and approve each milestone as it\'s delivered.',
    bullets: [
      'Maximum oversight — every milestone passes through you',
      'Recommended when the work is high-value or unfamiliar',
      // FU-588: no automated per-step gate exists yet (FU-452) — this bullet
      // states that honestly instead of implying a "waits for approval"
      // mechanism that isn't built.
      'Automated per-step approval gates are on our roadmap — for now this is your own manual review',
    ],
    icon: Eye,
    // '--color-info-primary' doesn't exist in the token set (var() to an
    // undefined custom property makes border-color fall back to its initial
    // value, currentColor — rendering white in dark theme). The tokenized
    // replacement ('--color-status-info', #2E5AAC) read as too muted/low-
    // contrast for an icon + chip — swapped for the brighter sky-blue
    // (#63B3ED) already used app-wide for "info/service" contexts
    // (marketplace-cards.tsx isService, CoopDetail.tsx), not itself a token
    // but the established convention for a legible blue here.
    color: '#63B3ED',
    bg: 'rgba(99,179,237,0.10)',
  },
  {
    id: 'autonomous',
    label: 'Let it run autonomously',
    subtitle: 'Agents self-coordinate (coming soon)',
    description: 'Once automated milestone hand-off ships, agents will self-coordinate between milestones without per-step approvals.',
    bullets: [
      // FU-588: automated agent-to-agent milestone hand-off doesn't exist yet
      // (FU-452 — no execution pipeline at all) — every milestone still needs
      // a manual push today regardless of this choice, so that's stated
      // up front instead of implying hands-off execution that isn't real.
      'Preview: automated hand-off between milestones is still in development — every milestone still needs your manual push today',
      'You — and only you — remain liable if a dispute opens',
      'You can switch back to per-step approval at any time',
    ],
    icon: Zap,
    // Same undefined-token bug as above — '--color-warning-primary' doesn't
    // exist. '--color-accent-2' is the real token for this exact orange
    // (matches the bg below).
    color: 'var(--color-accent-2)',
    bg: 'rgba(245,124,42,0.10)',
  },
]
