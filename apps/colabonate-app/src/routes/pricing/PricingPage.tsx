import { Link } from 'react-router-dom'
import { Tag } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { cn } from '@ds/utils'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { OnboardingStagger } from '../onboarding/components/OnboardingStagger'

const SLIDES = [
  {
    eyebrow: 'Community Edition',
    headline: 'Free for Everyone',
    description:
      'Use the marketplace, cooperate with partners, manage catalogs and settle payments — no platform fee, ever.',
    detail: 'No subscription. No commission. The protocol is free and open.',
    color: 'var(--color-accent-1)',
    iconBg: 'rgba(107,177,255,0.10)',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
  },
  {
    eyebrow: 'Bitcoin Lightning',
    headline: 'Lightning-Native Payments',
    description:
      'Send and receive Bitcoin Lightning payments instantly — peer to peer, no custodian, no bank.',
    detail: 'You only pay the Lightning network fee (typically < 1 sat). Colabonate takes nothing.',
    color: 'var(--color-primary-50)',
    iconBg: 'rgba(232,69,65,0.10)',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    eyebrow: 'DAO Governance',
    headline: 'Community Governed',
    description:
      'Protocol fees — if any — are set by the DAO, not by a company. One person, one vote.',
    detail: 'All governance decisions are Nostr-signed, public and immutable. No hidden fees.',
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
]

export function PricingPage() {
  return (
    <>
      <Seo
        title="Pricing"
        description="Colabonate pricing: no platform fees, no subscriptions, no hidden costs. Pay only the Bitcoin Lightning network fee — community-governed, open and free."
        path="/pricing"
      />
    <PageContainer>
      <PageHeader
        icon={<Tag size={20} />}
        title="Pricing"
        subtitle="No platform fees. No hidden costs. Just the network."
      />

      <OnboardingStagger className="flex flex-col gap-5">
        {SLIDES.map((slide) => (
          <div
            key={slide.eyebrow}
            className={cn(
              'rounded-2xl border border-[var(--theme-border)] p-6 sm:p-8',
              'bg-[var(--theme-surface)]',
            )}
          >
            {/* Icon */}
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
              style={{ background: slide.iconBg, color: slide.color }}
            >
              {slide.icon}
            </div>

            {/* Text */}
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-1.5"
              style={{ color: slide.color }}
            >
              {slide.eyebrow}
            </p>
            <h2 className="text-xl font-bold text-[var(--theme-text)] mb-3">
              {slide.headline}
            </h2>
            <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed mb-4">
              {slide.description}
            </p>

            {/* Detail badge */}
            <div
              className="inline-block rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: slide.iconBg, color: slide.color }}
            >
              {slide.detail}
            </div>
          </div>
        ))}
      </OnboardingStagger>

      {/* Standalone CTA */}
      <div className="mt-8 text-center">
        <Link
          to="/onboarding/welcome"
          className="inline-block px-7 py-3 rounded-xl font-semibold text-sm text-white"
          style={{ background: 'var(--color-primary-50)' }}
        >
          Join the Beta
        </Link>
        <p className="text-xs text-[var(--theme-text-muted)] mt-3">
          Free to join. No credit card required.
        </p>
      </div>
    </PageContainer>
    </>
  )
}
