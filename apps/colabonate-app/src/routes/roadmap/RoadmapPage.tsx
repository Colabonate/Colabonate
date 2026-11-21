import { Link } from 'react-router-dom'
import { Map } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { cn } from '@ds/utils'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { OnboardingStagger } from '../onboarding/components/OnboardingStagger'

const PHASES = [
  {
    eyebrow: 'Phase 1 · Launched',
    headline: 'Foundation',
    description:
      'Buy and sell locally with a decentralized identity and Bitcoin Lightning payments — no bank, no custodian.',
    detail: 'Marketplace · Nostr Identity (HID) · BTC Lightning Wallet',
    color: 'var(--color-accent-3)',
    iconBg: 'rgba(42,232,102,0.10)',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="22" x2="21" y2="22" />
        <line x1="6" y1="18" x2="6" y2="11" />
        <line x1="10" y1="18" x2="10" y2="11" />
        <line x1="14" y1="18" x2="14" y2="11" />
        <line x1="18" y1="18" x2="18" y2="11" />
        <polygon points="12 2 20 7 4 7" />
      </svg>
    ),
  },
  {
    eyebrow: 'Phase 2 · Launched',
    headline: 'Cooperation',
    description:
      'Fair contracts, transparent milestones and escrow-protected payments. Cooperate with partners you can trust — enforced on-chain.',
    detail: 'Smart Contracts · Tickets & Milestones · Private Offers · Escrow',
    color: 'var(--color-accent-3)',
    iconBg: 'rgba(42,232,102,0.10)',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
  },
  {
    eyebrow: 'Phase 3 · In Progress',
    headline: 'Discovery',
    description:
      'Find the right partners, get AI assistance on your projects and connect with the community.',
    detail: 'Partner Discovery · AI Assistant · Media & Content · Chat',
    color: 'var(--color-accent-1)',
    iconBg: 'rgba(107,177,255,0.10)',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    eyebrow: 'Phase 4 · Planned',
    headline: 'Governance',
    description:
      'One person, one vote. Community proposals, Codex amendments and a council for dispute arbitration — all immutable on-chain.',
    detail: 'DAO Proposals · Codex Voting · Arbitration Council',
    color: 'var(--theme-text-muted)',
    iconBg: 'var(--theme-surface-secondary)',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
      </svg>
    ),
  },
  {
    eyebrow: 'Phase 5 · Future',
    headline: 'Scale',
    description:
      'From one city to many. Open integrations, reputation-weighted governance and a protocol that grows with the community.',
    detail: 'Multi-city Rollout · External Integrations · Reputation Voting',
    color: 'var(--theme-text-muted)',
    iconBg: 'var(--theme-surface-secondary)',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
]

export function RoadmapPage() {
  return (
    <>
      <Seo
        title="Roadmap"
        description="The Colabonate roadmap: marketplace and Lightning payments live, smart contracts and escrow shipped, discovery and AI next, DAO governance and scale planned."
        path="/roadmap"
      />
    <PageContainer>
      <PageHeader
        icon={<Map size={20} />}
        title="Roadmap"
        subtitle="Where we are, and where we're going."
      />

      <OnboardingStagger className="flex flex-col gap-5">
        {PHASES.map((phase) => (
          <div
            key={phase.eyebrow}
            className={cn(
              'rounded-2xl border border-[var(--theme-border)] p-6 sm:p-8',
              'bg-[var(--theme-surface)]',
            )}
          >
            {/* Icon */}
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
              style={{ background: phase.iconBg, color: phase.color }}
            >
              {phase.icon}
            </div>

            {/* Text */}
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-1.5"
              style={{ color: phase.color }}
            >
              {phase.eyebrow}
            </p>
            <h2 className="text-xl font-bold text-[var(--theme-text)] mb-3">
              {phase.headline}
            </h2>
            <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed mb-4">
              {phase.description}
            </p>

            {/* Deliverables badge */}
            <div
              className="inline-block rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: phase.iconBg, color: phase.color }}
            >
              {phase.detail}
            </div>
          </div>
        ))}
      </OnboardingStagger>

      <div className="mt-8 text-center">
        <Link
          to="/onboarding/welcome"
          className="inline-block px-7 py-3 rounded-xl font-semibold text-sm text-white"
          style={{ background: 'var(--color-primary-50)' }}
        >
          Join the Beta
        </Link>
        <p className="text-xs text-[var(--theme-text-muted)] mt-3">
          Phase 1 &amp; 2 are live — try it now.
        </p>
      </div>
    </PageContainer>
    </>
  )
}
