import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShoppingCart,
  Store,
  Handshake,
  Check,
  ChevronDown,
  Fingerprint,
  Wallet,
  Search,
  Star,
  Building2,
  LayoutGrid,
  FileCheck,
  Ticket,
  Workflow,
  Landmark,
} from 'lucide-react'
import { cn } from '@ds/utils'
import { OnboardingSectionPage } from './components/OnboardingSectionPage'
import { OnboardingFooter } from './components/OnboardingFooter'
import { OnboardingStagger } from './components/OnboardingStagger'
import { Seo } from '../../components/Seo'

// ── Types ──────────────────────────────────────────────────────────────

type FeatureId = 'buy' | 'sell' | 'coop'

interface MainCard {
  id: FeatureId
  icon: React.ReactNode
  title: string
  subtitle: string
  description: string
  color: string
  bg: string
  /** Resolved rgba color for icon backgrounds in feature grid */
  iconBg: string
  /** Resolved rgba color for icon text in feature grid */
  iconColor: string
}

interface FeatureCard {
  id: string
  icon: React.ReactNode
  title: string
  description: string
  /** Which main categories this feature belongs to */
  tags: FeatureId[]
}

// ── Main Selection Cards ───────────────────────────────────────────────

const MAIN_CARDS: MainCard[] = [
  {
    id: 'buy',
    icon: <ShoppingCart size={26} />,
    title: 'Buy',
    subtitle: 'Discover & shop',
    description:
      'Find products and services nearby and pay directly — no intermediaries.',
    color: 'var(--color-accent-1)',
    bg: 'rgba(107,177,255,0.08)',
    iconBg: 'rgba(107,177,255,0.12)',
    iconColor: 'rgba(107,177,255,0.85)',
  },
  {
    id: 'sell',
    icon: <Store size={26} />,
    title: 'Sell',
    subtitle: 'Offer & grow',
    description:
      'Showcase your offers, manage catalogs and build a verifiable reputation.',
    color: 'var(--color-primary-50)',
    bg: 'rgba(232,69,65,0.08)',
    iconBg: 'rgba(232,69,65,0.12)',
    iconColor: 'rgba(232,69,65,0.85)',
  },
  {
    id: 'coop',
    icon: <Handshake size={26} />,
    title: 'Cooperate',
    subtitle: 'Collaborate & scale',
    description:
      'Find partners, close fair contracts and realize joint projects — open source and decentralized.',
    color: 'var(--color-accent-3)',
    bg: 'rgba(42,232,102,0.08)',
    iconBg: 'rgba(42,232,102,0.12)',
    iconColor: 'rgba(42,232,102,0.85)',
  },
]

// ── Feature Detail Cards (deduplicated) ────────────────────────────────

const FEATURE_CARDS: FeatureCard[] = [
  {
    id: 'local-providers',
    icon: <Search size={18} />,
    title: 'Local Providers',
    description:
      'Browse categories and discover providers and offers in your area.',
    tags: ['buy'],
  },
  {
    id: 'reviews',
    icon: <Star size={18} />,
    title: 'Reviews & Trust',
    description:
      'Real reviews from verified buyers help you make informed decisions.',
    tags: ['buy'],
  },
  {
    id: 'business-profile',
    icon: <Building2 size={18} />,
    title: 'Business Profile',
    description:
      'Create your creator profile with opening hours, contact info and branding.',
    tags: ['sell'],
  },
  {
    id: 'catalogs',
    icon: <LayoutGrid size={18} />,
    title: 'Catalogs & Categories',
    description:
      'Organize your products and services into searchable, structured catalogs.',
    tags: ['sell'],
  },
  {
    id: 'find-partners',
    icon: <Handshake size={18} />,
    title: 'Find Partners',
    description:
      'Discover providers with complementary skills for joint ventures.',
    tags: ['coop'],
  },
  {
    id: 'hid',
    icon: <Fingerprint size={18} />,
    title: 'Human Identity (HID)',
    description:
      'Your unique, decentralized identity — no fake profiles, only real people. Verified through biometric proof and peer validation.',
    tags: ['buy', 'sell', 'coop'],
  },
  {
    id: 'wallet',
    icon: <Wallet size={18} />,
    title: 'BTC / Lightning Wallet',
    description:
      'Send and receive payments instantly via Bitcoin Lightning — user to user, no bank required. Built on a secure Bitcoin L2 infrastructure.',
    tags: ['buy', 'sell', 'coop'],
  },
  {
    id: 'smart-contracts',
    icon: <FileCheck size={18} />,
    title: 'Smart Contracts',
    description:
      'Trustless agreements with automated payments and conditional releases — enforced on-chain, no middleman.',
    tags: ['coop'],
  },
  {
    id: 'tickets',
    icon: <Ticket size={18} />,
    title: 'Tickets & Milestones',
    description:
      'Structure projects into transparent phases with AI-assisted monitoring and automated payouts per milestone.',
    tags: ['coop'],
  },
  {
    id: 'workflows',
    icon: <Workflow size={18} />,
    title: 'Workflows & Open Protocols',
    description:
      'Use standardized processes from the community or create your own — all open source and community-governed.',
    tags: ['coop'],
  },
  {
    id: 'dao',
    icon: <Landmark size={18} />,
    title: 'DAO & Community Governance',
    description:
      'Communities can form their own DAOs — one person, one vote. Governed by the Colabonate Codex, fully open source.',
    tags: ['coop'],
  },
]

// ── ADR-151 grouping ───────────────────────────────────────────────────
// Cross-cutting features (relevant to every area) live in a "Foundation"
// strip that is always rendered active. The remaining features are grouped
// into ≤3 category sections (Buy / Sell / Cooperate).

const FOUNDATION_IDS = ['hid', 'wallet']

/** Always-active neutral style for Foundation chips (selection-independent). */
const FOUNDATION_STYLE = {
  bg: 'var(--theme-surface)',
  color: 'var(--theme-text)',
} as const

const foundationCards = FEATURE_CARDS.filter((fc) => FOUNDATION_IDS.includes(fc.id))

const categorySections = MAIN_CARDS.map((card) => ({
  card,
  features: FEATURE_CARDS.filter(
    (fc) => !FOUNDATION_IDS.includes(fc.id) && fc.tags.includes(card.id),
  ),
}))

// ── Component ──────────────────────────────────────────────────────────

export function OnboardingFeatures() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<Set<FeatureId>>(new Set())
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null)

  /** Map of featureId → { bg, color } from active main cards */
  const featureStyleMap = useMemo(() => {
    if (selected.size === 0) return {}
    const map: Record<string, { bg: string; color: string }> = {}
    for (const fc of FEATURE_CARDS) {
      const active = fc.tags.filter((t) => selected.has(t))
      if (active.length > 0) {
        const first = MAIN_CARDS.find((m) => m.id === active[0])!
        map[fc.id] = { bg: first.iconBg, color: first.iconColor }
      }
    }
    return map
  }, [selected])

  /** Auto-select first matching feature when main cards change */
  useMemo(() => {
    if (selected.size > 0) {
      const firstMatch = FEATURE_CARDS.find((fc) =>
        fc.tags.some((t) => selected.has(t)),
      )
      if (firstMatch && !featureStyleMap[firstMatch.id]) {
        // No active features anymore (all deselected)
        setActiveFeatureId(null)
      } else if (firstMatch && (!activeFeatureId || !featureStyleMap[activeFeatureId])) {
        // Set to first match if current is no longer active
        setActiveFeatureId(firstMatch.id)
      }
    } else {
      setActiveFeatureId(null)
    }
  }, [selected, featureStyleMap]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFeature = useCallback((id: FeatureId) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleContinue = useCallback(() => {
    localStorage.setItem(
      'onboarding_features',
      JSON.stringify(Array.from(selected)),
    )
    navigate('/onboarding/creator')
  }, [selected, navigate])

  const handleSkip = useCallback(() => {
    navigate('/onboarding/creator')
  }, [navigate])

  return (
    <>
      <Seo noindex />
    <OnboardingSectionPage
      footer={
        <OnboardingFooter
          onBack={() => navigate('/onboarding/welcome')}
          onContinue={handleContinue}
          continueLabel={
            selected.size > 0
              ? `${selected.size} selected — Continue`
              : 'Continue without selection'
          }
          continueColor={
            selected.size > 0
              ? 'var(--color-primary-50)'
              : 'var(--theme-surface-secondary)'
          }
          continueTextColor={
            selected.size > 0 ? 'white' : 'var(--theme-text-muted)'
          }
          onSkip={handleSkip}
        />
      }
    >
      <div className="flex flex-col items-center px-4 py-4 sm:px-6">
        {/* Intro Text */}
        <div className="max-w-md mb-6 text-center">
          <span
            className="inline-block text-[11px] font-bold uppercase tracking-widest mb-3 px-3 py-1 rounded-full"
            style={{
              background: 'var(--theme-surface-secondary)',
              color: 'var(--theme-text-muted)',
            }}
          >
            Step 2 of 3
          </span>
          <h1
            className="text-[24px] sm:text-[28px] font-bold leading-tight mb-3"
            style={{ color: 'var(--theme-text)' }}
          >
            What would you like to{' '}
            <span style={{ color: 'var(--color-primary-50)' }}>use</span>?
          </h1>
          <p
            className="text-[15px] leading-relaxed"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            Choose one or more areas. The related features will be
            highlighted below.
          </p>
        </div>

        {/* ── Main Selection Cards ─────────────────────────────────── */}
        <div className="grid w-full max-w-2xl grid-cols-1 gap-3 mb-6 md:grid-cols-3">
          {MAIN_CARDS.map((card) => {
            const isSelected = selected.has(card.id)
            return (
              <button
                key={card.id}
                onClick={() => toggleFeature(card.id)}
                className={cn(
                  'relative flex flex-col items-center p-5 pt-8 pb-5 rounded-xl border text-center cursor-pointer transition-all duration-200 min-h-[200px]',
                  'hover:-translate-y-0.5 active:scale-[0.98]',
                  isSelected && 'shadow-lg',
                )}
                style={{
                  border: isSelected
                    ? `2px solid ${card.color}`
                    : '1px solid var(--theme-border)',
                  background: isSelected ? card.bg : 'var(--theme-surface)',
                }}
              >
                {/* Check Badge */}
                {isSelected && (
                  <div
                    className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: card.color, color: 'white' }}
                  >
                    <Check size={12} />
                  </div>
                )}

                {/* Icon — centered in first row */}
                <div
                  className="flex items-center justify-center mb-4 w-14 h-14 rounded-2xl"
                  style={{ background: card.bg, color: card.color }}
                >
                  {card.icon}
                </div>

                {/* Text */}
                <div className="flex flex-col items-center min-w-0">
                  <h3
                    className="text-[16px] font-semibold leading-tight"
                    style={{ color: 'var(--theme-text)' }}
                  >
                    {card.title}
                  </h3>
                  <p
                    className="text-[14px] font-medium"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    {card.subtitle}
                  </p>
                  <p
                    className="text-[12px] leading-snug mt-1.5"
                    style={{ color: 'var(--theme-text-muted)' }}
                  >
                    {card.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Foundation (cross-cutting, always active) ──────────── */}
        <div className="w-full max-w-2xl mb-6">
          <p
            className="text-[12px] font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            Included in every area
          </p>
          <div className="flex flex-col gap-2.5">
            {foundationCards.map((fc) => (
              <FeatureChip
                key={fc.id}
                fc={fc}
                styles={FOUNDATION_STYLE}
                isActive
                isExpanded={activeFeatureId === fc.id}
                onClick={() => setActiveFeatureId(fc.id)}
              />
            ))}
          </div>
        </div>

        {/* ── Category sections (Buy / Sell / Cooperate) ─────────── */}
        <OnboardingStagger className="w-full max-w-2xl space-y-6">
          {categorySections.map(({ card, features }) => (
            <div key={card.id}>
              {/* Title + subtitle (split for clarity) */}
              <div className="mb-3">
                <h3
                  className="text-[16px] font-bold leading-tight"
                  style={{ color: card.color }}
                >
                  {card.title}
                </h3>
                <p
                  className="text-[12px]"
                  style={{ color: 'var(--theme-text-muted)' }}
                >
                  {card.subtitle}
                </p>
              </div>
              <div className="flex flex-col gap-2.5">
                {features.map((fc) => (
                  <FeatureChip
                    key={fc.id}
                    fc={fc}
                    styles={featureStyleMap[fc.id]}
                    isActive={!!featureStyleMap[fc.id]}
                    isExpanded={activeFeatureId === fc.id}
                    onClick={() => setActiveFeatureId(fc.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </OnboardingStagger>
      </div>
    </OnboardingSectionPage>
    </>
  )
}

// ── Feature chip (shared by Foundation strip + category sections) ──────

interface FeatureChipProps {
  fc: FeatureCard
  /** Resolved { bg, color } when active, else undefined. */
  styles?: { bg: string; color: string }
  isActive: boolean
  isExpanded: boolean
  onClick: () => void
}

function FeatureChip({ fc, styles, isActive, isExpanded, onClick }: FeatureChipProps) {
  return (
    <div
      className={cn(
        'rounded-xl border transition-all duration-200 overflow-hidden',
        !isActive && 'opacity-60 hover:opacity-90',
      )}
      style={{
        border: isExpanded
          ? '2px solid var(--color-primary-50)'
          : isActive
            ? '1px solid var(--theme-border)'
            : '1px solid transparent',
        background: isExpanded
          ? 'rgba(232,69,65,0.06)'
          : isActive
            ? 'var(--theme-surface)'
            : 'var(--theme-surface-secondary)',
        boxShadow: isExpanded ? '0 2px 8px rgba(232,69,65,0.12)' : 'none',
      }}
    >
      {/* Header row (clickable) */}
      <button
        onClick={onClick}
        aria-expanded={isExpanded}
        className="w-full flex items-center gap-2.5 p-3 min-h-[48px] text-left cursor-pointer bg-transparent border-none transition-transform duration-200 active:scale-[0.99]"
      >
        {/* Icon */}
        <div
          className="flex items-center justify-center flex-shrink-0 w-8 h-8 transition-colors duration-200 rounded-lg"
          style={{
            background: isExpanded
              ? 'rgba(232,69,65,0.15)'
              : isActive
                ? styles?.bg
                : 'var(--theme-surface)',
            color: isExpanded
              ? 'var(--color-primary-50)'
              : isActive
                ? styles?.color
                : 'var(--theme-text-muted)',
          }}
        >
          {fc.icon}
        </div>

        {/* Title */}
        <span
          className="flex-1 text-[14px] font-semibold leading-tight transition-colors duration-200"
          style={{
            color: isExpanded
              ? 'var(--color-primary-50)'
              : isActive
                ? 'var(--theme-text)'
                : 'var(--theme-text-muted)',
          }}
        >
          {fc.title}
        </span>

        {/* Expand indicator */}
        <ChevronDown
          size={16}
          className={cn(
            'flex-shrink-0 transition-transform duration-200',
            isExpanded && 'rotate-180',
          )}
          style={{ color: 'var(--theme-text-muted)' }}
        />
      </button>

      {/* Description — spawns below the selection, lengthening the card */}
      {isExpanded && (
        <div className="px-3 pb-3">
          <p
            className="text-[13px] leading-relaxed"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {fc.description}
          </p>
        </div>
      )}
    </div>
  )
}
