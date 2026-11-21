import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Box, Paper, Typography, CircularProgress, Alert, Chip, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableSortLabel,
  TablePagination, TableContainer, TextField, Select, MenuItem,
  FormControl, InputLabel, ToggleButton, ToggleButtonGroup,
  Avatar, IconButton, Collapse, Divider,
} from '@mui/material'
import RefreshIcon        from '@mui/icons-material/Refresh'
import SearchIcon         from '@mui/icons-material/Search'
import BoltIcon           from '@mui/icons-material/Bolt'
import EmailIcon          from '@mui/icons-material/Email'
import HexagonIcon        from '@mui/icons-material/Hexagon'
import GoogleIcon         from '@mui/icons-material/Google'
import HubIcon            from '@mui/icons-material/Hub'
import ScienceIcon        from '@mui/icons-material/Science'
import ExpandMoreIcon     from '@mui/icons-material/ExpandMore'
import ExpandLessIcon     from '@mui/icons-material/ExpandLess'
import FilterListIcon     from '@mui/icons-material/FilterList'
import CloseIcon          from '@mui/icons-material/Close'
import ContentCopyIcon    from '@mui/icons-material/ContentCopy'
import CheckIcon          from '@mui/icons-material/Check'
import LinkIcon           from '@mui/icons-material/Link'
import ShieldIcon         from '@mui/icons-material/Shield'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import ReceiptLongIcon    from '@mui/icons-material/ReceiptLong'
import LocalOfferIcon     from '@mui/icons-material/LocalOffer'
import DevicesIcon        from '@mui/icons-material/Devices'
import AccessTimeIcon     from '@mui/icons-material/AccessTime'
import OpenInNewIcon      from '@mui/icons-material/OpenInNew'
import BlockIcon          from '@mui/icons-material/Block'
import PublicIcon         from '@mui/icons-material/Public'
import HubOutlinedIcon    from '@mui/icons-material/HubOutlined'
import { apiCall } from '../../../lib/api'
import { ActionButton as EntityActionButton, type EntityActionMeta } from './ActionButton'
import { EntitlementsPanel } from './EntitlementsPanel'
import { useBetaMode } from '../../../hooks/useBetaMode'

const C = {
  text:       'var(--theme-text)',
  textMuted:  'var(--theme-text-muted)',
  border:     'var(--theme-border)',
  surface:    'var(--theme-surface)',
  bg:         'var(--theme-bg)',
  bgSubtle:   'var(--theme-bg-subtle)',
  accent:     'var(--color-warning-default, #f59e0b)',
  accentBg:   'var(--color-warning-subtle, #fef3c7)',
  selected:   'var(--color-status-error, #DA1414)',
  selectedBg: 'rgba(218, 20, 20, 0.04)',
} as const

// ── Login method config ──────────────────────────────────────────────────────

const METHOD_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  nostr:     { label: 'Nostr',     color: '#7c3aed', bg: '#ede9fe', icon: <HexagonIcon sx={{ fontSize: 12 }} /> },
  lightning: { label: 'Lightning', color: '#d97706', bg: '#fef3c7', icon: <BoltIcon     sx={{ fontSize: 12 }} /> },
  email:     { label: 'Email',     color: '#2563eb', bg: '#dbeafe', icon: <EmailIcon    sx={{ fontSize: 12 }} /> },
  google:    { label: 'Google',    color: '#dc2626', bg: '#fee2e2', icon: <GoogleIcon   sx={{ fontSize: 12 }} /> },
  evm:       { label: 'EVM',       color: '#4f46e5', bg: '#e0e7ff', icon: <HubIcon      sx={{ fontSize: 12 }} /> },
  demo:      { label: 'Demo',      color: '#0d9488', bg: '#ccfbf1', icon: <ScienceIcon  sx={{ fontSize: 12 }} /> },
}

const WALLET_LABELS: Record<string, string> = {
  DEMO: 'Demo', LNBITS: 'LNbits', CASHU: 'Cashu',
  WEBLN: 'WebLN', LIGHTSPARK: 'Lightspark', MOCK: 'Mock', none: 'No wallet',
}

const IDENTITY_LABELS = ['Anonymous', 'Verified', 'Full KYC']

// ── Types ────────────────────────────────────────────────────────────────────

interface Account {
  pubkey:            string
  createdAt:         string
  identityLevel:     number
  loginMethods:      string[]
  email:             string | null
  emailVerified:     boolean
  lnAddress:         string | null
  nip05:             string | null
  picture:           string | null
  nostrPubkey:       string | null
  linkedPubkey:      string | null
  evmAddress:        string | null
  hasGoogleId:       boolean
  wallet:            { provider: string; mode: string; balanceSats: number } | null
  offerCount:        number
  buyerTicketCount:  number
  sellerTicketCount: number
  sessionCount:      number
  lastSeen:          string | null
  // ADR-284 D7: derived, not stored — see admin.ts's originType().
  origin:        'remote' | 'native'
  blockedAt:     string | null
  blockedReason: string | null
}

interface Breakdown {
  methods:      Record<string, number>
  wallets:      Record<string, number>
  combinations: { key: string; count: number }[]
}

interface ApiResponse {
  accounts:  Account[]
  total:     number
  page:      number
  limit:     number
  breakdown: Breakdown
}

type SortField = 'createdAt' | 'lastSeen' | 'identityLevel' | 'offerCount' | 'sessionCount'
type SortDir   = 'asc' | 'desc'

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortPubkey(pk: string) { return pk.slice(0, 8) + '…' + pk.slice(-6) }

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 2)  return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: '2-digit' })
}

function joinedDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: '2-digit' })
}

function comboLabel(key: string) {
  if (key === 'none') return 'No linked method'
  return key.split('+').map(k => METHOD_CONFIG[k]?.label ?? k).join(' + ')
}

// ── Small reusables ──────────────────────────────────────────────────────────

function MethodChip({ method, isBeta }: { method: string; isBeta: boolean }) {
  // ADR-273: hide the 'demo' login-method chip in production builds — the
  // METHOD_CONFIG.demo entry (ScienceIcon + "Demo" label) only matters when
  // beta-mode is active.
  if (method === 'demo' && !isBeta) return null
  const cfg = METHOD_CONFIG[method]
  if (!cfg) return null
  return (
    <Chip
      icon={<Box sx={{ color: cfg.color, display: 'flex', ml: '6px !important' }}>{cfg.icon}</Box>}
      label={cfg.label}
      size="small"
      sx={{
        height: 20, fontSize: '0.68rem', fontWeight: 600,
        bgcolor: cfg.bg, color: cfg.color, border: 'none',
        '& .MuiChip-icon': { color: 'inherit' },
      }}
    />
  )
}

function IdentityBadge({ level }: { level: number }) {
  const colors = [C.textMuted, '#7c3aed', '#d97706']
  const labels = ['L0', 'L1', 'L2']
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 20, borderRadius: 1,
      bgcolor: level > 0 ? 'rgba(124,58,237,0.1)' : 'transparent',
      border: `1px solid ${colors[level] ?? C.border}`,
      fontSize: '0.68rem', fontWeight: 700, color: colors[level] ?? C.textMuted,
    }}>
      {labels[level] ?? `L${level}`}
    </Box>
  )
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <Tooltip title={copied ? 'Copied!' : `Copy ${label ?? ''}`}>
      <IconButton size="small" onClick={handleCopy} sx={{ color: copied ? 'var(--color-status-success, #23CA61)' : C.textMuted, p: 0.5 }}>
        {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
      </IconButton>
    </Tooltip>
  )
}

// ── Breakdown strip ──────────────────────────────────────────────────────────

function BreakdownStrip({ breakdown, activeMethod, onMethod }: {
  breakdown: Breakdown | null; activeMethod: string; onMethod: (m: string) => void
}) {
  const [comboOpen, setComboOpen] = useState(false)
  if (!breakdown) return null
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        {Object.entries(METHOD_CONFIG).map(([key, cfg]) => {
          const count  = breakdown.methods[key] ?? 0
          const active = activeMethod === key
          return (
            <Box key={key} onClick={() => onMethod(active ? '' : key)} sx={{
              display: 'flex', alignItems: 'center', gap: 0.75,
              px: 1.5, py: 0.5, borderRadius: 1.5, cursor: 'pointer',
              border: `1px solid ${active ? cfg.color : C.border}`,
              bgcolor: active ? cfg.bg : C.surface, transition: 'all 0.15s',
              '&:hover': { borderColor: cfg.color },
            }}>
              <Box sx={{ color: cfg.color, display: 'flex', alignItems: 'center' }}>{cfg.icon}</Box>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: active ? cfg.color : C.text }}>
                {cfg.label}
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: C.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                {count}
              </Typography>
            </Box>
          )
        })}
        {Object.entries(breakdown.wallets).filter(([, n]) => n > 0).map(([wp, count]) => (
          <Box key={wp} sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.5, py: 0.5, borderRadius: 1.5,
            border: `1px solid ${C.border}`, bgcolor: C.surface,
          }}>
            <Typography sx={{ fontSize: '0.72rem', color: C.textMuted }}>{WALLET_LABELS[wp] ?? wp}</Typography>
            <Typography sx={{ fontSize: '0.72rem', color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {count}
            </Typography>
          </Box>
        ))}
        {breakdown.combinations.length > 0 && (
          <Box onClick={() => setComboOpen(o => !o)} sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            px: 1.5, py: 0.5, borderRadius: 1.5, cursor: 'pointer',
            border: `1px solid ${C.border}`, bgcolor: C.surface,
            '&:hover': { borderColor: C.accent },
          }}>
            <FilterListIcon sx={{ fontSize: 14, color: C.textMuted }} />
            <Typography sx={{ fontSize: '0.72rem', color: C.textMuted, fontWeight: 600 }}>Combinations</Typography>
            {comboOpen ? <ExpandLessIcon sx={{ fontSize: 14, color: C.textMuted }} /> : <ExpandMoreIcon sx={{ fontSize: 14, color: C.textMuted }} />}
          </Box>
        )}
      </Box>
      <Collapse in={comboOpen}>
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, p: 1.5, mb: 1 }}>
          <Typography variant="overline" sx={{ fontSize: '0.65rem', color: C.textMuted, fontWeight: 700, letterSpacing: '0.08em', display: 'block', mb: 1 }}>
            Login Method Combinations
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {breakdown.combinations.map(({ key, count }) => (
              <Box key={key} sx={{
                display: 'flex', alignItems: 'center', gap: 1,
                px: 1.5, py: 0.5, borderRadius: 1,
                border: `1px solid ${C.border}`, bgcolor: C.bgSubtle,
              }}>
                <Typography sx={{ fontSize: '0.72rem', color: C.text }}>{comboLabel(key)}</Typography>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums', minWidth: 20, textAlign: 'right' }}>
                  {count}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      </Collapse>
    </Box>
  )
}

// ── User Detail Panel ────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="overline" sx={{
      fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em',
      color: C.textMuted, display: 'block', mb: 1,
    }}>
      {children}
    </Typography>
  )
}

function DetailRow({ icon, label, value, action }: {
  icon?: React.ReactNode; label: string; value: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.6 }}>
      {icon && (
        <Box sx={{ color: C.textMuted, display: 'flex', alignItems: 'center', mt: '2px', flexShrink: 0 }}>
          {icon}
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.66rem', color: C.textMuted, lineHeight: 1 }}>{label}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
          <Typography sx={{ fontSize: '0.78rem', color: C.text, wordBreak: 'break-all', lineHeight: 1.3 }}>
            {value}
          </Typography>
          {action}
        </Box>
      </Box>
    </Box>
  )
}

function StatCard({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: number | string; sub?: string
}) {
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25,
      p: 1, borderRadius: 1.5, border: `1px solid ${C.border}`, bgcolor: C.bgSubtle, flex: 1,
    }}>
      <Box sx={{ color: C.textMuted, display: 'flex' }}>{icon}</Box>
      <Typography sx={{ fontSize: '1.1rem', fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: '0.62rem', color: C.textMuted, fontWeight: 600, textAlign: 'center' }}>
        {label}
      </Typography>
      {sub && (
        <Typography sx={{ fontSize: '0.6rem', color: C.textMuted, textAlign: 'center' }}>{sub}</Typography>
      )}
    </Box>
  )
}

interface UserDetailPanelProps {
  isBeta: boolean
  account: Account
  onClose: () => void
  onRefresh: () => void
}

// ── Reset Demo Balance (ADR-201) ─────────────────────────────────────────
// Caches the Account action metadata once per session so we don't refetch
// when switching between user detail panels. The action comes from
// GET /api/admin/entities/Account/actions — see admin-entity-actions.ts.
const accountActionsCache: { value: EntityActionMeta[] | null } = { value: null }
const accountActionsPromise: { current: Promise<EntityActionMeta[]> | null } = { current: null }

async function fetchAccountActions(): Promise<EntityActionMeta[]> {
  if (accountActionsCache.value) return accountActionsCache.value
  if (accountActionsPromise.current) return accountActionsPromise.current
  accountActionsPromise.current = (async () => {
    try {
      const res  = await apiCall('/api/admin/entities/Account/actions')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const list = (json.actions ?? []) as EntityActionMeta[]
      accountActionsCache.value = list
      return list
    } catch (e) {
      // Allow retry on the next call by clearing the in-flight promise.
      accountActionsPromise.current = null
      throw e
    }
  })()
  return accountActionsPromise.current
}

function ResetDemoBalanceButton({ account: acc, onSuccess }: { account: Account; onSuccess: () => void }) {
  const [action, setAction] = useState<EntityActionMeta | null>(
    () => accountActionsCache.value?.find(a => a.key === 'reset-demo-balance') ?? null,
  )
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (action) return
    let cancelled = false
    fetchAccountActions()
      .then(list => {
        if (cancelled) return
        const found = list.find(a => a.key === 'reset-demo-balance')
        if (found) setAction(found)
        else setMissing(true)
      })
      .catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [action])

  if (missing) return null
  if (!action) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, color: C.textMuted }}>
        <CircularProgress size={12} />
        <Typography sx={{ fontSize: '0.74rem' }}>Loading action…</Typography>
      </Box>
    )
  }
  return (
    <EntityActionButton
      model="Account"
      id={acc.pubkey}
      action={action}
      onSuccess={onSuccess}
    />
  )
}

// ── Block / Unblock Account (ADR-284 D6) ────────────────────────────────
// Same registry + cache as ResetDemoBalanceButton above, but the action key
// switches between 'block-account' and 'unblock-account' depending on the
// account's current state — both are registered server-side on model
// "Account", so a single fetchAccountActions() call already has both.
function BlockAccountButton({ account: acc, onSuccess }: { account: Account; onSuccess: () => void }) {
  const wantKey = acc.blockedAt ? 'unblock-account' : 'block-account'
  const [action, setAction] = useState<EntityActionMeta | null>(
    () => accountActionsCache.value?.find(a => a.key === wantKey) ?? null,
  )
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (action?.key === wantKey) return
    setMissing(false)
    let cancelled = false
    fetchAccountActions()
      .then(list => {
        if (cancelled) return
        const found = list.find(a => a.key === wantKey)
        if (found) setAction(found)
        else setMissing(true)
      })
      .catch(() => { if (!cancelled) setMissing(true) })
    return () => { cancelled = true }
  }, [action, wantKey])

  if (missing) return null
  if (!action || action.key !== wantKey) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, color: C.textMuted }}>
        <CircularProgress size={12} />
        <Typography sx={{ fontSize: '0.74rem' }}>Loading action…</Typography>
      </Box>
    )
  }
  return (
    <EntityActionButton
      model="Account"
      id={acc.pubkey}
      action={action}
      onSuccess={onSuccess}
    />
  )
}

// ── Go to profile (ADR-284 D6) ──────────────────────────────────────────
function GoToProfileButton({ pubkey }: { pubkey: string }) {
  return (
    <Box
      component="a"
      href={`/u/${pubkey}`}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: 'flex', alignItems: 'center', gap: 1,
        px: 1.5, py: 0.75, borderRadius: 1.5, cursor: 'pointer',
        textDecoration: 'none',
        border: `1px solid ${C.border}`,
        bgcolor: C.bgSubtle, color: C.textMuted,
        transition: 'all 0.2s',
        '&:hover': { borderColor: C.accent, color: C.accent, bgcolor: C.accentBg },
      }}
    >
      <OpenInNewIcon sx={{ fontSize: 14 }} />
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'inherit' }}>Go to profile</Typography>
    </Box>
  )
}

function UserDetailPanel({ account: acc, onClose, onRefresh, isBeta }: UserDetailPanelProps) {
  const identityColor = ['var(--theme-text-muted)', '#7c3aed', '#d97706'][acc.identityLevel] ?? C.textMuted

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: C.selected,
        bgcolor: C.surface,
        display: 'flex',
        flexDirection: 'column',
        position: { lg: 'sticky' },
        top: { lg: 16 },
        maxHeight: { lg: 'calc(100vh - 180px)' },
        overflow: 'hidden',
      }}
    >
      {/* Panel header */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5,
        px: 2, py: 1.5,
        borderBottom: `1px solid ${C.border}`,
        bgcolor: C.selectedBg,
        flexShrink: 0,
      }}>
        <Avatar
          src={acc.picture ?? undefined}
          sx={{ width: 38, height: 38, fontSize: '0.85rem', bgcolor: '#7c3aed', color: '#fff', flexShrink: 0 }}
        >
          {acc.pubkey.slice(0, 2).toUpperCase()}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 600, color: C.text }}>
              {shortPubkey(acc.pubkey)}
            </Typography>
            <CopyButton value={acc.pubkey} label="pubkey" />
          </Box>
          {(acc.nip05 || acc.lnAddress || acc.email) && (
            <Typography sx={{ fontSize: '0.68rem', color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {acc.nip05 ?? acc.lnAddress ?? acc.email}
            </Typography>
          )}
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: C.textMuted, ml: 'auto', flexShrink: 0 }}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>

      {/* ADR-284 D6: blocked banner */}
      {acc.blockedAt && (
        <Box sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1,
          px: 2, py: 1, bgcolor: 'rgba(218, 20, 20, 0.08)',
          borderBottom: `1px solid ${C.selected}`, flexShrink: 0,
        }}>
          <BlockIcon sx={{ fontSize: 15, color: C.selected, mt: '1px', flexShrink: 0 }} />
          <Box>
            <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: C.selected }}>
              Account blocked
            </Typography>
            {acc.blockedReason && (
              <Typography sx={{ fontSize: '0.7rem', color: C.selected, opacity: 0.85 }}>
                {acc.blockedReason}
              </Typography>
            )}
          </Box>
        </Box>
      )}

      {/* Scrollable body */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>

        {/* Activity stats */}
        <Box>
          <SectionLabel>Activity</SectionLabel>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <StatCard icon={<LocalOfferIcon sx={{ fontSize: 16 }} />}  label="Offers"   value={acc.offerCount} />
            <StatCard icon={<ReceiptLongIcon sx={{ fontSize: 16 }} />} label="Tickets"  value={acc.buyerTicketCount + acc.sellerTicketCount} sub={`${acc.buyerTicketCount}B · ${acc.sellerTicketCount}S`} />
            <StatCard icon={<DevicesIcon sx={{ fontSize: 16 }} />}     label="Sessions" value={acc.sessionCount} />
          </Box>
          <Box sx={{ display: 'flex', gap: 3, mt: 1.5, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeIcon sx={{ fontSize: 13, color: C.textMuted }} />
              <Typography sx={{ fontSize: '0.7rem', color: C.textMuted }}>
                Last seen: <strong style={{ color: C.text }}>{relativeTime(acc.lastSeen)}</strong>
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeIcon sx={{ fontSize: 13, color: C.textMuted }} />
              <Typography sx={{ fontSize: '0.7rem', color: C.textMuted }}>
                Joined: <strong style={{ color: C.text }}>{joinedDate(acc.createdAt)}</strong>
              </Typography>
            </Box>
          </Box>
        </Box>

        <Divider sx={{ borderColor: C.border }} />

        {/* Identity */}
        <Box>
          <SectionLabel>Identity</SectionLabel>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <IdentityBadge level={acc.identityLevel} />
            <Box>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: identityColor }}>
                {IDENTITY_LABELS[acc.identityLevel] ?? `Level ${acc.identityLevel}`}
              </Typography>
              <Typography sx={{ fontSize: '0.66rem', color: C.textMuted }}>Identity Level {acc.identityLevel}</Typography>
            </Box>
          </Box>
        </Box>

        <Divider sx={{ borderColor: C.border }} />

        {/* Linked identifiers */}
        <Box>
          <SectionLabel>Login Methods & Identifiers</SectionLabel>

          <DetailRow
            icon={<ShieldIcon sx={{ fontSize: 15 }} />}
            label="Primary Pubkey"
            value={<Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{shortPubkey(acc.pubkey)}</Box>}
            action={<CopyButton value={acc.pubkey} label="pubkey" />}
          />

          {acc.nostrPubkey && (
            <DetailRow
              icon={<HexagonIcon sx={{ fontSize: 15, color: '#7c3aed' }} />}
              label="Nostr Pubkey"
              value={<Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#7c3aed' }}>{shortPubkey(acc.nostrPubkey)}</Box>}
              action={<CopyButton value={acc.nostrPubkey} label="nostr pubkey" />}
            />
          )}

          {acc.nip05 && (
            <DetailRow
              icon={<CheckIcon sx={{ fontSize: 15, color: '#7c3aed' }} />}
              label="NIP-05"
              value={acc.nip05}
              action={<CopyButton value={acc.nip05} label="NIP-05" />}
            />
          )}

          {(acc.lnAddress || acc.linkedPubkey) && (
            <DetailRow
              icon={<BoltIcon sx={{ fontSize: 15, color: '#d97706' }} />}
              label={acc.lnAddress ? 'Lightning Address' : 'Linked Lightning Pubkey'}
              value={
                <Box component="span" sx={{ color: '#d97706', fontSize: '0.72rem' }}>
                  {acc.lnAddress ?? (acc.linkedPubkey ? shortPubkey(acc.linkedPubkey) : '')}
                </Box>
              }
              action={<CopyButton value={acc.lnAddress ?? acc.linkedPubkey ?? ''} label="LN address" />}
            />
          )}

          {acc.email && (
            <DetailRow
              icon={<EmailIcon sx={{ fontSize: 15, color: '#2563eb' }} />}
              label="Email"
              value={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box component="span" sx={{ color: '#2563eb', fontSize: '0.72rem' }}>{acc.email}</Box>
                  {acc.emailVerified && (
                    <Chip label="verified" size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: '#dbeafe', color: '#2563eb', border: 'none' }} />
                  )}
                </Box>
              }
            />
          )}

          {acc.hasGoogleId && (
            <DetailRow
              icon={<GoogleIcon sx={{ fontSize: 15, color: '#dc2626' }} />}
              label="Google Account"
              value={<Box component="span" sx={{ color: '#dc2626', fontSize: '0.72rem' }}>Linked</Box>}
            />
          )}

          {acc.evmAddress && (
            <DetailRow
              icon={<HubIcon sx={{ fontSize: 15, color: '#4f46e5' }} />}
              label="EVM Address"
              value={<Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#4f46e5' }}>{acc.evmAddress}</Box>}
            />
          )}
        </Box>

        <Divider sx={{ borderColor: C.border }} />

        {/* Wallet */}
        <Box>
          <SectionLabel>Wallet</SectionLabel>
          {acc.wallet ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <AccountBalanceWalletIcon sx={{ fontSize: 18, color: acc.wallet.provider === 'DEMO' ? '#0d9488' : C.textMuted }} />
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.text }}>
                      {WALLET_LABELS[acc.wallet.provider] ?? acc.wallet.provider}
                    </Typography>
                    <Chip
                      label={acc.wallet.mode}
                      size="small"
                      sx={{ height: 16, fontSize: '0.6rem', fontWeight: 600, bgcolor: C.bgSubtle, color: C.textMuted, border: 'none' }}
                    />
                  </Box>
                  {isBeta && acc.wallet.provider === 'DEMO' && (
                    <Typography sx={{ fontSize: '0.72rem', color: '#0d9488', fontVariantNumeric: 'tabular-nums' }}>
                      {acc.wallet.balanceSats.toLocaleString()} sats
                    </Typography>
                  )}
                </Box>
              </Box>

              {isBeta && acc.wallet.provider === 'DEMO' && (
                <ResetDemoBalanceButton account={acc} onSuccess={onRefresh} />
              )}
            </Box>
          ) : (
            <Typography sx={{ fontSize: '0.75rem', color: C.textMuted }}>No wallet provisioned</Typography>
          )}
        </Box>

        <Divider sx={{ borderColor: C.border }} />

        {/* ADR-402 Phase 2 (D1/D3/D4/D7): per-identity AI credits + MCP pass
            grant/shorten/trial reset and the restrict-only AI/MCP policy. */}
        <EntitlementsPanel pubkey={acc.pubkey} onChanged={onRefresh} />

        <Divider sx={{ borderColor: C.border }} />

        {/* Quick actions */}
        <Box>
          <SectionLabel>Quick Actions</SectionLabel>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>

            <GoToProfileButton pubkey={acc.pubkey} />
            <BlockAccountButton account={acc} onSuccess={onRefresh} />

            {isBeta && acc.wallet?.provider === 'DEMO' && (
              <ResetDemoBalanceButton account={acc} onSuccess={onRefresh} />
            )}

            {[
              { label: 'Copy full pubkey',    value: acc.pubkey,       show: true },
              { label: 'Copy NIP-05',         value: acc.nip05 ?? '',  show: !!acc.nip05 },
              { label: 'Copy LN address',     value: acc.lnAddress ?? '', show: !!acc.lnAddress },
              { label: 'Copy Nostr pubkey',   value: acc.nostrPubkey ?? '', show: !!acc.nostrPubkey && acc.nostrPubkey !== acc.pubkey },
            ].filter(a => a.show).map(a => (
              <ActionButton key={a.label} label={a.label} value={a.value} />
            ))}

          </Box>
        </Box>

      </Box>
    </Paper>
  )
}

function ActionButton({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false)
  function handle() {
    navigator.clipboard.writeText(value).then(() => {
      setDone(true)
      setTimeout(() => setDone(false), 1800)
    })
  }
  return (
    <Box onClick={handle} sx={{
      display: 'flex', alignItems: 'center', gap: 1,
      px: 1.5, py: 0.75, borderRadius: 1.5, cursor: 'pointer',
      border: `1px solid ${done ? 'var(--color-status-success, #23CA61)' : C.border}`,
      bgcolor: done ? 'rgba(35,202,97,0.06)' : C.bgSubtle,
      color: done ? 'var(--color-status-success, #23CA61)' : C.textMuted,
      transition: 'all 0.2s',
      '&:hover': { borderColor: C.accent, color: C.accent, bgcolor: C.accentBg },
    }}>
      {done ? <CheckIcon sx={{ fontSize: 14 }} /> : <LinkIcon sx={{ fontSize: 14 }} />}
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'inherit' }}>{label}</Typography>
    </Box>
  )
}

// ── Main Section ─────────────────────────────────────────────────────────────

export function AccountsSection() {
  const { isBeta } = useBetaMode()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data,           setData]           = useState<ApiResponse | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState<string | null>(null)
  const [lastChecked,    setLastChecked]    = useState<Date | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)

  const [loginType,      setLoginType]      = useState('')
  const [walletProvider, setWalletProvider] = useState('')
  const [identityLevel,  setIdentityLevel]  = useState('')
  const [search,         setSearch]         = useState('')
  const [searchInput,    setSearchInput]    = useState('')
  // ADR-284 D7: 'remote' | 'native' | ''
  const [origin,         setOrigin]         = useState('')

  const [page,        setPage]        = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [sortField,   setSortField]   = useState<SortField>('createdAt')
  const [sortDir,     setSortDir]     = useState<SortDir>('desc')

  // ADR-282: pre-open the detail panel when navigated from
  // /admin/accounts?pubkey=<pk> (ActiveUsersChip → Popover → onClick).
  // `appliedPubkeyRef` keeps the effect idempotent across re-renders so we
  // don't re-select the same row every refresh tick. The `pubkey` param is
  // intentionally dropped when the detail panel closes — see `clearDeepLink`.
  const targetPubkey = searchParams.get('pubkey')
  const appliedPubkeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!data || !targetPubkey) return
    if (appliedPubkeyRef.current === targetPubkey) return
    const found = data.accounts.find(a => a.pubkey === targetPubkey)
    if (found && found.pubkey !== selectedAccount?.pubkey) {
      setSelectedAccount(found)
      appliedPubkeyRef.current = targetPubkey
    }
  }, [data, targetPubkey, selectedAccount?.pubkey])

  function clearDeepLink() {
    if (!searchParams.get('pubkey')) return
    const next = new URLSearchParams(searchParams)
    next.delete('pubkey')
    setSearchParams(next, { replace: true })
  }

  // ADR-201: topup was migrated to the entity-action registry (Account.reset-demo-balance).

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: String(page + 1), limit: String(rowsPerPage) })
      if (loginType)      params.set('loginType', loginType)
      if (walletProvider) params.set('walletProvider', walletProvider)
      if (identityLevel)  params.set('identityLevel', identityLevel)
      if (search)         params.set('search', search)
      if (origin)         params.set('origin', origin)
      const res  = await apiCall(`/api/admin/accounts?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setData(json as ApiResponse)
      setLastChecked(new Date())
      // Refresh selected account data if still in list
      if (selectedAccount) {
        const fresh = (json as ApiResponse).accounts.find(a => a.pubkey === selectedAccount.pubkey)
        if (fresh) setSelectedAccount(fresh)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, rowsPerPage, loginType, walletProvider, identityLevel, search, origin])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [loginType, walletProvider, identityLevel, search, origin])

  // ADR-201: topup moved to the entity-action registry (Reset Demo Balance button).

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const sorted = [...(data?.accounts ?? [])].sort((a, b) => {
    let av: number | string = 0; let bv: number | string = 0
    if (sortField === 'createdAt')     { av = a.createdAt    ?? ''; bv = b.createdAt    ?? '' }
    if (sortField === 'lastSeen')      { av = a.lastSeen     ?? ''; bv = b.lastSeen     ?? '' }
    if (sortField === 'identityLevel') { av = a.identityLevel;      bv = b.identityLevel }
    if (sortField === 'offerCount')    { av = a.offerCount;          bv = b.offerCount }
    if (sortField === 'sessionCount')  { av = a.sessionCount;        bv = b.sessionCount }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1  : -1
    return 0
  })

  const thSx = { color: C.textMuted, fontSize: '0.72rem', fontWeight: 700, borderColor: C.border, whiteSpace: 'nowrap' as const, py: 1, px: 1.5 }
  const tdSx = { borderColor: C.border, py: 0.75, px: 1.5, color: C.text }
  const panelOpen = !!selectedAccount

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="overline" sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted }}>
          Accounts {data ? `(${data.total})` : ''}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {lastChecked && !loading && (
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem' }}>
              {lastChecked.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Typography>
          )}
          {loading && <CircularProgress size={12} sx={{ color: C.textMuted }} />}
          <Box onClick={load} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: C.textMuted, '&:hover': { color: C.text } }}>
            <RefreshIcon sx={{ fontSize: 14 }} />
            <Typography variant="caption" sx={{ fontSize: '0.68rem' }}>Refresh</Typography>
          </Box>
        </Box>
      </Box>

      <BreakdownStrip breakdown={data?.breakdown ?? null} activeMethod={loginType} onMethod={setLoginType} />

      {/* Filter bar */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2, alignItems: 'center' }}>
        <ToggleButtonGroup
          value={loginType} exclusive
          onChange={(_, v) => setLoginType(v ?? '')}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: '0.72rem', fontWeight: 600, py: 0.5, px: 1.5,
              color: C.textMuted, borderColor: C.border,
              '&.Mui-selected': { color: C.accent, borderColor: C.accent, bgcolor: C.accentBg },
            },
          }}
        >
          {Object.entries(METHOD_CONFIG).map(([key, cfg]) => (
            <ToggleButton key={key} value={key}>{cfg.label}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel sx={{ fontSize: '0.75rem' }}>Wallet</InputLabel>
          <Select value={walletProvider} label="Wallet" onChange={e => setWalletProvider(e.target.value)} sx={{ fontSize: '0.75rem' }}>
            <MenuItem value=""><em>All</em></MenuItem>
            {Object.entries(WALLET_LABELS)
              .filter(([k]) => isBeta || (k !== 'DEMO' && k !== 'MOCK'))
              .map(([k, l]) => <MenuItem key={k} value={k} sx={{ fontSize: '0.75rem' }}>{l}</MenuItem>)}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 110 }}>
          <InputLabel sx={{ fontSize: '0.75rem' }}>Identity</InputLabel>
          <Select value={identityLevel} label="Identity" onChange={e => setIdentityLevel(e.target.value)} sx={{ fontSize: '0.75rem' }}>
            <MenuItem value=""><em>All</em></MenuItem>
            <MenuItem value="0" sx={{ fontSize: '0.75rem' }}>L0 — Anonymous</MenuItem>
            <MenuItem value="1" sx={{ fontSize: '0.75rem' }}>L1 — Verified</MenuItem>
            <MenuItem value="2" sx={{ fontSize: '0.75rem' }}>L2 — Full KYC</MenuItem>
          </Select>
        </FormControl>

        <TextField
          size="small" placeholder="Search pubkey…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') setSearch(searchInput) }}
          InputProps={{
            startAdornment: <SearchIcon sx={{ fontSize: 16, color: C.textMuted, mr: 0.5 }} />,
            sx: { fontSize: '0.75rem' },
          }}
          sx={{ minWidth: 200 }}
        />

        {/* ADR-284 D7: Remote (auto-provisioned, never logged in) vs
            Collaborate (native) users — derived server-side. */}
        <ToggleButtonGroup
          value={origin} exclusive
          onChange={(_, v) => setOrigin(v ?? '')}
          size="small"
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: '0.72rem', fontWeight: 600, py: 0.5, px: 1.5,
              color: C.textMuted, borderColor: C.border,
              '&.Mui-selected': { color: C.accent, borderColor: C.accent, bgcolor: C.accentBg },
            },
          }}
        >
          <ToggleButton value="native"><HubOutlinedIcon sx={{ fontSize: 14, mr: 0.5 }} />Collaborate</ToggleButton>
          <ToggleButton value="remote"><PublicIcon sx={{ fontSize: 14, mr: 0.5 }} />Remote</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Master–Detail grid */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: panelOpen ? '1fr 340px' : '1fr' },
        gap: 2,
        alignItems: 'start',
      }}>
        {/* Table */}
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: C.bgSubtle }}>
                  <TableCell sx={thSx}>Account</TableCell>
                  {/* ADR-284 D6: always visible — moderation status is a primary signal. */}
                  <TableCell sx={{ ...thSx, textAlign: 'center' }}>Status</TableCell>
                  {!panelOpen && <TableCell sx={thSx}>Login Methods</TableCell>}
                  <TableCell sx={{ ...thSx, textAlign: 'center' }}>
                    <TableSortLabel active={sortField === 'identityLevel'} direction={sortDir} onClick={() => handleSort('identityLevel')} sx={{ fontSize: '0.72rem', color: C.textMuted, '&.Mui-active': { color: C.textMuted } }}>
                      ID
                    </TableSortLabel>
                  </TableCell>
                  {!panelOpen && <TableCell sx={thSx}>Wallet</TableCell>}
                  <TableCell sx={{ ...thSx, textAlign: 'right' }}>
                    <TableSortLabel active={sortField === 'offerCount'} direction={sortDir} onClick={() => handleSort('offerCount')} sx={{ fontSize: '0.72rem', color: C.textMuted, '&.Mui-active': { color: C.textMuted } }}>
                      Offers
                    </TableSortLabel>
                  </TableCell>
                  {!panelOpen && <TableCell sx={{ ...thSx, textAlign: 'right' }}>Tickets</TableCell>}
                  <TableCell sx={{ ...thSx, textAlign: 'right' }}>
                    <TableSortLabel active={sortField === 'sessionCount'} direction={sortDir} onClick={() => handleSort('sessionCount')} sx={{ fontSize: '0.72rem', color: C.textMuted, '&.Mui-active': { color: C.textMuted } }}>
                      Sess.
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={thSx}>
                    <TableSortLabel active={sortField === 'createdAt'} direction={sortDir} onClick={() => handleSort('createdAt')} sx={{ fontSize: '0.72rem', color: C.textMuted, '&.Mui-active': { color: C.textMuted } }}>
                      Joined
                    </TableSortLabel>
                  </TableCell>
                  {!panelOpen && (
                    <TableCell sx={thSx}>
                      <TableSortLabel active={sortField === 'lastSeen'} direction={sortDir} onClick={() => handleSort('lastSeen')} sx={{ fontSize: '0.72rem', color: C.textMuted, '&.Mui-active': { color: C.textMuted } }}>
                        Last Active
                      </TableSortLabel>
                    </TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {loading && !data && (
                  <TableRow>
                    <TableCell colSpan={panelOpen ? 6 : 10} sx={{ textAlign: 'center', py: 6, borderColor: C.border }}>
                      <CircularProgress size={24} />
                    </TableCell>
                  </TableRow>
                )}
                {!loading && sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={panelOpen ? 6 : 10} sx={{ textAlign: 'center', py: 6, borderColor: C.border }}>
                      <Typography variant="caption" sx={{ color: C.textMuted }}>No accounts found.</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {sorted.map(acc => {
                  const isSelected = selectedAccount?.pubkey === acc.pubkey
                  return (
                    <TableRow
                      key={acc.pubkey}
                      onClick={() => {
                        setSelectedAccount(isSelected ? null : acc)
                        // ADR-282: any click in the table makes the URL
                        // reflect what's open in the detail panel.
                        if (!isSelected && searchParams.get('pubkey') === acc.pubkey) return
                        const next = new URLSearchParams(searchParams)
                        if (isSelected) next.delete('pubkey')
                        else next.set('pubkey', acc.pubkey)
                        setSearchParams(next, { replace: true })
                      }}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: isSelected ? C.selectedBg : 'transparent',
                        '&:last-child td': { border: 0 },
                        '&:hover': { bgcolor: isSelected ? C.selectedBg : C.bgSubtle },
                        transition: 'background 0.1s',
                      }}
                    >
                      <TableCell sx={tdSx}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar src={acc.picture ?? undefined} sx={{ width: 22, height: 22, fontSize: '0.62rem', bgcolor: '#7c3aed', color: '#fff', flexShrink: 0 }}>
                            {acc.pubkey.slice(0, 2).toUpperCase()}
                          </Avatar>
                          <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: isSelected ? C.selected : C.text }}>
                                {shortPubkey(acc.pubkey)}
                              </Typography>
                              {/* ADR-284 D7 */}
                              {acc.origin === 'remote' && (
                                <Tooltip title="Remote — auto-provisioned via a remote offer promotion, never logged in directly">
                                  <PublicIcon sx={{ fontSize: 12, color: C.textMuted }} />
                                </Tooltip>
                              )}
                            </Box>
                            {(acc.nip05 || acc.email) && (
                              <Typography variant="caption" sx={{ display: 'block', fontSize: '0.62rem', color: C.textMuted }}>
                                {acc.nip05 ?? acc.email}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </TableCell>

                      {/* ADR-284 D6: always visible */}
                      <TableCell sx={{ ...tdSx, textAlign: 'center' }}>
                        {acc.blockedAt ? (
                          <Tooltip title={acc.blockedReason ?? 'Blocked'}>
                            <Chip
                              icon={<BlockIcon sx={{ fontSize: 12 }} />}
                              label="Blocked"
                              size="small"
                              sx={{ height: 20, fontSize: '0.64rem', fontWeight: 700, bgcolor: 'rgba(218,20,20,0.1)', color: C.selected, border: 'none', '& .MuiChip-icon': { color: 'inherit' } }}
                            />
                          </Tooltip>
                        ) : (
                          <Chip
                            label="Active"
                            size="small"
                            sx={{ height: 20, fontSize: '0.64rem', fontWeight: 600, bgcolor: 'rgba(35,202,97,0.1)', color: 'var(--color-status-success, #23CA61)', border: 'none' }}
                          />
                        )}
                      </TableCell>

                      {!panelOpen && (
                        <TableCell sx={tdSx}>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {acc.loginMethods.length === 0
                              ? <Typography variant="caption" sx={{ color: C.textMuted }}>—</Typography>
                              : acc.loginMethods.map(m => <MethodChip key={m} method={m} isBeta={isBeta} />)}
                          </Box>
                        </TableCell>
                      )}

                      <TableCell sx={{ ...tdSx, textAlign: 'center' }}>
                        <IdentityBadge level={acc.identityLevel} />
                      </TableCell>

                      {!panelOpen && (
                        <TableCell sx={tdSx}>
                          {acc.wallet ? (
                            <Chip
                              label={WALLET_LABELS[acc.wallet.provider] ?? acc.wallet.provider}
                              size="small"
                              sx={{
                                height: 18, fontSize: '0.66rem', fontWeight: 600,
                                bgcolor: acc.wallet.provider === 'DEMO' ? '#ccfbf1' : C.bgSubtle,
                                color:   acc.wallet.provider === 'DEMO' ? '#0d9488' : C.textMuted,
                                border: 'none',
                              }}
                            />
                          ) : <Typography variant="caption" sx={{ color: C.textMuted }}>—</Typography>}
                        </TableCell>
                      )}

                      <TableCell sx={{ ...tdSx, textAlign: 'right' }}>
                        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', color: acc.offerCount > 0 ? C.text : C.textMuted }}>
                          {acc.offerCount}
                        </Typography>
                      </TableCell>

                      {!panelOpen && (
                        <TableCell sx={{ ...tdSx, textAlign: 'right' }}>
                          <Tooltip title={`${acc.buyerTicketCount} as buyer · ${acc.sellerTicketCount} as seller`}>
                            <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', color: (acc.buyerTicketCount + acc.sellerTicketCount) > 0 ? C.text : C.textMuted, cursor: 'default' }}>
                              {acc.buyerTicketCount + acc.sellerTicketCount}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                      )}

                      <TableCell sx={{ ...tdSx, textAlign: 'right' }}>
                        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', color: acc.sessionCount > 0 ? C.text : C.textMuted }}>
                          {acc.sessionCount}
                        </Typography>
                      </TableCell>

                      <TableCell sx={tdSx}>
                        <Typography variant="caption" sx={{ fontSize: '0.72rem', color: C.textMuted, whiteSpace: 'nowrap' }}>
                          {joinedDate(acc.createdAt)}
                        </Typography>
                      </TableCell>

                      {!panelOpen && (
                        <TableCell sx={tdSx}>
                          <Typography variant="caption" sx={{ fontSize: '0.72rem', color: C.textMuted, whiteSpace: 'nowrap' }}>
                            {relativeTime(acc.lastSeen)}
                          </Typography>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={data?.total ?? 0}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
            rowsPerPageOptions={[10, 25, 50, 100]}
            sx={{
              borderTop: `1px solid ${C.border}`, color: C.textMuted, fontSize: '0.72rem',
              '& .MuiTablePagination-select': { fontSize: '0.72rem' },
              '& .MuiTablePagination-displayedRows': { fontSize: '0.72rem' },
            }}
          />
        </Paper>

        {/* Detail panel */}
        {selectedAccount && (
          <UserDetailPanel
            account={selectedAccount}
            isBeta={isBeta}
            onClose={() => { setSelectedAccount(null); clearDeepLink() }}
            onRefresh={() => void load()}
          />
        )}
      </Box>
    </Box>
  )
}
