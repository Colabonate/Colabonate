// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Package, Briefcase, Eye, EyeOff, Bot,
  MoreVertical, Edit, Archive, Trash2, Zap, Power,
  ShieldCheck, Radio, ShoppingBag, Tag,
} from 'lucide-react'
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material'
import type { KPIItem } from '@ds/ui'
import { ListBrowser } from '../../../components/list-browser'
import type { TaxonomyAxis, GammaTagFacet } from '../../../components/list-browser'
import { useTranslation } from '../../../contexts/LocaleContext'
import { FiatHint } from '../../../components/currency/FiatHint'
import { ApiError } from '../../../lib/api'
import { useNotification } from '../../../context/NotificationContext'
import { SearchInput } from '../../../components/ui/SearchInput'
import { useFABActions } from '../../../context/FABContext'
import { useUserProductOffers, useStandardCategories } from '../../../hooks/useEntityQueries'
import { useOfferListActions } from '../../../hooks/useOfferListActions'
import { usePageListViewMode } from '../../../hooks/usePageListViewMode'
import { getOfferTypeLabel } from '@ds/utils'
import type { Offer } from '../../../types/api'
import type { SellTabProps } from '../sell.types'
import { EmptyStateGuide } from '../../../components/EmptyStateGuide'
import { VerifiedAgentBadge } from '../../../components/agents/VerifiedAgentBadge'

type ContextTab = 'all' | 'private' | 'corporate'
// ADR-368 D2: Sell is goods-only (PRODUCT/ITEM). SERVICE + AGENT_SETUP offers
// moved to Cooperate Manage (`?tab=services` / `?tab=stack`); the legacy
// `?filter=services|agents` deep links now redirect there (App.tsx redirect
// table) before this tab ever mounts.
type FilterTab = 'all' | 'items' | 'products' | 'active' | 'drafts'
type SortOption = 'newest' | 'price-asc' | 'price-desc' | 'name'
type CardSize = 'S' | 'M' | 'L'

// FU-472: shared by both card layouts (gallery + list) so the type badge
// stays a single source instead of two copies of the same 4-way branch.
// Exported for ADR-368's Cooperate ServicesTab (SERVICE offers reuse these
// cards — the SERVICE/AGENT_SETUP branches stay reachable for shared use).
export function getOfferTypeBadge(offer: Offer) {
  if (offer.offerType === 'AGENT_SETUP') return { Icon: Bot, label: getOfferTypeLabel(offer.offerType), bg: 'rgba(99,179,237,0.20)', color: 'var(--color-primary-50)', border: 'rgba(99,179,237,0.35)' }
  if (offer.offerType === 'SERVICE') return { Icon: Briefcase, label: getOfferTypeLabel(offer.offerType), bg: 'rgba(159,122,234,0.20)', color: 'var(--color-secondary-50)', border: 'rgba(159,122,234,0.35)' }
  if (offer.offerType === 'ITEM') return { Icon: Package, label: getOfferTypeLabel(offer.offerType), bg: 'rgba(72,187,120,0.20)', color: 'var(--color-status-success)', border: 'rgba(72,187,120,0.35)' }
  return { Icon: Package, label: getOfferTypeLabel(offer.offerType), bg: 'rgba(72,187,120,0.20)', color: 'var(--color-status-success)', border: 'rgba(72,187,120,0.35)' }
}

// Shared by SellListingsTab + Coop ServicesTab (ADR-368) — status badge map.
export const STATUS_BADGE: Record<string, { bg: string; color: string; border: string }> = {
  DRAFT:    { bg: 'rgba(159,122,234,0.18)', color: '#9F7AEA', border: 'rgba(159,122,234,0.40)' },
  ACTIVE:   { bg: 'rgba(72,187,120,0.18)', color: '#276749', border: 'rgba(72,187,120,0.40)' },
  CLOSED:   { bg: 'rgba(245,166,35,0.18)', color: '#92600A', border: 'rgba(245,166,35,0.40)' },
  ARCHIVED: { bg: 'rgba(113,128,150,0.18)', color: '#718096', border: 'rgba(113,128,150,0.40)' },
}

const CARD_SIZE_CONFIG: Record<CardSize, {
  gallery: { imgH: number; titleFs: number; priceFs: number; catFs: number; px: number; py: number; gap: number; badgeFs: number; badgePx: number; badgePy: number }
  list: { rowH: number; thumbW: number; titleFs: number; priceFs: number; catFs: number; px: number; py: number; gap: number; badgeFs: number; badgePx: number; badgePy: number }
}> = {
  S: {
    gallery: { imgH: 100, titleFs: 12, priceFs: 11, catFs: 9, px: 10, py: 8, gap: 2, badgeFs: 9, badgePx: 8, badgePy: 3 },
    list:    { rowH: 80, thumbW: 80, titleFs: 13, priceFs: 11, catFs: 9, px: 10, py: 8, gap: 8, badgeFs: 9, badgePx: 6, badgePy: 3 },
  },
  M: {
    gallery: { imgH: 140, titleFs: 16, priceFs: 12, catFs: 9, px: 12, py: 10, gap: 3, badgeFs: 12, badgePx: 10, badgePy: 4 },
    list:    { rowH: 100, thumbW: 100, titleFs: 15, priceFs: 13, catFs: 9, px: 16, py: 12, gap: 12, badgeFs: 9, badgePx: 8, badgePy: 3 },
  },
  L: {
    gallery: { imgH: 180, titleFs: 16, priceFs: 14, catFs: 9, px: 12, py: 10, gap: 4, badgeFs: 12, badgePx: 12, badgePy: 5 },
    list:    { rowH: 120, thumbW: 120, titleFs: 17, priceFs: 15, catFs: 9, px: 20, py: 16, gap: 16, badgeFs: 9, badgePx: 10, badgePy: 4 },
  },
}


export function SellGalleryCard({
  offer, size = 'M', onAction,
}: {
  offer: Offer; size: CardSize; onAction: (action: 'view' | 'edit' | 'archive' | 'delete' | 'publish' | 'toggle-active', offer: Offer) => void
}) {
  const { formatNumber } = useTranslation()
  const isAgent = offer.offerType === 'AGENT_SETUP'
  const typeBadge = getOfferTypeBadge(offer)
  const hasImage = offer.images && offer.images.length > 0
  const cfg = CARD_SIZE_CONFIG[size].gallery
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const sb = STATUS_BADGE[offer.status ?? 'DRAFT'] ?? STATUS_BADGE.DRAFT

  return (
    <div
      className="flex flex-col no-underline cursor-pointer rounded-xl overflow-hidden transition-all duration-300 ease-out hover:-translate-y-1.5 active:scale-[0.98] h-full relative"
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 16px 24px rgba(0,0,0,0.28), 0 4px 16px rgba(61,76,83,0.45)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)' }}
      onClick={() => { if (!menuAnchor) onAction('view', offer) }}
    >
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{ height: cfg.imgH, background: 'var(--theme-bg-subtle)' }}
      >
        {hasImage
          ? <img src={offer.images![0]} alt={offer.title} className="object-cover w-full h-full transition-transform duration-500" />
          : (
            <span style={{ fontSize: cfg.imgH * 0.3, fontWeight: 700, color: 'var(--theme-text-muted)', lineHeight: 1 }}>
              {offer.title.charAt(0).toUpperCase()}
            </span>
          )}
      </div>

      <div className="flex flex-col flex-1" style={{ padding: `${cfg.py}px ${cfg.px}px` }}>
        <div className="flex items-center gap-1 mb-1 flex-wrap">
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none"
            style={{
              fontSize: cfg.catFs, fontWeight: 700, letterSpacing: '0.07em',
              backgroundColor: typeBadge.bg,
              color: typeBadge.color,
              border: `1px solid ${typeBadge.border}`,
            }}
          >
            <typeBadge.Icon size={cfg.catFs} />
            {typeBadge.label}
          </span>
          {isAgent && <VerifiedAgentBadge isVerified={offer.agentProfile?.isVerified} surface="owner" />}
          {offer.status && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-sm uppercase leading-none"
              style={{
                fontSize: cfg.badgeFs, fontWeight: 700, letterSpacing: '0.07em',
                background: sb.bg, color: sb.color, border: `1px solid ${sb.border}`,
              }}
            >
              {offer.status}
            </span>
          )}
        </div>

        {offer.category && (
          <div
            className="mb-1"
            style={{
              fontSize: cfg.catFs, fontWeight: 700, color: 'var(--theme-text-muted)',
              textTransform: 'uppercase' as const, letterSpacing: '0.07em',
              whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {offer.category.replace(/\//g, ' - ')}
          </div>
        )}
        <div
          className="mb-2"
          style={{
            fontSize: cfg.titleFs, fontWeight: 600, lineHeight: 1.3, color: 'var(--theme-text)',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            minHeight: cfg.titleFs * 2 * 1.3,
          }}
        >
          {offer.title}
        </div>

        {(() => {
          const caps = offer.agentProfile?.capabilities
          if (!isAgent || !caps || caps.length === 0) return null
          return (
            <div className="flex flex-wrap gap-1 mb-2">
              {caps.slice(0, 3).map(cap => (
                <span
                  key={cap}
                  className="inline-flex items-center px-1.5 py-0.5 rounded-sm leading-none truncate max-w-24"
                  style={{ fontSize: cfg.catFs, background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)', border: '1px solid var(--theme-border)' }}
                >
                  {cap}
                </span>
              ))}
            </div>
          )
        })()}

        <div className="flex items-center justify-between gap-1 mt-auto">
          <div
            className="flex items-center gap-1"
            style={{
              padding: `${cfg.badgePy}px ${cfg.badgePx}px`, borderRadius: 6,
              background: 'rgba(99,179,237,0.10)', fontSize: cfg.priceFs, fontWeight: 700,
              fontVariantNumeric: 'tabular-nums', color: 'var(--color-primary-50)', whiteSpace: 'nowrap',
              letterSpacing: '-0.02em',
            }}
          >
            <Zap size={cfg.priceFs} />
            {formatNumber(offer.priceSats)}
            <FiatHint sats={offer.priceSats} className="text-[0.9em] ml-[3px]" />
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
            className="flex items-center justify-center transition-colors duration-150 rounded-lg cursor-pointer"
            style={{
              width: 32, height: 32,
              background: 'var(--theme-bg-subtle)',
              border: '1px solid var(--theme-border)',
              color: 'var(--theme-text-muted)',
            }}
            aria-label="Options"
          >
            <MoreVertical size={15} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 160 } } }}
      >
        <MenuItem onClick={() => { setMenuAnchor(null); onAction('view', offer) }}>
          <ListItemIcon><Eye size={16} /></ListItemIcon>
          <ListItemText>View</ListItemText>
        </MenuItem>
        {!isAgent && (
          <MenuItem onClick={() => { setMenuAnchor(null); onAction('edit', offer) }}>
            <ListItemIcon><Edit size={16} /></ListItemIcon>
            <ListItemText>Edit</ListItemText>
          </MenuItem>
        )}
        {isAgent ? (
          // FU-472: agents toggle ACTIVE<->DRAFT directly (MyAgents.tsx's
          // exact semantics) — not the generic Publish(->ACTIVE)/Archive
          // (ACTIVE->ARCHIVED) pair, agent listings don't use ARCHIVED here.
          <MenuItem onClick={() => { setMenuAnchor(null); onAction('toggle-active', offer) }} sx={{ color: offer.status === 'ACTIVE' ? 'text.secondary' : 'success.main' }}>
            <ListItemIcon sx={{ color: offer.status === 'ACTIVE' ? 'text.secondary' : 'success.main' }}><Power size={16} /></ListItemIcon>
            <ListItemText>{offer.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</ListItemText>
          </MenuItem>
        ) : (
          <>
            {/* ADR-366 follow-on: ARCHIVED can republish too — was a dead
                end before (Edit + Delete only), no way back to ACTIVE. */}
            {(offer.status === 'DRAFT' || offer.status === 'ARCHIVED') && (
              <MenuItem onClick={() => { setMenuAnchor(null); onAction('publish', offer) }} sx={{ color: 'success.main' }}>
                <ListItemIcon sx={{ color: 'success.main' }}><Eye size={16} /></ListItemIcon>
                <ListItemText>Publish</ListItemText>
              </MenuItem>
            )}
            {offer.status === 'ACTIVE' && (
              <MenuItem onClick={() => { setMenuAnchor(null); onAction('archive', offer) }} sx={{ color: 'text.secondary' }}>
                <ListItemIcon sx={{ color: 'text.secondary' }}><Archive size={16} /></ListItemIcon>
                <ListItemText>Archive</ListItemText>
              </MenuItem>
            )}
          </>
        )}
        <Divider />
        <MenuItem onClick={() => { setMenuAnchor(null); onAction('delete', offer) }} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'error.main' }}><Trash2 size={16} /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </div>
  )
}

export function SellListRow({
  offer, size = 'M', onAction,
}: {
  offer: Offer; size: CardSize; onAction: (action: 'view' | 'edit' | 'archive' | 'delete' | 'publish' | 'toggle-active', offer: Offer) => void
}) {
  const { formatNumber } = useTranslation()
  const isAgent = offer.offerType === 'AGENT_SETUP'
  const typeBadge = getOfferTypeBadge(offer)
  const hasImage = offer.images && offer.images.length > 0
  const cfg = CARD_SIZE_CONFIG[size].list
  const sb = STATUS_BADGE[offer.status ?? 'DRAFT'] ?? STATUS_BADGE.DRAFT
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  return (
    <div
      className="flex items-stretch no-underline cursor-pointer rounded-xl overflow-hidden transition-all duration-300 ease-out hover:-translate-y-1.5 active:scale-[0.98]"
      style={{
        background: 'var(--theme-surface)',
        outline: '1px solid var(--theme-border)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
        paddingTop: 0, paddingBottom: 0, paddingLeft: 0,
        paddingRight: `${cfg.px}px`,
        gap: `${cfg.gap}px`,
        minHeight: cfg.rowH,
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 16px 24px rgba(0,0,0,0.28), 0 4px 16px rgba(61,76,83,0.45)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)' }}
      onClick={() => { if (!menuAnchor) onAction('view', offer) }}
    >
      {hasImage ? (
        <div
          className="self-stretch overflow-hidden shrink-0"
          style={{ width: cfg.thumbW, background: 'var(--theme-bg-subtle)' }}
        >
          <img src={offer.images![0]} alt={offer.title} className="object-cover w-full h-full" />
        </div>
      ) : (
        <div
          className="flex items-center self-stretch justify-center shrink-0"
          style={{
            width: cfg.thumbW,
            background: typeBadge.bg,
          }}
        >
          <typeBadge.Icon size={cfg.thumbW * 0.3} style={{ color: typeBadge.color }} />
        </div>
      )}

      <div className="flex flex-col justify-center flex-1 min-w-0" style={{ padding: `${cfg.py}px 0` }}>
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          {offer.status && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border leading-none shrink-0"
              style={{ background: sb.bg, color: sb.color, borderColor: sb.border }}
            >
              {offer.status}
            </span>
          )}
          {isAgent && <VerifiedAgentBadge isVerified={offer.agentProfile?.isVerified} surface="owner" size="small" />}
          <div
            style={{
              fontSize: cfg.catFs, fontWeight: 600, color: 'var(--theme-text-muted)',
              textTransform: 'uppercase' as const, letterSpacing: '0.04em',
              whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            <typeBadge.Icon size={cfg.catFs + 1} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3, opacity: 0.7 }} />
            {offer.category ? offer.category.replace(/\//g, ' - ') : ''}
          </div>
        </div>
        <div
          style={{
            fontSize: cfg.titleFs, fontWeight: 600, lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', color: 'var(--theme-text)',
          }}
        >
          {offer.title}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0 self-center">
        <div
          className="flex items-center gap-1"
          style={{
            padding: `${cfg.badgePy}px ${cfg.badgePx}px`, borderRadius: 6,
            background: 'rgba(99,179,237,0.10)', fontSize: cfg.priceFs, fontWeight: 700,
            fontVariantNumeric: 'tabular-nums', color: 'var(--color-primary-50)',
            whiteSpace: 'nowrap' as const,
          }}
        >
          <Zap size={cfg.priceFs} />
          {formatNumber(offer.priceSats)}
          <FiatHint sats={offer.priceSats} className="text-[0.9em] ml-[3px]" />
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
          className="flex items-center justify-center transition-colors duration-150 rounded-lg cursor-pointer"
          style={{
            width: 32, height: 32,
            background: 'var(--theme-bg-subtle)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text-muted)',
          }}
          aria-label="Options"
        >
          <MoreVertical size={15} strokeWidth={2.5} />
        </button>
      </div>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 160 } } }}
      >
        <MenuItem onClick={() => { setMenuAnchor(null); onAction('view', offer) }}>
          <ListItemIcon><Eye size={16} /></ListItemIcon>
          <ListItemText>View</ListItemText>
        </MenuItem>
        {!isAgent && (
          <MenuItem onClick={() => { setMenuAnchor(null); onAction('edit', offer) }}>
            <ListItemIcon><Edit size={16} /></ListItemIcon>
            <ListItemText>Edit</ListItemText>
          </MenuItem>
        )}
        {isAgent ? (
          <MenuItem onClick={() => { setMenuAnchor(null); onAction('toggle-active', offer) }} sx={{ color: offer.status === 'ACTIVE' ? 'text.secondary' : 'success.main' }}>
            <ListItemIcon sx={{ color: offer.status === 'ACTIVE' ? 'text.secondary' : 'success.main' }}><Power size={16} /></ListItemIcon>
            <ListItemText>{offer.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</ListItemText>
          </MenuItem>
        ) : (
          <>
            {/* ADR-366 follow-on: ARCHIVED can republish too — was a dead
                end before (Edit + Delete only), no way back to ACTIVE. */}
            {(offer.status === 'DRAFT' || offer.status === 'ARCHIVED') && (
              <MenuItem onClick={() => { setMenuAnchor(null); onAction('publish', offer) }} sx={{ color: 'success.main' }}>
                <ListItemIcon sx={{ color: 'success.main' }}><Eye size={16} /></ListItemIcon>
                <ListItemText>Publish</ListItemText>
              </MenuItem>
            )}
            {offer.status === 'ACTIVE' && (
              <MenuItem onClick={() => { setMenuAnchor(null); onAction('archive', offer) }} sx={{ color: 'text.secondary' }}>
                <ListItemIcon sx={{ color: 'text.secondary' }}><Archive size={16} /></ListItemIcon>
                <ListItemText>Archive</ListItemText>
              </MenuItem>
            )}
          </>
        )}
        <Divider />
        <MenuItem onClick={() => { setMenuAnchor(null); onAction('delete', offer) }} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'error.main' }}><Trash2 size={16} /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </div>
  )
}



export function ListingsTab({ pubkey, onKpiChange, headerPrefix }: SellTabProps) {
  const navigate = useNavigate()
  const { showSnackbar } = useNotification()
  const [deleteConfirm, setDeleteConfirm] = useState<Offer | null>(null)
  const { setActions: setFABActions, clear: clearFAB } = useFABActions()
  const { setStatus, deleteOffer } = useOfferListActions(pubkey)

  const { data: productOffers = [], isLoading: productLoading } = useUserProductOffers(pubkey)
  // ADR-368 D2: Sell is goods-only — SERVICE + AGENT_SETUP offers moved to
  // Cooperate Manage (`?tab=services` / `?tab=stack`). No more merge.
  const offers = productOffers
  const loading = productLoading
  const { data: categories = [] } = useStandardCategories()

  const [categoryOpen, setCategoryOpen] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState('')
  // ADR-277 D6: taxonomy defaults to 'standard' — ListBrowser hydrates it from
  // localStorage on mount if the user previously switched to 'gamma'.
  const [taxonomy, setTaxonomy] = useState<TaxonomyAxis>('standard')
  const [selectedGammaTags, setSelectedGammaTags] = useState<string[]>([])
  const [contextTab, setContextTab] = useState<ContextTab>('all')
  // ADR-368 D2: legacy ?filter=services|agents deep links redirect to Cooperate
  // Manage (App.tsx redirect table); this tab only honors goods + status
  // filters now. Re-synced on every `searchParams` change, not just at mount:
  // ListingsTab stays mounted across in-tab navigation (SellListings only
  // (re)mounts it when `activeTab` actually flips away from 'listings' and
  // back), so a `useState` initializer alone missed the case where the user
  // was already on tab=listings and clicked a Sell subnav link that only
  // changes `?filter=` (ADR-336 bug fix).
  const [searchParams] = useSearchParams()
  const [filterTab, setFilterTab] = useState<FilterTab>(() => {
    const raw = searchParams.get('filter')
    return raw === 'items' || raw === 'products' || raw === 'active' || raw === 'drafts' ? raw : 'all'
  })
  useEffect(() => {
    const raw = searchParams.get('filter')
    const next = raw === 'items' || raw === 'products' || raw === 'active' || raw === 'drafts' ? raw : 'all'
    setFilterTab(prev => (prev === next ? prev : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  // ADR-368 follow-up: Grid/List is a page-level preference — shared with the
  // other /sell/listings subtabs via the 'sellManage_viewMode' key.
  const [viewMode, setViewMode] = usePageListViewMode({
    storageKey: 'sellManage_viewMode',
    legacyKey: 'sellListings_viewMode',
    initial: 'gallery',
  })

  function handleSearch() { setActiveQuery(query) }
  function handleClear() { setQuery(''); setActiveQuery('') }

  const contextTabs = [
    { key: 'all', label: 'All' },
    { key: 'private', label: 'Private' },
    { key: 'corporate', label: 'Corporate' },
  ]

  useEffect(() => {
    // ADR-368 D2: Sell FAB is goods-only — Service + Agent moved to the
    // Cooperate FAB sets (CoopManage tabs + CoopExplore).
    setFABActions([
      { id: 'create-item', label: 'Items', info: 'Sell items directly', group: 'Sell', icon: 'plus', onClick: () => navigate('/offers/new?type=item') },
      { id: 'create-offer', label: 'Product', info: 'Add to catalog', group: 'Sell', icon: 'package', onClick: () => navigate('/sell/listings/new?type=PRODUCT&mode=listings') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate])

  // ADR-277 D4/D6: frequency-sorted gamma tag facets from the pre-taxonomy-filter set
  // (mirrors BuyDashboard).
  const gammaTagFacets = useMemo<GammaTagFacet[]>(() => {
    const counts = new Map<string, number>()
    for (const o of offers) {
      for (const tag of o.gammaTags ?? []) {
        counts.set(tag, (counts.get(tag) || 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  }, [offers])

  const filteredItems = useMemo(() => {
    let filtered = offers
    if (activeQuery.trim()) {
      const q = activeQuery.toLowerCase()
      filtered = filtered.filter(o =>
        o.title.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.category?.toLowerCase().includes(q),
      )
    }
    if (contextTab === 'private') filtered = filtered.filter(o => !o.companyId)
    else if (contextTab === 'corporate') filtered = filtered.filter(o => !!o.companyId)
    if (filterTab === 'items') filtered = filtered.filter(o => o.offerType === 'ITEM')
    else if (filterTab === 'products') filtered = filtered.filter(o => o.offerType === 'PRODUCT')
    else if (filterTab === 'active') filtered = filtered.filter(o => o.status === 'ACTIVE')
    else if (filterTab === 'drafts') filtered = filtered.filter(o => o.status === 'DRAFT')
    // ADR-277 D7: the two axes are mutually exclusive — only the active axis's
    // selection narrows the item set. Gamma is multi-select, OR-combined.
    if (taxonomy === 'gamma') {
      if (selectedGammaTags.length > 0) {
        filtered = filtered.filter(o => o.gammaTags?.some(t => selectedGammaTags.includes(t)))
      }
    } else if (selectedCategory) {
      filtered = filtered.filter(o => o.categoryCode?.startsWith(selectedCategory))
    }
    switch (sortBy) {
      case 'price-asc': filtered.sort((a, b) => a.priceSats - b.priceSats); break
      case 'price-desc': filtered.sort((a, b) => b.priceSats - a.priceSats); break
      case 'name': filtered.sort((a, b) => a.title.localeCompare(b.title)); break
      default: filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); break
    }
    return filtered
  }, [offers, filterTab, contextTab, activeQuery, sortBy, selectedCategory, taxonomy, selectedGammaTags])

  const kpiItems = useMemo<KPIItem[]>(() => {
    const base = offers
    return [
      { icon: <Tag size={14} />, value: categories.filter(c => c.level === 1).length, label: 'Categories', onClick: () => setCategoryOpen(v => !v), active: categoryOpen, heading: 'Browse' },
      { icon: <Package size={14} />, value: base.length, label: 'Total', onClick: () => setFilterTab('all'), active: filterTab === 'all' },
      { icon: <Package size={14} />, value: base.filter(o => o.offerType === 'ITEM').length, label: 'Items', onClick: () => setFilterTab('items'), active: filterTab === 'items' },
      { icon: <Package size={14} />, value: base.filter(o => o.offerType === 'PRODUCT').length, label: 'Products', onClick: () => setFilterTab('products'), active: filterTab === 'products' },
      { icon: <Eye size={14} />, value: base.filter(o => o.status === 'ACTIVE').length, label: 'Active', onClick: () => setFilterTab('active'), active: filterTab === 'active' },
      { icon: <EyeOff size={14} />, value: base.filter(o => o.status === 'DRAFT').length, label: 'Drafts', onClick: () => setFilterTab('drafts'), active: filterTab === 'drafts', separator: true },
    ]
  }, [offers, filterTab, categories, categoryOpen])

  // Lift KPIs to the parent shell's KPIStrip.
  useEffect(() => {
    onKpiChange(kpiItems, loading)
  }, [onKpiChange, kpiItems, loading])

  function handleAction(action: 'view' | 'edit' | 'archive' | 'delete' | 'publish' | 'toggle-active', offer: Offer) {
    if (action === 'view') { navigate(`/buy/product/${offer.id}`); return }
    if (action === 'delete') { setDeleteConfirm(offer); return }
    if (action === 'edit') { navigate(`/sell/listings/${offer.id}`); return }
    // ADR-368 D2: goods-only pool — 'toggle-active' (AGENT_SETUP) is no
    // longer reachable here; it moved to Cooperate Manage's stack tab.
    if (action === 'toggle-active') return
    if (action === 'archive') {
      setStatus(offer, 'ARCHIVED')
        .then(() => showSnackbar('Listing archived', 'success'))
        .catch((err) => {
          console.error(err)
          const message = err instanceof ApiError ? (err.data?.message || err.message) : 'Failed to archive listing'
          showSnackbar(message, 'error')
        })
      return
    }
    if (action === 'publish') {
      setStatus(offer, 'ACTIVE')
        .then(() => showSnackbar('Listing published', 'success'))
        .catch((err) => {
          console.error(err)
          const message = err instanceof ApiError ? (err.data?.message || err.message) : 'Failed to publish listing'
          showSnackbar(message, 'error')
        })
      return
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm || !pubkey) return
    try {
      await deleteOffer(deleteConfirm)
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Failed to delete listing:', error)
      showSnackbar(error instanceof Error ? error.message : 'Failed to delete listing', 'error')
    }
  }

  return (
    <>
      <ListBrowser
        items={filteredItems}
        loading={loading}
        headerPrefix={headerPrefix}
        controlledViewMode={viewMode}
        onControlledViewModeChange={setViewMode}
        filterTabs={contextTabs}
        activeFilterTab={contextTab}
        onFilterTabChange={(key) => setContextTab(key as ContextTab)}
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        taxonomy={taxonomy}
        onTaxonomyChange={setTaxonomy}
        gammaTagFacets={gammaTagFacets}
        selectedGammaTags={selectedGammaTags}
        onSelectGammaTags={setSelectedGammaTags}
        searchQuery={activeQuery}
        onSearchQueryChange={(q) => { setQuery(q); setActiveQuery(q) }}
        sortBy={sortBy}
        onSortChange={(s) => setSortBy(s as SortOption)}
        sortOptions={[
          { value: 'newest', label: 'Newest' },
          { value: 'price-asc', label: 'Price ↑' },
          { value: 'price-desc', label: 'Price ↓' },
          { value: 'name', label: 'Name A–Z' },
        ]}
        categoryOpen={categoryOpen}
        onCategoryOpenChange={setCategoryOpen}
        defaultPanelMode="top"
        headerActions={[
          <SearchInput
            key="search"
            variant="toggle"
            size="md"
            value={query}
            onChange={setQuery}
            onSearch={handleSearch}
            onClear={handleClear}
            placeholder="Search listings…"
            ariaLabel="Search"
          />,
        ]}
        renderCard={(offer, size, viewMode) => viewMode === 'gallery' ? (
          <SellGalleryCard offer={offer} size={size} onAction={handleAction} />
        ) : (
          <SellListRow offer={offer} size={size} onAction={handleAction} />
        )}
        cardKey={(offer) => offer.id}
        emptyState={
          <EmptyStateGuide
            icon={<Package size={26} />}
            accent="var(--color-primary-50)"
            accentSoft="rgba(232,69,65,0.12)"
            title="No listings yet"
            intro="A listing is a published offer that buyers can purchase with Bitcoin Lightning. Create private items or catalog products — every sale is paid directly to you and published to Nostr so your offers stay portable and censorship-resistant. Services and AI agents are managed under Cooperate."
            features={[
              { icon: <ShoppingBag size={16} />, title: 'Private Items', text: 'Sell personal or used goods directly — no company required. Perfect for one-off sales between peers.', color: 'var(--color-neutral-5)', bg: 'rgba(113,128,150,0.12)' },
              { icon: <Package size={16} />, title: 'Products', text: 'Publish catalog products as purchasable listings with images, pricing in sats, and delivery options.', color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)' },
              { icon: <ShieldCheck size={16} />, title: 'Phased Payments', text: 'Pay milestone by milestone, directly to the provider, so neither side is exposed to the full amount at once. Escrow is planned for later.', color: 'var(--color-accent-primary)', bg: 'rgba(245,166,35,0.12)' },
              { icon: <Radio size={16} />, title: 'Nostr Publishing', text: 'Listings sync to Nostr relays — decentralized, portable, and discoverable across the network without a central server.', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.08)' },
              { icon: <Tag size={16} />, title: 'Status Lifecycle', text: 'Keep offers as Draft while editing, set them Active to sell, or Archive when done. Filter the KPI strip above to jump between states.', color: 'var(--color-primary-50)', bg: 'rgba(232,69,65,0.10)' },
            ]}
            helpLinks={[
              { label: 'List products', to: '/help/selling#sell-4' },
              { label: 'Sell dashboard overview', to: '/help/selling#sell-1' },
              { label: 'Selling guide', to: '/help/selling' },
            ]}
            ctaLabel="Create Listing"
            ctaTo="/sell/listings/new"
            secondaryCtaLabel="Set up company"
            secondaryCtaTo="/sell/company/setup"
          />
        }
        storageKeyPrefix="sellListings"
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Delete Listing?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>This action cannot be undone. &quot;{deleteConfirm.title}&quot; will be permanently removed.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>
                Cancel
              </button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--color-status-error)', color: 'white' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
