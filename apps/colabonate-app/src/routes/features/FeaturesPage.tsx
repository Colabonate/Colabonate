import { Link } from 'react-router-dom'
import {
  ShoppingCart,
  Store,
  Handshake,
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
import { PageContainer, PageCard } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { cn } from '@ds/utils'

// ── Data (mirrored from OnboardingFeatures.tsx) ───────────────────────────────

const MAIN_SECTIONS = [
  {
    id: 'buy',
    icon: <ShoppingCart size={20} />,
    title: 'Buy',
    subtitle: 'Discover & shop',
    description: 'Find products and services nearby and pay directly — no intermediaries.',
    color: 'var(--color-accent-1)',
    iconBg: 'rgba(107,177,255,0.12)',
  },
  {
    id: 'sell',
    icon: <Store size={20} />,
    title: 'Sell',
    subtitle: 'Offer & grow',
    description: 'Showcase your offers, manage catalogs and build a verifiable reputation.',
    color: 'var(--color-primary-50)',
    iconBg: 'rgba(232,69,65,0.12)',
  },
  {
    id: 'coop',
    icon: <Handshake size={20} />,
    title: 'Cooperate',
    subtitle: 'Collaborate & scale',
    description:
      'Find partners, close fair contracts and realize joint projects — open source and decentralized.',
    color: 'var(--color-accent-3)',
    iconBg: 'rgba(42,232,102,0.12)',
  },
] as const

type FeatureId = 'buy' | 'sell' | 'coop'

const FEATURE_CARDS = [
  { id: 'local-providers', icon: <Search size={16} />,    title: 'Local Providers',           description: 'Browse categories and discover providers and offers in your area.',                                                                                                    tags: ['buy'] as FeatureId[] },
  { id: 'reviews',         icon: <Star size={16} />,      title: 'Reviews & Trust',            description: 'Real reviews from verified buyers help you make informed decisions.',                                                                                                  tags: ['buy'] as FeatureId[] },
  { id: 'business-profile',icon: <Building2 size={16} />, title: 'Business Profile',           description: 'Create your creator profile with opening hours, contact info and branding.',                                                                                          tags: ['sell'] as FeatureId[] },
  { id: 'catalogs',        icon: <LayoutGrid size={16} />,title: 'Catalogs & Categories',      description: 'Organize your products and services into searchable, structured catalogs.',                                                                                           tags: ['sell'] as FeatureId[] },
  { id: 'find-partners',   icon: <Handshake size={16} />, title: 'Find Partners',              description: 'Discover providers with complementary skills for joint ventures.',                                                                                                    tags: ['coop'] as FeatureId[] },
  { id: 'smart-contracts', icon: <FileCheck size={16} />, title: 'Smart Contracts',            description: 'Trustless agreements with automated payments and conditional releases — enforced on-chain, no middleman.',                                                            tags: ['coop'] as FeatureId[] },
  { id: 'tickets',         icon: <Ticket size={16} />,    title: 'Tickets & Milestones',       description: 'Structure projects into transparent phases with AI-assisted monitoring and automated payouts per milestone.',                                                         tags: ['coop'] as FeatureId[] },
  { id: 'workflows',       icon: <Workflow size={16} />,  title: 'Workflows & Open Protocols', description: 'Use standardized processes from the community or create your own — all open source and community-governed.',                                                          tags: ['coop'] as FeatureId[] },
  { id: 'dao',             icon: <Landmark size={16} />,  title: 'DAO & Community Governance', description: 'Communities can form their own DAOs — one person, one vote. Governed by the Colabonate Codex, fully open source.',                                                   tags: ['coop'] as FeatureId[] },
]

const FOUNDATION_CARDS = [
  { id: 'hid',    icon: <Fingerprint size={16} />, title: 'Human Identity (HID)',   description: 'Your unique, decentralized identity — no fake profiles, only real people. Verified through biometric proof and peer validation.' },
  { id: 'wallet', icon: <Wallet size={16} />,      title: 'BTC / Lightning Wallet', description: 'Send and receive payments instantly via Bitcoin Lightning — user to user, no bank required.' },
]

// ── Sub-components ────────────────────────────────────────────────────────────

function FoundationChip({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 py-3 px-4 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)]">
      <span className="text-[var(--theme-text-muted)] mt-0.5 shrink-0">{icon}</span>
      <div>
        <div className="text-sm font-semibold text-[var(--theme-text)]">{title}</div>
        <div className="text-xs text-[var(--theme-text-muted)] leading-relaxed mt-0.5">{description}</div>
      </div>
    </div>
  )
}

function FeatureItem({ icon, title, description, iconBg }: { icon: React.ReactNode; title: string; description: string; iconBg: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: iconBg }}
      >
        <span className="text-[var(--theme-text)]">{icon}</span>
      </div>
      <div>
        <div className="text-sm font-semibold text-[var(--theme-text)]">{title}</div>
        <div className="text-xs text-[var(--theme-text-muted)] leading-relaxed mt-0.5">{description}</div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function FeaturesPage() {
  return (
    <>
      <Seo
        title="Features"
        description="Explore Colabonate's features: buy, sell and cooperate locally with decentralized identity, Bitcoin Lightning payments, smart contracts and DAO governance."
        path="/features"
      />
    <PageContainer>
      <PageHeader
        icon={<LayoutGrid size={20} />}
        title="Features"
        subtitle="Everything you need to buy, sell and cooperate locally."
      />

      {/* Foundation strip – always active */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        {FOUNDATION_CARDS.map((fc) => (
          <FoundationChip key={fc.id} icon={fc.icon} title={fc.title} description={fc.description} />
        ))}
      </div>

      {/* Category sections */}
      <div className="flex flex-col gap-8">
        {MAIN_SECTIONS.map((section) => {
          const features = FEATURE_CARDS.filter((fc) => fc.tags.includes(section.id as FeatureId))
          return (
            <PageCard key={section.id}>
              {/* Section header */}
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: section.iconBg, color: section.color }}
                >
                  {section.icon}
                </div>
                <div>
                  <div className="font-bold text-[var(--theme-text)]">{section.title}</div>
                  <div className="text-xs text-[var(--theme-text-muted)]">{section.subtitle}</div>
                </div>
              </div>

              <p className="text-sm text-[var(--theme-text-muted)] mb-5 leading-relaxed">
                {section.description}
              </p>

              <div className={cn('grid gap-4', features.length > 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
                {features.map((fc) => (
                  <FeatureItem
                    key={fc.id}
                    icon={fc.icon}
                    title={fc.title}
                    description={fc.description}
                    iconBg={section.iconBg}
                  />
                ))}
              </div>
            </PageCard>
          )
        })}
      </div>

      {/* CTA */}
      <div className="mt-8 text-center">
        <Link
          to="/onboarding/welcome"
          className="inline-block px-6 py-2.5 rounded-xl font-semibold text-sm text-white"
          style={{ background: 'var(--color-primary-50)' }}
        >
          Get Started
        </Link>
      </div>
    </PageContainer>
    </>
  )
}
