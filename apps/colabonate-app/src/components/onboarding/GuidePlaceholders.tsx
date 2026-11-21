// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useRef, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { ShoppingCart, Package, Users2, Lightbulb, ArrowRight, Store, Handshake, UserPlus, Target, LayoutDashboard, Bot } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn, useTheme, useIsMobile } from '@ds/utils'
import { CARD_THEME } from '@ds/ui'

export interface GuidePlaceholderItem {
  id: string
  topic: string
  icon: LucideIcon
  text: string
  cta: string
  to: string
  accent?: string
  accentSoft?: string
  badge?: string
}

export const GUIDE_PLACEHOLDERS: GuidePlaceholderItem[] = [
  {
    id: 'guide-buy', topic: 'Buy', icon: ShoppingCart,
    text: 'Discover products and services nearby and pay directly with Bitcoin Lightning.',
    cta: 'Buying guide', to: '/help/buying',
    accent: 'var(--color-accent-1)', accentSoft: 'rgba(107,177,255,0.12)', badge: 'Lightning',
  },
  {
    id: 'guide-sell', topic: 'Sell', icon: Package,
    text: 'Publish your offers, organize catalogs and build a verifiable reputation.',
    cta: 'Selling guide', to: '/help/selling',
    accent: 'var(--color-primary-50)', accentSoft: 'rgba(232,69,65,0.12)', badge: 'Reputation',
  },
  {
    id: 'guide-coop', topic: 'Cooperate', icon: Users2,
    text: 'Find partners for joint projects with direct milestone payments.',
    cta: 'Cooperation guide', to: '/help/cooperation',
    accent: 'var(--color-accent-3)', accentSoft: 'rgba(42,232,102,0.12)', badge: 'Escrow',
  },
  {
    id: 'guide-start', topic: 'Getting Started', icon: Lightbulb,
    text: 'New here? Learn how Colabonate works in just a few simple steps.',
    cta: 'Open guide', to: '/help/getting-started',
    accent: 'var(--color-accent-2)', accentSoft: 'rgba(245,124,42,0.12)', badge: 'New here',
  },
]

export const PARTNER_PLACEHOLDERS: GuidePlaceholderItem[] = [
  {
    id: 'partner-buy', topic: 'Buy', icon: ShoppingCart,
    text: 'Find trusted local providers near you. Real reviews from verified buyers help you choose with confidence — you pay providers directly over Lightning.',
    cta: 'Discover providers', to: '/buy',
    accent: 'var(--color-accent-1)', accentSoft: 'rgba(107,177,255,0.12)', badge: 'Verified',
  },
  {
    id: 'partner-sell', topic: 'Sell', icon: Store,
    text: 'Join the network and get discovered by buyers in your area. Build a verifiable reputation, manage your catalog, and grow your sales peer-to-peer.',
    cta: 'Start selling', to: '/sell',
    accent: 'var(--color-primary-50)', accentSoft: 'rgba(232,69,65,0.12)', badge: 'P2P',
  },
  {
    id: 'partner-coop', topic: 'Cooperate', icon: Handshake,
    text: 'Team up with complementary providers for joint projects. Combine skills, split earnings fairly, and realize bigger ventures with milestone-based escrow.',
    cta: 'Find partners', to: '/coop',
    accent: 'var(--color-accent-3)', accentSoft: 'rgba(42,232,102,0.12)', badge: 'Escrow',
  },
]

export const SERVICES_GUIDE_PLACEHOLDERS: GuidePlaceholderItem[] = [
  {
    id: 'services-coop-guide', topic: 'Cooperate', icon: Handshake,
    text: 'Start the guided Coop flow — find partners, agree on milestones and pay each stage directly as it is delivered.',
    cta: 'Start Coop Guide', to: '/coop/guide',
    accent: 'var(--color-accent-3)', accentSoft: 'rgba(42,232,102,0.12)', badge: 'Escrow',
  },
  {
    id: 'services-create-product', topic: 'Sell', icon: Package,
    text: 'Add a product to your catalog and reach nearby buyers directly.',
    cta: 'Create product', to: '/offers/new?type=product',
    accent: 'var(--color-primary-50)', accentSoft: 'rgba(232,69,65,0.12)', badge: 'Catalog',
  },
  {
    id: 'services-create-item', topic: 'Sell', icon: ShoppingCart,
    text: 'List a single item for sale — quick to publish, ready in seconds.',
    cta: 'Create item', to: '/offers/new?type=item',
    accent: 'var(--color-accent-2)', accentSoft: 'rgba(245,124,42,0.12)', badge: 'Quick list',
  },
]

// Green collaborate-context placeholder cards — the empty state of the Home
// "Services & Collaborations" slider's Collaborations segment. Same card
// pattern as the Tickets & Offers placeholder row, but every card routes into
// a Collaborate function of the app and shares the green accent of the
// Coop-guide carousel card.
export const COLLABORATE_PLACEHOLDERS: GuidePlaceholderItem[] = [
  {
    id: 'collab-guide', topic: 'Cooperate', icon: Handshake,
    text: 'Start the guided Coop flow — find partners, agree on milestones and pay each stage directly as it is delivered.',
    cta: 'Start Coop Guide', to: '/coop/guide',
    accent: 'var(--color-accent-3)', accentSoft: 'rgba(42,232,102,0.12)', badge: 'Escrow',
  },
  {
    id: 'collab-explore', topic: 'Discover', icon: Users2,
    text: 'Browse open collaborations and see what partners in the network are building right now.',
    cta: 'Explore collaborations', to: '/coop',
    accent: 'var(--color-accent-3)', accentSoft: 'rgba(42,232,102,0.12)', badge: 'Network',
  },
  {
    id: 'collab-partners', topic: 'Partners', icon: UserPlus,
    text: 'Find complementary providers to team up with — combine skills and split earnings fairly.',
    cta: 'Find partners', to: '/coop?filter=partners',
    accent: 'var(--color-accent-3)', accentSoft: 'rgba(42,232,102,0.12)', badge: 'P2P',
  },
  {
    id: 'collab-bounty', topic: 'Bounty', icon: Target,
    text: 'Describe the work you need and let the network deliver — milestone payments limit what either side has at stake.',
    cta: 'Post a bounty', to: '/bounties/new',
    accent: 'var(--color-accent-3)', accentSoft: 'rgba(42,232,102,0.12)', badge: 'Bounty',
  },
  {
    id: 'collab-manage', topic: 'Manage', icon: LayoutDashboard,
    text: 'Track your cooperations, services, bounties and agents in one hub.',
    cta: 'Open Coop hub', to: '/coop/manage',
    accent: 'var(--color-accent-3)', accentSoft: 'rgba(42,232,102,0.12)', badge: 'Hub',
  },
  {
    id: 'collab-agents', topic: 'Agents', icon: Bot,
    text: 'Deploy and manage AI agents that trade and collaborate on your behalf.',
    cta: 'Manage agent stack', to: '/coop/manage?tab=stack',
    accent: 'var(--color-accent-3)', accentSoft: 'rgba(42,232,102,0.12)', badge: 'Agents',
  },
]

export const ALL_PLACEHOLDERS: GuidePlaceholderItem[] = [...GUIDE_PLACEHOLDERS, ...PARTNER_PLACEHOLDERS]

export function GuidePlaceholderCard({
  topic, icon: Icon, text, cta, to,
  accent = 'var(--color-primary-50)',
  accentSoft = 'rgba(232,69,65,0.12)',
  badge,
  mobile = false,
}: Omit<GuidePlaceholderItem, 'id'> & { mobile?: boolean }) {
  const { theme } = useTheme()
  const C = CARD_THEME.colors(theme)
  const width     = mobile ? CARD_THEME.mobileWidth       : '196px'
  const height    = mobile ? CARD_THEME.mobileHeight      : '256px'
  const headerH   = mobile ? CARD_THEME.mobileImageHeight : '120px'
  return (
    <Link
      to={to}
      className={cn(
        'shrink-0 snap-start group flex flex-col rounded-xl overflow-hidden no-underline cursor-pointer',
        'relative transition-all duration-300 ease-out hover:-translate-y-1.5 hover:z-10',
      )}
      style={{
        width,
        height,
        background: CARD_THEME.bg(theme),
        boxShadow: CARD_THEME.shadow,
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = CARD_THEME.shadowHover }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = CARD_THEME.shadow }}
    >
      <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: CARD_THEME.overlay(theme) }} />
      {/* Header — tinted icon area (aligns body with the other slider cards) */}
      <div
        className="relative flex items-center justify-center shrink-0"
        style={{ height: headerH, background: accentSoft }}
      >
        {/* Top accent bar (overlaid, matches ProviderCard / OfferCard) */}
        <div className="absolute top-0 left-0 right-0 h-[2.5px]" style={{ backgroundColor: accent }} />

        {/* Topic badge */}
        <span
          className="absolute top-2 left-2 inline-flex items-center px-1.5 py-0.5 rounded-sm uppercase leading-none"
          style={{
            fontSize: mobile ? '8px' : '9px', fontWeight: 700, letterSpacing: '0.07em',
            color: accent, backgroundColor: 'var(--theme-surface)', border: `1px solid ${accent}`,
          }}
        >
          {topic}
        </span>

        {/* Icon */}
        <div
          className={cn('flex items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110', mobile ? 'w-10 h-10' : 'w-14 h-14')}
          style={{ background: 'var(--theme-surface)', color: accent, boxShadow: '0 6px 16px rgba(0,0,0,0.10)' }}
        >
          <Icon size={mobile ? 20 : 26} />
        </div>
      </div>

      {/* Body */}
      <div className={cn('flex flex-col flex-1 min-h-0', mobile ? 'gap-1 p-2' : 'gap-1.5 p-3')}>
        {/* Secondary content badge */}
        {badge && (
          <span
            className="inline-flex items-center self-start px-1.5 py-0.5 rounded-full leading-none shrink-0"
            style={{ fontSize: mobile ? '8px' : '9px', fontWeight: 700, color: accent, backgroundColor: accentSoft }}
          >
            {badge}
          </span>
        )}

        <p
          className={cn('leading-snug line-clamp-3', mobile ? 'text-[10px]' : 'text-[12px]')}
          style={{ color: C.textPrimary, fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {text}
        </p>

        {/* CTA button (visual — the whole card is the link) */}
        <span
          className={cn(
            'mt-auto inline-flex items-center justify-center gap-1 w-full font-semibold uppercase tracking-wider rounded-lg transition-transform duration-200 group-hover:scale-[1.02]',
            mobile ? 'text-[9px] px-2 py-1' : 'text-[11px] px-3 py-1.5',
          )}
          style={{ color: accent, background: 'transparent', border: `1px solid ${accent}` }}
        >
          {cta}
          <ArrowRight size={mobile ? 10 : 12} />
        </span>
      </div>
    </Link>
  )
}

export function GuidePlaceholderCarousel({ items = ALL_PLACEHOLDERS }: { items?: GuidePlaceholderItem[] }) {
  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)
  const pausedRef = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()

  function goTo(nextIdx: number) {
    const el = wrapRef.current
    if (!el || indexRef.current === nextIdx) return

    gsap.killTweensOf(el)
    gsap.to(el, {
      opacity: 0,
      filter: 'blur(10px)',
      scale: 0.94,
      y: -6,
      duration: 0.22,
      ease: 'power2.in',
      onComplete: () => {
        indexRef.current = nextIdx
        setIndex(nextIdx)
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!wrapRef.current) return
          gsap.fromTo(wrapRef.current,
            { opacity: 0, filter: 'blur(10px)', scale: 0.94, y: 6 },
            { opacity: 1, filter: 'blur(0px)', scale: 1, y: 0, duration: 0.32, ease: 'power2.out' },
          )
        }))
      },
    })
  }

  useEffect(() => {
    const timer = setInterval(() => {
      if (pausedRef.current) return
      const next = (indexRef.current + 1) % items.length
      goTo(next)
    }, 4000)
    return () => clearInterval(timer)
  }, [items.length])

  const item = items[index]

  return (
    <div
      className="flex flex-col shrink-0 snap-start"
      style={{ width: isMobile ? CARD_THEME.mobileWidth : 196 }}
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
    >
      {/* Animated card wrapper — GSAP targets this div */}
      <div
        ref={wrapRef}
        style={{ willChange: 'transform, opacity, filter' }}
      >
        <GuidePlaceholderCard
          topic={item.topic}
          icon={item.icon}
          text={item.text}
          cta={item.cta}
          to={item.to}
          accent={item.accent}
          accentSoft={item.accentSoft}
          badge={item.badge}
          mobile={isMobile}
        />
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-1 pt-2.5">
        {items.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`Show ${items[i].topic}`}
            style={{
              width: i === index ? 14 : 5,
              height: 5,
              borderRadius: 3,
              padding: 0,
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              background: i === index ? 'var(--color-primary-50)' : 'var(--theme-border)',
              transition: 'width 0.25s ease, background 0.25s ease',
            }}
          />
        ))}
      </div>
    </div>
  )
}
