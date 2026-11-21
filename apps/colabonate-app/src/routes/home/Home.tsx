// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Login } from '../auth/Login'
import {
  AccountBalanceWallet as Wallet,
  Person,
  CurrencyBitcoin,
  Star,
  ConfirmationNumber,
  Handshake,
  ShoppingCart,
  Store,
  Search,
  Business,
  GridView,
  Fingerprint,
  FactCheck,
  AccountTree,
  AccountBalance,
  Check,
  ExpandMore,
  Inventory2,
  Label,
  Work,
  Bolt,
  Group,
  TrendingUp,
  Logout,
  LocationOn,
  Language,
  LightMode,
  DarkMode,
  Notifications,
} from '@mui/icons-material'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { TicketIcon, Package } from 'lucide-react'
gsap.registerPlugin(ScrollTrigger)

import { PageContainer, SliderList, FloatingAddButton, CARD_THEME } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import { richTextToPlainText } from '../../components/offers'
import { Seo } from '../../components/Seo'
import { CartFAB, SearchFAB } from '../../components/ui'
import { SearchHeroSection } from '../../components/home/SearchHeroSection'
import { SupportProjectCard } from '../../components/home/SupportProjectCard'
import { McpConnectSection } from '../../components/home/McpConnectSection'
import { AIAssistantPromoSection } from '../../components/home/AIAssistantPromoSection'
import { SearchQuickChips } from '../../components/home/SearchQuickChips'
// CoopDockSection (ADR-303) is rendered in Layout.tsx after </main>,
// before <AppFooter>, so the footer stays visible at the bottom.
import { SEARCH_CHIPS, buildCategoryFilterChips } from '../../config/search-chips'
import type { KPIItem, SliderListItem } from '@ds/ui'
import { cn, useIsMobile, useTheme } from '@ds/utils'
import { useTranslation } from '../../contexts/LocaleContext'
import { useCurrency } from '../../contexts/CurrencyContext'
import { formatSatsNumber } from '../../lib/currency'
import { walletProviderShortLabel } from '../../lib/walletProviderLabels'
import { useSliderItemsFiat } from '../../components/currency/useSliderItemsFiat'
import { apiCall } from '../../lib/api'
import { logout } from '../../lib/logout'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useImageValidity } from '../../hooks/useImageValidity'
import { usePageAnimation, useSectionAnimation } from '../../hooks/usePageAnimation'
import { useSignalAppReady } from '../../hooks/useSignalAppReady'
import { statusLabel as STATUS_LABEL_MAP } from '../../lib/ticket-status-config'
import { syncNostrProfile } from '../../lib/nostr'
import { toNpub } from '../../lib/nostr-identity'
import { useFABActions } from '../../context/FABContext'
import { useNotification } from '../../context/NotificationContext'
import type { Ticket } from '../../types/api'
import type { CoopItem } from '../coop/coop-cards'
import { COUNTRIES } from '../../components/offers/offerFormConstants'
import { useAllOffers, useCountryOffers, useMyActiveOffersSlim, useOffersByType, useStandardCategories, useCategoryCounts, useEcosystemStats, useCooperationsDiscover, useUserServiceOffers, useUserAgentOffers, useOffers as useUserNetworkOffers } from '../../hooks/useEntityQueries'
import { dedupeHits } from '../../hooks/useOfferSearch'
import { useOpenBounties } from '../../hooks/useAgentTaskQueries'
import {
  ALL_PLACEHOLDERS, GUIDE_PLACEHOLDERS, SERVICES_GUIDE_PLACEHOLDERS, COLLABORATE_PLACEHOLDERS, GuidePlaceholderCarousel, GuidePlaceholderCard,
} from '../../components/onboarding/GuidePlaceholders'
import type { GuidePlaceholderItem } from '../../components/onboarding/GuidePlaceholders'

import { usePref } from '../../utils/userPreferences'
import { foreignPriceText } from '../../lib/offer-price-text'
import { mergeProximityPool } from '../../lib/proximity-pool'
import { toMyOfferCard } from '../../lib/my-offer-card'

const POLL_INTERVAL = Number(import.meta.env.VITE_HOME_REFRESH_MS) || 30_000

// ADR-422: how many of the viewer's own listings the "My Offers" row shows.
// The row scrolls horizontally, so a higher cap costs no layout space.
const MY_OFFERS_SLIDER_CAP = 16

const SECTION_TITLE_STYLE: CSSProperties = { fontWeight: 250 }

// Short, screen-friendly labels for the WalletProvider enum live in
// lib/walletProviderLabels.ts (shared with the Wallet page + switcher).

// ─── Why Colabonate Section (Buy, Sell, Cooperate) ────────────────────────────

type FeatureCategory = 'buy' | 'sell' | 'coop'

interface MainCardDef {
  id: FeatureCategory
  icon: ReactNode
  title: string
  subtitle: string
  description: string
  color: string
  bg: string
  iconBg: string
  iconColor: string
  imageUrls?: string[]
}

interface FeatureDef {
  id: string
  icon: ReactNode
  title: string
  description: string
  tags: FeatureCategory[]
}

const GUEST_HERO_CARDS: MainCardDef[] = [
  {
    id: 'buy',
    icon: <ShoppingCart sx={{ fontSize: 18 }} />,
    title: 'Buy',
    subtitle: 'Discover nearby',
    description: 'Find products and services nearby and pay directly.',
    color: 'var(--color-accent-1)',
    bg: 'rgba(107,177,255,0.08)',
    iconBg: 'rgba(107,177,255,0.15)',
    iconColor: 'rgba(107,177,255,1)',
    imageUrls: [
      'https://images.pexels.com/photos/230544/pexels-photo-230544.jpeg?auto=compress&cs=tinysrgb&w=400',
      'https://images.pexels.com/photos/5632370/pexels-photo-5632370.jpeg?auto=compress&cs=tinysrgb&w=400',
      'https://images.pexels.com/photos/264636/pexels-photo-264636.jpeg?auto=compress&cs=tinysrgb&w=400',
    ],
  },
  {
    id: 'sell',
    icon: <Store sx={{ fontSize: 18 }} />,
    title: 'Sell',
    subtitle: 'Grow your reach',
    description: 'Showcase offers and build verifiable reputation.',
    color: 'var(--color-primary-50)',
    bg: 'rgba(232,69,65,0.08)',
    iconBg: 'rgba(232,69,65,0.15)',
    iconColor: 'rgba(232,69,65,1)',
    imageUrls: [
      'https://images.pexels.com/photos/264507/pexels-photo-264507.jpeg?auto=compress&cs=tinysrgb&w=400',
      'https://images.pexels.com/photos/1488463/pexels-photo-1488463.jpeg?auto=compress&cs=tinysrgb&w=400',
      'https://images.pexels.com/photos/1078958/pexels-photo-1078958.jpeg?auto=compress&cs=tinysrgb&w=400',
    ],
  },
  {
    id: 'coop',
    icon: <Handshake sx={{ fontSize: 18 }} />,
    title: 'Cooperate',
    subtitle: 'Scale together',
    description: 'Find partners and realize joint projects.',
    color: 'var(--color-accent-3)',
    bg: 'rgba(42,232,102,0.08)',
    iconBg: 'rgba(42,232,102,0.15)',
    iconColor: 'rgba(42,232,102,1)',
    imageUrls: [
      'https://images.pexels.com/photos/3182812/pexels-photo-3182812.jpeg?auto=compress&cs=tinysrgb&w=400',
      'https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&fit=crop&w=400&q=80',
      'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=400&q=80',
    ],
  },
]

const WHY_MAIN_CARDS: MainCardDef[] = [
  {
    id: 'buy',
    icon: <ShoppingCart sx={{ fontSize: 26 }} />,
    title: 'Buy',
    subtitle: 'Discover & shop',
    description: 'Find products and services nearby and pay directly — no intermediaries.',
    color: 'var(--color-accent-1)',
    bg: 'rgba(107,177,255,0.08)',
    iconBg: 'rgba(107,177,255,0.12)',
    iconColor: 'rgba(107,177,255,0.85)',
  },
  {
    id: 'sell',
    icon: <Store sx={{ fontSize: 26 }} />,
    title: 'Sell',
    subtitle: 'Offer & grow',
    description: 'Showcase your offers, manage catalogs and build a verifiable reputation.',
    color: 'var(--color-primary-50)',
    bg: 'rgba(232,69,65,0.08)',
    iconBg: 'rgba(232,69,65,0.12)',
    iconColor: 'rgba(232,69,65,0.85)',
  },
  {
    id: 'coop',
    icon: <Handshake sx={{ fontSize: 26 }} />,
    title: 'Cooperate',
    subtitle: 'Collaborate & scale',
    description: 'Find partners, close fair contracts and realize joint projects — open source and decentralized.',
    color: 'var(--color-accent-3)',
    bg: 'rgba(42,232,102,0.08)',
    iconBg: 'rgba(42,232,102,0.12)',
    iconColor: 'rgba(42,232,102,0.85)',
  },
]

const WHY_FEATURES: FeatureDef[] = [
  {
    id: 'local-providers',
    icon: <Search sx={{ fontSize: 18 }} />,
    title: 'Local Providers',
    description: 'Browse categories and discover providers and offers in your area.',
    tags: ['buy'],
  },
  {
    id: 'reviews',
    icon: <Star sx={{ fontSize: 18 }} />,
    title: 'Reviews & Trust',
    description: 'Real reviews from verified buyers help you make informed decisions.',
    tags: ['buy'],
  },
  {
    id: 'business-profile',
    icon: <Business sx={{ fontSize: 18 }} />,
    title: 'Business Profile',
    description: 'Create your creator profile with opening hours, contact info and branding.',
    tags: ['sell'],
  },
  {
    id: 'catalogs',
    icon: <GridView sx={{ fontSize: 18 }} />,
    title: 'Catalogs & Categories',
    description: 'Organize your products and services into searchable, structured catalogs.',
    tags: ['sell'],
  },
  {
    id: 'find-partners',
    icon: <Handshake sx={{ fontSize: 18 }} />,
    title: 'Find Partners',
    description: 'Discover providers with complementary skills for joint ventures.',
    tags: ['coop'],
  },
  {
    id: 'hid',
    icon: <Fingerprint sx={{ fontSize: 18 }} />,
    title: 'Human Identity (HID)',
    description: 'Your unique, decentralized identity — no fake profiles, only real people. Verified through biometric proof and peer validation.',
    tags: ['buy', 'sell', 'coop'],
  },
  {
    id: 'wallet',
    icon: <Wallet sx={{ fontSize: 18 }} />,
    title: 'BTC / Lightning Wallet',
    description: 'Send and receive payments instantly via Bitcoin Lightning — user to user, no bank required. Built on a secure Bitcoin L2 infrastructure.',
    tags: ['buy', 'sell', 'coop'],
  },
  {
    id: 'smart-contracts',
    icon: <FactCheck sx={{ fontSize: 18 }} />,
    title: 'Smart Contracts',
    description: 'Trustless agreements with automated payments and conditional releases — enforced on-chain, no middleman.',
    tags: ['coop'],
  },
  {
    id: 'tickets',
    icon: <ConfirmationNumber sx={{ fontSize: 18 }} />,
    title: 'Tickets & Milestones',
    description: 'Structure projects into transparent phases with AI-assisted monitoring and automated payouts per milestone.',
    tags: ['coop'],
  },
  {
    id: 'workflows',
    icon: <AccountTree sx={{ fontSize: 18 }} />,
    title: 'Workflows & Open Protocols',
    description: 'Use standardized processes from the community or create your own — all open source and community-governed.',
    tags: ['coop'],
  },
  {
    id: 'dao',
    icon: <AccountBalance sx={{ fontSize: 18 }} />,
    title: 'DAO & Community Governance',
    description: 'Communities can form their own DAOs — one person, one vote. Governed by the Colabonate Codex, fully open source.',
    tags: ['coop'],
  },
]

// Matches the offer's `city` field exactly OR a comma-bounded token inside
// the full `location` string ("Street, City, Zip, Country"). Catches offers
// whose `city` field is missing but whose `location` string still names the
// user's city — common for older listings and catalogue imports.
function offerMatchesUserCity(
  o: { city?: string | null; location?: string | null },
  userCity: string,
): boolean {
  const userCityLc = userCity.toLowerCase().trim()
  if (!userCityLc) return false
  if (o.city?.toLowerCase().trim() === userCityLc) return true
  const locLc = o.location?.toLowerCase() ?? ''
  if (!locLc) return false
  return locLc.split(',').some(part => part.trim() === userCityLc)
}

function WhyColabonateSection() {
  const isMobile = useIsMobile()
  const [isOpen, setIsOpen] = useState(true)
  const [activeCategory, setActiveCategory] = useState<FeatureCategory | null>(isMobile ? null : 'buy')
  const [expandedFeature, setExpandedFeature] = useState<string | null>(isMobile ? null : 'local-providers')

  /** Build style map: featureId → { bg, color } for highlighted features */
  const featureStyleMap = useMemo(() => {
    if (!activeCategory) return {}
    const mainCard = WHY_MAIN_CARDS.find(m => m.id === activeCategory)
    if (!mainCard) return {}
    const map: Record<string, { bg: string; color: string }> = {}
    for (const fc of WHY_FEATURES) {
      if (fc.tags.includes(activeCategory)) {
        map[fc.id] = { bg: mainCard.iconBg, color: mainCard.iconColor }
      }
    }
    return map
  }, [activeCategory])

  const toggleCategory = useCallback((id: FeatureCategory) => {
    setActiveCategory(prev => prev === id ? null : id)
  }, [])

  return (
    <section
      aria-label="Why Colabonate"
      className="relative"
    >
      {/* Decorative Background */}
      <div className="absolute inset-0 mr-2 overflow-hidden pointer-events-none -z-10">
        <div className="absolute rounded-full -top-24 -right-24 w-96 h-96 bg-primary-500/5 blur-3xl" />
        <div className="absolute rounded-full -bottom-24 -left-24 w-96 h-96 bg-secondary-500/5 blur-3xl" />
      </div>

      {/* Header */}
      <button
        onClick={() => setIsOpen(p => !p)}
        className={cn(
          'group w-full flex items-center gap-4 rounded-xl px-3 py-2 -mx-3 cursor-pointer text-left',
          'transition-colors duration-200 hover:bg-[rgba(232,69,65,0.06)] active:bg-[rgba(232,69,65,0.10)]',
          isOpen && 'mb-8 md:mb-10',
        )}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Collapse section' : 'Expand section'}
      >
        <div
          className="flex items-center justify-center w-10 h-10 shrink-0 md:w-12 md:h-12 rounded-xl"
          style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}
        >
          <CurrencyBitcoin sx={{ fontSize: 24 }} />
        </div>
        <h3 className="flex-1 m-0">Why Colabonate?</h3>
        <div
          className="flex items-center justify-center w-10 h-10 shrink-0 md:w-12 md:h-12 rounded-xl transition-colors duration-200 group-hover:bg-[rgba(232,69,65,0.18)]"
          style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}
        >
          <ExpandMore
            sx={{
              fontSize: 24,
              transition: 'transform 0.3s ease',
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </div>
      </button>

      {/* ── Collapsible Content ────────────────────────────────────── */}
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
      <div className="overflow-hidden">
        <p
          className="max-w-3xl text-base leading-relaxed md:text-lg lg:text-xl text-neutral-6 dark:text-neutral-7 mb-8 md:mb-10"
          style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          Decentral commerce powered by Bitcoin – buy, sell and cooperate in your region. No intermediaries, full control, and direct peer-to-peer partnerships.
        </p>

      {/* ── Main Category Cards (Buy, Sell, Cooperate) ────────────── */}
      <div className="grid w-full grid-cols-3 gap-2 md:gap-3 mx-auto mb-8 md:mb-10">
        {WHY_MAIN_CARDS.map((card) => {
          const isActive = activeCategory === card.id
          return (
            <button
              key={card.id}
              onClick={() => toggleCategory(card.id)}
              className={cn(
                'relative flex flex-col items-center p-3 pt-6 md:p-5 md:pt-8 md:pb-5 rounded-xl border text-center cursor-pointer transition-all duration-200',
                'hover:-translate-y-0.5 active:scale-[0.98]',
                isActive && 'shadow-lg',
              )}
              style={{
                border: isActive
                  ? `2px solid ${card.color}`
                  : '1px solid var(--theme-border)',
                background: isActive
                  ? card.bg
                  : 'var(--theme-surface)',
              }}
            >
              {/* Active Badge */}
              {isActive && (
                <div
                  className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: card.color, color: 'white' }}
                >
                  <Check sx={{ fontSize: 12 }} />
                </div>
              )}

              {/* Icon */}
              <div
                className="flex items-center justify-center mb-2 md:mb-4 w-10 h-10 md:w-14 md:h-14 rounded-2xl"
                style={{ background: card.bg, color: card.color }}
              >
                {card.icon}
              </div>

              {/* Text */}
              <div className="flex flex-col items-center min-w-0">
                <h3
                  className="text-[12px] md:text-[16px] font-semibold leading-tight"
                  style={{ color: 'var(--theme-text)' }}
                >
                  {card.title}
                </h3>
                <p
                  className="text-[11px] md:text-[14px] font-medium"
                  style={{ color: 'var(--theme-text-muted)' }}
                >
                  {card.subtitle}
                </p>
                <p
                  className="hidden md:block text-[12px] leading-snug mt-1.5"
                  style={{ color: 'var(--theme-text-muted)' }}
                >
                  {card.description}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Feature Label ──────────────────────────────────────────── */}
      <p
        className="text-[12px] font-semibold uppercase tracking-wider mb-3"
        style={{ color: 'var(--theme-text-muted)' }}
      >
        {activeCategory
          ? `Features for ${WHY_MAIN_CARDS.find(m => m.id === activeCategory)?.title}`
          : 'All features'}
      </p>

      {/* ── Feature Detail Grid ────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5 mb-6">
        {WHY_FEATURES.map((fc) => {
          const styles = featureStyleMap[fc.id]
          const isHighlighted = !!styles
          const isExpanded = expandedFeature === fc.id

          return (
            <button
              key={fc.id}
              onClick={() => { setExpandedFeature(prev => prev === fc.id ? null : fc.id) }}
              className={cn(
                'flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-all duration-200 text-left min-h-12',
                'hover:-translate-y-0.5 active:scale-[0.97]',
              )}
              style={{
                border: isExpanded
                  ? '2px solid var(--color-primary-50)'
                  : isHighlighted
                    ? '1px solid var(--theme-border)'
                    : '1px solid transparent',
                background: isExpanded
                  ? 'rgba(232,69,65,0.08)'
                  : isHighlighted
                    ? 'var(--theme-surface)'
                    : 'var(--theme-surface-secondary)',
                boxShadow: isExpanded
                  ? '0 2px 8px rgba(232,69,65,0.15)'
                  : 'none',
                opacity: activeCategory && !isHighlighted ? 0.45 : 1,
              }}
            >
              {/* Icon */}
              <div
                className="flex items-center justify-center w-8 h-8 transition-colors duration-200 rounded-lg shrink-0"
                style={{
                  background: isExpanded
                    ? 'rgba(232,69,65,0.15)'
                    : isHighlighted
                      ? styles.bg
                      : 'var(--theme-surface)',
                  color: isExpanded
                    ? 'var(--color-primary-50)'
                    : isHighlighted
                      ? styles.color
                      : 'var(--theme-text-muted)',
                }}
              >
                {fc.icon}
              </div>

              {/* Title */}
              <span
                className="text-[13px] font-semibold leading-tight truncate transition-colors duration-200"
                style={{
                  color: isExpanded
                    ? 'var(--color-primary-50)'
                    : isHighlighted
                      ? 'var(--theme-text)'
                      : 'var(--theme-text-muted)',
                }}
              >
                {fc.title}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Expanded Feature Detail ────────────────────────────────── */}
      {expandedFeature && (() => {
        const activeFc = WHY_FEATURES.find(f => f.id === expandedFeature)
        if (!activeFc) return null
        return (
          <div
            className="p-4 transition-all duration-300 border rounded-xl"
            style={{
              border: '1px solid rgba(232,69,65,0.25)',
              background: 'rgba(232,69,65,0.05)',
            }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div
                className="flex items-center justify-center rounded-lg shrink-0 w-7 h-7"
                style={{
                  background: 'rgba(232,69,65,0.12)',
                  color: 'rgba(232,69,65,0.85)',
                }}
              >
                {activeFc.icon}
              </div>
              <span
                className="text-[15px] font-semibold leading-tight"
                style={{ color: 'var(--theme-text)' }}
              >
                {activeFc.title}
              </span>
            </div>
            <p
              className="text-[13px] leading-relaxed"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              {activeFc.description}
            </p>
          </div>
        )
      })()}
      </div>
      </div>
    </section>
  )
}


/** Sentinel id used in the Marketplace "Nearby" items array to mark the seam
 *  between exact-city results and broader region results. Rendered by
 *  `MarketplaceRegionDivider` via the SliderList `renderItem` escape hatch. */
const MARKETPLACE_REGION_DIVIDER_ID = '__marketplace_region_divider__'

// ─── Marketplace Region Divider ───────────────────────────────────────────────
// Subtle vertical seam inserted between "nearby" (exact-city) cards and the
// following "region" cards inside the Marketplace slider's Nearby tab. The pill
// is rotated -90° so the divider takes only ~24–28px of horizontal space — the
// pill's text reads bottom-to-top like a spine label. Renders outside the
// card-sizing wrapper that SliderList applies to default cards — we return
// this from `renderItem`, so SliderList uses it verbatim.
function MarketplaceRegionDivider() {
  const isMobile = useIsMobile()
  const height = isMobile ? CARD_THEME.mobileHeight : CARD_THEME.cardHeight
  const width  = isMobile ? 24 : 28
  return (
    <div
      role="separator"
      aria-label="From your region"
      className="shrink-0 snap-start relative"
      style={{ width, height }}
    >
      <div
        className="absolute top-0 bottom-0 w-px"
        style={{
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'linear-gradient(to bottom, transparent 0%, rgba(245,124,42,0.55) 50%, transparent 100%)',
        }}
      />
      <div
        className="absolute"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%) rotate(-90deg)',
        }}
      >
        <div
          className="flex items-center gap-1 px-2 py-1 rounded-full whitespace-nowrap"
          style={{
            background: 'var(--theme-surface)',
            border: '1px solid rgba(245,124,42,0.30)',
          }}
        >
          <Language sx={{ fontSize: 10, color: 'var(--color-accent-2)' }} />
          <span
            className="text-[9px] font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-accent-2)' }}
          >
            From your region
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
// Minimal shape for open AgentTasks (bounties) rendered inside the home
// Collaborations slider (Home queries them directly; full type lives in
// useAgentTaskQueries).
interface HomeBounty {
  id: string
  title: string
  description?: string | null
  budgetSats?: number | null
  creatorPubkey?: string
  images?: string[] | null
  deadline?: string | null
  createdAt?: string
}
export function Home() {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { unreadCount } = useNotification()
  const { formatNumber } = useTranslation()
  const { satsToFiat, formatFiat } = useCurrency()
  // Fiat equivalent for KPI tooltips (ADR-235): KPI cards stay sats-only; the
  // hint lives in the hover/long-press tooltip.
  const kpiFiatHint = useCallback((sats: number): string => {
    const fiat = satsToFiat(sats)
    return fiat !== null ? ` ≈ ${formatFiat(fiat)}` : ''
  }, [satsToFiat, formatFiat])
  const isMobile = useIsMobile()
  const { actions: fabActions, setActions: setFABActions, clear: clearFAB } = useFABActions()
  const [userCity]    = usePref('userCity', '')
  const [userCountry] = usePref('userCountry', '')
  const [pubkey]       = useState(() => localStorage.getItem('pubkey') ?? '')
  // Random guest hero background image per card, stable for the component session
  const [guestHeroImageUrls] = useState(() =>
    GUEST_HERO_CARDS.map((card) => {
      const urls = card.imageUrls
      if (!urls || urls.length === 0) return undefined
      return urls[Math.floor(Math.random() * urls.length)]
    })
  )
  // 'cooperation' (Collaborations) is the section's initial segment — the
  // Products sub-tab was removed from Services & Collaborations.
  const [servicesSegment, setServicesSegment] = useState('cooperation')
  const [activeTicketSegment, setActiveTicketSegment] = useState<'my-offers' | 'my-tickets'>('my-offers')
  const marketplaceSectionRef = useRef<HTMLDivElement>(null)
  const [lnAddress]   = useState(() => { const v = localStorage.getItem('lnAddress') ?? ''; return v === 'undefined' ? '' : v })
  const [balance, setBalance] = useState<number | null>(null)
  const [walletProvider, setWalletProvider] = useState<string | null>(null)
  const [userIdentityLevel, setUserIdentityLevel] = useState(0)
  const [userPicture, setUserPicture] = useState<string | null>(null)
  const [userBanner, setUserBanner] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)

  // ── TanStack Query ───────────────────────────────────────────────────────────
  const { data: offersData = [], isLoading: offersLoading } = useAllOffers()
  // ADR-421: the visitor's own country, server-side, for the Nearby/Region tabs.
  const profileCountry = COUNTRIES.some(c => c.code === userCountry) ? userCountry : ''
  const { data: countryOffersData = [], isLoading: countryOffersLoading } = useCountryOffers(profileCountry)
  // ADR-334 D3/D4: single server-aggregated stats source for the KPI strip —
  // replaces the client-side derivations from the 30-row useAllOffers window
  // AND folds the separate useRemoteOfferCount call into the same roundtrip.
  const { data: ecosystemStats, isLoading: statsLoading } = useEcosystemStats()
  const { data: standardCategories = [], isLoading: categoriesLoading } = useStandardCategories()
  const { data: categoryCounts = {} } = useCategoryCounts()
  const { data: ticketsData = [], isLoading: ticketsLoading } = useQuery({
    queryKey: ['tickets', pubkey],
    queryFn: async (): Promise<Ticket[]> => {
      if (!pubkey) return []
      const res = await apiCall('/api/tickets?first=100')
      const data = await res.json()
      return data.edges?.map((e: { node: Ticket }) => e.node) ?? []
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
  // ADR-376 D2: reuses the exact hook CoopExplore/Search now compose over
  // (useCoopExploreData → useCooperationsDiscover) instead of an inline
  // re-implementation — same key/shape (FU-407), and first=100 (was 50) so
  // this and the coop-context browse land on the identical cache entry
  // instead of two disjoint ones. staleTime is the hook's own 15 s; the
  // explicit POLL_INTERVAL here preserves Home's original 30 s self-refresh
  // (was a bespoke `refetchInterval: POLL_INTERVAL` on the removed inline
  // query — other callers of useCooperationsDiscover don't poll at all).
  const { data: cooperationsData = [], isLoading: cooperationsLoading } = useCooperationsDiscover('', true, 100, POLL_INTERVAL)
  // Open bounties feed the same Collaborations slider (ADR-368 follow-up): a
  // bounty is a cooperation-shaped opportunity agents can apply to, so it
  // belongs right beside Cooperation entities + COOP offers.
  // FU-870: one shared cache entry with the coop browse (useOpenBounties).
  const { data: openBounties = [], isLoading: bountiesLoading } = useOpenBounties(POLL_INTERVAL)

  // Combined guard for GSAP animations (waits for all data before animating)
  const loading = offersLoading || categoriesLoading || ticketsLoading || cooperationsLoading
  // ADR-290: tells main.tsx's boot splash it can fade out — see useSignalAppReady.
  useSignalAppReady(!loading)

  // Per-section loading: prevents one slow query from blocking unrelated sections
  const marketplaceLoading = offersLoading || categoriesLoading || countryOffersLoading
  // ADR-334 D3: statsLoading gates the KPI strip so the server totals don't
  // flash as 0 before /api/stats resolves.
  const kpiLoading         = offersLoading || ticketsLoading || statsLoading

  const offers = offersData
  const tickets = ticketsData
  const cooperations = cooperationsData

  useEffect(() => {
    if (!pubkey || pubkey.includes('test')) return
    const webln = (window as unknown as { webln?: { enable(): Promise<void>; getBalance(): Promise<{ balance: number }> } }).webln
    if (!webln) return
    webln.enable().then(() => webln.getBalance()).then(r => setBalance(r.balance)).catch(() => {/* silent */})
  }, [pubkey])

  // Active server-side wallet → balance + provider (LNBITS/NWC/WEBLN/CASHU/ALBY…).
  // Source of truth for the KPI strip's "balance" + sublabel; falls back to the
  // window.webln getBalance() above for browser-extension WEBLN users without
  // an active server wallet row.
  useEffect(() => {
    if (!pubkey) return
    apiCall('/api/wallet')
      .then(r => r.json())
      .then(data => {
        if (data?.wallet?.provider) {
          setWalletProvider(data.wallet.provider as string)
          const bal = data.wallet.balance?.confirmedSats
          if (typeof bal === 'number') setBalance(bal)
        }
      })
      .catch(() => {/* silent */})
  }, [pubkey])

  useEffect(() => {
    if (!pubkey) return
    apiCall(`/api/identity/${pubkey}`)
      .then(r => r.json())
      .then(data => {
        if (data.identityLevel !== undefined) setUserIdentityLevel(data.identityLevel)
        if (data.picture) setUserPicture(data.picture)
        if (data.banner) setUserBanner(data.banner)
        if (data.name) setUserName(data.name)

        // Auto-load Nostr profile after login: when the account has no avatar
        // or display name yet, pull the Kind 0 metadata from relays via the
        // user's Nostr key (NIP-07 extension pubkey or L1-bound nostrPubkey)
        // and persist it server-side (fill-once). Keeps the KPI strip avatar,
        // banner and name in sync without a relay round-trip on every home
        // visit. The session flag is only set on success, so a failed relay
        // fetch retries on the next mount.
        if ((!data.picture || !data.name) && !data.error && !sessionStorage.getItem('nostr_profile_synced')) {
          void (async () => {
            try {
              let nostrPubkey: string | undefined = data.nostrPubkey ?? undefined
              const ext = (window as unknown as { nostr?: { getPublicKey?: () => Promise<string> } }).nostr
              if (ext?.getPublicKey) {
                try { nostrPubkey = await ext.getPublicKey() } catch { /* keep DB value */ }
              }
              const synced = await syncNostrProfile(pubkey, nostrPubkey)
              if (synced && (synced.picture || synced.name)) {
                sessionStorage.setItem('nostr_profile_synced', '1')
                if (synced.picture) setUserPicture(synced.picture)
                if (synced.banner) setUserBanner(synced.banner)
                if (synced.name) setUserName(synced.name)
              }
            } catch { /* silent — KPI avatar stays generic */ }
          })()
        }
      })
      .catch(() => {/* silent */})
    // Sync from simulator state
    try {
      const stored = localStorage.getItem('colabonate_simulator_state')
      if (stored) {
        const s = JSON.parse(stored)
        if (s.subject?.identityLevel > userIdentityLevel) setUserIdentityLevel(s.subject.identityLevel)
      }
    } catch { /* silent */ }
  }, [pubkey])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [])

  const prefersReduced = useReducedMotion()
  const ctaRef         = useRef<HTMLDivElement>(null)
  const heroRef        = usePageAnimation([
    { selector: '.hero-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  // Note: no permanent will-change here. All homepage entrance animations are
  // one-shot (ScrollTrigger once:true) reveals — permanently GPU-promoting
  // every .hero/.section/.beta element kept many large layers alive for the
  // whole page lifetime and caused scroll compositing cost (gsap-performance:
  // "Do not set will-change on every element just in case"). The entrance tweens
  // already use clearProps so layers are released right after they play.

  const scrollToMarketplace = useCallback(() => {
    marketplaceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    // Unified Add-FAB — identical action set as CoopExplore (ADR-368): Items,
    // Product, Service, Agent, Bounty, Coop Guide across every surface.
    setFABActions([
      { id: 'create-item', label: 'Items', info: 'Sell items directly', group: 'Sell', icon: 'plus', onClick: () => navigate('/offers/new?type=item') },
      { id: 'create-offer', label: 'Product', info: 'Add to catalog', group: 'Sell', icon: 'package', onClick: () => navigate('/sell/listings/new?type=PRODUCT&mode=listings') },
      { id: 'create-service', label: 'Service', info: 'Offer your expertise', group: 'Cooperate', icon: 'briefcase', onClick: () => navigate('/offers/new?type=service&context=coop') },
      { id: 'create-agent', label: 'Agent', info: 'Offer a new agent', group: 'Cooperate', icon: 'bot', onClick: () => navigate('/coop/agents/new') },
      { id: 'post-bounty', label: 'Bounty', info: 'Post a bounty for agents to apply to', group: 'Create', icon: 'plus', onClick: () => navigate('/bounties/new') },
      { id: 'coop-guide', label: 'Coop Guide', info: 'Start cooperation', group: 'Cooperate', icon: 'handshake', onClick: () => navigate('/coop/guide') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate])

  // ── Derived State ─────────────────────────────────────────────────────────
  const { activeTickets, completedCount } = useMemo(() => {
    const active: Ticket[] = []
    let done = 0
    const ACTIVE_STATUSES = new Set(['PENDING', 'ACCEPTED', 'PAID', 'IN_PROGRESS'])
    for (const t of tickets) {
      if (ACTIVE_STATUSES.has(t.status)) active.push(t)
      else if (t.status === 'COMPLETED') done++
    }
    return { activeTickets: active, completedCount: done }
  }, [tickets])

  // Base offer pool for all home sliders (region/price/rating/sort chips were
  // removed from the slider headers; previously they filtered this list).
  // Offers without a usable image are hidden by default — array-nonempty is
  // not enough, remote listings often carry dead or 1x1 placeholder URLs
  // (see useImageValidity).
  const sliderImageUrls = useMemo(() => [...offers, ...countryOffersData].map(o => o.images?.[0]), [offers, countryOffersData])
  const { isUsableImage } = useImageValidity(sliderImageUrls)
  const localBaseOffers = useMemo(
    () => offers.filter(o => isUsableImage(o.images?.[0])),
    [offers, isUsableImage],
  )
  // ADR-421: Nearby/Region filter this pool: the global newest window PLUS the
  // visitor's own country fetched server-side (older local offers would never
  // appear in the global window). Worldwide keeps using localBaseOffers.
  const proximityPool = useMemo(
    () => mergeProximityPool(countryOffersData.filter(o => isUsableImage(o.images?.[0])), localBaseOffers),
    [countryOffersData, localBaseOffers, isUsableImage],
  )

  // ── Services & Collaborations segment pools ─────────────────────────────────
  // Sourced from type-filtered /api/offers queries, NOT from localBaseOffers:
  // that pool is only the 30 newest offers across ALL types, so a type tab
  // could end up empty even while Explore (/buy, server-side filtered) lists
  // plenty of services. Same full-row shape, image-validity filter applied
  // like everywhere else.
  const { data: serviceTypeOffers = [], isLoading: serviceTypeLoading } = useOffersByType('SERVICE')
  const { data: coopTypeOffers    = [], isLoading: coopTypeLoading    } = useOffersByType('COOP')
  // ADR-368 follow-up: AGENT_SETUP offers live under the Cooperate umbrella,
  // so they join the home Collaborations slider too.
  const { data: agentTypeOffers   = [], isLoading: agentTypeLoading   } = useOffersByType('AGENT_SETUP')

  // ADR-366 D4b: the public feed above (/api/search) only ever returns
  // status=ACTIVE, non-PRIVATE rows — a viewer's own DRAFT/OPEN entity is
  // otherwise invisible on their own Home ("created but not shown"). Merge
  // in the owner's full-status rows for their own pubkey; the server-side
  // owner-scoped /api/offers?creatorPubkey= route already returns every
  // status when a creatorPubkey is given (apps/server/index.ts:404-412).
  const { data: ownServiceOffers = [], isLoading: ownServiceOffersLoading } = useUserServiceOffers(pubkey)
  const { data: ownNetworkOffers = [], isLoading: ownNetworkOffersLoading } = useUserNetworkOffers(pubkey)
  const { data: ownAgentOffers = [], isLoading: ownAgentOffersLoading } = useUserAgentOffers(pubkey)

  // ADR-366 D4a: unlike localBaseOffers, these pools are NOT filtered by
  // image validity — the card component (OfferGalleryCard/OfferListRow)
  // already renders a title-initial placeholder for offers with no usable
  // image, so filtering here only hid otherwise-real, otherwise-visible
  // services/collaborations for no reason.
  const servicesServicePool = useMemo(
    () => dedupeHits([...ownServiceOffers, ...serviceTypeOffers]),
    [ownServiceOffers, serviceTypeOffers],
  )
  const servicesCoopPool = useMemo(
    () => dedupeHits([...(ownNetworkOffers as typeof coopTypeOffers), ...coopTypeOffers]),
    [ownNetworkOffers, coopTypeOffers],
  )
  const agentOffersPool = useMemo(
    () => dedupeHits([...(ownAgentOffers as typeof agentTypeOffers), ...agentTypeOffers]),
    [ownAgentOffers, agentTypeOffers],
  )

  // Initial-load segment decision: 'cooperation' (Collaborations) stays the
  // section's default, but once the pools have settled we auto-switch to
  // 'Services' when Collaborations has no entries while Services does — so a
  // first-time visitor lands on real content instead of an empty tab. If both
  // are empty, we stay on Collaborations, whose empty state then shows the
  // green collaborate-function placeholder cards (see
  // COLLABORATE_PLACEHOLDERS). Decided exactly once, and a manual tab click is
  // never overridden (the functional setState bails when the segment changed).
  const initialSegmentDecidedRef = useRef(false)
  useEffect(() => {
    if (initialSegmentDecidedRef.current) return
    const settled =
      !cooperationsLoading && !coopTypeLoading && !agentTypeLoading &&
      !bountiesLoading && !serviceTypeLoading &&
      !ownNetworkOffersLoading && !ownAgentOffersLoading && !ownServiceOffersLoading
    if (!settled) return
    initialSegmentDecidedRef.current = true
    const cooperationCount =
      cooperations.length + servicesCoopPool.length + agentOffersPool.length + openBounties.length
    if (cooperationCount === 0 && servicesServicePool.length > 0) {
      setServicesSegment(prev => (prev === 'cooperation' ? 'Services' : prev))
    }
  }, [
    cooperationsLoading, coopTypeLoading, agentTypeLoading, bountiesLoading, serviceTypeLoading,
    ownNetworkOffersLoading, ownAgentOffersLoading, ownServiceOffersLoading,
    cooperations.length, servicesCoopPool.length, agentOffersPool.length, openBounties.length,
    servicesServicePool.length,
  ])

  // Services slider loading: only the active segment's pool gates the
  // skeleton, so one slow query never blocks the unrelated tabs. `offers`
  // and `cooperations` (the Cooperation entities, not the COOP-type offer
  // pool) are only actually read by this slider on the 'cooperation' segment
  // (servicesItemsFiat concats `cooperations` there) — `/api/cooperations/
  // discover` can take seconds over a slow link (FU-301-D), so unconditionally
  // OR-ing cooperationsLoading in here (as a previous version did) forced the
  // inactive tab to sit on a skeleton waiting for data it never renders, even
  // after the rest of the page (including the Marketplace slider right below)
  // had already settled.
  const providerLoading = servicesSegment === 'cooperation'
    ? (cooperationsLoading || coopTypeLoading || agentTypeLoading || bountiesLoading)
    : servicesSegment === 'agents' ? agentTypeLoading
    : serviceTypeLoading

  const servicesFilteredOffers = useMemo(() => {
    if (servicesSegment === 'agents') {
      // Agent-only filter tab — shows AGENT_SETUP offers exclusively.
      return agentOffersPool
    }
    if (servicesSegment === 'cooperation') {
      // Collaborations = Cooperation entities + COOP-type offers only. Services
      // already have their own tab (above) — the segment's count badge only
      // counts COOP-type offers, so the item list must match it 1:1.
      return servicesCoopPool
    }
    // 'Services' — offerType is the authoritative signal, same field
    // BuyDashboard's own Services quick-filter uses (now applied server-side
    // by useOffersByType, matching Explore's list 1:1).
    return servicesServicePool
  }, [servicesCoopPool, servicesServicePool, agentOffersPool, servicesSegment])

  // Newest first — the default sort of the removed slider filter chips.
  const applyDisplayFilters = (base: typeof offers): typeof offers => {
    return [...base].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  const servicesDisplayOffers = useMemo(
    () => applyDisplayFilters(servicesFilteredOffers),
    [servicesFilteredOffers],
  )

  // Per-segment loading flags (independent of which tab is active) so an
  // inactive tab whose query hasn't resolved yet renders a loading indicator
  // instead of looking identical to "genuinely empty" (see SliderSegment.loading).
  // `providerLoading` above stays the sole gate for the active tab's card-row
  // skeleton — this is purely an additional visibility layer for the others.
  const servicesSegments = useMemo(() => [
    { id: 'cooperation', label: 'Collaborations', count: cooperations.length + servicesCoopPool.length + agentOffersPool.length + openBounties.length, loading: cooperationsLoading || coopTypeLoading || agentTypeLoading || bountiesLoading },
    { id: 'Services', label: 'Services', count: servicesServicePool.length, loading: serviceTypeLoading },
    // ADR-368 follow-up: dedicated Agent toggle-filter next to the segments —
    // shows AGENT_SETUP offers only.
    { id: 'agents', label: 'Agents', count: agentOffersPool.length, loading: agentTypeLoading },
  ], [servicesServicePool, servicesCoopPool, agentOffersPool, cooperations, openBounties, serviceTypeLoading, cooperationsLoading, coopTypeLoading, agentTypeLoading, bountiesLoading])

  const mapOfferToSliderItem = (offer: (typeof offers)[number]) => ({
    id: offer.id,
    title: offer.title,
    // ADR-295: slider cards show visible text, never stored rich-text markup
    description: offer.description ? richTextToPlainText(offer.description) : undefined,
    providerName: toNpub(offer.creatorPubkey) ?? offer.creator?.lnAddress ?? offer.creatorPubkey.slice(0, 14),
    createdAt: offer.createdAt,
    // ADR-368 follow-up: AGENT_SETUP offers carry the "Agent" chip so the
    // Agents slider segment reads clearly even without a taxonomy category.
    category: offer.offerType === 'AGENT_SETUP' ? 'Agent' : (offer.categoryCode ?? undefined),
    rating: offer.sellerStats?.rating,
    reviewCount: offer.sellerStats?.reviewCount,
    priceSats: offer.priceSats,
    priceRange: foreignPriceText(offer) ?? `${formatNumber(offer.priceSats)} sats`,
    priceLabel: foreignPriceText(offer) ?? undefined,
    avatarUrl: offer.images?.[0],
    entityType: 'offer' as const,
    isAgent: offer.offerType === 'AGENT_SETUP',
  })

  const mapCoopToSliderItem = (c: CoopItem) => ({
    // CoopItem.images arrives pre-parsed (string[]) and description already
    // plain-text via coopToCoopItem (ADR-295) — no JSON-string handling here.
    id: c.id,
    title: c.title,
    description: c.description ?? '',
    providerName: toNpub(c.initiatorPubkey) ?? (c.initiatorPubkey ?? '').slice(0, 14),
    createdAt: c.createdAt,
    category: c.categoryCode ?? 'services/cooperation',
    priceSats: c.budgetSats,
    priceRange: `${formatNumber(c.budgetSats ?? 0)} sats`,
    avatarUrl: c.images?.[0],
  })

  // Bounties (open AgentTasks) — same provider-card shape; description is the
  // shared offers WYSIWYG HTML, so slider text goes through richTextToPlainText
  // like every other card (ADR-295).
  const mapBountyToSliderItem = (b: HomeBounty) => ({
    id: b.id,
    title: b.title,
    description: b.description ? richTextToPlainText(b.description) : undefined,
    providerName: toNpub(b.creatorPubkey) ?? (b.creatorPubkey ?? '').slice(0, 14),
    createdAt: b.createdAt,
    category: 'Bounty',
    priceSats: b.budgetSats ?? undefined,
    priceRange: `${formatNumber(b.budgetSats ?? 0)} sats`,
    avatarUrl: Array.isArray(b.images) && b.images.length > 0 ? b.images[0] : undefined,
  })

  // Proximity grouping mirrors the Marketplace slider's "Nearby" tab: nearby
  // (exact-city, tier 0) offers come first, then a region divider, then broader
  // region (country, tier 1) offers. Both groups already carry the active display
  // filters/sort from servicesDisplayOffers. `tier` is inlined here because the
  // shared `proximityTier` helper is defined further down (would hit the TDZ).
  const SERVICES_NEARBY_CAP = 8
  const SERVICES_TOTAL_CAP = 16
  const servicesItems = useMemo(() => {
    const tier = (o: (typeof offers)[number]): number => {
      if (offerMatchesUserCity(o, userCity)) return 0
      if (userCountry && o.country === userCountry) return 1
      return 2
    }
    const nearby     = servicesDisplayOffers.filter(o => tier(o) === 0)
    const regionOnly = servicesDisplayOffers.filter(o => tier(o) === 1)

    let offerItems: SliderListItem[]
    if (nearby.length === 0) {
      // No exact-city services — prefer region (country) before the full pool,
      // mirroring the Marketplace slider so a city without services still shows
      // the user's region instead of worldwide offers.
      const filtered = regionOnly.length > 0 ? regionOnly : servicesDisplayOffers
      offerItems = filtered.slice(0, SERVICES_TOTAL_CAP).map(mapOfferToSliderItem)
    } else if (regionOnly.length === 0) {
      offerItems = nearby.slice(0, SERVICES_TOTAL_CAP).map(mapOfferToSliderItem)
    } else {
      const nearbyShown = nearby.slice(0, SERVICES_NEARBY_CAP)
      const regionCap   = Math.max(0, SERVICES_TOTAL_CAP - nearbyShown.length)
      const regionShown = regionOnly.slice(0, regionCap)
      offerItems = [
        ...nearbyShown.map(mapOfferToSliderItem),
        { id: MARKETPLACE_REGION_DIVIDER_ID, title: '', category: '' },
        ...regionShown.map(mapOfferToSliderItem),
      ]
    }

    if (servicesSegment === 'cooperation') {
      const coopItems = cooperations.slice(0, 8).map(mapCoopToSliderItem)
      const bountyItems = openBounties.slice(0, 8).map(mapBountyToSliderItem)
      const agentItems = agentOffersPool.slice(0, 8).map(o => ({ ...mapOfferToSliderItem(o), category: 'Agent' }))
      return [...offerItems, ...coopItems, ...bountyItems, ...agentItems]
    }
    return offerItems
  }, [servicesDisplayOffers, servicesSegment, cooperations, openBounties, agentOffersPool, userCity, userCountry, formatNumber])

  // Empty state of the Collaborations segment: instead of the rotating
  // Coop-guide carousel, show the green collaborate-function placeholder cards
  // (Tickets & Offers pattern). Gated on every pool that can feed the tab so
  // the row never flashes before the skeleton resolves.
  const ownCooperationLoading = ownNetworkOffersLoading || ownAgentOffersLoading
  const showCooperationPlaceholders =
    servicesSegment === 'cooperation' && !providerLoading && !ownCooperationLoading && servicesItems.length === 0

  // ── Tickets & Offers slider (personal — mirrors SellDashboard's "Tickets & Offers") ──
  // ADR-422: a signed-in viewer's own listings come from the owner-scoped slim
  // query, never from `offers` (the global newest-100 window: an older seller's
  // listings sit outside it, so "My Offers" and the KPI tiles showed 0).
  // Logged out, the tab keeps showing the public feed as before.
  const { data: myOffersSlim, isLoading: myOffersLoading } = useMyActiveOffersSlim(pubkey)
  const filteredSellOffers = useMemo(
    () => (pubkey ? (myOffersSlim?.offers ?? []) : offers).map(toMyOfferCard),
    [pubkey, myOffersSlim, offers],
  )
  const sellOffersCount = pubkey ? (myOffersSlim?.total ?? filteredSellOffers.length) : filteredSellOffers.length
  const sellOffersLoading = pubkey ? myOffersLoading : offersLoading

  const ticketSegments = useMemo(() => [
    { id: 'my-offers', label: 'My Offers', count: sellOffersCount, loading: sellOffersLoading },
    { id: 'my-tickets', label: 'My Tickets', count: activeTickets.length, loading: ticketsLoading },
  ], [activeTickets.length, sellOffersCount, sellOffersLoading, ticketsLoading])

  // 'my-offers' is backed by the `offers` query, 'my-tickets' by the separate
  // `tickets` query — they resolve independently, so the card-row skeleton
  // must follow whichever one actually backs the active tab. A hardcoded
  // `ticketsLoading` here previously showed a stale/premature "no offers"
  // flash whenever the tickets query settled first (smaller payload).
  const ticketsSliderLoading = activeTicketSegment === 'my-tickets' ? ticketsLoading : sellOffersLoading

  const ticketInfoCards = useMemo(() => ({
    'my-tickets': {
      title: 'Tickets',
      description: 'Track your active orders and services.',
    },
    'my-offers': {
      title: 'Offers',
      description: 'Your published listings and services.',
    },
  }), [])

  const ticketItems = useMemo(() => {
    switch (activeTicketSegment) {
      case 'my-tickets':
        return activeTickets.slice(0, 8).map(ticket => ({
          id: ticket.id,
          title: ticket.offer.title,
          category: ticket.offerType === 'PRODUCT' ? 'Product' : 'Service',
          status: ticket.status,
          statusLabel: STATUS_LABEL_MAP[ticket.status],
          priceSats: ticket.amountSats ?? ticket.offer.priceSats,
          entityType: 'ticket' as const,
          avatarUrl: ticket.offer.images?.[0],
          providerName: toNpub(ticket.sellerPubkey) ?? undefined,
          createdAt: ticket.createdAt,
        }))
      case 'my-offers':
        // ADR-422: the cap used to be 8, which hid a seller's older listings —
        // the row is horizontally scrollable, so it can carry more. 16 covers
        // the common case and matches the Services slider's total cap.
        return filteredSellOffers.slice(0, MY_OFFERS_SLIDER_CAP).map(offer => ({
          id: offer.id,
          title: offer.title,
          category: offer.categoryCode,
          priceSats: offer.priceSats,
          entityType: 'offer' as const,
          avatarUrl: offer.avatarUrl,
          createdAt: offer.createdAt,
        }))
      default:
        return []
    }
  }, [activeTicketSegment, activeTickets, filteredSellOffers])

  const ticketEmptyPlaceholders = useMemo<GuidePlaceholderItem[]>(() => {
    const info = ticketInfoCards[activeTicketSegment]
    const infoCard: GuidePlaceholderItem = {
      id: `info-${activeTicketSegment}`,
      topic: info.title,
      icon: activeTicketSegment === 'my-tickets' ? TicketIcon : Package,
      text: info.description,
      cta: activeTicketSegment === 'my-tickets' ? 'View tickets' : 'Create offer',
      to: activeTicketSegment === 'my-tickets' ? '/tickets' : '/sell/listings/new?type=PRODUCT&mode=listings',
    }
    return [infoCard, ...GUIDE_PLACEHOLDERS]
  }, [activeTicketSegment, ticketInfoCards])

  const handleTicketCardClick = useCallback((id: string) => {
    if (activeTicketSegment === 'my-tickets') navigate(`/tickets/${id}`)
    else navigate(`/offers/${id}`)
  }, [activeTicketSegment, navigate])

  const handleTicketLinkClick = useCallback(() => {
    if (activeTicketSegment === 'my-tickets') navigate('/tickets')
    else navigate('/sell/listings')
  }, [activeTicketSegment, navigate])

  // ── Compact Marketplace teaser (proximity-first, reputation tiebreak, last 30) ──
  const proximityTier = (o: (typeof offers)[number]): number => {
    if (offerMatchesUserCity(o, userCity)) return 0
    if (userCountry && o.country === userCountry) return 1
    return 2
  }

  const [marketplaceProximity, setMarketplaceProximity] = useState('nearby')

  // Tabs are inclusive/expanding radii: Nearby ⊂ Region ⊂ Worldwide.
  // Counts come from `localBaseOffers` so the segment counts line up with what
  // the Marketplace slider actually shows.
  const marketplaceSegments = useMemo(() => [
    { id: 'nearby', label: 'Nearby', count: proximityPool.filter(o => proximityTier(o) === 0).length },
    { id: 'region', label: 'Region', count: proximityPool.filter(o => proximityTier(o) <= 1).length },
    { id: 'world', label: 'Worldwide', count: localBaseOffers.length },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [localBaseOffers, proximityPool, userCity, userCountry])

  // Auto-select the first proximity tab with entries, mirroring the Services &
  // Collaborations segment auto-switch above: a first-time visitor (no city yet)
  // would otherwise land on an empty "Nearby" tab. Nearby ⊂ Region ⊂ Worldwide,
  // so prefer the closest non-empty tier; if the whole pool is empty we stay on
  // Nearby (its empty state shows). A manual tab click always wins and is never
  // overridden — until then the tab keeps re-evaluating, which also self-corrects
  // the async arrival of the default country pref.
  const marketplaceManualRef = useRef(false)
  const handleMarketplaceSegmentChange = useCallback((id: string) => {
    marketplaceManualRef.current = true
    setMarketplaceProximity(id)
  }, [])

  useEffect(() => {
    if (offersLoading || countryOffersLoading || marketplaceManualRef.current) return
    const nearbyCount = proximityPool.filter(o => proximityTier(o) === 0).length
    const regionCount = proximityPool.filter(o => proximityTier(o) <= 1).length
    const desired =
      nearbyCount > 0 ? 'nearby'
        : regionCount > 0 ? 'region'
          : localBaseOffers.length > 0 ? 'world'
            : 'nearby'
    setMarketplaceProximity(prev => (prev === desired ? prev : desired))
    // proximityTier/logic close over userCity/userCountry — listed in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offersLoading, countryOffersLoading, localBaseOffers, proximityPool, userCity, userCountry])

  // Nearby/Region can legitimately be empty (no userCity/userCountry set, or no local
  // offers yet) — fall back to the full pool rather than showing nothing, mirroring
  // the same fallback already used for localBaseOffers above. `usedFallback` is
  // surfaced separately so the subtitle can tell the user this happened.
  // Source is `localBaseOffers` (newest-first, no chip filters) — Products/Services
  // use the same source.
  //
  // "Nearby" tab expands the radius seamlessly: exact-city (tier 0) results are
  // shown first, then a subtle vertical divider, then broader-region (tier 1)
  // results. Caps keep each group visible (~20 nearby, fill remaining with region)
  // so neither group gets starved by a one-sided sort.
  const NEARBY_GROUP_CAP = 20
  const MARKETPLACE_TOTAL_CAP = 30
  const { items: compactMarketplaceItems, usedFallback: marketplaceUsedFallback } = useMemo(() => {
    if (marketplaceProximity === 'nearby') {
      const nearby      = proximityPool.filter(o => proximityTier(o) === 0)
      const regionOnly  = proximityPool.filter(o => proximityTier(o) === 1)

      if (nearby.length === 0) {
        const usedFallback = regionOnly.length === 0 && localBaseOffers.length > 0
        const filtered = regionOnly.length > 0 ? regionOnly : localBaseOffers
        return {
          items: applyDisplayFilters(filtered).map(mapOfferToSliderItem).slice(0, MARKETPLACE_TOTAL_CAP),
          usedFallback,
        }
      }
      if (regionOnly.length === 0) {
        return {
          items: applyDisplayFilters(nearby).map(mapOfferToSliderItem).slice(0, MARKETPLACE_TOTAL_CAP),
          usedFallback: false,
        }
      }

      const nearbyShown = nearby.slice(0, NEARBY_GROUP_CAP)
      const regionCap   = Math.max(0, MARKETPLACE_TOTAL_CAP - nearbyShown.length)
      const regionShown = regionOnly.slice(0, regionCap)
      const nearbyItems = applyDisplayFilters(nearbyShown).map(mapOfferToSliderItem)
      const regionItems = applyDisplayFilters(regionShown).map(mapOfferToSliderItem)
      const divider: SliderListItem = {
        id: MARKETPLACE_REGION_DIVIDER_ID,
        title: '',
        category: '',
      }
      return {
        items: [...nearbyItems, divider, ...regionItems],
        usedFallback: false,
      }
    }

    const maxTier = marketplaceProximity === 'region' ? 1 : 2
    const tierMatches = (marketplaceProximity === 'region' ? proximityPool : localBaseOffers).filter(o => proximityTier(o) <= maxTier)
    const usedFallback = tierMatches.length === 0 && localBaseOffers.length > 0
    const filtered = tierMatches.length > 0 ? tierMatches : localBaseOffers
    return {
      items: applyDisplayFilters(filtered).map(mapOfferToSliderItem).slice(0, MARKETPLACE_TOTAL_CAP),
      usedFallback,
    }
  }, [localBaseOffers, proximityPool, marketplaceProximity, userCity, userCountry, formatNumber])

  // ── Marketplace custom item renderer ───────────────────────────────────────
  // Returns the divider component for the sentinel id, otherwise `null` to fall
  // back to SliderList's default variant card (ProviderCard here).
  const marketplaceRenderItem = useCallback((item: SliderListItem) => {
    if (item.id === MARKETPLACE_REGION_DIVIDER_ID) return <MarketplaceRegionDivider />
    return null
  }, [])

  // ── Marketplace rotating subtitle — fallback notice (if any) + inviting/explanatory copy ──
  const MARKETPLACE_SUBTITLE_MESSAGES = [
    'Fresh offers from Bitcoin-native sellers — tap a card to view details.',
    'Add items to your basket and check out with Lightning in seconds.',
    'Switch between Nearby, Region and Worldwide to explore further out.',
  ]

  const marketplaceSubtitleMessages = useMemo(() => {
    if (!marketplaceUsedFallback) return MARKETPLACE_SUBTITLE_MESSAGES
    const scope = marketplaceProximity === 'nearby' ? 'nearby' : 'in your region'
    return [`No offers found ${scope} yet — showing offers from everywhere instead.`, ...MARKETPLACE_SUBTITLE_MESSAGES]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplaceUsedFallback, marketplaceProximity])

  const [marketplaceSubtitleIndex, setMarketplaceSubtitleIndex] = useState(0)

  useEffect(() => {
    setMarketplaceSubtitleIndex(0)
  }, [marketplaceSubtitleMessages])

  useEffect(() => {
    if (prefersReduced || marketplaceSubtitleMessages.length <= 1) return
    const id = setInterval(() => {
      setMarketplaceSubtitleIndex(i => (i + 1) % marketplaceSubtitleMessages.length)
    }, 8000)
    return () => clearInterval(id)
  }, [marketplaceSubtitleMessages, prefersReduced])

  const marketplaceSubtitle = marketplaceSubtitleMessages[marketplaceSubtitleIndex] ?? marketplaceSubtitleMessages[0]

  // ── Tickets & Offers rotating subtitle — explains ticket + escrow + dispute benefits ──
  const TICKETS_SUBTITLE_MESSAGES = [
    'Every ticket tracks the order from request to confirmed delivery — paid directly, no platform holding your funds.',
    'Open a dispute anytime. The Council arbitrates and enforces the outcome.',
    'Track every milestone in one place — from order to delivery to release.',
    'Lightning-fast checkout, on-chain proof — receipts that follow you, not the platform.',
    'Cancel, refund or complete with one tap. No middlemen, no waiting weeks.',
  ]

  const [ticketsSubtitleIndex, setTicketsSubtitleIndex] = useState(0)

  useEffect(() => {
    setTicketsSubtitleIndex(0)
  }, [TICKETS_SUBTITLE_MESSAGES.length])

  useEffect(() => {
    if (prefersReduced || TICKETS_SUBTITLE_MESSAGES.length <= 1) return
    const id = setInterval(() => {
      setTicketsSubtitleIndex(i => (i + 1) % TICKETS_SUBTITLE_MESSAGES.length)
    }, 5000)
    return () => clearInterval(id)
  }, [prefersReduced])

  const ticketsSubtitle = TICKETS_SUBTITLE_MESSAGES[ticketsSubtitleIndex] ?? TICKETS_SUBTITLE_MESSAGES[0]

  // ── New Local Partners rotating subtitle — sells the partner discovery feature ──
  const PARTNERS_SUBTITLE_MESSAGES = [
    'Discover sellers and companies in your area — sorted by activity, not ad spend.',
    'Reputation you carry with you. Portable Nostr identity, no platform lock-in.',
    'From neighbors to networks — build trusted relationships beyond the marketplace.',
    'Switch between People and Companies to find the right kind of partner.',
    'New partners every day. No algorithms, no paid placements — just the network.',
  ]

  const [partnersSubtitleIndex, setPartnersSubtitleIndex] = useState(0)

  useEffect(() => {
    setPartnersSubtitleIndex(0)
  }, [PARTNERS_SUBTITLE_MESSAGES.length])

  useEffect(() => {
    if (prefersReduced || PARTNERS_SUBTITLE_MESSAGES.length <= 1) return
    const id = setInterval(() => {
      setPartnersSubtitleIndex(i => (i + 1) % PARTNERS_SUBTITLE_MESSAGES.length)
    }, 5000)
    return () => clearInterval(id)
  }, [prefersReduced])

  const partnersSubtitle = PARTNERS_SUBTITLE_MESSAGES[partnersSubtitleIndex] ?? PARTNERS_SUBTITLE_MESSAGES[0]

  // ── Services & Collaborations rotating subtitle ──
  const SERVICES_SUBTITLE_MESSAGES = [
    'In your area — services from providers near you.',
    'Hire solo or partner up — combine skills, split earnings, fully peer-to-peer.',
    'Payments go per milestone. Work gets paid as it gets done.',
    'Switch between Services and Collaborations to match the work you need.',
    'Open contracts, transparent terms — no agencies, no platform cut.',
  ]

  const [servicesSubtitleIndex, setServicesSubtitleIndex] = useState(0)

  useEffect(() => {
    setServicesSubtitleIndex(0)
  }, [SERVICES_SUBTITLE_MESSAGES.length])

  useEffect(() => {
    if (prefersReduced || SERVICES_SUBTITLE_MESSAGES.length <= 1) return
    const id = setInterval(() => {
      setServicesSubtitleIndex(i => (i + 1) % SERVICES_SUBTITLE_MESSAGES.length)
    }, 5000)
    return () => clearInterval(id)
  }, [prefersReduced])

  const servicesSubtitle = SERVICES_SUBTITLE_MESSAGES[servicesSubtitleIndex] ?? SERVICES_SUBTITLE_MESSAGES[0]

  // Mobile-only quick-search chips for the "Services & Collaborations" slider,
  // shown below its Providers/Cooperations tab bar (SearchHeroSection shows the
  // static SEARCH_CHIPS row instead from tablet (md) upward). Sourced from the
  // categories with the most offers, capped at the same count as SEARCH_CHIPS.
  const mobileServiceChips = useMemo(
    () => buildCategoryFilterChips(standardCategories, categoryCounts, SEARCH_CHIPS.length),
    [standardCategories, categoryCounts],
  )

  // ── Home KPI Strip ────────────────────────────────────────────────────────
  // ADR-334 D3: every headline number comes from /api/stats (server-aggregated
  // totals), NOT from the 30-row useAllOffers slider window. "Services" is
  // DRYed to SERVICE-only — COOP-type offers are network cooperations and live
  // in the coop surfaces (matches Search/BuyDashboard).
  const marketplaceKpiItems = useMemo(() => {
    const offersTotal    = ecosystemStats?.offers?.total ?? 0
    const services       = ecosystemStats?.offers?.services ?? 0
    const products       = ecosystemStats?.offers?.products ?? 0
    const totalSats      = ecosystemStats?.offers?.totalSats ?? 0
    const uniqueProviders = ecosystemStats?.providers ?? 0

    return [
      {
        value: offersTotal,
        label: 'Offers',
        icon: <Label sx={{ fontSize: 14 }} />,
        heading: 'Marketplace',
        tooltip: 'All active marketplace offers',
        onClick: () => scrollToMarketplace(),
      },
      {
        value: services,
        label: 'Services',
        icon: <Work sx={{ fontSize: 14 }} />,
        tooltip: 'Available services',
        onClick: () => scrollToMarketplace(),
      },
      {
        value: products,
        label: 'Products',
        icon: <Inventory2 sx={{ fontSize: 14 }} />,
        tooltip: 'Available products',
        onClick: () => scrollToMarketplace(),
      },
      {
        value: uniqueProviders,
        label: 'Providers',
        icon: <Group sx={{ fontSize: 14 }} />,
        tooltip: `${uniqueProviders} unique providers on the marketplace`,
      },
      {
        value: formatSatsNumber(totalSats),
        label: 'Market Val.',
        icon: <CurrencyBitcoin sx={{ fontSize: 14 }} />,
        tooltip: `Total value of all listed offers: ${formatNumber(totalSats)} sats${kpiFiatHint(totalSats)}`,
      },
    ] as KPIItem[]
  }, [ecosystemStats, scrollToMarketplace, formatNumber, kpiFiatHint])

  const activityKpiItems = useMemo(() => {
    if (!pubkey) return []

    const completedSales  = tickets.filter(t => t.sellerPubkey === pubkey && t.status === 'COMPLETED')
    const completedBuys   = tickets.filter(t => t.buyerPubkey  === pubkey && t.status === 'COMPLETED')
    const cutoff30d       = Date.now() - 30 * 86400000
    const rev30d          = completedSales
      .filter(t => new Date(t.createdAt).getTime() >= cutoff30d)
      .reduce((sum, t) => sum + (t.amountSats ?? t.offer?.priceSats ?? 0), 0)

    const items: KPIItem[] = [
      {
        value: activeTickets.length,
        label: 'Active',
        icon: <ConfirmationNumber sx={{ fontSize: 14 }} />,
        heading: 'My Activity',
        tooltip: 'Your currently active tickets',
        onClick: () => navigate('/tickets'),
      },
      {
        value: sellOffersCount,
        label: 'My Offers',
        icon: <Store sx={{ fontSize: 14 }} />,
        tooltip: 'Your published offers',
        onClick: () => navigate('/sell'),
      },
      {
        value: completedCount,
        label: 'Deals Done',
        icon: <Check sx={{ fontSize: 14 }} />,
        tooltip: 'Total completed transactions',
      },
      {
        value: completedSales.length,
        label: 'Sales',
        icon: <TrendingUp sx={{ fontSize: 14 }} />,
        tooltip: 'Completed sales as seller',
        onClick: () => navigate('/sell'),
      },
      {
        value: completedBuys.length,
        label: 'Purchases',
        icon: <ShoppingCart sx={{ fontSize: 14 }} />,
        tooltip: 'Completed purchases as buyer',
        onClick: () => navigate('/tickets'),
      },
      {
        value: formatSatsNumber(rev30d),
        label: 'Rev 30d',
        icon: <Bolt sx={{ fontSize: 14 }} />,
        separator: true,
        tooltip: `Your revenue as seller in the last 30 days (sats)${kpiFiatHint(rev30d)}`,
        onClick: () => navigate('/sell/company'),
      },
    ]

    return items
  }, [sellOffersCount, tickets, pubkey, activeTickets.length, completedCount, balance, navigate, kpiFiatHint, formatNumber, scrollToMarketplace])

  // Ecosystem KPI (Nostr network ingest count) — rendered as its own heading
  // section, placed BEFORE the PROFILE section in heroKpiItems.
  // ADR-334 D4: value comes from /api/stats now (same roundtrip as the
  // marketplace KPIs above), replacing the separate useRemoteOfferCount query.
  const remoteOfferCount = ecosystemStats?.remoteOffers ?? 0
  const ecosystemKpiItems = useMemo((): KPIItem[] => {
    if (!pubkey) return []
    return [{
      value: formatNumber(remoteOfferCount),
      label: 'Nostr Network',
      icon: <Language sx={{ fontSize: 14 }} />,
      heading: 'Ecosystem',
      tooltip: `${formatNumber(remoteOfferCount)} listings ingested live from the wider Nostr marketplace network`,
      onClick: () => scrollToMarketplace(),
    }]
  }, [pubkey, remoteOfferCount, formatNumber, scrollToMarketplace])

  const npub = toNpub(pubkey)
  const displayName = npub ? `${npub.slice(0, 12)}…` : 'Guest'

  useEffect(() => {
    try {
      const key = 'kpi-home-dashboard'
      const raw = localStorage.getItem(key)
      const set = raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>()
      if (!set.has('Stats')) {
        set.add('Stats')
        localStorage.setItem(key, JSON.stringify([...set]))
      }
    } catch { /* ignore */ }
  }, [])

  const userDashKpiItems = useMemo((): KPIItem[] => {
    if (!pubkey) return []
    return [
      {
        value: userName || (lnAddress ? lnAddress.split('@')[0] : displayName),
        label: lnAddress ? `⚡ ${lnAddress}` : npub ? `L${userIdentityLevel} · ${npub.slice(0, 12)}…` : `L${userIdentityLevel}`,
        icon: <Person sx={{ fontSize: 16 }} />,
        avatarUrl: userPicture ?? undefined,
        bannerUrl: userBanner ?? undefined,
        tooltip: `${userName ? `${userName} · ` : ''}${lnAddress ? `${lnAddress} · ` : ''}${npub ? `${npub.slice(0, 24)}…` : ''}`,
        heading: 'PROFILE',
        headingBadge: unreadCount > 0,
        onClick: () => navigate('/account'),
        active: true,
        activeColor: userIdentityLevel === 0 ? '#9e9e9e' : userIdentityLevel === 1 ? '#1976d2' : userIdentityLevel === 2 ? '#7b1fa2' : '#f57f17',
        actions: [
          {
            icon: <Logout sx={{ fontSize: 14 }} />,
            label: 'Logout',
            onClick: async () => {
              await logout()
              window.location.href = '/'
            },
          },
        ],
      },
      {
        value: '',
        label: '',
        fitContent: true,
        icon: theme === 'dark' ? <LightMode sx={{ fontSize: 18 }} /> : <DarkMode sx={{ fontSize: 18 }} />,
        tooltip: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        onClick: toggleTheme,
      },
      {
        value: '',
        label: '',
        fitContent: true,
        icon: <Notifications sx={{ fontSize: 18 }} />,
        badge: unreadCount > 0,
        tooltip: unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications',
        onClick: () => navigate('/notifications'),
      },
      ...(userCity || userCountry ? [{
        value: userCity || (COUNTRIES.find(c => c.code === userCountry)?.name ?? userCountry),
        label: userCountry ? userCountry : 'Location',
        icon: <LocationOn sx={{ fontSize: 16 }} />,
        tooltip: [userCity, COUNTRIES.find(c => c.code === userCountry)?.name].filter(Boolean).join(', '),
        onClick: () => navigate('/settings'),
      }] : []),
      {
        value: balance !== null ? formatSatsNumber(balance) : '—',
        label: walletProvider
          ? `${walletProviderShortLabel(walletProvider)} · Balance`
          : 'Balance',
        icon: <Wallet sx={{ fontSize: 16 }} />,
        heading: 'Wallet',
        tooltip: balance !== null
          ? `${formatNumber(balance)} sats${kpiFiatHint(balance)}${walletProvider ? ` · ${walletProviderShortLabel(walletProvider)}` : ''}`
          : walletProvider
            ? `Wallet: ${walletProviderShortLabel(walletProvider)}`
            : undefined,
        onClick: () => navigate('/wallet'),
      },
      {
        value: sellOffersCount,
        label: 'Offers',
        icon: <Store sx={{ fontSize: 16 }} />,
        tooltip: 'Your published offers',
        onClick: () => navigate('/sell'),
      },
      {
        value: activeTickets.length,
        label: 'Tickets',
        icon: <ConfirmationNumber sx={{ fontSize: 16 }} />,
        tooltip: 'Your active tickets',
        onClick: () => navigate('/tickets'),
      },
      {
        value: completedCount,
        label: 'Done',
        icon: <Check sx={{ fontSize: 16 }} />,
        tooltip: 'Completed transactions',
      },
    ]
  }, [pubkey, npub, balance, formatNumber, sellOffersCount, activeTickets.length, completedCount, navigate, lnAddress, displayName, userIdentityLevel, userPicture, userBanner, userName, userCity, userCountry, theme, toggleTheme, kpiFiatHint, unreadCount, walletProvider])

  const heroKpiItems = useMemo((): KPIItem[] => {
    if (!pubkey) return marketplaceKpiItems
    return [...ecosystemKpiItems, ...userDashKpiItems, ...activityKpiItems]
  }, [pubkey, ecosystemKpiItems, userDashKpiItems, activityKpiItems, marketplaceKpiItems])

  // ADR-235: white fiat chip next to sats in every slider card variant.
  const compactMarketplaceItemsFiat = useSliderItemsFiat(compactMarketplaceItems)
  const servicesItemsFiat = useSliderItemsFiat(servicesItems)
  const ticketItemsFiat = useSliderItemsFiat(ticketItems)

  // ADR-180: Partners slider — Users / Companies segment tabs.
  // Server-side aggregation in /api/partners. Self-exclusion happens client-side
  // for users. Both segments are fetched in parallel at mount (fixed query keys,
  // not gated by the active tab) so switching to "Companies" never triggers a
  // fresh round-trip — same prefetch-both-segments pattern as the "Services &
  // Collaborations" slider. Cheap (limit=12 each), so the extra request is worth
  // the instant tab switch.
  // FU-181-E: default `new=1` so the slider shows recent partners first.
  const [partnerSegment, setPartnerSegment] = useState<'users' | 'companies'>('users')
  type PartnersSegmentResult = {
    segment: 'users' | 'companies'
    items: Array<{
      pubkey?: string
      lnAddress?: string | null
      picture?: string | null
      id?: string
      name?: string
      logoUrl?: string | null
      offerCount: number
      ownerPubkey?: string
      firstOfferAt?: string | null
    }>
  }
  const fetchPartnersSegment = async (segment: 'users' | 'companies'): Promise<PartnersSegmentResult> => {
    const res = await apiCall(`/api/partners?segment=${segment}&sort=offers&new=1&limit=12`)
    return res.json()
  }
  const usersPartnersQuery = useQuery({
    queryKey: ['partners-slider', 'users'],
    queryFn: () => fetchPartnersSegment('users'),
    staleTime: 60_000,
    refetchInterval: POLL_INTERVAL,
  })
  const companiesPartnersQuery = useQuery({
    queryKey: ['partners-slider', 'companies'],
    queryFn: () => fetchPartnersSegment('companies'),
    staleTime: 60_000,
    refetchInterval: POLL_INTERVAL,
  })
  const activePartnersQuery = partnerSegment === 'companies' ? companiesPartnersQuery : usersPartnersQuery

  const partnerSegmentTabs = useMemo(() => [
    { id: 'users', label: 'People', loading: usersPartnersQuery.isLoading },
    { id: 'companies', label: 'Companies', loading: companiesPartnersQuery.isLoading },
  ], [usersPartnersQuery.isLoading, companiesPartnersQuery.isLoading])

  const partnerItems = useMemo(() => {
    const data = activePartnersQuery.data
    if (!data) return []
    if (data.segment === 'users') {
      return data.items
        .filter(p => !!p.pubkey && p.pubkey !== pubkey)
        .map(p => {
          const display = p.lnAddress || `${(p.pubkey ?? '').slice(0, 8)}…`
          return {
            id: p.pubkey!,
            title: display,
            providerName: toNpub(p.pubkey) ?? `${(p.pubkey ?? '').slice(0, 8)}…`,
            category: `${p.offerCount} ${p.offerCount === 1 ? 'offer' : 'offers'}`,
            avatarUrl: p.picture ?? undefined,
            entityType: 'person' as const,
            createdAt: p.firstOfferAt ?? undefined,
          }
        })
    }
    return data.items
      .filter(c => !!c.id)
      .map(c => ({
        id: c.id!,
        title: c.name ?? '',
        providerName: toNpub(c.ownerPubkey) ?? '',
        category: `${c.offerCount} ${c.offerCount === 1 ? 'offer' : 'offers'}`,
        avatarUrl: c.logoUrl ?? undefined,
        entityType: 'company' as const,
        createdAt: c.firstOfferAt ?? undefined,
      }))
  }, [activePartnersQuery.data, pubkey])

  const partnersLoading = activePartnersQuery.isLoading
  const partnerInfoCards = useMemo(() => ({
    users: {
      title: 'New local people',
      description: 'Independent providers, freelancers and creators who just published an offer in your area.',
      badges: [
        { label: 'Verified', color: 'var(--color-accent-3)', bg: 'rgba(42,232,102,0.12)' },
        { label: 'Reviews', color: 'var(--color-accent-1)', bg: 'rgba(107,177,255,0.12)' },
        { label: 'Freelancers', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.12)' },
      ],
    },
    companies: {
      title: 'New local companies',
      description: 'Small businesses and merchants on Colabonate. Tap a card to view their catalog.',
      badges: [
        { label: 'Verified', color: 'var(--color-accent-3)', bg: 'rgba(42,232,102,0.12)' },
        { label: 'Catalog', color: 'var(--color-accent-1)', bg: 'rgba(107,177,255,0.12)' },
        { label: 'Local', color: 'var(--color-accent-2)', bg: 'rgba(245,124,42,0.12)' },
      ],
    },
  }), [])

  // ── GSAP: ScrollTrigger Sections ──────────────────────────────────────────
  // Animate elements with the .section-animate class
  const providerRef = useSectionAnimation('.section-animate', {
    scrollTrigger: true, start: 'top 85%',
    from: { y: 32, duration: 0.55, stagger: 0.08 },
  })
  const partnersRef = useSectionAnimation('.section-animate', {
    scrollTrigger: true, start: 'top 85%',
    from: { scale: 0.94, duration: 0.45, stagger: 0.09 },
  })

  // ── GSAP: CTA ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || prefersReduced || !ctaRef.current) return
    let ctx: gsap.Context
    const id = requestAnimationFrame(() => {
      ctx = gsap.context(() => {
        gsap.from('.home-cta-section', {
          scrollTrigger: { trigger: ctaRef.current, start: 'top 88%', once: true },
          opacity: 0, y: 28, duration: 0.6, ease: 'power2.out', clearProps: 'opacity,transform',
        })
        gsap.to('.cta-pulse-btn', {
          scrollTrigger: { trigger: ctaRef.current, start: 'top 88%', once: true },
          scale: 1.035, duration: 1.4, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: 1.8,
        })
      })
    })
    return () => { cancelAnimationFrame(id); ctx?.revert() }
  }, [loading, prefersReduced])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
    <Seo
      description="Colabonate is a peer-to-peer marketplace to buy, sell and cooperate directly — with Bitcoin Lightning payments, Nostr identity and community escrow."
      path="/"
    />
    <PageContainer size="wide" spacing="lg" className="!mt-0 pt-0!" ref={heroRef}>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 2 – Welcome + Provider Overview
        ══════════════════════════════════════════════════════════════════════ */}
        <section ref={providerRef} className="provider-section" aria-label="Marketplace Interactions">

          {/* Search Hero — standalone, above the KPI Strip (logged-in users only).
              On mobile the Search card spans the full row and carries the
              Support action inline, next to Explore (see SearchHeroSection).
              From tablet (md) upward it becomes a two-column row: Search left,
              full Support-the-project card right. At xl the Search column keeps
              its natural width (xl:flex-none) so the support card absorbs the
              leftover space, as before. */}
          {pubkey && (
            <div className="hero-animate mb-3 md:mb-4 flex flex-row items-stretch gap-2 md:gap-3">
              <div className="min-w-0 flex-1 xl:flex-none h-full">
                <SearchHeroSection />
              </div>
              <div className="hidden md:block md:flex-1 min-w-0 h-full">
                <SupportProjectCard />
              </div>
            </div>
          )}

          {/* Hero + Dashboard / Login */}
          <div className={cn(
            'flex flex-col gap-2 md:gap-4 mb-3 lg:mb-8 mt-0.5 md:mt-1',
            !pubkey && 'lg:grid lg:grid-cols-[1fr_1fr]',
          )}>

            {/* ── Hero ──────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-1.5 hero-animate min-w-0">

              {/* KPI Overview – Marketplace + Profile + Stats (logged in) */}
              {!pubkey ? (
                /* Guest: Buy / Sell / Cooperate cards */
                <div className="grid grid-cols-3 items-stretch gap-2 hero-animate h-full">
                  {GUEST_HERO_CARDS.map((card, index) => {
                    const heroImageUrl = guestHeroImageUrls[index]
                    const dashboardRoute =
                      card.id === 'buy' ? '/buy' :
                      card.id === 'sell' ? '/sell' :
                      '/coop'
                    return (
                    <button
                      key={card.id}
                      onClick={() => navigate(dashboardRoute)}
                      className="group relative flex flex-col items-center justify-center p-3 rounded-xl border cursor-pointer transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.97] h-full overflow-hidden"
                      style={{
                        border: `1px solid ${card.color}30`,
                        background: card.bg,
                        minHeight: 72,
                      }}
                    >
                      {heroImageUrl && (
                        <div
                          className="absolute inset-0 bg-cover bg-center"
                          style={{
                            backgroundImage: `url(${heroImageUrl})`,
                            filter: 'blur(3px)',
                            transform: 'scale(1.05)',
                            opacity: 0.15,
                          }}
                        />
                      )}
                      <div className="relative z-10 flex flex-col items-center justify-center">
                        <div
                          className="flex items-center justify-center w-9 h-9 rounded-xl mb-2 transition-transform duration-200 group-hover:scale-110"
                          style={{ background: card.iconBg, color: card.iconColor }}
                        >
                          {card.icon}
                        </div>
                        <span
                          className="text-[13px] font-semibold leading-tight"
                          style={{ color: card.color }}
                        >
                          {card.title}
                        </span>
                        <span
                          className="text-[10px] leading-tight mt-0.5"
                          style={{ color: 'var(--theme-text-muted)' }}
                        >
                          {card.subtitle}
                        </span>
                      </div>
                    </button>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-0 hero-animate">
                  <KPIStrip
                    wrap
                    collapsible
                    storageKey="kpi-home-strip"
                    items={heroKpiItems}
                    loading={kpiLoading}
                    skeletonCount={11}
                  />
                </div>
              )}
            </div>

            {/* ── Login (guest) ──── */}
            {!pubkey && (
              <div className="hero-animate lg:min-w-0 flex flex-col gap-2 md:gap-4">
                <div className="flex items-center justify-center px-1">
                  <div
                    className="flex items-center justify-center w-8 h-8 rounded-lg"
                    style={{ background: 'var(--theme-bg-subtle)', color: 'var(--color-primary-50)' }}
                  >
                    <Fingerprint sx={{ fontSize: 18 }} />
                  </div>
                </div>
                <Login embedded />
              </div>
            )}
          </div>

          {/* Services & Collaborations Slider — above Marketplace's position */}
          <div className="mt-4 md:mt-8 mb-0 section-animate">
            <SliderList
              variant="provider"
              subtitle={servicesSubtitle}
              subtitleCollapsible
              title="Services & Collaborations"
              titleStyle={SECTION_TITLE_STYLE}
              loading={providerLoading}
              skeletonCount={8}
              enableDragScroll
              showArrows
              linkLabel="All"
              onLinkClick={() => navigate('/buy')}
              segments={servicesSegments}
              activeSegment={servicesSegment}
              onSegmentChange={setServicesSegment}
              headerSlot={isMobile && pubkey && mobileServiceChips.length > 0
                ? <SearchQuickChips chips={mobileServiceChips} className="flex" />
                : undefined}
              infoCards={showCooperationPlaceholders ? undefined : {
                cooperation: {
                  title: 'Partner Collaborations',
                  description: 'Partner with other providers. Combine skills and split earnings – fully peer-to-peer.',
                  badges: [
                    { label: 'Direct Pay', color: 'var(--color-accent-3)', bg: 'rgba(42,232,102,0.12)' },
                    { label: 'Milestones', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.12)' },
                    { label: 'P2P', color: 'var(--color-accent-1)', bg: 'rgba(107,177,255,0.12)' },
                  ],
                },
              }}
              onCardClick={(id) => {
                const bounty = openBounties.find(b => b.id === id)
                if (bounty) { navigate(`/bounties/${id}`); return }
                const coop = cooperations.find(c => c.id === id)
                if (coop) navigate(`/coop/${id}`)
                else navigate(`/offers/${id}`)
              }}
              renderItem={marketplaceRenderItem}
              items={servicesItemsFiat}
              secondSlot={showCooperationPlaceholders
                ? undefined
                : <GuidePlaceholderCarousel items={SERVICES_GUIDE_PLACEHOLDERS} />}
            >
              {showCooperationPlaceholders && COLLABORATE_PLACEHOLDERS.map((g) => (
                <GuidePlaceholderCard
                  key={g.id}
                  topic={g.topic}
                  icon={g.icon}
                  text={g.text}
                  cta={g.cta}
                  to={g.to}
                  accent={g.accent}
                  accentSoft={g.accentSoft}
                  badge={g.badge}
                  mobile={isMobile}
                />
              ))}
            </SliderList>
          </div>

          {/* Marketplace Slider — proximity-filtered (Nearby / Region / Worldwide) */}
          <div className="mt-4 md:mt-8 mb-0 section-animate" ref={marketplaceSectionRef}>
            <SliderList
              variant="provider"
              title="Marketplace"
              titleStyle={SECTION_TITLE_STYLE}
              subtitle={marketplaceSubtitle}
              subtitleCollapsible
              loading={marketplaceLoading}
              skeletonCount={8}
              enableDragScroll
              showArrows
              segments={marketplaceSegments}
              activeSegment={marketplaceProximity}
              onSegmentChange={handleMarketplaceSegmentChange}
              linkLabel="Open Marketplace"
              linkButton
              onLinkClick={() => navigate(`/buy?proximity=${marketplaceProximity}`)}
              onCardClick={(id) => navigate(`/offers/${id}`)}
              renderItem={marketplaceRenderItem}
              items={compactMarketplaceItemsFiat}
            />
          </div>

          {/* Tickets & Offers Slider (personal — logged-in only) */}
          {pubkey && (
            <div className="mt-4 md:mt-8 mb-0 section-animate">
              <SliderList
                variant={activeTicketSegment === 'my-tickets' ? 'ticket' : 'offer'}
                title="Tickets & Offers"
                titleStyle={SECTION_TITLE_STYLE}
                subtitle={ticketsSubtitle}
                subtitleCollapsible
                linkLabel="All"
                onLinkClick={handleTicketLinkClick}
                loading={ticketsSliderLoading}
                skeletonCount={8}
                enableDragScroll
                showArrows
                segments={ticketSegments}
                activeSegment={activeTicketSegment}
                onSegmentChange={(id) => setActiveTicketSegment(id as 'my-offers' | 'my-tickets')}
                infoCards={ticketItems.length > 0 ? ticketInfoCards : undefined}
                infoCardCompact
                onCardClick={handleTicketCardClick}
                items={ticketItemsFiat}
              >
                {ticketItems.length === 0 && (
                  <>
                    {ticketEmptyPlaceholders.map((g) => (
                      <GuidePlaceholderCard key={g.id} topic={g.topic} icon={g.icon} text={g.text} cta={g.cta} to={g.to} mobile={isMobile} />
                    ))}
                  </>
                )}
              </SliderList>
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION – Partners (ADR-180: Users | Companies segments)
        ══════════════════════════════════════════════════════════════════════ */}
        <section ref={partnersRef} className="partners-section" aria-label="Partner">
          <div className="mt-4 md:mt-8 mb-0 section-animate">
            <SliderList
              variant="partner-card"
              title="New Local Partners"
              titleStyle={SECTION_TITLE_STYLE}
              subtitle={partnersSubtitle}
              subtitleCollapsible
              linkLabel="All"
              onLinkClick={() => navigate('/coop?filter=partners')}
              loading={partnersLoading}
              skeletonCount={8}
              enableDragScroll
              segments={partnerSegmentTabs}
              activeSegment={partnerSegment}
              onSegmentChange={(id) => setPartnerSegment(id === 'companies' ? 'companies' : 'users')}
              infoCards={partnerItems.length > 0 ? partnerInfoCards : undefined}
              items={partnerItems}
              onCardClick={(id) => navigate(partnerSegment === 'companies' ? `/c/${id}` : `/u/${id}`)}
              secondSlot={<GuidePlaceholderCarousel items={ALL_PLACEHOLDERS} />}
            />
          </div>
        </section>

        {/* ADR-384 D9: Colabonate-hosted AI Assistant promo (credit packs, guest-purchasable) */}
        <AIAssistantPromoSection />

        {/* ═══════════════════════════════════════════════════════════════════
            SECTION – Why Colabonate? (Buy, Sell, Cooperate + Feature Grid)
        ══════════════════════════════════════════════════════════════════════ */}
        <WhyColabonateSection />

        {/* ADR-371 D6 — pre-footer "Connect your own agent via MCP" section */}
        <McpConnectSection />

      </PageContainer>

      <CartFAB
        bottomOffset="calc(58px + env(safe-area-inset-bottom, 0px) + 200px)"
        topOffset={250}
        scrollFade
      />
      <SearchFAB
        bottomOffset="calc(58px + env(safe-area-inset-bottom, 0px) + 136px)"
        topOffset={190}
        scrollFade
      />
      <FloatingAddButton
        offsetRight={40}
        offsetTop={130}
        actions={fabActions}
        scrollFade
        className="fab-layer"
      />
    </>
  )
}
