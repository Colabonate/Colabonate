// ADR-368: moved from the Sell "Agent Stack" tab (routes/sell/tabs, ADR-339)
// to Cooperate Manage — the stack now lives under `/coop/manage?tab=stack`.
// Everything else (roster pipeline, catalog sections, ⋮ membership, D3
// online/offline/delete semantics) is unchanged.
//
// An "Agent Setup" = AgentProfile (identity) + its AGENT_SETUP Offer
// (listing: gallery, price, status). The roster endpoint attaches the
// newest non-archived offer to every owned entry (ADR-339 D1), so the row
// identity is offer.images[0] → avatarUrl → Bot icon.
//
// The axis that matters here is online/offline (Offer.status ACTIVE vs
// DRAFT/none — D2); the former Owned/Booked filter tabs are gone, booked
// agents stay visible (locked) under All. Groups are now server-persisted
// Agent Catalogs (D5) — the panel rides ListBrowser's sidebarExtraTop slot,
// membership toggles live in the row "⋮" menu, and the list view groups
// entries under catalog section headers (ListBrowser's presentational
// `sections` capability).
//
// ADR-368 D3: agent-catalog CRUD moved here too — the "Catalogs" KPI tile
// opens an internal `?view=catalogs` mode (Create/Edit/Delete via the shared
// CatalogModals preset AGENT_SETUP); membership stays in the ⋮ menus above.
//
// The page body delegates to <ListBrowser> (same primitive as ListingsTab /
// CatalogsTab) so list rendering, header, search, sort, view-mode toggle,
// pagination and infinite scroll are all handled by the shared primitive.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Box, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, Menu, MenuItem, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import PersonOutline from '@mui/icons-material/PersonOutline'
import BusinessOutlined from '@mui/icons-material/BusinessOutlined'
import {
  Bot, Eye, EyeOff, Lock, MoreVertical, Pencil, Share2, Trash2, Users, FolderPlus,
} from 'lucide-react'
import { ListBrowser } from '../../../components/list-browser'
import type { ListBrowserFilterTab, ListBrowserSortOption } from '../../../components/list-browser/list-browser.types'
import type { KPIItem } from '@ds/ui'
import { VerifiedAgentBadge } from '../../../components/agents/VerifiedAgentBadge'
import { SearchInput } from '../../../components/ui/SearchInput'
import { useFABActions } from '../../../context/FABContext'
import { usePageListViewMode } from '../../../hooks/usePageListViewMode'
import { useAgentRoster, type BookedRosterEntry, type RosterAgentProfile } from '../../../hooks/useAgentRosterQuery'
import {
  useAgentCatalogs, useDeleteAgentCatalog,
  useDeleteAgentProfile, DeleteAgentProfileError,
  useToggleAgentCatalogMember, useToggleAgentSetupStatus,
  type AgentCatalog,
} from '../../../hooks/useAgentCatalogsQuery'
import { CreateCatalogModal, EditCatalogModal } from '../../sell/components/CatalogModals'
import { cn } from '@ds/utils'
import type { CoopTabProps } from '../../sell/sell.types'

// A stack entry is either an owned-only profile or a booked one (which may
// also happen to be owned by the same caller — no cross-dedupe, both entry
// points stay valid and independent).
interface RosterEntry {
  key: string
  agentProfile: RosterAgentProfile
  kind: 'owned' | 'booked'
  booked?: BookedRosterEntry
}

// ADR-339 D2: the meaningful axis for a setup manager is online/offline
// (driven by the entry's AGENT_SETUP offer), not owned/booked. Booked
// entries stay visible under All with their locked/read-only treatment.
type ViewFilter = 'all' | 'online' | 'offline'
type SortOption = 'newest' | 'name' | 'active'
// ADR-326 D10.6 (FU-494): same axis as ListingsTab.tsx's contextTab.
type AgentContext = 'all' | 'private' | 'corporate'

const PRESENCE_FRESH_MS = 5 * 60 * 1000 // heuristic threshold, no live presence (FU-395)

const UNCATALOGED_SECTION_KEY = 'uncataloged'

function formatLastActive(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < PRESENCE_FRESH_MS) return 'active now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `active ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `active ${hours}h ago`
  const days = Math.floor(hours / 24)
  return `active ${days}d ago`
}

function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < PRESENCE_FRESH_MS
}

// ADR-339 D1: the listing half of the identity — the first gallery image
// assigned in the agent wizard, falling back to avatarUrl and finally the
// Bot glyph (handled by AvatarThumb). Offer.images is a JSON column, parsed
// defensively.
function offerGalleryImage(agentProfile: RosterAgentProfile): string | null {
  const imgs = agentProfile.offer?.images
  if (Array.isArray(imgs) && typeof imgs[0] === 'string' && imgs[0]) return imgs[0]
  return null
}

// Online = the entry's AGENT_SETUP offer is ACTIVE (ADR-339 D2). DRAFT or no
// offer = offline. ARCHIVED offers never reach the client (excluded in the
// roster projection).
function isOnlineEntry(entry: RosterEntry): boolean {
  return entry.kind === 'owned' && entry.agentProfile.offer?.status === 'ACTIVE'
}

// AvatarThumb — round 64×64 (list) or full-width (gallery) avatar with a
// Bot-icon fallback when no image source exists. Keeps the same visual
// weight whether the agent has a gallery image or not, so empty rows don't
// collapse the layout.
function AvatarThumb({
  src, alt, size = 90,
}: { src: string | null; alt: string; size?: number }) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className="object-cover"
        style={{ width: size, height: size, borderRadius: '50%' }}
      />
    )
  }
  return (
    <div
      className="flex items-center justify-center shrink-0 rounded-full overflow-hidden"
      style={{ width: size, height: size, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
    >
      <Bot size={Math.round(size * 0.35)} style={{ color: 'var(--color-primary-50)', opacity: 0.85 }} />
    </div>
  )
}

// Shared "⋮" options menu content (ADR-339 D3 + ADR-340 D4): Edit ·
// Online/Offline · Share (disabled, FU-540) · catalog membership checkboxes
// (D5) · Delete (D4, owned + not busy). Owned entries only; booked entries
// are read-only.
function StackOptionsMenu({
  entry, isBusy, catalogs, onToggleCatalog, onEdit, onToggleOnline, onDelete, onClose,
}: {
  entry: RosterEntry
  isBusy: boolean
  catalogs: Array<{ id: string; name: string; memberIds: string[] }>
  onToggleCatalog: (agentProfileId: string, catalogId: string) => void
  onEdit: (entry: RosterEntry) => void
  onToggleOnline: (entry: RosterEntry) => void
  onDelete: (entry: RosterEntry) => void
  onClose: () => void
}) {
  const { agentProfile, kind, booked } = entry
  const offer = agentProfile.offer
  const isOnline = isOnlineEntry(entry)

  if (kind === 'booked') {
    return (
      <>
        <MenuItem disabled>
          Read-only — {booked?.workspace ? 'booked agent with an open workspace' : 'booked from another seller'}
        </MenuItem>
        <Tooltip title="Coming soon" placement="left">
          <span><MenuItem disabled><Share2 size={14} style={{ marginRight: 8 }} />Share</MenuItem></span>
        </Tooltip>
      </>
    )
  }

  return (
    <>
      {isBusy ? (
        <MenuItem disabled>
          <Lock size={14} style={{ marginRight: 8 }} />
          Busy — finish the active job to edit
        </MenuItem>
      ) : (
        <MenuItem onClick={() => { onClose(); onEdit(entry) }}>
          <Pencil size={14} style={{ marginRight: 8 }} />
          Edit
        </MenuItem>
      )}
      {!isBusy && offer && (
        <MenuItem onClick={() => { onClose(); onToggleOnline(entry) }}>
          {isOnline
            ? <EyeOff size={14} style={{ marginRight: 8 }} />
            : <Eye size={14} style={{ marginRight: 8 }} />}
          {isOnline ? 'Take offline' : 'Bring online'}
        </MenuItem>
      )}
      <Tooltip title="Coming soon" placement="left">
        <span><MenuItem disabled><Share2 size={14} style={{ marginRight: 8 }} />Share</MenuItem></span>
      </Tooltip>
      {catalogs.length > 0 && (
        <>
          <Divider sx={{ my: 0.5 }} />
          {catalogs.map(c => (
            <MenuItem key={c.id} onClick={() => onToggleCatalog(agentProfile.id, c.id)}>
              <Checkbox size="small" checked={c.memberIds.includes(agentProfile.id)} sx={{ p: 0, mr: 1 }} />
              {c.name}
            </MenuItem>
          ))}
        </>
      )}
      {/* ADR-340 D4: soft delete (busy-guarded server-side; we mirror the
          client-side busy lock so the user sees the same lock affordance as
          Edit). Divider above is the existing membership section divider — D4
          adds its own separator so Delete is unambiguously the last action. */}
      <Divider sx={{ my: 0.5 }} />
      <Tooltip title={isBusy ? 'Agent is busy — finish the active job to delete' : 'Permanently remove this setup'} placement="left">
        <span>
          <MenuItem
            onClick={() => { if (!isBusy) { onClose(); onDelete(entry) } }}
            disabled={isBusy}
            sx={{ color: isBusy ? undefined : 'var(--color-status-error)' }}
          >
            <Trash2 size={14} style={{ marginRight: 8 }} />
            Delete
          </MenuItem>
        </span>
      </Tooltip>
    </>
  )
}

// StackListRow mirrors CoopListRow (coop-cards.tsx): left thumb with the
// gallery/avatar image, uppercase kind label + name title in the middle,
// online/offline or presence pill + menu on the right. Hover lift + ring
// shadow match the rest of the Coop-cards family.
function StackListRow({
  entry, isBusy, catalogs, onToggleCatalog, onEdit, onToggleOnline, onDelete, onOpen,
}: {
  entry: RosterEntry
  /** True when the agent is currently in an active workspace/ticket — owned
   *  agents fall back to the read-only Listings filter while busy (locked). */
  isBusy: boolean
  catalogs: Array<{ id: string; name: string; memberIds: string[] }>
  onToggleCatalog: (agentProfileId: string, catalogId: string) => void
  onEdit: (entry: RosterEntry) => void
  onToggleOnline: (entry: RosterEntry) => void
  onDelete: (entry: RosterEntry) => void
  onOpen: (entry: RosterEntry) => void
}) {
  const { agentProfile, kind, booked } = entry
  const lastActiveAt = booked?.lastActiveAt
  const isOnline = isOnlineEntry(entry)
  const fresh = lastActiveAt ? isFresh(lastActiveAt) : false
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  // Owned agents that are free → edit wizard (ADR-339 D4). Owned agents
  // currently in a project/workspace, and booked agents → read-only listing
  // filter (or workspace/ticket if available). isBusy gates the edit path.
  const detailPath = kind === 'owned'
    ? (isBusy
        ? '/coop/manage?tab=stack'
        : `/coop/agents/${agentProfile.id}/edit`)
    : (booked?.workspace
        ? `/workspaces/${booked.workspace.id}`
        : booked?.ticket
          ? `/tickets/${booked.ticket.id}`
          : '/coop/manage?tab=stack')

  return (
    <Link
      to={detailPath}
      onClick={(e) => { if (menuAnchor) { e.preventDefault(); return }; onOpen(entry) }}
      className={cn(
        'flex items-stretch no-underline cursor-pointer rounded-xl overflow-hidden',
        'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.06)]',
        'transition-all duration-300 ease-out',
        'hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)]',
        'active:scale-[0.99] relative',
      )}
      style={{
        background: 'var(--theme-surface)',
        outline: '1px solid var(--theme-border)',
        minHeight: 90,
      }}
    >
      <div
        className="flex items-center justify-center shrink-0 overflow-hidden"
        style={{ width: 90, background: 'transparent' }}
      >
        <AvatarThumb src={offerGalleryImage(agentProfile) ?? agentProfile.avatarUrl} alt={agentProfile.name} size={64} />
      </div>

      <div className="flex flex-col justify-center flex-1 min-w-0" style={{ padding: '12px 16px' }}>
        <div
          className="mb-0.5"
          style={{
            fontSize: 11, fontWeight: 600,
            color: 'var(--theme-text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.04em',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          <Bot size={11} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }} />
          {kind === 'owned' ? 'Agent · Owned' : 'Agent · Booked'}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            style={{
              fontSize: 15, fontWeight: 600, color: 'var(--theme-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
            }}
          >
            {agentProfile.name}
          </span>
          <VerifiedAgentBadge isVerified={agentProfile.isVerified} size="small" />
          {/* Busy lock — surfaces why an owned agent isn't editable. Mirrors
              the same pattern as the gallery card below so the affordance
              reads identically across view modes. */}
          {kind === 'owned' && isBusy && (
            <Tooltip title="Agent is currently in a workspace — finish the active job to edit.">
              <Lock size={12} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
            </Tooltip>
          )}
        </div>
        {agentProfile.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {agentProfile.capabilities.slice(0, 3).map(c => (
              <span
                key={c}
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
              >
                {c}
              </span>
            ))}
            {agentProfile.capabilities.length > 3 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
              >
                +{agentProfile.capabilities.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 self-center" style={{ paddingRight: 12 }}>
        {kind === 'owned' ? (
          // ADR-339 D2/D3: online/offline pill — Offer.status is the single
          // source of truth for "is this setup listed".
          <span
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: isOnline ? 'rgba(72,187,120,0.16)' : 'rgba(113,128,150,0.16)',
              color: isOnline ? 'var(--color-status-success)' : 'var(--theme-text-muted)',
            }}
          >
            <Box
              component="span"
              sx={{
                width: 6, height: 6, borderRadius: '50%',
                bgcolor: isOnline ? 'var(--color-status-success)' : 'var(--theme-text-muted)',
                display: 'inline-block',
              }}
            />
            {isOnline ? 'Online' : 'Offline'}
          </span>
        ) : (
          // Booked agents keep the presence heuristic pill (FU-395).
          <span
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: fresh ? 'rgba(72,187,120,0.16)' : 'rgba(113,128,150,0.16)',
              color: fresh ? 'var(--color-status-success)' : 'var(--theme-text-muted)',
            }}
          >
            <Box
              component="span"
              sx={{
                width: 6, height: 6, borderRadius: '50%',
                bgcolor: fresh ? 'var(--color-status-success)' : 'var(--theme-text-muted)',
                display: 'inline-block',
              }}
            />
            {lastActiveAt ? formatLastActive(lastActiveAt) : 'Booked'}
          </span>
        )}
        <IconButton
          size="small"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
          aria-label="Options"
          sx={{ width: 32, height: 32, border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-bg-subtle)' }}
        >
          <MoreVertical size={15} strokeWidth={2.5} />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <StackOptionsMenu
            entry={entry}
            isBusy={isBusy}
            catalogs={catalogs}
            onToggleCatalog={onToggleCatalog}
            onEdit={onEdit}
            onToggleOnline={onToggleOnline}
            onDelete={onDelete}
            onClose={() => setMenuAnchor(null)}
          />
        </Menu>
      </div>
    </Link>
  )
}

// StackGalleryCard — 2-col grid card for the gallery view. Same visual
// language as CoopGalleryCard (coop-cards.tsx): top image tile with kind
// badge, content below with kind label + name + capability chips, footer
// with status pill + action menu.
function StackGalleryCard({
  entry, isBusy, catalogs, onToggleCatalog, onEdit, onToggleOnline, onDelete, onOpen,
}: {
  entry: RosterEntry
  /** True when the agent is currently in an active workspace/ticket — owned
   *  agents fall back to the read-only Listings filter while busy (locked). */
  isBusy: boolean
  catalogs: Array<{ id: string; name: string; memberIds: string[] }>
  onToggleCatalog: (agentProfileId: string, catalogId: string) => void
  onEdit: (entry: RosterEntry) => void
  onToggleOnline: (entry: RosterEntry) => void
  onDelete: (entry: RosterEntry) => void
  onOpen: (entry: RosterEntry) => void
}) {
  const { agentProfile, kind, booked } = entry
  const lastActiveAt = booked?.lastActiveAt
  const isOnline = isOnlineEntry(entry)
  const fresh = lastActiveAt ? isFresh(lastActiveAt) : false
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  const detailPath = kind === 'owned'
    ? (isBusy
        ? '/coop/manage?tab=stack'
        : `/coop/agents/${agentProfile.id}/edit`)
    : (booked?.workspace
        ? `/workspaces/${booked.workspace.id}`
        : booked?.ticket
          ? `/tickets/${booked.ticket.id}`
          : '/coop/manage?tab=stack')

  return (
    <div
      onClick={(e) => {
        if (menuAnchor) { e.preventDefault(); return }
        const target = e.target as HTMLElement
        if (target.closest('[aria-label="Options"]') || target.closest('.MuiMenu-root')) return
        onOpen(entry)
      }}
      className={cn(
        'flex flex-col rounded-xl overflow-hidden cursor-pointer relative',
        'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.06)]',
        'transition-all duration-300 ease-out',
        'hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)]',
        'active:scale-[0.99]',
      )}
      style={{
        background: 'var(--theme-surface)',
        outline: '1px solid var(--theme-border)',
      }}
    >
      <Link
        to={detailPath}
        onClick={(e) => { if (menuAnchor) e.preventDefault() }}
        className="flex flex-col flex-1 no-underline"
      >
        <div
          className="relative flex items-center justify-center shrink-0 overflow-hidden"
          style={{ height: 110, background: 'var(--theme-bg-subtle)' }}
        >
          <AvatarThumb src={offerGalleryImage(agentProfile) ?? agentProfile.avatarUrl} alt={agentProfile.name} size={72} />
          {kind === 'owned' && isBusy && (
            <Tooltip title="Agent is currently in a workspace — finish the active job to edit.">
              <span
                className="absolute top-2 left-2 inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(113,128,150,0.85)', color: 'white' }}
              >
                <Lock size={9} />
                Busy
              </span>
            </Tooltip>
          )}
          <span
            className="absolute top-2 left-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full"
            style={{
              // Shifted right when the Busy chip occupies the top-left slot.
              left: kind === 'owned' && isBusy ? 58 : 8,
              background: kind === 'owned' ? 'rgba(99,179,237,0.20)' : 'rgba(159,122,234,0.20)',
              color: kind === 'owned' ? 'var(--color-primary-50)' : 'var(--color-secondary-50)',
              border: '1px solid',
              borderColor: kind === 'owned' ? 'rgba(99,179,237,0.35)' : 'rgba(159,122,234,0.35)',
            }}
          >
            {kind === 'owned' ? (isOnline ? 'Online' : 'Offline') : 'Booked'}
          </span>
          {agentProfile.isVerified && (
            <span className="absolute top-2 right-2">
              <VerifiedAgentBadge isVerified size="small" />
            </span>
          )}
        </div>

        <div className="flex flex-col flex-1" style={{ padding: '10px 12px' }}>
          <div
            className="mb-0.5"
            style={{
              fontSize: 9, fontWeight: 600,
              color: 'var(--theme-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.04em',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            <Bot size={9} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3, opacity: 0.7 }} />
            Agent
          </div>
          <div
            style={{
              fontSize: 13, fontWeight: 600, lineHeight: 1.4,
              color: 'var(--theme-text)',
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
              minHeight: 36,
            }}
          >
            {agentProfile.name}
          </div>
          {agentProfile.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {agentProfile.capabilities.slice(0, 2).map(c => (
                <span
                  key={c}
                  className="text-[9px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
                >
                  {c}
                </span>
              ))}
              {agentProfile.capabilities.length > 2 && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
                >
                  +{agentProfile.capabilities.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>

      <div
        className="flex items-center justify-between gap-1 px-2 py-1.5"
        style={{ borderTop: '1px solid var(--theme-border)' }}
      >
        {kind === 'owned' ? (
          <span
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: isOnline ? 'rgba(72,187,120,0.16)' : 'rgba(113,128,150,0.16)',
              color: isOnline ? 'var(--color-status-success)' : 'var(--theme-text-muted)',
            }}
          >
            <Box
              component="span"
              sx={{
                width: 5, height: 5, borderRadius: '50%',
                bgcolor: isOnline ? 'var(--color-status-success)' : 'var(--theme-text-muted)',
                display: 'inline-block',
              }}
            />
            {isOnline ? 'Online' : 'Offline'}
          </span>
        ) : (
          <span
            className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: fresh ? 'rgba(72,187,120,0.16)' : 'rgba(113,128,150,0.16)',
              color: fresh ? 'var(--color-status-success)' : 'var(--theme-text-muted)',
            }}
          >
            <Box
              component="span"
              sx={{
                width: 5, height: 5, borderRadius: '50%',
                bgcolor: fresh ? 'var(--color-status-success)' : 'var(--theme-text-muted)',
                display: 'inline-block',
              }}
            />
            {lastActiveAt ? formatLastActive(lastActiveAt) : 'Booked'}
          </span>
        )}
        <IconButton
          size="small"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
          aria-label="Options"
          sx={{ width: 26, height: 26 }}
        >
          <MoreVertical size={14} strokeWidth={2.5} />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <StackOptionsMenu
            entry={entry}
            isBusy={isBusy}
            catalogs={catalogs}
            onToggleCatalog={onToggleCatalog}
            onEdit={onEdit}
            onToggleOnline={onToggleOnline}
            onDelete={onDelete}
            onClose={() => setMenuAnchor(null)}
          />
        </Menu>
      </div>
    </div>
  )
}

// ADR-368 D3: agent-catalog CRUD mode (`?view=catalogs`). Rendered in place
// of the roster ListBrowser; membership stays on the ⋮ menus in the roster.
// Create/Edit reuse the shared CatalogModals (preset AGENT_SETUP); Delete
// uses the agent-catalog mutation (same /api/catalog DELETE as CatalogsTab).
function StackCatalogsPanel({
  onExit,
  onOpenCatalog,
}: {
  onExit: () => void
  onOpenCatalog: (catalogId: string) => void
}) {
  const { data: catalogData, isLoading } = useAgentCatalogs()
  const queryClient = useQueryClient()
  const deleteCatalog = useDeleteAgentCatalog()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<AgentCatalog | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const catalogs = useMemo(() => catalogData?.catalogs ?? [], [catalogData])

  function refreshCatalogs() {
    queryClient.invalidateQueries({ queryKey: ['agent-catalogs'] })
    queryClient.invalidateQueries({ queryKey: ['catalogs', 'mine'] })
  }

  function handleConfirmDelete() {
    if (!deleting) return
    const { id } = deleting
    setDeleting(null)
    deleteCatalog.mutate(id, {
      onSuccess: refreshCatalogs,
      onError: (e) => setActionError(e instanceof Error ? e.message : 'Could not delete catalog'),
    })
  }

  return (
    <>
      {actionError && (
        <Typography
          variant="caption"
          className="mb-1"
          style={{ color: 'var(--color-status-error)', display: 'block' }}
          onClick={() => setActionError(null)}
        >
          {actionError} (tap to dismiss)
        </Typography>
      )}

      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 hover:opacity-90"
          style={{ background: 'var(--theme-surface-secondary)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
        >
          <Bot size={14} />
          Back to Agent Stack
        </button>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 text-[13px] font-semibold px-3 py-2 rounded-lg cursor-pointer transition-all duration-150 hover:opacity-90"
          style={{ background: 'var(--color-primary-50)', color: 'white' }}
        >
          <FolderPlus size={14} />
          New Catalog
        </button>
      </div>

      {isLoading ? (
        <Typography variant="body2" color="text.secondary">Loading catalogs…</Typography>
      ) : catalogs.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 py-16 text-center rounded-xl"
          style={{ border: '1px dashed var(--theme-border)', background: 'var(--theme-bg-subtle)' }}
        >
          <FolderPlus size={26} style={{ color: 'var(--theme-text-muted)', opacity: 0.6 }} />
          <Typography variant="body2" color="text.secondary">
            No agent catalogs yet — group your setups under a label.
          </Typography>
          <button
            onClick={() => setCreating(true)}
            className="text-[13px] font-semibold px-3 py-2 rounded-lg cursor-pointer"
            style={{ background: 'var(--color-primary-50)', color: 'white' }}
          >
            Create Catalog
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {catalogs.map(c => (
            <div
              key={c.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-150 hover:-translate-y-0.5"
              style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
              onClick={() => onOpenCatalog(c.id)}
            >
              <span
                className="shrink-0 flex items-center justify-center rounded-lg"
                style={{ width: 40, height: 40, background: 'rgba(159,122,234,0.16)', color: 'var(--color-secondary-50)' }}
              >
                <FolderPlus size={18} />
              </span>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[14px] font-semibold truncate" style={{ color: 'var(--theme-text)' }}>{c.name}</span>
                <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                  {c.memberIds.length} member{c.memberIds.length !== 1 ? 's' : ''} · tap to manage membership
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                <IconButton
                  size="small"
                  onClick={() => setEditing(c)}
                  aria-label="Edit catalog"
                  sx={{ width: 30, height: 30, border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-bg-subtle)' }}
                >
                  <Pencil size={13} strokeWidth={2.5} />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => setDeleting({ id: c.id, name: c.name })}
                  aria-label="Delete catalog"
                  sx={{ width: 30, height: 30, border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-bg-subtle)', color: 'var(--color-status-error)' }}
                >
                  <Trash2 size={13} strokeWidth={2.5} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateCatalogModal
          companyId={null}
          defaultType="AGENT_SETUP"
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refreshCatalogs() }}
        />
      )}
      {editing && (
        <EditCatalogModal
          catalog={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshCatalogs() }}
        />
      )}
      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete catalog?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            “{deleting?.name}” will be removed. Its agents are not deleted — they just stop being grouped under this catalog.
          </Typography>
        </DialogContent>
        <DialogActions>
          <MenuItem onClick={() => setDeleting(null)}>Cancel</MenuItem>
          <MenuItem onClick={handleConfirmDelete} sx={{ color: 'var(--color-status-error)' }}>Delete</MenuItem>
        </DialogActions>
      </Dialog>
    </>
  )
}

export function AgentStackTab({ onKpiChange, headerPrefix }: CoopTabProps) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const catalogsView = searchParams.get('view') === 'catalogs'
  const { data, isLoading } = useAgentRoster()
  const { setActions: setFABActions, clear: clearFAB } = useFABActions()
  // ADR-340 D3: catalogs are still loaded (the row menu still owns
  // membership checkboxes per ADR-339 D5), but the sidebar/panel is gone.
  const { data: catalogData, isLoading: catalogsLoading } = useAgentCatalogs()
  const toggleMember = useToggleAgentCatalogMember()
  const toggleSetupStatus = useToggleAgentSetupStatus()
  const deleteProfile = useDeleteAgentProfile()
  const catalogs = useMemo(() => catalogData?.catalogs ?? [], [catalogData])
  const [actionError, setActionError] = useState<string | null>(null)
  const [activeCatalogId, setActiveCatalogId] = useState<string | null>(null)
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all')
  // ADR-368 follow-up: Grid/List is a page-level preference — shared with the
  // other /coop/manage subtabs via the 'coopManage_viewMode' key.
  const [viewMode, setViewMode] = usePageListViewMode({
    storageKey: 'coopManage_viewMode',
    legacyKey: 'roster_viewMode',
    initial: 'list',
  })
  // ADR-326 D10.6 (FU-494): filters the "owned" section by AgentProfile.
  // companyId; booked entries are unaffected — whose agent I booked is
  // independent of my own Private/Corporate context.
  const [contextTab, setContextTab] = useState<AgentContext>('all')
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  // ADR-340 D4: delete-agent confirm dialog state.
  const [deleteTarget, setDeleteTarget] = useState<RosterEntry | null>(null)

  // ADR-368 D5: Agent stays a Cooperate FAB action (as on the former
  // /sell/listings FAB) pointing at the moved create route; the Coop Guide
  // action joins it (Coop Manage FAB contract). FU-496: inherits the current
  // Corporate context so the wizard starts pre-selected.
  useEffect(() => {
    setFABActions([
      {
        id: 'create-agent', label: 'Agent', info: 'Offer a new agent', group: 'Cooperate', icon: 'bot',
        onClick: () => navigate(contextTab === 'corporate' ? '/coop/agents/new?context=corporate' : '/coop/agents/new'),
      },
      { id: 'coop-guide', label: 'Coop Guide', info: 'Start cooperation', group: 'Cooperate', icon: 'handshake', onClick: () => navigate('/coop/guide') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate, contextTab])

  // Stable identities (used as KPI-memo deps below) — unstable function
  // identities used to invalidate the KPI memo every render, which triggered
  // the onKpiChange lift effect → setState → render loop (max update depth).
  const openCatalogsView = useCallback(() => {
    setSearchParams(p => { p.set('view', 'catalogs'); return p }, { replace: true })
  }, [setSearchParams])
  const closeCatalogsView = useCallback(() => {
    setSearchParams(p => { p.delete('view'); return p }, { replace: true })
  }, [setSearchParams])
  const openCatalogFromPanel = useCallback((catalogId: string) => {
    setActiveCatalogId(catalogId)
    closeCatalogsView()
  }, [setActiveCatalogId, closeCatalogsView])

  const allEntries: RosterEntry[] = useMemo(() => {
    if (!data) return []
    const owned: RosterEntry[] = data.owned.map(p => ({ key: `owned-${p.id}`, agentProfile: p, kind: 'owned' as const }))
    const booked: RosterEntry[] = data.booked.map(b => ({ key: `booked-${b.agentProfile.id}`, agentProfile: b.agentProfile, kind: 'booked' as const, booked: b }))
    return [...owned, ...booked]
  }, [data])

  const ownedEntries = useMemo(() => allEntries.filter(e => e.kind === 'owned'), [allEntries])
  const onlineCount = useMemo(() => ownedEntries.filter(isOnlineEntry).length, [ownedEntries])
  const offlineCount = ownedEntries.length - onlineCount
  // Set of agentProfile ids that currently appear in the booked list — i.e.
  // the agent is in an active workspace/ticket. Owned agents in this set
  // are flagged as "busy" so the stack row/card shows the lock affordance
  // and the detail link falls back to the read-only Listings tab instead of
  // opening the edit surface (ADR-326 D7: edit only when free).
  const bookedAgentIds = useMemo(
    () => new Set(data?.booked.map(b => b.agentProfile.id) ?? []),
    [data?.booked],
  )

  // Sections (ADR-339 D5, list view): entries group under their first
  // catalog (catalog order), uncataloged entries trail at the end. Only
  // active when no catalog chip filters the list (a filtered list is a
  // single section by definition) and catalogs have loaded.
  const sectionsActive = activeCatalogId === null && catalogs.length > 0
  const sectionIndexOf = useMemo(() => {
    const indexOf = new Map<string, number>()
    catalogs.forEach((c, i) => indexOf.set(c.id, i))
    return (entry: RosterEntry) => {
      for (const c of catalogs) {
        if (c.memberIds.includes(entry.agentProfile.id)) return indexOf.get(c.id) ?? 0
      }
      return catalogs.length
    }
  }, [catalogs])
  const sectionOfFn = sectionsActive
    ? (entry: RosterEntry) => catalogs.find(c => c.memberIds.includes(entry.agentProfile.id))?.id ?? UNCATALOGED_SECTION_KEY
    : undefined
  const sectionLabelsMap = useMemo(() => {
    const labels: Record<string, string> = { [UNCATALOGED_SECTION_KEY]: 'Uncataloged' }
    for (const c of catalogs) labels[c.id] = c.name
    return labels
  }, [catalogs])

  // Filter pipeline — composes viewFilter (page-level tabs from ListBrowser)
  // + activeCatalog (server-persisted catalogs) + search + sort. ListBrowser
  // only paginates what we hand it, so all filtering stays in this consumer.
  const visibleEntries = useMemo(() => {
    let entries = activeCatalogId
      ? allEntries.filter(e => (catalogs.find(c => c.id === activeCatalogId)?.memberIds ?? []).includes(e.agentProfile.id))
      : allEntries
    if (viewFilter === 'online') entries = entries.filter(isOnlineEntry)
    else if (viewFilter === 'offline') entries = entries.filter(e => e.kind === 'owned' && !isOnlineEntry(e))
    // ADR-326 D10.6 (FU-494): only the owned section is filtered — booked
    // entries pass through regardless of the caller's own context.
    if (contextTab === 'private') entries = entries.filter(e => e.kind === 'booked' || !e.agentProfile.companyId)
    else if (contextTab === 'corporate') entries = entries.filter(e => e.kind === 'booked' || !!e.agentProfile.companyId)
    if (activeQuery.trim()) {
      const q = activeQuery.toLowerCase()
      entries = entries.filter(e =>
        e.agentProfile.name.toLowerCase().includes(q) ||
        e.agentProfile.capabilities.some(c => c.toLowerCase().includes(q)),
      )
    }
    const bySort = (a: RosterEntry, b: RosterEntry) => {
      if (sortBy === 'name') return a.agentProfile.name.localeCompare(b.agentProfile.name)
      if (sortBy === 'active') {
        const at = a.booked?.lastActiveAt ? new Date(a.booked.lastActiveAt).getTime() : 0
        const bt = b.booked?.lastActiveAt ? new Date(b.booked.lastActiveAt).getTime() : 0
        return bt - at
      }
      const at = new Date(a.agentProfile.createdAt ?? 0).getTime()
      const bt = new Date(b.agentProfile.createdAt ?? 0).getTime()
      return bt - at
    }
    const sorted = [...entries]
    sorted.sort((a, b) => {
      // Section grouping wins over the chosen sort across sections; the
      // sort still orders entries WITHIN each section.
      if (sectionsActive) {
        const sa = sectionIndexOf(a)
        const sb = sectionIndexOf(b)
        if (sa !== sb) return sa - sb
      }
      return bySort(a, b)
    })
    return sorted
  }, [allEntries, activeCatalogId, catalogs, viewFilter, contextTab, activeQuery, sortBy, sectionsActive, sectionIndexOf])

  const kpiItems = useMemo<KPIItem[]>(() => {
    // ADR-368 D3: `?view=catalogs` swaps the strip for the catalog surface's
    // own KPI set (counts + summed membership).
    if (catalogsView) {
      const members = catalogs.reduce((sum, c) => sum + c.memberIds.length, 0)
      return [
        { icon: <Users size={14} />, value: catalogs.length, label: 'Catalogs', active: true, heading: 'Agent Catalogs' },
        { icon: <Bot size={14} />, value: members, label: 'Members', color: 'var(--color-status-success)' },
      ]
    }
    return [
      // Agent Stack section: the online/offline axis (ADR-339 D2). `heading:
      // 'Agent Stack'` mirrors the `heading: 'Browse'` pattern from
      // ListingsTab.tsx — the first item doubles as the collapsible section
      // label. Total counts the caller's own setups; booked agents appear in
      // the list under All but are not part of the managed total.
      { icon: <Users size={14} />, value: ownedEntries.length, label: 'Total', onClick: () => setActiveCatalogId(null), active: activeCatalogId === null, heading: 'Agent Stack' },
      { icon: <Bot size={14} />, value: onlineCount, label: 'Online', color: 'var(--color-status-success)' },
      { icon: <Bot size={14} />, value: offlineCount, label: 'Offline', color: 'var(--theme-text-muted)' },
      // ADR-368 D3: opens the internal agent-catalog mode (`?view=catalogs`)
      // — catalog CRUD now lives with the stack under Cooperate Manage.
      { icon: <Users size={14} />, value: catalogs.length, label: 'Catalogs', onClick: openCatalogsView, active: catalogsView, heading: 'Catalogs', separator: true },
    ]
  }, [ownedEntries, onlineCount, offlineCount, activeCatalogId, catalogs.length, catalogsView, openCatalogsView])

  useEffect(() => {
    onKpiChange(kpiItems, isLoading)
  }, [onKpiChange, kpiItems, isLoading])

  function handleToggleCatalogMembership(agentProfileId: string, catalogId: string) {
    const catalog = catalogs.find(c => c.id === catalogId)
    if (!catalog) return
    const member = !catalog.memberIds.includes(agentProfileId)
    toggleMember.mutate(
      { catalogId, agentProfileId, member },
      { onError: (e) => setActionError(e instanceof Error ? e.message : 'Could not update catalog membership') },
    )
  }

  // ADR-340 D4: open the delete-confirm dialog. The row menu calls this
  // directly; the dialog then drives the actual delete mutation.
  function handleDeleteAgent(entry: RosterEntry) {
    setDeleteTarget(entry)
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.agentProfile.id
    setDeleteTarget(null)
    deleteProfile.mutate(id, {
      onError: (e) => {
        if (e instanceof DeleteAgentProfileError) {
          setActionError(e.message)
        } else {
          setActionError(e instanceof Error ? e.message : 'Could not delete agent setup')
        }
      },
    })
  }

  function handleEdit(entry: RosterEntry) {
    navigate(`/coop/agents/${entry.agentProfile.id}/edit`)
  }

  // ADR-339 D3: online/offline toggle — PATCH /api/offers/:id with the
  // flipped status. Taking an agent offline uses DRAFT (not ARCHIVED) so it
  // stays editable + re-publishable; ADR-306's seal gate guards ACTIVE.
  function handleToggleOnline(entry: RosterEntry) {
    const offer = entry.agentProfile.offer
    if (!offer) return
    toggleSetupStatus.mutate(
      { offerId: offer.id, nextStatus: offer.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE' },
      { onError: (e) => setActionError(e instanceof Error ? e.message : 'Could not change online state') },
    )
  }

  function handleOpen(entry: RosterEntry) {
    if (entry.kind === 'booked' && entry.booked) {
      if (entry.booked.workspace) navigate(`/workspaces/${entry.booked.workspace.id}`)
      else navigate(`/tickets/${entry.booked.ticket.id}`)
      return
    }
    navigate(`/coop/agents/${entry.agentProfile.id}/edit`)
  }

  // ListBrowser's filterTabs become the page-level MUI Tabs in its built-in
  // ListHeader — the online/offline axis (ADR-339 D2). Same shape as
  // ListingsTab.tsx (contextTabs).
  const viewTabs: ListBrowserFilterTab[] = [
    { key: 'all',     label: 'All' },
    { key: 'online',  label: 'Online' },
    { key: 'offline', label: 'Offline' },
  ]

  // Sort options — drives the dropdown that lives inside ListBrowser's
  // built-in filterMenuAction (sliders menu). Same axis shape as
  // ListingsTab.tsx.
  const sortOptions: ListBrowserSortOption[] = [
    { value: 'newest', label: 'Newest' },
    { value: 'name',   label: 'Name A–Z' },
    { value: 'active', label: 'Last active' },
  ]

  // ADR-368 D3: internal agent-catalog CRUD mode — replaces the roster list.
  if (catalogsView) {
    return (
      <>
        {headerPrefix}
        <StackCatalogsPanel onExit={closeCatalogsView} onOpenCatalog={openCatalogFromPanel} />
      </>
    )
  }

  return (
    <>
      {actionError && (
        <Typography
          variant="caption"
          className="mb-1"
          style={{ color: 'var(--color-status-error)', display: 'block' }}
          onClick={() => setActionError(null)}
        >
          {actionError} (tap to dismiss)
        </Typography>
      )}
      {/* Standard list primitive — same as ListingsTab / CatalogsTab. Owns
          the ListHeader (tabs + toggle-search + sort + view-toggle + sliders
          options), item rendering with `mt-3` top spacing, pagination,
          infinite scroll, skeletons, GSAP stagger and (ADR-339 D5) optional
          section headers in list view. storageKeyPrefix 'roster' namespaces
          localStorage for the view-mode toggle (roster_viewMode).
          ADR-368 D3: agent-catalog CRUD now lives in this tab's internal
          `?view=catalogs` mode (CreateCatalogModal/EditCatalogModal preset
          AGENT_SETUP). Built-in taxonomy stays suppressed. defaultPanelMode
          'top' per ADR-339 D6. */}
      <ListBrowser
        items={visibleEntries}
        loading={isLoading || catalogsLoading}
        headerPrefix={headerPrefix}
        controlledViewMode={viewMode}
        onControlledViewModeChange={setViewMode}
        filterTabs={viewTabs}
        activeFilterTab={viewFilter}
        onFilterTabChange={(key) => setViewFilter(key as ViewFilter)}
        categories={[]}
        selectedCategory=""
        onSelectCategory={() => {}}
        // ADR-340 D3: no taxonomy panel anymore. ListBrowser still expects
        // the props; pass no-op state.
        categoryOpen={false}
        onCategoryOpenChange={() => {}}
        hideBuiltinTaxonomyPanel
        defaultPanelMode="top"
        searchQuery={activeQuery}
        onSearchQueryChange={(q) => { setQuery(q); setActiveQuery(q) }}
        sortBy={sortBy}
        onSortChange={(s) => setSortBy(s as SortOption)}
        sortOptions={sortOptions}
        sectionOf={sectionOfFn}
        sectionLabels={sectionLabelsMap}
        headerActions={[
          // ADR-326 D10.6 (FU-494): Private/Corporate context — same axis
          // as ListingsTab.tsx's contextTabs, rendered as a compact toggle
          // here since the online/offline axis already owns ListBrowser's
          // one built-in filterTabs slot.
          <ToggleButtonGroup
            key="context"
            value={contextTab}
            exclusive
            size="small"
            onChange={(_, value) => { if (value) setContextTab(value as AgentContext) }}
          >
            <ToggleButton value="all" sx={{ textTransform: 'none', px: 1.5 }}>All</ToggleButton>
            <ToggleButton value="private" sx={{ gap: 0.5, textTransform: 'none', px: 1.5 }}>
              <PersonOutline sx={{ fontSize: 16 }} /> Private
            </ToggleButton>
            <ToggleButton value="corporate" sx={{ gap: 0.5, textTransform: 'none', px: 1.5 }}>
              <BusinessOutlined sx={{ fontSize: 16 }} /> Corporate
            </ToggleButton>
          </ToggleButtonGroup>,
          <SearchInput
            key="search"
            variant="toggle"
            size="md"
            value={query}
            onChange={setQuery}
            onSearch={() => setActiveQuery(query)}
            onClear={() => { setQuery(''); setActiveQuery('') }}
            ariaLabel="Search agents"
            placeholder="Search agents…"
          />,
        ]}
        renderCard={(entry, _size, viewMode) => viewMode === 'gallery' ? (
          <StackGalleryCard
            entry={entry}
            catalogs={catalogs}
            isBusy={bookedAgentIds.has(entry.agentProfile.id)}
            onToggleCatalog={handleToggleCatalogMembership}
            onEdit={handleEdit}
            onToggleOnline={handleToggleOnline}
            onDelete={handleDeleteAgent}
            onOpen={handleOpen}
          />
        ) : (
          <StackListRow
            entry={entry}
            catalogs={catalogs}
            isBusy={bookedAgentIds.has(entry.agentProfile.id)}
            onToggleCatalog={handleToggleCatalogMembership}
            onEdit={handleEdit}
            onToggleOnline={handleToggleOnline}
            onDelete={handleDeleteAgent}
            onOpen={handleOpen}
          />
        )}
        cardKey={(entry) => entry.key}
        emptyState={
          isLoading ? null : (
            <Typography variant="body2" color="text.secondary">
              {viewFilter === 'all'
                ? 'You have no agent setups yet.'
                : viewFilter === 'online'
                  ? 'No online agents — bring a setup online from its ⋮ menu.'
                  : 'No offline agents match the current filters.'}
            </Typography>
          )
        }
        storageKeyPrefix="roster"
        defaultScrollMode="paginated"
      />
      {/* ADR-340 D4: confirm dialog for soft-delete. Same pattern as
          CatalogsTab / ProductsTab — prevents accidental click-to-delete on
          the ⋮ menu. Past bookings stay visible in tickets. */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete agent setup?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            “{deleteTarget?.agentProfile.name}” will be permanently removed and
            its listing taken offline. Past bookings remain visible in tickets.
          </Typography>
        </DialogContent>
        <DialogActions>
          <MenuItem onClick={() => setDeleteTarget(null)}>Cancel</MenuItem>
          <MenuItem onClick={handleConfirmDelete} sx={{ color: 'var(--color-status-error)' }}>
            Delete
          </MenuItem>
        </DialogActions>
      </Dialog>
    </>
  )
}
