// Cooperation cards – GalleryCard + ListRow + EmptyState (ADR-110)
// Follows marketplace-cards.tsx pattern: S/M/L size config, icon area, AddToCoop GSAP button

import { useRef, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { Button } from '@mui/material'
import {
  Zap, MapPin, Calendar, Users, Handshake,
  Network, FolderKanban, FileText, Store, Search,
  Tag, Target, Bot, Package, BadgeCheck, Star, Frame,
} from 'lucide-react'
import { CARD_THEME } from '@ds/ui'
import { cn, useTheme, formatCompactDate } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { formatSatsNumber } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { useBreakpoint } from '../../hooks/useBreakpoint'

// Subtle colabonate-red radial glow anchored to the bottom-right of every card
// on hover. Same hue as the slider-list "add to basket" pulse, but ~70% as
// intense and stays put while hovered (no GSAP required). Pure CSS — `opacity-0`
// by default, fades in via `group-hover/card` over 500ms.
const HOVER_GLOW_BG = 'radial-gradient(circle at 85% 90%, rgba(232,69,65,0.22) 0%, rgba(232,69,65,0.07) 40%, transparent 70%)'

// ── Types ─────────────────────────────────────────────────────────────────────

// ADR-338: 'bounty' — an AgentTask (Bounty Board) row, mapped in via
// agentTaskToCoopItem (useCoopExploreData.ts) so it renders through the exact
// same CoopGalleryCard/CoopListRow primitives as every other coop item,
// instead of a separate special-cased render path.
// ADR-368 D4: 'agent' — an AGENT_SETUP offer; 'service' — a SERVICE offer;
// 'bundle' — a Cooperation with cooperationType === 'SERVICE'. All three map
// through the useCoopExploreData mappers (agentSetupToCoopItem /
// serviceOfferToCoopItem / coopToCoopItem) so they render side by side with
// tenders/projects/network/partners/bounties under the coop browse surfaces.
export type CoopItemType = 'offer' | 'project' | 'vendor' | 'network' | 'tender' | 'partner' | 'bounty' | 'agent' | 'service' | 'bundle'

export interface CoopItem {
  id: string
  title: string
  description?: string
  itemType: CoopItemType
  status?: string
  category?: string
  /** UNSPSC slug path for CategorySidebar prefix-matching (e.g. 'goods/food') */
  categoryCode?: string | null
  /** Multi-value variant of categoryCode, for items with several assigned categories (Company/Partner) */
  categoryCodes?: string[]
  // ADR-277 D7/D8: forwarded only from offer-sourced items (offerToCoopItem) — cooperations and
  // companies aren't NIP-99 listings and legitimately carry no t-tags.
  gammaTags?: string[]
  location?: string
  priceSats?: number
  budgetSats?: number
  createdAt?: string
  skills?: string[]
  /**
   * ADR-368 follow-up (2026-09-05): agent-offer trust signals forwarded from
   * agentSetupToCoopItem (AgentProfile.isVerified / reputationScore). Only set
   * for itemType 'agent' — powers the Verified + reputation chips on agent
   * cards so browse rows carry the same signals as the roster.
   */
  verified?: boolean
  reputation?: number
  /** ADR-370 D6 (Phase 2): canvas provider forwarded from offer-sourced agent
   *  items (agentSetupToCoopItem) — drives the pre-purchase Canvas chip on the
   *  /coop agents browse cards. 'doop-local' | 'doop-hosted' | undefined. */
  canvasProvider?: 'doop-local' | 'doop-hosted'
  /** ADR-368 follow-up: Offer.agentBillingModel forwarded from agent-sourced
   *  items (agentSetupToCoopItem) — drives the client-side Agent Filters
   *  billing-model axis on the coop surfaces. Only set for itemType 'agent'. */
  billingModel?: string
  /** ADR-397 D2-C: bounty poster's record — winners paid of decided tickets. Only for itemType 'bounty'. */
  posterPaid?: { paid: number; decided: number }
  partnerPubkey?: string
  initiatorPubkey?: string
  detailPath?: string
  cooperationType?: string
  deadline?: string
  images?: string[]
  /**
   * ADR-328 D4: server-derived snapshot — true when any CoopMilestone of this
   * Cooperation was assigned an AgentProfile at creation time. Only meaningful
   * for cooperation-sourced items (coopToCoopItem); offer-sourced items always
   * leave it undefined. Powers the Mensch/AI-Agent sub-filter on /coop/offers
   * and the executor-kind chip on /coop/guide.
   */
  isAgentOrchestration?: boolean
  /**
   * ADR-386: server-derived owner gate forwarded from coopToCoopItem — true
   * only while a published cooperation is still unengaged (no partner/
   * application/progress/money) and non-agent, so Manage's Edit can route into
   * the full Coop-Guide form instead of the lightweight detail dialog.
   */
  canFullEdit?: boolean
  /**
   * ADR-363 D3: set on offer-sourced network items (offerToCoopItem) when the
   * offer row carries its company relation. Lets dedupeCoopItems collapse a
   * network card into the company's vendor card on the same tab.
   */
  companyId?: string
  /**
   * ADR-363 D6: ISO country code when the source row carries one (offers:
   * offer.country; companies: company.country). Drives the shared
   * LocationsFilterPanel over the coop client pipeline.
   */
  country?: string
}

export type CardSize = 'S' | 'M' | 'L'

// ── Image With Fallback ───────────────────────────────────────────────
// Mirrors marketplace-cards.tsx's own helper of the same name: a bare
// `<img>` with no error handling lets the browser paint its native broken-
// image icon + raw alt text once the URL fails to load — visible here as
// unstyled text in the card's top-left corner instead of the intended Icon
// placeholder. Swaps to `fallback` on error before that ever paints.
function ImageWithFallback({
  src,
  alt,
  className,
  style,
  fallback,
}: {
  src: string
  alt: string
  className?: string
  style?: React.CSSProperties
  fallback: ReactNode
}) {
  const [failed, setFailed] = useState(false)

  if (failed) return <>{fallback}</>

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

/** Defensively normalizes a Prisma `Json?` field that may arrive as a native array/object
 * (correct) or a stringified JSON blob (legacy double-encoding bug, ADR-229). */
export function parseJsonField<T>(val: unknown, fallback: T | undefined): T | undefined {
  if (val == null) return fallback
  if (typeof val === 'object') return val as unknown as T
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T } catch { return fallback }
  }
  return fallback
}

// ── Size Config ───────────────────────────────────────────────────────────────

export const CARD_SIZE_CONFIG: Record<CardSize, {
  gallery: { iconH: number; titleFs: number; priceFs: number; catFs: number; px: number; py: number; badgePx: number; badgePy: number }
  list: { rowH: number; thumbW: number; titleFs: number; priceFs: number; catFs: number; px: number; py: number }
}> = {
  S: {
    gallery: { iconH: 80,  titleFs: 12, priceFs: 11, catFs: 8,  px: 10, py: 10, badgePx: 8,  badgePy: 4 },
    list:    { rowH: 70,   thumbW: 70,  titleFs: 13, priceFs: 11, catFs: 10, px: 10, py: 8 },
  },
  M: {
    gallery: { iconH: 110, titleFs: 15, priceFs: 12, catFs: 9,  px: 14, py: 14, badgePx: 10, badgePy: 5 },
    list:    { rowH: 90,   thumbW: 90,  titleFs: 15, priceFs: 13, catFs: 12, px: 16, py: 12 },
  },
  L: {
    gallery: { iconH: 150, titleFs: 17, priceFs: 14, catFs: 10, px: 18, py: 18, badgePx: 12, badgePy: 6 },
    list:    { rowH: 110,  thumbW: 110, titleFs: 17, priceFs: 15, catFs: 13, px: 20, py: 16 },
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeIcon(itemType: CoopItemType) {
  switch (itemType) {
    case 'project':  return FolderKanban
    case 'vendor':   return Store
    case 'network':  return Network
    case 'tender':   return FileText
    case 'partner':  return Users
    case 'bounty':   return Target
    case 'agent':    return Bot
    case 'service':  return Handshake
    case 'bundle':   return Package
    default:         return Handshake
  }
}

function typeColor(itemType: CoopItemType): string {
  switch (itemType) {
    case 'project':  return 'var(--color-status-success)'
    case 'vendor':   return 'var(--color-secondary-50)'
    case 'network':  return 'var(--color-warning-primary)'
    case 'tender':   return 'var(--color-info-primary)'
    case 'partner':  return 'var(--color-primary-50)'
    case 'bounty':   return 'var(--color-secondary-50)'
    case 'agent':    return 'var(--color-secondary-50)'
    case 'service':  return 'var(--color-info-primary)'
    case 'bundle':   return 'var(--color-status-success)'
    default:         return 'var(--color-primary-50)'
  }
}

function typeBg(itemType: CoopItemType): string {
  switch (itemType) {
    case 'project':  return 'rgba(72,187,120,0.14)'
    case 'vendor':   return 'rgba(159,122,234,0.14)'
    case 'network':  return 'rgba(255,192,57,0.14)'
    case 'tender':   return 'rgba(56,189,248,0.14)'
    case 'partner':  return 'rgba(99,179,237,0.14)'
    case 'bounty':   return 'rgba(159,122,234,0.14)'
    case 'agent':    return 'rgba(159,122,234,0.14)'
    case 'service':  return 'rgba(56,189,248,0.14)'
    case 'bundle':   return 'rgba(72,187,120,0.14)'
    default:         return 'rgba(99,179,237,0.14)'
  }
}

function typeLabel(itemType: CoopItemType): string {
  switch (itemType) {
    case 'project': return 'Project'
    case 'tender':  return 'Tender'
    case 'network': return 'Network'
    case 'vendor':  return 'Company'
    case 'partner': return 'Partner'
    case 'bounty':  return 'Bounty'
    case 'agent':   return 'AI Agent'
    case 'service': return 'Service'
    case 'bundle':  return 'Bundle'
    default:        return 'Offer'
  }
}

function statusBg(status?: string): string {
  switch (status?.toUpperCase()) {
    case 'ACTIVE':    return 'rgba(72,187,120,0.12)'
    case 'OPEN':      return 'rgba(99,179,237,0.12)'
    case 'ACCEPTED':  return 'rgba(72,187,120,0.12)'
    case 'COMPLETED': return 'rgba(113,128,150,0.10)'
    case 'CANCELLED': return 'rgba(245,101,101,0.10)'
    // AgentTask (bounty) statuses — SELECTING/EXPIRED share the neutral/error
    // tone of their closest cooperation-status analog, ASSIGNED reads as a won tender.
    case 'SELECTING': return 'rgba(255,192,57,0.12)'
    case 'ASSIGNED':  return 'rgba(72,187,120,0.12)'
    case 'IN_PROGRESS': return 'rgba(255,192,57,0.12)'
    case 'EXPIRED':   return 'rgba(113,128,150,0.10)'
    default:          return 'rgba(99,179,237,0.10)'
  }
}

function statusColor(status?: string): string {
  switch (status?.toUpperCase()) {
    case 'ACTIVE':    return 'var(--color-status-success)'
    case 'OPEN':      return 'var(--color-primary-50)'
    case 'ACCEPTED':  return 'var(--color-status-success)'
    case 'COMPLETED': return 'var(--color-neutral-5)'
    case 'CANCELLED': return 'var(--color-status-error)'
    case 'SELECTING': return 'var(--color-warning-primary)'
    case 'ASSIGNED':  return 'var(--color-status-success)'
    case 'IN_PROGRESS': return 'var(--color-warning-primary)'
    case 'EXPIRED':   return 'var(--color-neutral-5)'
    default:          return 'var(--color-primary-50)'
  }
}

// ── CoopGalleryCard ───────────────────────────────────────────────────────────

interface CoopGalleryCardProps {
  item: CoopItem
  size?: CardSize
  onAddToCoop?: () => void
  actions?: ReactNode
}

export function CoopGalleryCard({ item, size = 'M', onAddToCoop, actions }: CoopGalleryCardProps) {
  const Icon = typeIcon(item.itemType)
  const color = typeColor(item.itemType)
  const bg = typeBg(item.itemType)
  const sats = item.priceSats ?? item.budgetSats
  const to = item.detailPath ?? `/coop/${item.itemType}s/${item.id}`
  const cfg = CARD_SIZE_CONFIG[size].gallery
  // ADR-385: compact creation date on the browse cards (grid + list).
  const createdLabel = formatCompactDate(item.createdAt)
  const cardRef = useRef<HTMLAnchorElement>(null)
  const pulseRef = useRef<HTMLDivElement>(null)
  const floatingRef = useRef<HTMLSpanElement>(null)
  const { theme } = useTheme()
  const prefersReducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  const [acceptLoading, setAcceptLoading] = useState(false)

  async function handleAccept(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (!item.id || acceptLoading) return
    setAcceptLoading(true)

    const card = cardRef.current
    const pulse = pulseRef.current
    const floating = floatingRef.current

    const dur = prefersReducedMotion ? 0 : 0.6
    const tl = gsap.timeline()

    tl.to(card, {
      scale: 1.04,
      boxShadow: `0 8px 30px ${color.replace('var(', '').replace(')', '')}33, 0 2px 8px rgba(0,0,0,0.10)`,
      borderColor: bg.replace('0.14)', '0.50)'),
      duration: dur * 0.3,
      ease: 'power2.out',
    })
    if (pulse) {
      tl.fromTo(pulse,
        { opacity: 0.6, scale: 0.95 },
        { opacity: 0, scale: 1.15, duration: dur * 0.5, ease: 'power2.out' },
        '<',
      )
    }
    tl.to(card, {
      scale: 1,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      borderColor: 'var(--theme-border)',
      duration: dur * 0.4,
      ease: 'power2.inOut',
    }, dur * 0.35)

    if (floating) {
      tl.fromTo(floating,
        { opacity: 1, y: 0, scale: 0.8 },
        { opacity: 0, y: -40, scale: 1.2, duration: dur * 0.6, ease: 'power2.out' },
        dur * 0.1,
      )
    }

    try {
      const pubkey = localStorage.getItem('pubkey')
      const res = await apiCall(`/api/cooperations/${item.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerPubkey: pubkey }),
      })
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('coop-accepted', { detail: { id: item.id } }))
      }
    } catch { /* silent */ }
    finally { setAcceptLoading(false) }
  }

  return (
    <Link
      ref={cardRef}
      to={to}
      className={cn(
        'group/card flex flex-col no-underline cursor-pointer rounded-xl overflow-hidden',
        'shadow-[0_2px_8px_rgba(0,0,0,0.08)]',
        'transition-all duration-300 ease-out',
        'hover:z-10 hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)]',
        'active:scale-[0.99] h-full relative',
      )}
      style={{
        background: CARD_THEME.bg(theme),
        border: '1px solid var(--theme-border)',
      }}
    >
      {/* Static sheen overlay — matches SliderList cards */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{ background: CARD_THEME.overlay(theme) }}
      />
      {/* Hover glow — subtle colabonate-red radial from bottom-right */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-500 ease-out group-hover/card:opacity-100"
        style={{ background: HOVER_GLOW_BG }}
      />
      {/* Pulse overlay */}
      <div
        ref={pulseRef}
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{
          background: `radial-gradient(circle, ${bg.replace('0.14)', '0.30)')} 0%, ${bg.replace('0.14)', '0.10)')} 60%, transparent 100%)`,
          opacity: 0,
          zIndex: 5,
        }}
      />

      {/* Image / type area */}
      <div
        className="relative flex items-center justify-center shrink-0 overflow-hidden"
        style={{ height: cfg.iconH, background: item.images?.length ? 'var(--theme-bg-subtle)' : bg }}
      >
        {item.images?.[0] ? (
          <ImageWithFallback
            src={item.images[0]}
            alt={item.title}
            className="w-full h-full object-cover"
            style={{ opacity: 0.9 }}
            fallback={<Icon size={Math.round(cfg.iconH * 0.36)} style={{ color, opacity: 0.85 }} />}
          />
        ) : (
          <Icon size={Math.round(cfg.iconH * 0.36)} style={{ color, opacity: 0.85 }} />
        )}

        {/* Status badge – top left */}
        {item.status && (
          <span
            className="absolute top-2 left-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full"
            style={{ background: statusBg(item.status), color: statusColor(item.status) }}
          >
            {item.status}
          </span>
        )}

        {/* Type badge – top right */}
        <span
          className="absolute top-2 right-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(0,0,0,0.28)', color: 'white', backdropFilter: 'blur(4px)' }}
        >
          {typeLabel(item.itemType)}
        </span>

        {/* Deadline badge for tenders */}
        {item.deadline && (item.itemType === 'tender' || item.itemType === 'bounty') && (
          <span
            className="absolute bottom-2 left-2 flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(56,189,248,0.20)', color: 'var(--color-info-primary)' }}
          >
            <Calendar size={8} />
            {new Date(item.deadline).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Content */}
      <div
        className="flex flex-col flex-1"
        style={{ padding: `${cfg.py}px ${cfg.px}px` }}
      >
        {/* Category / type label */}
        <div
          className="mb-1"
          style={{
            fontSize: cfg.catFs,
            fontWeight: 600,
            color: 'var(--theme-text-muted)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap' as const,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <Icon
            size={cfg.catFs + 1}
            style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }}
          />
          {item.cooperationType
            ? item.cooperationType
            : (item.categoryCode?.replace(/\//g, ' – ') ?? item.category ?? typeLabel(item.itemType))
          }
        </div>

        {/* Title */}
        <div
          className="mb-2"
          style={{
            fontSize: cfg.titleFs,
            lineHeight: 1.45,
            color: 'var(--theme-text)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
          }}
        >
          {item.title}
        </div>

        {createdLabel && (
          <div className="mb-1 truncate" style={{ fontSize: cfg.catFs, color: 'var(--theme-text-muted)' }}>
            Created {createdLabel}
          </div>
        )}

        {/* Meta chips – only M/L. The row always renders so every grid card
            has the same middle-block height: agent trust signals (Verified /
            reputation), then capability chips, then a muted "No skills"
            fallback when nothing else is present (user reports 2026-09-05:
            uneven grid card heights + missing agent info in browse). */}
        {size !== 'S' && (
          <div className="flex flex-wrap gap-1 mb-2">
            {item.verified && (
              <span
                className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'rgba(72,187,120,0.12)', color: 'var(--color-status-success)' }}
              >
                <BadgeCheck size={10} />
                Verified
              </span>
            )}
            {item.itemType === 'agent' && typeof item.reputation === 'number' && item.reputation > 0 && (
              <span
                className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'rgba(255,192,57,0.12)', color: 'var(--color-warning-primary)' }}
              >
                <Star size={10} />
                {item.reputation.toFixed(1)}
              </span>
            )}
            {/* ADR-397 D2-C: has this poster paid the agents they picked? */}
            {item.itemType === 'bounty' && (
              <span
                className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
                title="Bounty tickets this poster paid, out of all that were paid or cancelled"
              >
                <Zap size={10} />
                {item.posterPaid && item.posterPaid.decided > 0 ? `Paid ${item.posterPaid.paid}/${item.posterPaid.decided}` : 'New poster'}
              </span>
            )}
            {/* ADR-370 D6 (Phase 2): pre-purchase canvas disclosure on /coop
                agent browse cards (G1). */}
            {item.itemType === 'agent' && item.canvasProvider && (
              <span
                className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
                title={item.canvasProvider === 'doop-hosted'
                  ? 'Colabonate-hosted collaboration canvas — opened from the ticket'
                  : "Collaboration canvas on the seller's own doop instance"}
              >
                <Frame size={10} />
                Canvas
              </span>
            )}
            {Array.isArray(item.skills) && item.skills.length > 0 ? (
              <>
                {item.skills.slice(0, 3).map(skill => (
                  <span
                    key={skill}
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
                  >
                    {skill}
                  </span>
                ))}
                {item.skills.length > 3 && (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
                  >
                    +{item.skills.length - 3}
                  </span>
                )}
              </>
            ) : !item.verified && !(item.itemType === 'agent' && typeof item.reputation === 'number' && item.reputation > 0) ? (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded"
                style={{ background: 'transparent', border: '1px dashed var(--theme-border)', color: 'var(--theme-text-muted)' }}
              >
                No skills
              </span>
            ) : null}
          </div>
        )}

        {/* Location (if any) */}
        {item.location && size === 'L' && (
          <div
            className="flex items-center gap-1 mb-2 text-[10px]"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <MapPin size={10} />
            {item.location}
          </div>
        )}

        {/* Price + AddToCoop button */}
        <div className="flex items-center justify-between gap-1 mt-auto">
          {sats && sats > 0 ? (
            <div
              className="flex items-center gap-1"
              style={{
                padding: `${cfg.badgePy}px ${cfg.badgePx}px`,
                borderRadius: 6,
                background: 'rgba(99,179,237,0.10)',
                fontSize: cfg.priceFs,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--color-primary-50)',
                whiteSpace: 'nowrap' as const,
              }}
            >
              <Zap size={cfg.priceFs} />
              {formatSatsNumber(sats)}
              <FiatHint sats={sats} className="text-[0.9em] ml-[3px]" />
            </div>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          {onAddToCoop ? (
            <div className="relative shrink-0">
              <Button
                variant="outlined"
                size="small"
                disabled={acceptLoading}
                onClick={handleAccept}
                sx={{
                  minWidth: 0,
                  width: 34,
                  height: 34,
                  p: 0,
                  borderColor: 'var(--theme-border)',
                  color,
                  '&:hover': { borderColor: color },
                }}
                aria-label="Start cooperation"
                title="Start cooperation"
              >
                <Handshake size={15} strokeWidth={2.5} />
              </Button>
            <span
              ref={floatingRef}
              className="absolute pointer-events-none"
              style={{
                top: -4, right: -4,
                fontSize: 13, fontWeight: 800,
                color,
                opacity: 0,
                zIndex: 10,
              }}
            >
              +
            </span>
          </div>
          ) : actions ? (
            <div className="shrink-0">{actions}</div>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

// ── CoopListRow ───────────────────────────────────────────────────────────────

interface CoopListRowProps {
  item: CoopItem
  size?: CardSize
  onAddToCoop?: () => void
  actions?: ReactNode
}

export function CoopListRow({ item, size = 'M', onAddToCoop, actions }: CoopListRowProps) {
  const Icon = typeIcon(item.itemType)
  const color = typeColor(item.itemType)
  const bg = typeBg(item.itemType)
  const sats = item.priceSats ?? item.budgetSats
  const to = item.detailPath ?? `/coop/${item.itemType}s/${item.id}`
  const cfg = CARD_SIZE_CONFIG[size].list
  // ADR-385: compact creation date on the browse cards (grid + list).
  const createdLabel = formatCompactDate(item.createdAt)
  const { theme } = useTheme()
  const { isMobile, isDesktop } = useBreakpoint()
  const [acceptLoading, setAcceptLoading] = useState(false)

  async function handleAccept(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!item.id || acceptLoading) return
    setAcceptLoading(true)
    try {
      const pubkey = localStorage.getItem('pubkey')
      const res = await apiCall(`/api/cooperations/${item.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerPubkey: pubkey }),
      })
      if (res.ok) {
        window.dispatchEvent(new CustomEvent('coop-accepted', { detail: { id: item.id } }))
      }
    } catch { /* silent */ }
    finally { setAcceptLoading(false) }
  }

  // Status badge + price. On desktop they sit at the right edge of the row;
  // on mobile/tablet they become their own full-width row above the Created
  // line (otherwise they squeeze the title/description). The start-cooperation
  // button stays in the right column on tablet and only moves inline on mobile.
  const statusAndPrice = (
    <>
      {item.status && (
        <span
          className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
          style={{ background: statusBg(item.status), color: statusColor(item.status) }}
        >
          {item.status}
        </span>
      )}
      {sats && sats > 0 && (
        <span
          className="flex items-center gap-1 text-[12px] font-semibold"
          style={{ color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          <Zap size={12} />
          {formatSatsNumber(sats)}
          <FiatHint sats={sats} className="text-[11px]" />
        </span>
      )}
    </>
  )
  const startCoopButton = onAddToCoop ? (
    <Button
      variant="outlined"
      size="small"
      disabled={acceptLoading}
      onClick={handleAccept}
      sx={{
        minWidth: 0,
        width: 34,
        height: 34,
        p: 0,
        borderColor: 'var(--theme-border)',
        color,
        '&:hover': { borderColor: color },
      }}
      aria-label="Start cooperation"
      title="Start cooperation"
    >
      <Handshake size={14} strokeWidth={2.5} />
    </Button>
  ) : null

  return (
    <Link
      to={to}
      className={cn(
        'group/card flex items-stretch no-underline cursor-pointer rounded-xl overflow-hidden',
        'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.06)]',
        'transition-all duration-300 ease-out',
        'hover:z-10 hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)]',
        'active:scale-[0.99] relative',
      )}
      style={{
        background: CARD_THEME.bg(theme),
        outline: '1px solid var(--theme-border)',
        minHeight: cfg.rowH,
      }}
    >
      {/* Static sheen overlay — matches SliderList cards */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{ background: CARD_THEME.overlay(theme) }}
      />
      {/* Hover glow — subtle colabonate-red radial from bottom-right */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-500 ease-out group-hover/card:opacity-100"
        style={{ background: HOVER_GLOW_BG }}
      />
      {/* Left icon thumbnail */}
      <div
        className="flex items-center justify-center shrink-0 overflow-hidden"
        style={{ width: cfg.thumbW, background: item.images?.length ? 'var(--theme-bg-subtle)' : bg }}
      >
        {item.images?.[0] ? (
          <ImageWithFallback
            src={item.images[0]}
            alt={item.title}
            className="w-full h-full object-cover"
            fallback={<Icon size={Math.round(cfg.thumbW * 0.35)} style={{ color, opacity: 0.85 }} />}
          />
        ) : (
          <Icon size={Math.round(cfg.thumbW * 0.35)} style={{ color, opacity: 0.85 }} />
        )}
      </div>

      {/* Content */}
      <div
        className="flex flex-col justify-center flex-1 min-w-0"
        style={{ padding: `${cfg.py}px ${cfg.px}px` }}
      >
        <div
          className="mb-0.5"
          style={{
            fontSize: cfg.catFs,
            fontWeight: 600,
            color: 'var(--theme-text-muted)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap' as const,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <Icon
            size={cfg.catFs + 1}
            style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3, opacity: 0.7 }}
          />
          {item.cooperationType
            ? item.cooperationType
            : (item.categoryCode?.replace(/\//g, ' – ') ?? item.category ?? typeLabel(item.itemType))
          }
        </div>
        <div
          style={{
            fontSize: cfg.titleFs,
            fontWeight: 600,
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const,
            overflow: 'hidden',
            color: 'var(--theme-text)',
          }}
        >
          {item.title}
        </div>
        {!isDesktop && (
          <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 6 }}>
            {statusAndPrice}
            {isMobile && startCoopButton}
            {isMobile && actions && <div className="shrink-0">{actions}</div>}
          </div>
        )}
        {createdLabel && (
          <div className="mt-0.5 truncate" style={{ fontSize: cfg.catFs, color: 'var(--theme-text-muted)' }}>
            Created {createdLabel}
          </div>
        )}
        {item.location && size === 'L' && (
          <div
            className="flex items-center gap-1 mt-0.5 text-[10px]"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <MapPin size={9} />
            {item.location}
          </div>
        )}

        {/* ADR-368 follow-up (2026-09-05): agent rows used to carry almost no
            info — only image/title/price. Add the profile's description
            snippet + trust signals (Verified / reputation) + capability chips
            so the list view matches the gallery's richness. */}
        {item.itemType === 'agent' && size !== 'S' && item.description && (
          <div
            className="mt-0.5 text-[10px] leading-snug"
            style={{
              color: 'var(--theme-text-muted)',
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical' as const,
              overflow: 'hidden',
            }}
          >
            {item.description}
          </div>
        )}
        {item.itemType === 'agent' && size !== 'S' && (
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {item.verified && (
              <span
                className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'rgba(72,187,120,0.12)', color: 'var(--color-status-success)' }}
              >
                <BadgeCheck size={9} />
                Verified
              </span>
            )}
            {typeof item.reputation === 'number' && item.reputation > 0 && (
              <span
                className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'rgba(255,192,57,0.12)', color: 'var(--color-warning-primary)' }}
              >
                <Star size={9} />
                {item.reputation.toFixed(1)}
              </span>
            )}
            {/* ADR-370 D6 (Phase 2): pre-purchase canvas disclosure — list row. */}
            {item.canvasProvider && (
              <span
                className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
                style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
                title={item.canvasProvider === 'doop-hosted'
                  ? 'Colabonate-hosted collaboration canvas — opened from the ticket'
                  : "Collaboration canvas on the seller's own doop instance"}
              >
                <Frame size={9} />
                Canvas
              </span>
            )}
            {Array.isArray(item.skills) && item.skills.length > 0 ? (
              item.skills.slice(0, 4).map(skill => (
                <span
                  key={skill}
                  className="text-[9px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
                >
                  {skill}
                </span>
              ))
            ) : (!item.verified && !(typeof item.reputation === 'number' && item.reputation > 0)) ? (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded"
                style={{ background: 'transparent', border: '1px dashed var(--theme-border)', color: 'var(--theme-text-muted)' }}
              >
                No skills
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Right: status badge + price + button. On tablet only the
          start-cooperation button stays here (the values moved inline above
          the Created line); on desktop every value sits here. */}
      {!isMobile && (isDesktop || startCoopButton || actions) && (
        <div
          className="flex items-center gap-1.5 shrink-0 self-center"
          style={{ paddingRight: cfg.px }}
        >
          {isDesktop && statusAndPrice}
          {startCoopButton}
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
    </Link>
  )
}

// ── CoopEmptyState ────────────────────────────────────────────────────────────

interface EmptyStateProps {
  message?: string
  sub?: string
}

export function CoopEmptyState({
  message = 'No results found',
  sub = 'Try adjusting your search or filters.',
}: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 rounded-xl"
      style={{ background: 'var(--theme-bg-subtle)' }}
    >
      <Search size={40} className="mb-3" style={{ color: 'var(--theme-text-muted)', opacity: 0.4 }} />
      <p
        className="text-[15px] font-semibold mb-1"
        style={{ color: 'var(--theme-text)' }}
      >
        {message}
      </p>
      <p
        className="text-[13px]"
        style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {sub}
      </p>
    </div>
  )
}

// ── CoopSizeToggle ────────────────────────────────────────────────────────────

interface SizeToggleProps {
  size: CardSize
  onChange: (s: CardSize) => void
}

export function CoopSizeToggle({ size, onChange }: SizeToggleProps) {
  const sizes: CardSize[] = ['S', 'M', 'L']
  return (
    <div className="flex gap-1">
      {sizes.map(s => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className="flex items-center justify-center rounded-md cursor-pointer transition-all duration-100"
          style={{
            width: 28, height: 28,
            fontSize: 11, fontWeight: 600,
            background: size === s ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
            color: size === s ? 'white' : 'var(--theme-text-muted)',
            border: size === s ? 'none' : '1px solid var(--theme-border)',
          }}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

// ── TagChip (shared helper) ───────────────────────────────────────────────────

export function CoopTagChip({ label, color: c, bg: b }: { label: string; color?: string; bg?: string }) {
  return (
    <span
      className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md"
      style={{
        background: b ?? 'var(--theme-bg-subtle)',
        color: c ?? 'var(--theme-text-muted)',
      }}
    >
      <Tag size={9} />
      {label}
    </span>
  )
}
