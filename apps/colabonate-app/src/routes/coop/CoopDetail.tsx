// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, useNavigationType, Link, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useEntity, useIdentity, useCompany, useCooperations, useCooperationsDiscover, useCooperationTicket, useOfferMembers, useVendorOffers, useAllOffers, invalidateOfferMembers } from '../../hooks/useEntityQueries'
import type { OfferMember } from '../../hooks/useEntityQueries'
import { useDetailSliderItems } from '../../hooks/useDetailSliderItems'
import { useDetailSwipeNav } from '../../hooks/useDetailSwipeNav'
import { NotFoundState } from '../../components/NotFoundState'
import { RichText, RichDescriptionEditor, richTextToPlainText } from '../../components/offers'
import { gsap } from 'gsap'
import { useTranslation, formatLocaleDate } from '../../contexts/LocaleContext'
import { FiatHint } from '../../components/currency/FiatHint'
import { DetailPriceHero } from '../../components/currency/DetailPriceHero'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import {
  Box, Typography, Grid, Stack,
  Button, CircularProgress, Divider,
  Tooltip, Chip, Alert, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  IconButton, Switch,
} from '@mui/material'
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider as MuiDivider } from '@mui/material'
import {
  ShoppingCart as ShoppingCartIcon,
  Bolt as BoltIcon,
  Inventory2 as Inventory2Icon,
  Work as WorkIcon,
  Check as CheckIcon,
  Lock as LockIcon,
  Shield as ShieldIcon,
  VerifiedUser as VerifiedUserIcon,
  InfoOutlined as InfoOutlinedIcon,
  CheckCircle as CheckCircleIcon,
  AccessTime as AccessTimeIcon,
  Place as PlaceIcon,
  LocalOffer as LocalOfferIcon,
  Storefront as StorefrontIcon,
  Favorite as FavoriteIcon,
  Handshake as HandshakeIcon,
  ChatBubbleOutline as ChatBubbleOutlineIcon,
  Person as PersonIcon,
  ArrowRight as ArrowRightIcon,
  EmojiEvents as EmojiEventsIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
} from '@mui/icons-material'
import {
  Flag, TrendingUp, X, Calendar, Tag, Send, Users, UserPlus, LogOut,
  CheckCircle as CheckCircleLucide, Clock as ClockLucide, Zap as ZapLucide,
  FileText as FileTextLucide, Handshake as HandshakeLucide,
  MoreVertical, Play, Archive, Trash2, Pencil, Eye,
} from 'lucide-react'
import { PageContainer } from '@ds/ui'
import type { SliderListItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { CartFAB } from '../../components/ui'
import { DetailSliderNav } from '../../components/DetailSliderNav'
import type { DetailSliderSegment } from '../../components/DetailSliderNav'
import { SwipeHint, notifySwipeHintDismissed } from '../../components/SwipeHint'
import { apiCall } from '../../lib/api'
import { usePageAnimation, useSectionAnimation } from '../../hooks/usePageAnimation'
import { usePref } from '../../utils/userPreferences'
import { FullEditConfirmDialog } from '../../components/coop/FullEditConfirmDialog'
import { useCart } from '../../context/CartContext'
import { useNotification } from '../../context/NotificationContext'
import { useFavoritesWithUndo } from '../../hooks/useFavorites'
import { IdentityLevelBadge } from '../../components/identity/IdentityLevelBadge'
import { UserLink } from '../../components/user/UserLink'
import { CoopTenderChat } from '../../components/coop/CoopTenderChat'
import { deliverCooperationTemplate, deliverMilestoneTemplate } from '../../lib/nostr-ticket'
import type { NostrEventTemplate } from '../../lib/nostr-ticket'
import type { Offer, UserProfileResponse } from '../../types/api'
import { usePayment } from '../../hooks/usePayment'
import { useBetaMode } from '../../hooks/useBetaMode'
import { useCashu } from '../../contexts/CashuContext'
import { isCashuEnabled } from '../../lib/cashu'
import { DetailImageGallery } from '../../components/media/DetailImageGallery'
import { foreignPriceText } from '../../lib/offer-price-text'
import type { IdentityLevel } from '../../types/identity'

const toCoopDetailRoute = (cid: string) => `/coop/${cid}`

// ── Types ─────────────────────────────────────────────────────────────────────

interface CoopMilestoneApplication {
  id: string
  cooperationId: string
  milestoneId: string
  applicantPubkey: string
  message: string | null
  status: string
  createdAt: string
}

interface CoopMilestone {
  id: string
  cooperationId: string
  milestoneIndex: number
  title: string
  description: string | null
  amountSats: number
  status: string
  completedAt: string | null
  partnerPubkey?: string | null
  paidAt?: string | null
  applications?: CoopMilestoneApplication[]
  messages?: CoopMilestoneMessage[]
}

interface Cooperation {
  id: string
  title: string
  description?: string
  initiatorPubkey: string
  partnerPubkey?: string
  cooperationType?: string
  partnerMode?: string
  budgetSats: number
  timeline?: string
  skills?: string
  status: string
  categoryCode?: string
  deadline?: string
  requirements?: string
  visibility?: 'PUBLIC' | 'PRIVATE'
  disputeMode?: 'PUBLIC' | 'PRIVATE' | 'NONE'
  // ADR-329: payment structure — optional for back-compat with cached payloads
  ticketType?: 'SMART_ORDER' | 'MILESTONE'
  milestones: CoopMilestone[]
  createdAt: string
  images?: string[]
  offerId?: string
  nostrProposalId?: string
  nostrAcceptId?: string
  // ADR-386: server-derived owner full-edit gate.
  canFullEdit?: boolean
  company?: { id: string; name: string; logoUrl?: string } | null
  partner?: { id: string; name: string; logoUrl?: string } | null
}

type EntityType = 'cooperation' | 'offer'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCategoryCode(code: string): string {
  return code
    .split('/')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '))
    .join(' › ')
}

function statusColor(status: string): string {
  switch (status?.toUpperCase()) {
    case 'OPEN': return 'var(--color-status-success)'
    case 'ACCEPTED': return 'var(--color-primary-50)'
    case 'PAID': return 'var(--color-primary-50)'
    case 'IN_PROGRESS': return 'var(--color-primary-50)'
    case 'COMPLETED': return 'var(--color-status-success)'
    case 'DISPUTED': return 'var(--color-status-error)'
    default: return 'var(--theme-text-muted)'
  }
}

function statusBg(status: string): string {
  switch (status?.toUpperCase()) {
    case 'OPEN': return 'rgba(72,187,120,0.14)'
    case 'ACCEPTED': return 'rgba(99,179,237,0.14)'
    case 'PAID': return 'rgba(99,179,237,0.14)'
    case 'IN_PROGRESS': return 'rgba(99,179,237,0.14)'
    case 'COMPLETED': return 'rgba(72,187,120,0.14)'
    case 'DISPUTED': return 'rgba(245,101,101,0.10)'
    case 'CANCELLED': return 'rgba(113,128,150,0.10)'
    default: return 'rgba(113,128,150,0.10)'
  }
}

function milestoneStatusColor(status: string): string {
  switch (status?.toUpperCase()) {
    case 'COMPLETED': return 'var(--color-status-success)'
    case 'IN_PROGRESS': return 'var(--color-primary-50)'
    case 'DISPUTED': return 'var(--color-status-error)'
    case 'ACCEPTED': return 'var(--color-status-success)'
    default: return 'var(--theme-text-muted)'
  }
}

function parseImages(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : [] }
    catch { return raw ? [raw] : [] }
  }
  return []
}

// ── Image Gallery ────────────────────────────────────────────────────────────
// Shared hero gallery (crossfade auto-carousel + lightbox) lives in
// components/media/DetailImageGallery.

// ── Trust Badge ──────────────────────────────────────────────────────────────

function TrustBadge({ icon, text, tooltip }: { icon: React.ReactNode; text: string; tooltip?: string }) {
  const badge = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', color: 'success.main', flexShrink: 0 }}>{icon}</Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>{text}</Typography>
    </Box>
  )
  if (tooltip) return <Tooltip title={tooltip} arrow placement="top">{badge}</Tooltip>
  return badge
}

// ── Milestone Step ───────────────────────────────────────────────────────────

interface CoopMilestoneMessage {
  id: string
  authorPubkey: string
  action: string | null
  message: string | null
  createdAt: string
}

function MilestoneStep({
  index, title, description, amountSats, status, isLast, budgetSats,
  messages, applications, isInitiator, isPartner,
  onStartWork, onMarkComplete, onApprove, onDecline,
  onAcceptApp, onDeclineApp, actionLoading,
  direct, paidAt, onPayNow, onConfirmReceived,
}: {
  index: number; title: string; description?: string
  amountSats: number; status: string; isLast: boolean; budgetSats: number
  messages?: CoopMilestoneMessage[]
  applications?: CoopMilestoneApplication[]
  isInitiator?: boolean; isPartner?: boolean
  onStartWork?: () => void
  onMarkComplete?: (message: string) => void
  onApprove?: (message: string, opts?: { skipPayment?: boolean }) => void
  onDecline?: (message: string) => void
  onAcceptApp?: (milestoneId: string, appId: string) => void
  onDeclineApp?: (milestoneId: string, appId: string) => void
  actionLoading?: boolean
  // Direct-pay (escrow off): payment state + actions
  direct?: boolean
  paidAt?: string | null
  onPayNow?: () => void
  onConfirmReceived?: () => void
}) {
  const { formatNumber } = useTranslation()
  const percentage = budgetSats > 0 ? Math.round((amountSats / budgetSats) * 100) : 0
  const [completeOpen, setCompleteOpen] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const [declineOpen, setDeclineOpen] = useState(false)
  const [msg, setMsg] = useState('')

  const actionLabel = (action: string | null) => {
    switch (action) {
      case 'STARTED': return 'started work'
      case 'COMPLETED': return 'submitted work'
      case 'APPROVED': return 'approved'
      case 'DECLINED': return 'requested changes'
      case 'DISPUTED': return 'raised dispute'
      case 'PAID_DIRECT': return 'paid'
      case 'CASHU_TOKEN': return 'sent eCash'
      case 'PAID_CONFIRMED': return 'confirmed receipt'
      default: return action ?? ''
    }
  }
  const actionColor = (action: string | null) => {
    switch (action) {
      case 'APPROVED': return 'var(--color-status-success)'
      case 'DECLINED': return 'var(--color-status-error)'
      case 'DISPUTED': return 'var(--color-status-error)'
      default: return 'var(--color-primary-50)'
    }
  }

  const hasMessages = messages && messages.length > 0

  return (
    <Box sx={{ display: 'flex', gap: 2, position: 'relative' }}>
      {!isLast && (
        <Box sx={{ position: 'absolute', left: 15, top: 36, bottom: -8, width: 2, background: 'linear-gradient(to bottom, var(--theme-border) 0%, transparent 100%)' }} />
      )}
      <Box sx={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: status === 'COMPLETED' || status === 'ACCEPTED' ? 'rgba(72,187,120,0.15)' : 'rgba(99,179,237,0.10)', border: `2px solid ${milestoneStatusColor(status)}`, zIndex: 1 }}>
        {status === 'COMPLETED' || status === 'ACCEPTED'
          ? <CheckIcon sx={{ fontSize: '0.8rem', color: milestoneStatusColor(status) }} />
          : <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--color-primary-50)' }}>{index + 1}</Typography>}
      </Box>
      <Box sx={{ flex: 1, pb: isLast ? 0 : 2.5, minWidth: 0 }}>
        {/* minHeight 32 = number-circle height; center aligns the title
            vertically with the digit inside the circle */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 32, gap: 1 }}>
          <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>{title}</Typography>
          {/* Percentage, sats and fiat conversion share ONE line, sized up
              to body2 so they read at the same level as the milestone title. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
            <Chip label={`${percentage}%`} sx={{ fontSize: '0.75rem', height: 24, fontWeight: 700, background: 'rgba(99,179,237,0.10)', border: '1px solid rgba(99,179,237,0.20)', color: 'var(--color-primary-50)' }} />
            <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatNumber(amountSats)} sats</Typography>
            <FiatHint sats={amountSats} className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }} />
          </Box>
        </Box>
        {description && <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', mt: 0.5, lineHeight: 1.6 }}>{description}</Typography>}
        {status && status !== 'PENDING' && (
          <Chip label={status.replace(/_/g, ' ')} size="small" sx={{ mt: 0.75, fontSize: '0.6rem', height: 18, fontWeight: 600, bgcolor: statusBg(status), color: statusColor(status), border: 'none' }} />
        )}
        {direct && (
          <Chip
            label={paidAt ? 'PAID' : status === 'ACCEPTED' ? 'APPROVED · UNPAID' : 'UNPAID'}
            size="small"
            sx={{ mt: 0.75, ml: status && status !== 'PENDING' ? 0.75 : 0, fontSize: '0.6rem', height: 18, fontWeight: 600, border: 'none',
              bgcolor: paidAt ? 'var(--color-status-success-bg)' : 'var(--theme-bg-subtle)',
              color: paidAt ? 'var(--color-status-success)' : 'var(--theme-text-muted)' }}
          />
        )}

        {/* Message Thread */}
        {hasMessages && (
          <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {messages!.map(m => (
              <Box key={m.id} sx={{ p: 1.25, borderRadius: 'var(--radius-md, 8px)', bgcolor: 'var(--theme-bg-elevated)', border: '1px solid var(--theme-border)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: m.message ? 0.5 : 0 }}>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.6rem', color: 'var(--theme-text-muted)' }}>{m.authorPubkey.slice(0, 10)}...</Typography>
                  {m.action && (
                    <Chip label={actionLabel(m.action)} size="small" sx={{ fontSize: '0.55rem', height: 16, fontWeight: 700, bgcolor: `${actionColor(m.action)}14`, color: actionColor(m.action), border: 'none' }} />
                  )}
                  <Typography variant="caption" sx={{ fontSize: '0.55rem', color: 'var(--theme-text-disabled)', ml: 'auto' }}>{new Date(m.createdAt).toLocaleDateString()}</Typography>
                </Box>
                {m.message && m.action === 'CASHU_TOKEN' ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--theme-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.message}</Typography>
                    {isPartner && (
                      <Button size="small" sx={{ fontSize: '0.65rem', textTransform: 'none', flexShrink: 0 }} onClick={() => void navigator.clipboard?.writeText(m.message!)}>Copy token</Button>
                    )}
                  </Box>
                ) : m.message && (
                  <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'var(--theme-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.message}</Typography>
                )}
              </Box>
            ))}
          </Box>
        )}

        {/* Action Buttons */}
        {status === 'PENDING' && isPartner && (
          <Button size="small" variant="outlined" sx={{ mt: 1, fontSize: '0.7rem', textTransform: 'none' }} onClick={onStartWork}>Start Work</Button>
        )}
        {status === 'IN_PROGRESS' && isPartner && (
          <Button size="small" variant="contained" sx={{ mt: 1, fontSize: '0.7rem', textTransform: 'none' }} onClick={() => { setMsg(''); setCompleteOpen(true) }}>Mark Completed</Button>
        )}
        {status === 'COMPLETED' && isInitiator && (
          <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
            <Button size="small" variant="contained" color="success" sx={{ fontSize: '0.7rem', textTransform: 'none' }} onClick={() => { setMsg(''); setApproveOpen(true) }}>{direct ? (paidAt ? 'Approve' : 'Approve & Pay') : 'Approve & Release'}</Button>
            <Button size="small" variant="outlined" color="error" sx={{ fontSize: '0.7rem', textTransform: 'none' }} onClick={() => { setMsg(''); setDeclineOpen(true) }}>Request Changes</Button>
          </Box>
        )}

        {direct && !paidAt && status !== 'DISPUTED' && (
          <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {isInitiator && status !== 'COMPLETED' && (
              <Button size="small" variant="outlined" disabled={actionLoading} sx={{ fontSize: '0.7rem', textTransform: 'none' }} onClick={onPayNow}>
                {status === 'ACCEPTED' ? 'Pay now' : 'Pay upfront'}
              </Button>
            )}
            {isPartner && (
              <Button size="small" variant="outlined" disabled={actionLoading} sx={{ fontSize: '0.7rem', textTransform: 'none' }} onClick={onConfirmReceived}>
                Confirm payment received
              </Button>
            )}
          </Box>
        )}

        {/* Applications (initiator review) */}
        {applications && applications.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography variant="caption" fontWeight={600} color="text.secondary">Applications ({applications.length})</Typography>
            {applications.map(app => (
              <Box key={app.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'var(--theme-bg-elevated)', border: '1px solid var(--theme-border)' }}>
                <Typography variant="caption" sx={{ flex: 1, fontFamily: 'monospace', fontSize: '0.65rem' }}>{app.applicantPubkey.slice(0, 12)}...</Typography>
                {app.message && <Typography variant="caption" sx={{ flex: 2, color: 'var(--theme-text-muted)', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.message}</Typography>}
                <Typography variant="caption" sx={{ fontSize: '0.6rem', color: statusColor(app.status), fontWeight: 600 }}>{app.status}</Typography>
                {app.status === 'PENDING' && (
                  <>
                    <Button size="small" sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: '0.6rem' }} onClick={() => onAcceptApp?.('', app.id)}>Accept</Button>
                    <Button size="small" sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: '0.6rem', color: 'error.main' }} onClick={() => onDeclineApp?.('', app.id)}>Decline</Button>
                  </>
                )}
              </Box>
            ))}
          </Box>
        )}

        {/* Mark Complete Dialog */}
        <Dialog open={completeOpen} onClose={() => setCompleteOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            Submit Work — {title}
            <IconButton onClick={() => setCompleteOpen(false)} size="small"><X fontSize={18} /></IconButton>
          </DialogTitle>
          <DialogContent>
            <TextField multiline rows={3} fullWidth value={msg} onChange={e => setMsg(e.target.value)} placeholder="Describe what was done and provide any relevant links..." />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setCompleteOpen(false)}>Cancel</Button>
            <Button variant="contained" disabled={actionLoading} onClick={() => { onMarkComplete?.(msg); setCompleteOpen(false) }}>Submit</Button>
          </DialogActions>
        </Dialog>

        {/* Approve Dialog */}
        <Dialog open={approveOpen} onClose={() => setApproveOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {direct ? 'Approve' : 'Approve & Release'} — {title}
            <IconButton onClick={() => setApproveOpen(false)} size="small"><X fontSize={18} /></IconButton>
          </DialogTitle>
          <DialogContent>
            <TextField multiline rows={3} fullWidth value={msg} onChange={e => setMsg(e.target.value)} placeholder="Optional message for the partner..." />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setApproveOpen(false)}>Cancel</Button>
            {direct && !paidAt && (
              <Button disabled={actionLoading} onClick={() => { onApprove?.(msg, { skipPayment: true }); setApproveOpen(false) }}>Approve without paying</Button>
            )}
            <Button variant="contained" color="success" disabled={actionLoading} onClick={() => { onApprove?.(msg); setApproveOpen(false) }}>{direct ? (paidAt ? 'Approve' : 'Approve & pay') : 'Approve & Release'}</Button>
          </DialogActions>
        </Dialog>

        {/* Decline / Request Changes Dialog */}
        <Dialog open={declineOpen} onClose={() => setDeclineOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            Request Changes — {title}
            <IconButton onClick={() => setDeclineOpen(false)} size="small"><X fontSize={18} /></IconButton>
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>The milestone will be sent back to the partner for another iteration.</Typography>
            <TextField multiline rows={3} fullWidth value={msg} onChange={e => setMsg(e.target.value)} placeholder="Describe what needs to be changed..." />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setDeclineOpen(false)}>Cancel</Button>
            <Button variant="contained" color="error" disabled={actionLoading} onClick={() => { onDecline?.(msg); setDeclineOpen(false) }}>Request Changes</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  )
}

// ── Cooperation Edit Dialog (Projects & Tenders) ─────────────────────────────

export interface CooperationEditValues {
  title: string
  description: string
  budgetSats: string
  timeline: string
  deadline: string
  requirements: string
  skills: string
}

function CooperationEditDialog({
  open, onClose, onSave, saving, error, isTender, initial,
}: {
  open: boolean
  onClose: () => void
  onSave: (values: CooperationEditValues) => void
  saving: boolean
  error: string | null
  isTender: boolean
  initial: CooperationEditValues
}) {
  const [values, setValues] = useState(initial)
  useEffect(() => { if (open) setValues(initial) }, [open, initial])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Edit {isTender ? 'Tender' : 'Project'}
        <IconButton onClick={onClose} size="small"><X fontSize={18} /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Title" fullWidth value={values.title} onChange={e => setValues(v => ({ ...v, title: e.target.value }))} />
        {/* ADR-295: WYSIWYG description editor + AI assist */}
        <RichDescriptionEditor
          value={values.description}
          onChange={(html) => setValues(v => ({ ...v, description: html }))}
          aiContext={{ title: values.title, offerType: isTender ? 'TENDER' : 'COOPERATION' }}
        />
        <SatsAmountInput label="Budget" valueSats={values.budgetSats === '' ? '' : Number(values.budgetSats)} onChangeSats={sats => setValues(v => ({ ...v, budgetSats: sats === '' ? '' : String(sats) }))} />
        {isTender ? (
          <>
            <TextField label="Deadline" type="date" fullWidth slotProps={{ inputLabel: { shrink: true } }} value={values.deadline} onChange={e => setValues(v => ({ ...v, deadline: e.target.value }))} />
            <TextField label="Requirements" fullWidth multiline rows={2} value={values.requirements} onChange={e => setValues(v => ({ ...v, requirements: e.target.value }))} />
          </>
        ) : (
          <>
            <TextField label="Timeline" fullWidth placeholder="e.g. 2026-08-01 – 2026-09-15" value={values.timeline} onChange={e => setValues(v => ({ ...v, timeline: e.target.value }))} />
            <TextField label="Skills (comma separated)" fullWidth value={values.skills} onChange={e => setValues(v => ({ ...v, skills: e.target.value }))} />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving || !values.title.trim()} onClick={() => onSave(values)}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Network Edit Dialog (offerType=COOP) ─────────────────────────────────────

export interface NetworkEditValues {
  title: string
  description: string
  priceSats: string
  networkType: 'open' | 'closed'
  membershipCriteria: string
  maxMembers: string
}

function NetworkEditDialog({
  open, onClose, onSave, saving, error, initial,
}: {
  open: boolean
  onClose: () => void
  onSave: (values: NetworkEditValues) => void
  saving: boolean
  error: string | null
  initial: NetworkEditValues
}) {
  const [values, setValues] = useState(initial)
  useEffect(() => { if (open) setValues(initial) }, [open, initial])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Edit Network
        <IconButton onClick={onClose} size="small"><X fontSize={18} /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Title" fullWidth value={values.title} onChange={e => setValues(v => ({ ...v, title: e.target.value }))} />
        {/* ADR-295: WYSIWYG description editor + AI assist */}
        <RichDescriptionEditor
          value={values.description}
          onChange={(html) => setValues(v => ({ ...v, description: html }))}
          aiContext={{ title: values.title, offerType: 'NETWORK' }}
        />
        <SatsAmountInput label="Budget" valueSats={values.priceSats === '' ? '' : Number(values.priceSats)} onChangeSats={sats => setValues(v => ({ ...v, priceSats: sats === '' ? '' : String(sats) }))} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 'var(--radius-md, 8px)', bgcolor: 'var(--theme-bg-elevated)' }}>
          <Switch
            checked={values.networkType === 'open'}
            onChange={e => setValues(v => ({ ...v, networkType: e.target.checked ? 'open' : 'closed' }))}
          />
          <Box>
            <Typography variant="body2" fontWeight={600}>{values.networkType === 'open' ? 'Open membership' : 'Closed membership'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {values.networkType === 'open' ? 'Anyone can join without approval.' : 'New members require approval.'}
            </Typography>
          </Box>
        </Box>
        <TextField label="Membership Criteria" fullWidth multiline rows={2} value={values.membershipCriteria} onChange={e => setValues(v => ({ ...v, membershipCriteria: e.target.value }))} />
        <TextField label="Max Members (optional)" type="number" fullWidth value={values.maxMembers} onChange={e => setValues(v => ({ ...v, maxMembers: e.target.value }))} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving || !values.title.trim()} onClick={() => onSave(values)}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Request to Join Dialog (closed networks) — ADR-212 ───────────────────────

function RequestToJoinDialog({
  open, onClose, onSubmit, saving, error, membershipCriteria,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (message: string) => void
  saving: boolean
  error: string | null
  membershipCriteria: string | null
}) {
  const [message, setMessage] = useState('')
  useEffect(() => { if (open) setMessage('') }, [open])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Request to Join
        <IconButton onClick={onClose} size="small"><X fontSize={18} /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {membershipCriteria && (
          <Box sx={{ p: 1.5, borderRadius: 'var(--radius-md, 8px)', background: 'rgba(99,179,237,0.06)', border: '1px solid rgba(99,179,237,0.15)' }}>
            <Typography variant="caption" fontWeight={700} display="block" sx={{ color: 'var(--color-primary-50)', mb: 0.25 }}>Membership criteria</Typography>
            <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>{membershipCriteria}</Typography>
          </Box>
        )}
        <TextField
          label="Message to the network owner (optional)"
          multiline rows={3} fullWidth
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Introduce yourself and explain why you'd like to join…"
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving} onClick={() => onSubmit(message)}>
          {saving ? 'Sending…' : 'Send Request'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Network Join CTA (sidebar) — ADR-212 ──────────────────────────────────────

function NetworkJoinPanel({
  networkType, maxMembers, membershipCriteria, activeMemberCount,
  isOwner, myStatus, loading, error,
  onJoinOpen, onRequestClosed, onLeave, onRequestAgain,
}: {
  networkType: 'open' | 'closed'
  maxMembers: number | null
  membershipCriteria: string | null
  activeMemberCount: number
  isOwner: boolean
  myStatus: 'PENDING' | 'ACTIVE' | 'DECLINED' | 'REMOVED' | null
  loading: boolean
  error: string | null
  onJoinOpen: () => void
  onRequestClosed: () => void
  onLeave: () => void
  onRequestAgain: () => void
}) {
  const [confirmLeave, setConfirmLeave] = useState(false)
  const isFull = !!maxMembers && activeMemberCount >= maxMembers

  return (
    <Box sx={{ mb: 2.5 }}>
      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2, p: 1.5, borderRadius: 'var(--radius-md, 8px)', background: 'rgba(255,192,57,0.06)', border: '1px solid rgba(255,192,57,0.15)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {networkType === 'closed' && <LockIcon sx={{ fontSize: 15, color: 'var(--color-warning-primary)' }} />}
          <Typography variant="caption" fontWeight={700} sx={{ color: 'var(--color-warning-primary)' }}>
            {networkType === 'open' ? 'Open Membership' : 'Closed Membership'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Users size={13} style={{ color: 'var(--theme-text-muted)' }} />
          <Typography variant="caption" fontWeight={700} sx={{ color: 'var(--theme-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {activeMemberCount}{maxMembers ? ` / ${maxMembers}` : ''}
          </Typography>
        </Box>
      </Box>

      {isOwner ? (
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          You own this network. Review join requests and manage members below.
        </Typography>
      ) : myStatus === 'ACTIVE' ? (
        confirmLeave ? (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button fullWidth variant="contained" color="error" disabled={loading} onClick={onLeave}>Confirm Leave</Button>
            <Button fullWidth variant="text" onClick={() => setConfirmLeave(false)}>Cancel</Button>
          </Box>
        ) : (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, color: 'var(--color-status-success)' }}>
              <CheckCircleIcon fontSize="small" />
              <Typography variant="body2" fontWeight={700}>You're a member</Typography>
            </Box>
            <Button fullWidth variant="outlined" color="error" size="small" startIcon={<LogOut size={14} />} onClick={() => setConfirmLeave(true)}>
              Leave Network
            </Button>
          </Box>
        )
      ) : myStatus === 'PENDING' ? (
        <Box>
          <Chip label="Request Pending" size="small" sx={{ mb: 1.5, fontWeight: 700, bgcolor: 'rgba(255,192,57,0.14)', color: 'var(--color-warning-primary)' }} />
          <Button fullWidth variant="outlined" size="small" disabled={loading} onClick={onLeave}>Withdraw Request</Button>
        </Box>
      ) : myStatus === 'DECLINED' ? (
        <Box>
          <Chip label="Request Declined" size="small" sx={{ mb: 1.5, fontWeight: 700, bgcolor: 'rgba(245,101,101,0.10)', color: 'var(--color-status-error)' }} />
          <Button fullWidth variant="outlined" disabled={loading} onClick={onRequestAgain}>Request Again</Button>
        </Box>
      ) : isFull ? (
        <Button fullWidth variant="outlined" disabled>Network Full</Button>
      ) : networkType === 'open' ? (
        <Button fullWidth variant="contained" size="large" disabled={loading} startIcon={<UserPlus size={16} />} onClick={onJoinOpen} sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700 }}>
          Join Network
        </Button>
      ) : (
        <>
          <Button fullWidth variant="contained" size="large" disabled={loading} startIcon={<UserPlus size={16} />} onClick={onRequestClosed} sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700, mb: membershipCriteria ? 1 : 0 }}>
            Request to Join
          </Button>
          {membershipCriteria && (
            <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.5, display: 'block' }}>{membershipCriteria}</Typography>
          )}
        </>
      )}
    </Box>
  )
}

// ── Network Members Section (main content) — ADR-212 ──────────────────────────

function NetworkMembersSection({
  members, isOwner, loading, error, onAccept, onDecline,
}: {
  members: OfferMember[]
  isOwner: boolean
  loading: boolean
  error: string | null
  onAccept: (id: string) => void
  onDecline: (id: string) => void
}) {
  const pending = members.filter(m => m.status === 'PENDING')
  const active = members.filter(m => m.status === 'ACTIVE')

  return (
    <Box className="section-animate" sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 'var(--radius-lg, 12px)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Users size={16} style={{ color: 'var(--theme-text-muted)' }} />
        <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
          Members ({active.length})
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {isOwner && pending.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" gutterBottom sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.65rem' }}>
            Pending Requests ({pending.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {pending.map(m => (
              <Box key={m.id} sx={{ p: 1.5, borderRadius: 'var(--radius-md, 8px)', border: '1px solid rgba(255,192,57,0.30)', background: 'rgba(255,192,57,0.04)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: m.message ? 1 : 1.25 }}>
                  <UserLink pubkey={m.pubkey} size="small" mono />
                  <Typography variant="caption" color="text.secondary">{new Date(m.createdAt).toLocaleDateString()}</Typography>
                </Box>
                {m.message && (
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)', lineHeight: 1.6, mb: 1.25 }}>{m.message}</Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" variant="contained" color="success" disabled={loading} onClick={() => onAccept(m.id)} sx={{ fontSize: '0.7rem', textTransform: 'none' }}>Accept</Button>
                  <Button size="small" variant="outlined" color="error" disabled={loading} onClick={() => onDecline(m.id)} sx={{ fontSize: '0.7rem', textTransform: 'none' }}>Decline</Button>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {active.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No members yet — be the first to join.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {active.map(m => (
            <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.25, borderRadius: 'var(--radius-md, 8px)', border: '1px solid var(--theme-border)' }}>
              <UserLink pubkey={m.pubkey} size="small" mono />
              <Typography variant="caption" color="text.secondary">Joined {new Date(m.updatedAt).toLocaleDateString()}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function CoopDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const { formatNumber } = useTranslation()
  const pubkey = localStorage.getItem('pubkey') ?? ''

  const queryClient = useQueryClient()
  const { payInvoice, pollUntilPaid } = usePayment()
  const { coopEscrowEnabled } = useBetaMode()
  // Direct-pay (escrow off): dialog for wallets that cannot auto-pay (manual LN
  // invoice + preimage) and for the Cashu rail (P2PK token for the partner).
  const cashuWallet = useCashu()
  const [directPay, setDirectPay] = useState<{
    milestone: CoopMilestone
    rail: 'LN' | 'CASHU'
    invoice?: string
    cashu?: { pubkey: string; mintUrl: string }
    token?: string
    message?: string
    approveAfter: boolean
  } | null>(null)
  const [directPreimage, setDirectPreimage] = useState('')
  const { data: entityData, error: queryError } = useEntity(id || '')
  const entityType = entityData?.type as EntityType | undefined
  const cooperation = entityType === 'cooperation' ? entityData?.data as Cooperation : null
  const offer = entityType === 'offer' ? entityData?.data as Offer : null

  // ADR-204: fetch the ticket for this cooperation (created by fund-escrow)
  const { data: ticketData } = useCooperationTicket(cooperation?.id || '')

  const { data: sellerIdentity } = useIdentity(cooperation?.initiatorPubkey || offer?.creatorPubkey || '')
  const { data: partnerIdentity } = useIdentity(cooperation?.partnerPubkey || '')
  const sellerIdentityLevel = sellerIdentity?.identityLevel ?? 0
  const partnerIdentityLevel = partnerIdentity?.identityLevel ?? 0

  // ADR-212: network membership (Offer.offerType=COOP only)
  const { data: offerMembers = [] } = useOfferMembers(offer?.id ?? '', offer?.offerType === 'COOP')

  const { data: resolvedCompanyData } = useCompany(offer?.companyId || '')
  const resolvedCompany = resolvedCompanyData

  // Initiator profile mirror — same fetch as BuyProductDetail's sellerProfile so
  // the Initiator card on the Coop Detail page can render the same full layout
  // (avatar, NIP-05, lightning, banner background, key-value grid, footer).
  const initiatorPubkey = cooperation?.initiatorPubkey
  const [sellerProfile, setSellerProfile] = useState<UserProfileResponse | null>(null)
  useEffect(() => {
    const pk = initiatorPubkey
    if (!pk) { setSellerProfile(null); return }
    let cancelled = false
    apiCall(`/api/user/${pk}/profile`)
      .then(r => r.json())
      .then((data: UserProfileResponse & { error?: string }) => {
        if (!cancelled && data && !data.error && data.pubkey) setSellerProfile(data)
      })
      .catch(() => { /* silent — fallback stays at useIdentity-only data */ })
    return () => { cancelled = true }
  }, [initiatorPubkey])

  // Live Nostr Kind 0 fallback for the initiator (same as UserProfile.tsx) — when
  // the DB has no Nostr display metadata yet, fetch it live from relays so we
  // still show the user's real banner / picture / name / about. Skipped for
  // non-PUBLIC visibility and non-hex pubkeys. Display-only merge, never persisted.
  useEffect(() => {
    const pk = initiatorPubkey
    if (!pk || !sellerProfile) return
    if (sellerProfile.visibility && sellerProfile.visibility !== 'PUBLIC') return
    if (sellerProfile.picture || sellerProfile.name || sellerProfile.banner) return
    if (!/^[0-9a-f]{64}$/i.test(pk)) return
    let cancelled = false
    apiCall(`/api/nostr/profile/${pk}`)
      .then(r => (r.ok ? r.json() : null))
      .then((k0: { name?: string; picture?: string; about?: string; banner?: string; nip05?: string } | null) => {
        if (cancelled || !k0) return
        if (!k0.picture && !k0.name && !k0.banner) return
        setSellerProfile(p => p
          ? {
              ...p,
              picture: p.picture ?? (k0.picture || null),
              name: p.name ?? (k0.name || null),
              about: p.about ?? (k0.about || null),
              banner: p.banner ?? (k0.banner || null),
              nip05: p.nip05 ?? (k0.nip05 || null),
            }
          : p)
      })
      .catch(() => { /* silent — fallback stays */ })
    return () => { cancelled = true }
  }, [initiatorPubkey, sellerProfile])

  // ADR-188: detail↔slider binding for cooperations. Two sibling sources:
  //   - Vendor: other cooperations by the same initiator
  //   - Marketplace: all discoverable cooperations
  // Both hooks are TanStack-Query cached. The slider is mounted only when the
  // current entity is a cooperation (not an offer — BuyProductDetail handles
  // that path).
  const { data: vendorCooperations, isLoading: vendorCoopLoading } = useCooperations(cooperation?.initiatorPubkey || '')
  const { data: allCooperations, isLoading: allCoopLoading } = useCooperationsDiscover('')

  // ADR-188 (network variant): slider for Network offers (offerType=COOP).
  // Scoped to NETWORK offers only — the raw vendor/all offer lists mix in the
  // creator's regular product/service offers, and swiping onto one lands on a
  // /coop/:id detail that mounts no slider and no swipe (BuyProductDetail owns
  // that path): a dead end. Filtering at the source keeps both the slider and
  // the swipe nav (which browses the same list) within networks. Anchored on
  // offer when active.
  const { data: vendorOffers, isLoading: vendorOffersLoading } = useVendorOffers(offer?.creatorPubkey ?? '')
  const { data: allOffers } = useAllOffers()

  const offerToSliderItem = (o: { id: string; title: string; priceSats?: number; category?: string; categoryCode?: string | null; offerType?: string; images?: unknown; country?: string | null; companyId?: string | null; source?: string; priceAmount?: string | null; priceCurrency?: string | null }): SliderListItem => ({
    id: o.id,
    title: o.title,
    category: o.category ?? 'Network',
    avatarUrl: Array.isArray(o.images) ? o.images[0] as string | undefined : undefined,
    priceSats: o.priceSats ?? 0,
    priceLabel: foreignPriceText({ source: o.source as 'LOCAL' | 'REMOTE' | undefined, priceSats: o.priceSats ?? 0, priceAmount: o.priceAmount, priceCurrency: o.priceCurrency }) ?? undefined,
    entityType: 'offer',
    categoryCode: o.categoryCode ?? undefined,
    offerType: o.offerType,
    country: o.country ?? null,
    companyId: o.companyId ?? null,
  } as SliderListItem)

  const networkVendorOffers = useMemo(
    () => (vendorOffers ?? []).filter(o => o.offerType === 'COOP'),
    [vendorOffers],
  )
  const networkAllOffers = useMemo(
    () => (allOffers ?? []).filter(o => o.offerType === 'COOP'),
    [allOffers],
  )

  const { vendorItems: vendorOfferItems, allItems: allOfferItems } = useDetailSliderItems({
    vendorList: networkVendorOffers,
    allList: networkAllOffers,
    anchor: offer,
    mapItem: offerToSliderItem,
  })

  const coopToSliderItem = (c: { id: string; title: string; budgetSats?: number; categoryCode?: string | null; cooperationType?: string; images?: unknown; company?: { id: string } | null }): SliderListItem => ({
    id: c.id,
    title: c.title,
    category: c.cooperationType ?? 'Cooperation',
    avatarUrl: Array.isArray(c.images) ? c.images[0] as string | undefined : undefined,
    priceSats: c.budgetSats ?? 0,
    entityType: 'offer',
    categoryCode: c.categoryCode ?? undefined,
    country: null,
    companyId: c.company?.id ?? null,
  } as SliderListItem)

  const { vendorItems: vendorCoopItems, allItems: allCoopItems } = useDetailSliderItems({
    vendorList: vendorCooperations,
    allList: allCooperations,
    anchor: cooperation,
    mapItem: coopToSliderItem,
  })

  const [actionError, setActionError] = useState<string | null>(null)
  const error = actionError || (queryError ? queryError.message : null)
  const [actionLoading, setActionLoading] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [selectedMilestoneIds, setSelectedMilestoneIds] = useState<Set<string>>(new Set())
  const [applyMessage, setApplyMessage] = useState('')
  const [applying, setApplying] = useState(false)
  const [sidebarMsMessages, setSidebarMsMessages] = useState<Record<string, string>>({})
  const [headerMenuAnchor, setHeaderMenuAnchor] = useState<HTMLElement | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [joinDialogOpen, setJoinDialogOpen] = useState(false)
  const [memberActionLoading, setMemberActionLoading] = useState(false)
  const [memberActionError, setMemberActionError] = useState<string | null>(null)

  const { addItem, isInCart, lastAddedItem, undoLastAdd } = useCart()
  const { showSnackbarWithUndo, showSnackbar } = useNotification()
  const { isFavorite, toggleFavorite } = useFavoritesWithUndo({ entityType: 'offer', showSnackbarWithUndo })

  const pageRef = usePageAnimation([
    { selector: '.page-animate', from: { duration: 0.5, stagger: 0.1, y: 20 } },
  ])
  const detailsRef = useSectionAnimation('.section-animate', {
    scrollTrigger: true, start: 'top 90%',
    from: { duration: 0.5, stagger: 0.08, y: 24, clearProps: 'all' },
  })
  const sidebarRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<HTMLDivElement>(null)
  const sidebarTimelineRef = useRef<gsap.core.Timeline | null>(null)
  const gsapTimelineRef = useRef<gsap.core.Timeline | null>(null)
  const snackbarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingItemRef = useRef<{ offerId: string; title: string } | null>(null)

  useEffect(() => {
    if (!lastAddedItem) return
    pendingItemRef.current = { offerId: lastAddedItem.offerId, title: lastAddedItem.title }
    if (snackbarTimeoutRef.current) clearTimeout(snackbarTimeoutRef.current)
    snackbarTimeoutRef.current = setTimeout(() => {
      if (pendingItemRef.current) {
        showSnackbarWithUndo({
          message: `"${pendingItemRef.current.title.slice(0, 20)}${pendingItemRef.current.title.length > 20 ? '…' : ''}" added to basket`,
          severity: 'success',
          undoLabel: 'Undo',
          onUndo: undoLastAdd,
        })
        pendingItemRef.current = null
      }
    }, 350)
    return () => { if (snackbarTimeoutRef.current) clearTimeout(snackbarTimeoutRef.current) }
  }, [lastAddedItem])

  useEffect(() => {
    if (!lastAddedItem) return
    if (sidebarTimelineRef.current) sidebarTimelineRef.current.kill()
    const sidebar = sidebarRef.current
    if (!sidebar) return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    sidebarTimelineRef.current = gsap.timeline()
    sidebarTimelineRef.current.to(sidebar, {
      scale: 1.02,
      boxShadow: '0 8px 30px rgba(72,187,120,0.35), 0 2px 8px rgba(0,0,0,0.10)',
      borderColor: 'rgba(72,187,120,0.50)',
      duration: 0.25,
      ease: 'power2.out',
    })
    sidebarTimelineRef.current.to(sidebar, {
      scale: 1,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
      borderColor: 'var(--theme-border)',
      duration: 0.4,
      ease: 'power2.inOut',
    })
  }, [lastAddedItem])

  useEffect(() => {
    if (!lastAddedItem) return
    if (gsapTimelineRef.current) gsapTimelineRef.current.kill()
    const fab = document.querySelector('.cart-fab-btn') as HTMLElement | null
    if (!fab) return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    gsapTimelineRef.current = gsap.timeline()
    gsapTimelineRef.current.to(fab, {
      scale: 1.2,
      boxShadow: '0 0 24px rgba(72,187,120,0.55), 0 0 48px rgba(72,187,120,0.30)',
      duration: 0.25,
      ease: 'power2.out',
    })
    gsapTimelineRef.current.to(fab, {
      scale: 1,
      boxShadow: '',
      duration: 0.4,
      ease: 'power2.inOut',
    })
  }, [lastAddedItem])

  // ── Cooperation actions ──────────────────────────────────────────────────

  async function handleAccept() {
    if (!cooperation || !pubkey) return
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await apiCall(`/api/cooperations/${cooperation.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerPubkey: pubkey }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.nostrEventTemplate) {
          // ADR-152 / Phase 3.2: PRIVATE coop acceptance → NIP-17 DM, not public publish
          deliverCooperationTemplate(
            data.nostrEventTemplate as NostrEventTemplate,
            cooperation.visibility as 'PUBLIC' | 'PRIVATE' | undefined,
          ).catch(() => {})
        }
        queryClient.invalidateQueries({ queryKey: ['entity', id] })
      } else setActionError('Failed to accept cooperation')
    } catch { setActionError('Network error') }
    finally { setActionLoading(false) }
  }

  async function handleCancel() {
    if (!cooperation) return
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await apiCall(`/api/cooperations/${cooperation.id}/cancel`, { method: 'POST' })
      if (res.ok) { await res.json(); queryClient.invalidateQueries({ queryKey: ['entity', id] }) }
      else setActionError('Failed to cancel')
    } catch { setActionError('Network error') }
    finally { setActionLoading(false) }
  }

  async function handleStatusUpdate(newStatus: string) {
    if (!cooperation) return
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await apiCall(`/api/cooperations/${cooperation.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) { await res.json(); queryClient.invalidateQueries({ queryKey: ['entity', id] }) }
      else setActionError('Failed to update status')
    } catch { setActionError('Network error') }
    finally { setActionLoading(false) }
  }

  async function handleFundEscrow() {
    if (!cooperation) return
    setActionLoading(true)
    setActionError(null)
    try {
      const invoiceRes = await apiCall(`/api/cooperations/${cooperation.id}/fund-escrow`, { method: 'POST' })
      if (!invoiceRes.ok) {
        const data = await invoiceRes.json()
        // ADR-255 D4: prefer the server's human-readable message (e.g. for
        // COOP_ESCROW_DISABLED) over the raw error code — same fix FU-253-I
        // already applied to the Offer escrow toggle's error path.
        setActionError(data.message || data.error || 'Failed to create escrow invoice')
        setActionLoading(false)
        return
      }
      const { invoice: _invoice, paymentHash } = await invoiceRes.json()

      const payResult = await payInvoice({ invoice: _invoice, paymentHash })
      if (!payResult.ok) {
        setActionError(
          payResult.mode === 'WEBLN' && payResult.error === 'Payment rejected by wallet.'
            ? 'Payment rejected by wallet. Escrow was not funded.'
            : (payResult.error || 'Failed to fund escrow'),
        )
        setActionLoading(false)
        return
      }

      const paid = await pollUntilPaid(paymentHash)
      if (paid) {
        queryClient.invalidateQueries({ queryKey: ['entity', id] })
        setActionLoading(false)
        return
      }

      setActionError('Payment sent but confirmation is taking longer than expected. The status will update automatically.')
      setActionLoading(false)
    } catch (err: any) {
      setActionError(err?.message || 'Failed to fund escrow')
      setActionLoading(false)
    }
  }

  async function handleMilestoneAction(milestone: CoopMilestone, newStatus: string, message?: string) {
    if (!cooperation || !pubkey) return
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestone.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, performerPubkey: pubkey, message: message || undefined }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.nostrEventTemplate) deliverMilestoneTemplate(data.nostrEventTemplate as NostrEventTemplate, cooperation.visibility as 'PUBLIC' | 'PRIVATE' | undefined).catch(() => {})
        if (data.milestone) {
          queryClient.invalidateQueries({ queryKey: ['entity', id] })
        }
        if (data.cooperationCompleted) {
          queryClient.invalidateQueries({ queryKey: ['entity', id] })
          showSnackbar('All milestones completed — cooperation finished', 'success')
        } else {
          const snackMessages: Record<string, { msg: string; sev: 'success' | 'info' | 'warning' }> = {
            IN_PROGRESS: { msg: `Work started: ${milestone.title}`, sev: 'info' },
            COMPLETED:   { msg: `Work submitted: ${milestone.title}`, sev: 'info' },
            ACCEPTED:    { msg: `Milestone approved: ${milestone.title}`, sev: 'success' },
            DISPUTED:    { msg: `Milestone disputed: ${milestone.title}`, sev: 'warning' },
          }
          const s = snackMessages[newStatus]
          if (s) showSnackbar(s.msg, s.sev)
        }
      } else setActionError('Failed to update milestone')
    } catch { setActionError('Network error') }
    finally { setActionLoading(false) }
  }

  // Direct-pay: initiator pays the partner's own rail — upfront, on completion
  // or after approval. Approving (ACCEPTED) is a separate, explicit decision.
  async function approveMilestone(milestone: CoopMilestone, message: string | undefined, paid: boolean) {
    if (!cooperation) return
    await apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestone.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACCEPTED', performerPubkey: pubkey, message: message || undefined }),
    })
    showSnackbar(paid ? `Milestone approved: ${milestone.title}` : `Milestone approved without payment: ${milestone.title}`, paid ? 'success' : 'info')
    queryClient.invalidateQueries({ queryKey: ['entity', id] })
  }

  async function confirmDirectPayment(milestone: CoopMilestone, preimage: string, message: string | undefined, approveAfter: boolean) {
    if (!cooperation) return
    await apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestone.id}/confirm-direct-payment`, {
      method: 'POST', body: JSON.stringify({ preimage }),
    })
    if (approveAfter) await approveMilestone(milestone, message, true)
    else {
      showSnackbar(`Paid: ${milestone.title}`, 'success')
      queryClient.invalidateQueries({ queryKey: ['entity', id] })
    }
  }

  async function handleMilestoneDirectPay(milestone: CoopMilestone, message: string | undefined, approveAfter: boolean) {
    if (!cooperation) return
    setActionLoading(true)
    setActionError(null)
    try {
      const res = await apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestone.id}/pay-direct`, { method: 'POST' })
      const data = await res.json()
      if (data.rail === 'CASHU') {
        setDirectPay({ milestone, rail: 'CASHU', cashu: data.cashu, message, approveAfter })
        return
      }
      const { invoice, paymentHash } = data
      const payResult = await payInvoice({ invoice, paymentHash })
      if (payResult.ok && payResult.preimage) {
        await confirmDirectPayment(milestone, payResult.preimage, message, approveAfter)
        return
      }
      if (payResult.ok || payResult.mode === 'MANUAL') {
        // Paid without a returned preimage, or no wallet to auto-pay: show the
        // invoice and let the user paste the proof.
        setDirectPay({ milestone, rail: 'LN', invoice, message, approveAfter })
        return
      }
      setActionError(payResult.error || 'Payment failed')
    } catch (err: any) {
      setActionError(err?.message || 'Failed to pay milestone')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDirectPayProof() {
    if (!directPay || !directPreimage.trim()) return
    setActionLoading(true)
    setActionError(null)
    try {
      await confirmDirectPayment(directPay.milestone, directPreimage.trim(), directPay.message, directPay.approveAfter)
      setDirectPay(null)
      setDirectPreimage('')
    } catch (err: any) {
      setActionError(err?.message || 'Could not confirm the payment')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleCreateCashuToken() {
    if (!directPay?.cashu || !cooperation) return
    setActionLoading(true)
    setActionError(null)
    try {
      const token = await cashuWallet.sendP2PKForCheckout(directPay.cashu.pubkey, directPay.cashu.mintUrl, directPay.milestone.amountSats)
      await apiCall(`/api/cooperations/${cooperation.id}/milestones/${directPay.milestone.id}/cashu-token`, {
        method: 'POST', body: JSON.stringify({ token }),
      })
      setDirectPay({ ...directPay, token })
      queryClient.invalidateQueries({ queryKey: ['entity', id] })
      if (directPay.approveAfter) await approveMilestone(directPay.milestone, directPay.message, true)
    } catch (err: any) {
      setActionError(err?.message || 'Failed to create the eCash token')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleConfirmReceived(milestone: CoopMilestone) {
    if (!cooperation) return
    setActionLoading(true)
    setActionError(null)
    try {
      await apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestone.id}/confirm-received`, { method: 'POST' })
      showSnackbar(`Payment confirmed: ${milestone.title}`, 'success')
      queryClient.invalidateQueries({ queryKey: ['entity', id] })
    } catch (err: any) {
      setActionError(err?.message || 'Could not confirm receipt')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleMilestoneReleasePayment(milestone: CoopMilestone, message?: string, opts?: { skipPayment?: boolean }) {
    if (!cooperation) return
    if (!coopEscrowEnabled) {
      if (opts?.skipPayment || milestone.paidAt) {
        setActionLoading(true)
        setActionError(null)
        try { await approveMilestone(milestone, message, Boolean(milestone.paidAt)) }
        catch (err: any) { setActionError(err?.message || 'Failed to approve milestone') }
        finally { setActionLoading(false) }
        return
      }
      return handleMilestoneDirectPay(milestone, message, true)
    }
    setActionLoading(true)
    setActionError(null)
    try {
      const invoiceRes = await apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestone.id}/release-payment`, { method: 'POST' })
      if (!invoiceRes.ok) {
        const data = await invoiceRes.json()
        // ADR-255 D4: prefer the server's human-readable message (e.g. for
        // COOP_ESCROW_DISABLED) over the raw error code.
        setActionError(data.message || data.error || 'Failed to create release invoice')
        setActionLoading(false)
        return
      }
      const { invoice: _milestoneInvoice, paymentHash } = await invoiceRes.json()

      const payResult = await payInvoice({ invoice: _milestoneInvoice, paymentHash })
      if (!payResult.ok) {
        setActionError(
          payResult.mode === 'WEBLN' && payResult.error === 'Payment rejected by wallet.'
            ? 'Payment rejected by wallet. Milestone was not released.'
            : (payResult.error || 'Failed to release milestone payment'),
        )
        setActionLoading(false)
        return
      }

      const paid = await pollUntilPaid(paymentHash)
      if (paid) {
        await apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestone.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ACCEPTED', performerPubkey: pubkey, message: message || undefined }),
        })
        showSnackbar(`Milestone approved & payment released: ${milestone.title}`, 'success')
        queryClient.invalidateQueries({ queryKey: ['entity', id] })
        setActionLoading(false)
        return
      }

      setActionError('Payment sent but confirmation is taking longer than expected. The status will update automatically.')
      setActionLoading(false)
    } catch (err: any) {
      setActionError(err?.message || 'Failed to release milestone payment')
      setActionLoading(false)
    }
  }

  async function submitApplication() {
    if (selectedMilestoneIds.size === 0 || !pubkey || !cooperation) return
    setApplying(true)
    try {
      const promises = [...selectedMilestoneIds].map(milestoneId =>
        apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestoneId}/apply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicantPubkey: pubkey, message: applyMessage || undefined }),
        })
      )
      await Promise.all(promises)
      setApplyDialogOpen(false)
      setSelectedMilestoneIds(new Set())
      setApplyMessage('')
      queryClient.invalidateQueries({ queryKey: ['entity', id] })
    } catch { setActionError('Failed to submit application') }
    finally { setApplying(false) }
  }

  async function handleApplicationAccept(milestoneId: string, appId: string) {
    if (!cooperation) return
    setActionLoading(true)
    try {
      const r = await apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestoneId}/applications/${appId}/accept`, { method: 'POST' })
      if (r.ok) { await r.json(); queryClient.invalidateQueries({ queryKey: ['entity', id] }) }
    } catch { setActionError('Failed to accept application') }
    finally { setActionLoading(false) }
  }

  async function handleApplicationDecline(milestoneId: string, appId: string) {
    if (!cooperation) return
    setActionLoading(true)
    try {
      const r = await apiCall(`/api/cooperations/${cooperation.id}/milestones/${milestoneId}/applications/${appId}/decline`, { method: 'POST' })
      if (r.ok) { queryClient.invalidateQueries({ queryKey: ['entity', id] }) }
    } catch { setActionError('Failed to decline application') }
    finally { setActionLoading(false) }
  }

  async function handleSaveCooperationEdit(values: CooperationEditValues) {
    if (!cooperation) return
    setEditSaving(true)
    setEditError(null)
    try {
      const isTender = cooperation.cooperationType === 'TENDER'
      const body: Record<string, unknown> = {
        title: values.title,
        description: values.description,
        budgetSats: parseInt(values.budgetSats) || 0,
      }
      if (isTender) {
        body.deadline = values.deadline || null
        body.requirements = values.requirements
      } else {
        body.timeline = values.timeline
        body.skills = values.skills.split(',').map(s => s.trim()).filter(Boolean)
      }
      const res = await apiCall(`/api/cooperations/${cooperation.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['entity', id] })
        setEditDialogOpen(false)
      } else {
        const data = await res.json()
        setEditError(data.error || 'Failed to save changes')
      }
    } catch {
      setEditError('Network error. Please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleSaveNetworkEdit(values: NetworkEditValues) {
    if (!offer) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await apiCall(`/api/offers/${offer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: values.title,
          description: values.description,
          priceSats: parseInt(values.priceSats) || 0,
          networkType: values.networkType,
          membershipCriteria: values.membershipCriteria,
          maxMembers: values.maxMembers ? parseInt(values.maxMembers) : null,
          creatorPubkey: pubkey,
        }),
      })
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['entity', id] })
        setEditDialogOpen(false)
      } else {
        const data = await res.json()
        setEditError(data.error || 'Failed to save changes')
      }
    } catch {
      setEditError('Network error. Please try again.')
    } finally {
      setEditSaving(false)
    }
  }

  // ADR-212: network membership actions
  async function handleJoinNetwork(message?: string) {
    if (!offer) return
    setMemberActionLoading(true)
    setMemberActionError(null)
    try {
      const res = await apiCall(`/api/offers/${offer.id}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
      })
      if (res.ok) {
        invalidateOfferMembers(queryClient, offer.id)
        setJoinDialogOpen(false)
      } else {
        const data = await res.json()
        setMemberActionError(data.error || 'Failed to join network')
      }
    } catch {
      setMemberActionError('Network error. Please try again.')
    } finally {
      setMemberActionLoading(false)
    }
  }

  async function handleLeaveNetwork() {
    if (!offer) return
    setMemberActionLoading(true)
    setMemberActionError(null)
    try {
      const res = await apiCall(`/api/offers/${offer.id}/leave`, { method: 'POST' })
      if (res.ok) {
        invalidateOfferMembers(queryClient, offer.id)
      } else {
        const data = await res.json()
        setMemberActionError(data.error || 'Failed to leave network')
      }
    } catch {
      setMemberActionError('Network error. Please try again.')
    } finally {
      setMemberActionLoading(false)
    }
  }

  async function handleMemberDecision(memberId: string, decision: 'accept' | 'decline') {
    if (!offer) return
    setMemberActionLoading(true)
    setMemberActionError(null)
    try {
      const res = await apiCall(`/api/offers/${offer.id}/members/${memberId}/${decision}`, { method: 'POST' })
      if (res.ok) {
        invalidateOfferMembers(queryClient, offer.id)
      } else {
        const data = await res.json()
        setMemberActionError(data.error || `Failed to ${decision} request`)
      }
    } catch {
      setMemberActionError('Network error. Please try again.')
    } finally {
      setMemberActionLoading(false)
    }
  }

  // ── Derived state ────────────────────────────────────────────────────────

  const isCooperation = entityType === 'cooperation'
  const isOffer = entityType === 'offer'
  // Escrow wording/visuals only when escrow actually applies (ADR-397 / FU-862):
  // cooperations follow the platform switch, offers their own useEscrow flag.
  const escrowActive = isCooperation ? coopEscrowEnabled : !!offer?.useEscrow

  const title = isCooperation ? cooperation?.title ?? '' : offer?.title ?? ''
  const description = isCooperation ? cooperation?.description ?? '' : offer?.description ?? ''
  const priceSats = isCooperation ? cooperation?.budgetSats ?? 0 : offer?.priceSats ?? 0
  const images = isCooperation ? parseImages(cooperation?.images) : (offer?.images ?? [])
  const hasImages = images.length > 0
  const categoryCode = isCooperation ? cooperation?.categoryCode : offer?.categoryCode
  const category = isCooperation ? cooperation?.categoryCode : offer?.category
  const location = isCooperation ? undefined : offer?.location
  const createdAt = isCooperation ? cooperation?.createdAt : offer?.createdAt
  const effectiveCompany = isCooperation ? cooperation?.company : (offer?.company ?? resolvedCompany)
  const isCorporate = !!(effectiveCompany)
  const isService = isOffer && offer?.offerType === 'SERVICE'
  const isItem = isOffer && offer?.offerType === 'ITEM'
  const isNetworkOffer = isOffer && offer?.offerType === 'COOP'
  const myMembership = offerMembers.find(m => m.pubkey === pubkey)
  const activeMemberCount = offerMembers.filter(m => m.status === 'ACTIVE').length
  // ADR-329 D5: a cooperation is milestone-type iff its stored payment
  // structure says so — SMART_ORDER coops render the fixed 25/50/25 phase box.
  const isMilestone = (isCooperation && cooperation?.ticketType !== 'SMART_ORDER') || (isOffer && offer?.offerType === 'SERVICE')
  const milestones = isCooperation ? (cooperation?.milestones ?? []) : (offer?.offerMilestones ?? [])
  const coopStatus = isCooperation ? cooperation?.status : undefined

  const isInitiator = isCooperation && pubkey === cooperation?.initiatorPubkey
  const isCreator = isOffer && pubkey === offer?.creatorPubkey
  const isOwner = isInitiator || isCreator
  // ADR-386: full-form edit eligibility. Cooperations use the server-derived
  // `canFullEdit`; for COOP networks the public detail endpoint is unauthenticated
  // (and cached), so the owner gate is derived locally from status + members —
  // the PATCH route re-checks server-side before accepting a full edit.
  const canFullEdit = isCooperation
    ? cooperation?.canFullEdit === true
    : isCreator && offer?.status?.toUpperCase() === 'ACTIVE' && offerMembers.length === 0
  // ADR-386 D8: when the user hides page headers via Settings the header — and
  // with it the only owner-action affordance — disappears, so the same actions
  // menu is re-rendered over the hero image.
  const [hidePageHeaders] = usePref('hidePageHeaders', false)
  const [fullEditConfirmOpen, setFullEditConfirmOpen] = useState(false)
  const isPerMilestone = cooperation?.partnerMode === 'PER_MILESTONE'
  const isMilestonePartner = isCooperation && isPerMilestone && pubkey
    ? (cooperation.milestones ?? []).some(m => m.partnerPubkey === pubkey)
    : false
  const isPartner = (isCooperation && pubkey === cooperation?.partnerPubkey) || isMilestonePartner
  const isOpen = coopStatus === 'OPEN'
  const canAccept = isOpen && !isInitiator && !isPerMilestone && (!cooperation?.partnerPubkey || isPartner)
  const canApply = isOpen && !isInitiator && isPerMilestone

  const hasSellerStats = isOffer && offer?.sellerStats && (
    offer.sellerStats.rating !== undefined || offer.sellerStats.completionRate !== undefined
  )

  // Key-value grid data derivations — mirror BuyProductDetail so the Initiator
  // card shows the same Reputation / Earnings / Activity columns. Placed here
  // because they depend on `hasSellerStats` and `effectiveCompany` declared
  // above, and on `sellerProfile` fetched near the top of the component.
  const hasKeyValueData = !!(
    sellerProfile?.reputationScore !== undefined
    || sellerProfile?.reviewCount !== undefined
    || sellerProfile?.colPoints !== undefined
    || sellerProfile?.stats
    || (hasSellerStats && (offer?.sellerStats?.rating !== undefined || offer?.sellerStats?.completionRate !== undefined))
  )
  const ratingValue: string | null = sellerProfile?.reputationScore !== undefined
    ? sellerProfile.reputationScore.toFixed(2)
    : (hasSellerStats && offer?.sellerStats?.rating !== undefined
        ? offer.sellerStats.rating.toFixed(2)
        : null)
  const ratingCount: number | null = sellerProfile?.reputationScore !== undefined
    ? (sellerProfile.reviewCount ?? null)
    : (hasSellerStats && offer?.sellerStats?.rating !== undefined
        ? (offer?.sellerStats?.reviewCount ?? null)
        : null)
  const completionValue: number | null = hasSellerStats && offer?.sellerStats?.completionRate !== undefined
    ? offer.sellerStats.completionRate
    : null
  const hasReputationData = ratingValue !== null || completionValue !== null
  const initiatorDashboardUrl = effectiveCompany?.id
    ? `/buy?companyId=${effectiveCompany.id}`
    : `/buy?sellerPubkey=${initiatorPubkey ?? ''}`

  // Mobile swipe navigation for cooperations — browses the same segment the
  // user selected in the slider (Vendor ↔ Marketplace). Must run before the
  // early returns below.
  // Network offers default to the same-creator 'vendor' segment (mirrors
  // BuyProductDetail); cooperations default to 'all' so the marketplace
  // discovery view is the first impression on entry.
  const [sliderSegment, setSliderSegment] = useState<DetailSliderSegment>(isOffer ? 'vendor' : 'all')

  // Resolve swipe-nav source lists to whichever DetailSliderNav is mounted:
  // cooperations browse `vendorCoopItems`/`allCoopItems`; Network offers
  // (offerType=COOP) browse the offer siblings. Without this branching the
  // Network offer detail page renders its sibling slider but never enables
  // swipe navigation — users can only tap cards, never swipe.
  const swipeVendorItems = isNetworkOffer ? vendorOfferItems : vendorCoopItems
  const swipeAllItems    = isNetworkOffer ? allOfferItems    : allCoopItems
  const swipeActiveId    = isNetworkOffer ? offer?.id        : cooperation?.id
  const swipeContextFilters = isNetworkOffer
    ? { categoryPrefix: offer?.categoryCode?.split('/')[0], country: offer?.country ?? null }
    : cooperation
      ? { categoryPrefix: cooperation.categoryCode?.split('/')[0] }
      : undefined

  const swipeHandlers = useDetailSwipeNav({
    containerRef: swipeRef,
    segment: sliderSegment,
    vendorItems: swipeVendorItems,
    allItems: swipeAllItems,
    contextFilters: swipeContextFilters,
    activeId: swipeActiveId,
    toRoute: toCoopDetailRoute,
    enabled: isCooperation || isNetworkOffer,
    onSwipeNavigate: notifySwipeHintDismissed,
  })

  // Drive the one-time mobile swipe hint: show only when the user can actually
  // swipe to a sibling. Covers both cooperations AND Network Items — the
  // useDetailSwipeNav hook now browses either entity's list (see above), so the
  // hint has to follow the same branching or Network-Item pages would never
  // teach the gesture.
  const hasCoopSiblings = useMemo(() => {
    if (!isCooperation && !isNetworkOffer) return false
    const list = sliderSegment === 'vendor'
      ? (isNetworkOffer ? vendorOfferItems : vendorCoopItems)
      : (isNetworkOffer ? allOfferItems    : allCoopItems)
    return list.length > 1
  }, [isCooperation, isNetworkOffer, sliderSegment, vendorCoopItems, allCoopItems, vendorOfferItems, allOfferItems])

  // ── Loading / Error ──────────────────────────────────────────────────────
  // ADR-188: useEntity uses placeholderData: keepPreviousData, so on sibling
  // navigation `loading` flips back to true but `entityData` still holds the
  // previous entity. Render the page with the previous data instead of
  // unmounting into a spinner (which would also wipe the slider + header).

  if (queryError && !entityData) {
    return (
      <NotFoundState
        title="Not found"
        message="This cooperation or offer may have been removed, or the link is incorrect."
        detail={id ? `ID ${id}` : undefined}
        primary={{ label: 'Back to cooperate', to: '/coop' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  if (!entityData) {
    return (
      <PageContainer size="wide" spacing="none">
        <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '60vh' }}>
          <Stack alignItems="center" spacing={1}>
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary">Loading...</Typography>
          </Stack>
        </Stack>
      </PageContainer>
    )
  }

  // entityData resolved but it is neither a cooperation nor an offer (e.g. a
  // miscategorized id or a future entity type) — show the not-found state
  // instead of rendering an empty, broken page.
  if (!cooperation && !offer) {
    return (
      <NotFoundState
        title="Not found"
        message="This cooperation or offer may have been removed, or the link is incorrect."
        detail={id ? `ID ${id}` : undefined}
        primary={{ label: 'Back to cooperate', to: '/coop' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  // ADR-386 D8: owner actions menu, shared by the visible page header and the
  // hero overlay that replaces it when `hidePageHeaders` is on. `overlay`
  // renders a high-contrast variant so it stays legible on top of an image.
  function renderOwnerActions(variant: 'header' | 'overlay' = 'header') {
    const menuItems: Array<{ key: string; label: string; icon: React.ReactNode; color?: string; divider?: boolean }> = []

    if (isOffer && isCreator) {
      const s = offer?.status?.toUpperCase() ?? 'DRAFT'
      menuItems.push(
        { key: 'view', label: 'View', icon: <Eye size={16} /> },
        { key: 'edit', label: 'Edit', icon: <Pencil size={16} /> },
      )
      if (s === 'DRAFT') menuItems.push({ key: 'publish', label: 'Publish', icon: <Play size={16} />, color: 'success.main' })
      if (s === 'ACTIVE') menuItems.push({ key: 'archive', label: 'Archive', icon: <Archive size={16} />, color: 'text.secondary' })
      menuItems.push({ key: 'delete', label: 'Delete', icon: <Trash2 size={16} />, color: 'error.main', divider: true })
    } else if (isCooperation && isInitiator) {
      const status = coopStatus?.toUpperCase() ?? ''
      const isDraft = status === 'DRAFT'
      const isOpen = status === 'OPEN'
      const isActive = ['ACCEPTED', 'PAID', 'IN_PROGRESS'].includes(status)
      // Editing is only safe before a partner is engaged — budget/timeline
      // changes after ACCEPTED/PAID/IN_PROGRESS could invalidate terms the
      // partner already committed to.
      if (isDraft || isOpen) menuItems.push({ key: 'edit', label: 'Edit', icon: <Pencil size={16} /> })
      if (isDraft) menuItems.push({ key: 'publish', label: 'Publish', icon: <Play size={16} />, color: 'success.main' })
      if (isOpen || isActive) menuItems.push({ key: 'cancel', label: 'Cancel', icon: <Archive size={16} />, color: 'text.secondary' })
      if (isDraft) menuItems.push({ key: 'delete', label: 'Cancel & Remove', icon: <Trash2 size={16} />, color: 'error.main', divider: menuItems.length > 0 })
    }

    if (menuItems.length === 0) return undefined
    const overlay = variant === 'overlay'
    return (
      <div className="flex items-center justify-end gap-2 min-w-0" style={{ marginLeft: 'auto' }}>
        <button
          onClick={(e) => { e.stopPropagation(); setHeaderMenuAnchor(e.currentTarget) }}
          className="flex items-center justify-center transition-colors duration-150 rounded-lg cursor-pointer"
          style={{
            width: 36, height: 36,
            background: overlay ? 'rgba(0,0,0,0.55)' : 'var(--theme-bg-subtle)',
            border: overlay ? '1px solid rgba(255,255,255,0.28)' : '1px solid var(--theme-border)',
            color: overlay ? 'white' : 'var(--theme-text-muted)',
            backdropFilter: overlay ? 'blur(4px)' : undefined,
          }}
          aria-label="Actions"
        >
          <MoreVertical size={16} strokeWidth={2.5} />
        </button>
        <Menu
          anchorEl={headerMenuAnchor}
          open={Boolean(headerMenuAnchor)}
          onClose={() => setHeaderMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 160 } } }}
        >
          {menuItems.flatMap((a, idx) => [
            ...(a.divider && idx > 0 ? [<MuiDivider key={`d-${a.key}`} />] : []),
            <MenuItem
              key={a.key}
              onClick={() => {
                setHeaderMenuAnchor(null)
                if (a.key === 'publish' && isCooperation) handleStatusUpdate('OPEN')
                else if (a.key === 'publish' && isOffer) {
                  apiCall(`/api/offers/${offer!.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE', creatorPubkey: pubkey }) }).then(() => queryClient.invalidateQueries({ queryKey: ['entity', id] })).catch(console.error)
                }
                else if (a.key === 'cancel') handleCancel()
                else if (a.key === 'archive' && isOffer) {
                  apiCall(`/api/offers/${offer!.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ARCHIVED', creatorPubkey: pubkey }) }).then(() => queryClient.invalidateQueries({ queryKey: ['entity', id] })).catch(console.error)
                }
                else if (a.key === 'delete') setDeleteConfirmOpen(true)
                // ADR-386: an unengaged published entity edits through the full form.
                else if (a.key === 'edit' && canFullEdit && ((isCooperation) || (isOffer && offer?.offerType === 'COOP'))) setFullEditConfirmOpen(true)
                else if (a.key === 'edit' && isOffer && offer?.offerType === 'COOP') {
                  setEditError(null)
                  setEditDialogOpen(true)
                }
                else if (a.key === 'edit' && isOffer) navigate(`/sell/listings/${offer!.id}`)
                else if (a.key === 'edit' && isCooperation) {
                  setEditError(null)
                  setEditDialogOpen(true)
                }
                else if (a.key === 'view' && isOffer) navigate(`/buy/product/${offer!.id}`)
              }}
              sx={a.color ? { color: a.color } : undefined}
            >
              <ListItemIcon sx={a.color ? { color: a.color } : undefined}>{a.icon}</ListItemIcon>
              <ListItemText>{a.label}</ListItemText>
            </MenuItem>,
          ])}
        </Menu>
      </div>
    )
  }

  if (offer?.source === 'REMOTE') {
    return <Navigate to={`/buy/product/${offer.id}`} replace />
  }

  return (
    <PageContainer size="wide" spacing="none" className="page-animate" ref={pageRef}>
      <PageHeader
        icon={isService ? <WorkIcon /> : isCooperation ? <HandshakeIcon /> : <Inventory2Icon />}
        title={title}
        subtitle={categoryCode ? formatCategoryCode(categoryCode) : undefined}
        onBack={() => {
          if (window.history.length <= 1 || navigationType === 'POP') {
            navigate('/coop/manage?tab=cooperations', { replace: true })
          } else {
            navigate(-1)
          }
        }}
        actions={isOwner ? renderOwnerActions() : undefined}
        actionsFit="inline"
      />

      {error && <Alert severity="error" onClose={() => setActionError(null)} sx={{ mb: 2 }}>{error}</Alert>}

      {/* Mobile swipe-to-next wrapper — horizontal swipe navigates to the
          next/previous cooperation (see useDetailSwipeNav). Wraps gallery +
          content so the whole detail body slides; the PageHeader stays put. */}
      <div ref={swipeRef} {...swipeHandlers}>
      {/* ── Image Gallery ──────────────────────────────────────────────────── */}
      {hasImages && (
        <Box sx={{ position: 'relative', mb: { xs: 3, md: 4 } }} className="hero-animate">
          {isOffer && (
            <Tooltip title={isFavorite(offer!.id) ? 'Remove from favorites' : 'Add to favorites'} arrow>
              <Box component="button" onClick={() => toggleFavorite(offer!.id)} sx={{ position: 'absolute', top: 12, right: 12, zIndex: 2, width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: isFavorite(offer!.id) ? '#E84541' : 'rgba(0,0,0,0.45)', color: 'white', backdropFilter: 'blur(4px)', border: 'none', cursor: 'pointer', transition: 'all 0.2s ease', '&:hover': { backgroundColor: isFavorite(offer!.id) ? '#d63031' : 'rgba(0,0,0,0.6)', transform: 'scale(1.1)' } }}>
                <FavoriteIcon sx={{ fontSize: 18 }} />
              </Box>
            </Tooltip>
          )}
          <DetailImageGallery images={images} title={title} />
          {/* ADR-386 D8: when the user hides page headers the owner actions move
              onto the hero as a high-contrast icon button. Offset to the left of
              the favorite button when the offer already owns the top-right. */}
          {isOwner && hidePageHeaders && (
            <div style={{ position: 'absolute', top: 12, right: isOffer ? 56 : 12, zIndex: 3 }}>
              {renderOwnerActions('overlay')}
            </div>
          )}
        </Box>
      )}

      {/* ADR-386 D8: no hero image — surface the owner actions as a right-aligned row. */}
      {isOwner && hidePageHeaders && !hasImages && (
        <div className="flex items-center justify-end" style={{ marginBottom: 12 }}>
          {renderOwnerActions('overlay')}
        </div>
      )}

      <Grid container spacing={{ xs: 3, lg: 4 }}>
        {/* ── Left Column ─────────────────────────────────────────────────── */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} ref={detailsRef}>

            {/* Meta Chips */}
            <Box className="section-animate">
              <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                {category && (
                  <Chip label={category} size="small" color="primary" variant="outlined" sx={{ fontWeight: 600, height: 22, fontSize: '0.7rem' }} />
                )}
                {isCooperation && cooperation?.cooperationType && (
                  <Chip label={cooperation.cooperationType} size="small" variant="outlined" sx={{ fontWeight: 700, height: 22, fontSize: '0.65rem', borderColor: 'rgba(99,179,237,0.5)', color: 'var(--color-primary-50)', bgcolor: 'rgba(99,179,237,0.08)' }} />
                )}
                {isCooperation && coopStatus && (
                  <Chip label={coopStatus.replace(/_/g, ' ')} size="small" sx={{ fontWeight: 700, height: 22, fontSize: '0.65rem', bgcolor: statusBg(coopStatus), color: statusColor(coopStatus), border: 'none' }} />
                )}
                {isCooperation && (isInitiator || isPartner) && (
                  <Chip
                    label={isInitiator ? 'Initiator' : 'Partner'}
                    size="small"
                    sx={{
                      fontWeight: 700, height: 22, fontSize: '0.65rem',
                      background: isInitiator ? 'rgba(99,179,237,0.15)' : 'rgba(72,187,120,0.15)',
                      color: isInitiator ? 'var(--color-primary-50)' : 'var(--color-status-success)',
                    }}
                  />
                )}
                {isOffer && (
                  <Chip label={isNetworkOffer ? 'Network' : isService ? 'Service' : isItem ? 'Item' : 'Product'} size="small" variant="outlined" sx={{ fontWeight: 700, height: 22, fontSize: '0.65rem', borderColor: isNetworkOffer ? 'rgba(255,192,57,0.5)' : isService ? 'rgba(99,179,237,0.5)' : 'rgba(72,187,120,0.5)', color: isNetworkOffer ? 'var(--color-warning-primary)' : isService ? '#63B3ED' : '#48B978', bgcolor: isNetworkOffer ? 'rgba(255,192,57,0.08)' : isService ? 'rgba(99,179,237,0.08)' : 'rgba(72,187,120,0.08)' }} />
                )}
                {isMilestone && milestones.length > 0 && (
                  <Tooltip title={`Payment split into ${milestones.length} phases`} arrow>
                    <Chip label={`Milestone (${milestones.length})`} size="small" variant="outlined" icon={<Flag size={13} style={{ color: 'var(--color-primary-50)' }} />} sx={{ fontWeight: 700, height: 22, fontSize: '0.65rem', borderColor: 'rgba(99,179,237,0.35)', color: 'var(--color-primary-50)', bgcolor: 'rgba(99,179,237,0.06)', '& .MuiChip-icon': { color: 'var(--color-primary-50)' } }} />
                  </Tooltip>
                )}
                {isCorporate && (
                  <Tooltip title="Offered by a verified business" arrow>
                    <Chip label="Business" size="small" variant="outlined" icon={<StorefrontIcon sx={{ fontSize: '0.85rem !important' }} />} sx={{ fontWeight: 700, height: 22, fontSize: '0.65rem', borderColor: 'rgba(99,179,237,0.5)', color: 'var(--color-primary-50)', bgcolor: 'rgba(99,179,237,0.08)' }} />
                  </Tooltip>
                )}
                <Tooltip title="Publication date" arrow>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'default' }}>
                    <AccessTimeIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
                    <Typography variant="caption" color="text.secondary">{formatLocaleDate(new Date(createdAt ?? ''), { year: 'numeric', month: 'short', day: 'numeric' })}</Typography>
                  </Box>
                </Tooltip>
                {location && (
                  <Tooltip title="Location" arrow>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'default' }}>
                      <PlaceIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
                      <Typography variant="caption" color="text.secondary">{location}</Typography>
                    </Box>
                  </Tooltip>
                )}
                {isCooperation && cooperation?.deadline && (
                  <Tooltip title="Application deadline" arrow>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'default' }}>
                      <Calendar size={13} style={{ color: 'var(--theme-text-disabled)' }} />
                      <Typography variant="caption" color="text.secondary">Deadline: {formatLocaleDate(new Date(cooperation.deadline!), { year: 'numeric', month: 'short', day: 'numeric' })}</Typography>
                    </Box>
                  </Tooltip>
                )}
              </Stack>
            </Box>

            {/* Initiator & Partner Cards */}
            <Grid container spacing={3} className="section-animate">
              {/* Initiator Card — full mirror of the Seller Card on BuyProductDetail
                  (banner background + avatar + NIP-05 + lightning + key-value grid
                  + footer with company storefront link + View Profile CTA). Width is
                  intentionally kept at xl=6 so the card sits side-by-side with the
                  Partner / Potential Partner card. Visibility rules mirror the
                  Seller card so PRIVATE initiators don't leak personal metadata. */}
              <Grid size={{ xs: 12, xl: 6 }}>
                <Box
                  className="section-animate"
                  sx={{
                    position: 'relative',
                    borderRadius: 'var(--radius-lg, 12px)',
                    background: 'var(--theme-surface)',
                    border: '2px solid',
                    borderColor: sellerIdentityLevel === 0 ? 'rgba(158,158,158,0.3)' : sellerIdentityLevel === 1 ? 'rgba(25,118,210,0.3)' : sellerIdentityLevel === 2 ? 'rgba(123,31,162,0.3)' : 'rgba(245,127,23,0.3)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
                    transition: 'box-shadow 0.2s ease, border-color 0.3s ease',
                    overflow: 'hidden',
                    height: '100%',
                    '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.08), 0 6px 16px rgba(0,0,0,0.06)' },
                  }}
                >
                  {/* Banner background layer — same dezenter / blur treatment as
                      the Seller card so light banners don't blow out contrast. */}
                  {sellerProfile?.banner && sellerProfile?.visibility !== 'PRIVATE' && (
                    <Box
                      aria-hidden
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        backgroundImage: `url(${sellerProfile.banner})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        backgroundColor: 'var(--theme-bg-subtle)',
                        filter: 'blur(6px)',
                        transform: 'scale(1.06)',
                        opacity: 0.7,
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          inset: 0,
                          background: 'var(--theme-surface)',
                          opacity: 0.55,
                        },
                        '&::after': {
                          content: '""',
                          position: 'absolute',
                          inset: 0,
                          background: 'linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 22%, transparent 45%, var(--theme-surface) 100%)',
                        },
                      }}
                    />
                  )}

                  {/* Content layer — sits on top of the banner background */}
                  <Box sx={{ position: 'relative', zIndex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: { xs: 2.5, sm: 3 }, pt: { xs: 2.5, sm: 3 }, pb: 1.5 }}>
                      {isCooperation
                        ? <HandshakeIcon fontSize="small" sx={{ color: sellerIdentityLevel === 0 ? '#9e9e9e' : sellerIdentityLevel === 1 ? '#1976d2' : sellerIdentityLevel === 2 ? '#7b1fa2' : '#f57f17' }} />
                        : <StorefrontIcon fontSize="small" sx={{ color: sellerIdentityLevel === 0 ? '#9e9e9e' : sellerIdentityLevel === 1 ? '#1976d2' : sellerIdentityLevel === 2 ? '#7b1fa2' : '#f57f17' }} />}
                      <Typography variant="subtitle2" fontWeight={700} color="text.secondary"
                        sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
                        {isCooperation ? 'Initiator' : 'Seller'}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <IdentityLevelBadge level={sellerIdentityLevel as IdentityLevel} size="small" />
                    </Box>

                    {/* Private profile notice — same policy as UserProfile.tsx */}
                    {sellerProfile?.visibility === 'PRIVATE' ? (
                      <Box sx={{ px: { xs: 2.5, sm: 3 }, pb: { xs: 2.5, sm: 3 }, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <LockIcon sx={{ fontSize: 22, color: 'var(--theme-text-muted)' }} />
                        <Box>
                          <Typography variant="body2" fontWeight={600} color="text.primary">Private Profile</Typography>
                          <Typography variant="caption" color="text.secondary">Only the identity level is visible.</Typography>
                        </Box>
                      </Box>
                    ) : (
                      <Box sx={{ px: { xs: 2.5, sm: 3 }, pb: { xs: 2.5, sm: 3 } }}>
                        {/* Slim header — Nostr avatar + name + NIP-05 + lightning on one row */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Box sx={{
                            position: 'relative',
                            width: { xs: 40, sm: 44, md: 48, lg: 56, xl: 64 },
                            height: { xs: 40, sm: 44, md: 48, lg: 56, xl: 64 },
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            overflow: 'hidden',
                            background: 'var(--color-primary-10)',
                            color: 'var(--color-primary-50)',
                            border: '2px solid var(--theme-surface)',
                            fontSize: { xs: '1rem', lg: '1.2rem' },
                            fontWeight: 800,
                          }}>
                            {(
                              sellerProfile?.picture
                                ? <Box component="img" src={sellerProfile.picture} alt={sellerProfile.name || ''}
                                    sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                                    onError={(e: React.SyntheticEvent<HTMLImageElement>) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                                : null
                            )}
                            {(sellerProfile?.name || sellerProfile?.lnAddress || (initiatorPubkey ?? '')).charAt(0).toUpperCase() || <PersonIcon sx={{ fontSize: { xs: 22, lg: 28 } }} />}
                          </Box>

                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body1" fontWeight={700} sx={{
                              color: 'var(--theme-text)',
                              fontSize: { xs: 15, sm: 16, md: 17, lg: 18 },
                              lineHeight: 1.2,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                            }}>
                              {sellerProfile?.name
                                || sellerProfile?.lnAddress
                                || effectiveCompany?.name
                                || (initiatorPubkey ?? '').slice(0, 12) + '…'}
                            </Typography>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, lg: 1.5 }, mt: 0.25, flexWrap: 'wrap' }}>
                              {sellerProfile?.nip05 && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                  <CheckCircleOutlineIcon sx={{ fontSize: { xs: 13, lg: 16 }, color: 'var(--color-status-success)', flexShrink: 0 }} />
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', lg: '0.85rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {sellerProfile.nip05}
                                  </Typography>
                                </Box>
                              )}
                              {sellerProfile?.lnAddress && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                  <BoltIcon sx={{ fontSize: { xs: 13, lg: 16 }, color: 'var(--color-primary-50)', flexShrink: 0 }} />
                                  <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--theme-text-muted)', fontSize: { xs: '0.75rem', lg: '0.85rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {sellerProfile.lnAddress}
                                  </Typography>
                                </Box>
                              )}
                              {!sellerProfile?.nip05 && !sellerProfile?.lnAddress && (
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', lg: '0.85rem' } }}>{isCooperation ? 'Cooperation initiator' : 'New seller'}</Typography>
                              )}
                            </Box>
                          </Box>
                        </Box>

                        {/* Key-value grid — Reputation / Earnings / Activity, same
                            layout as the Seller card. Inlined because KeyValueColumn
                            / KeyValueCell are private to BuyProductDetail.tsx. */}
                        {hasKeyValueData && (
                          <Box sx={{
                            display: 'grid',
                            gridTemplateColumns: {
                              xs: '1fr',
                              md: 'repeat(2, 1fr)',
                              lg: 'repeat(3, 1fr)',
                            },
                            gap: { xs: 2, md: 2.5, lg: 3 },
                            rowGap: { xs: 2.5, md: 2.5, lg: 2.5 },
                            mt: { xs: 2, lg: 2.5 },
                            pt: { xs: 2, lg: 2.5 },
                            borderTop: '1px solid var(--theme-border)',
                          }}>
                            {hasReputationData && (
                              <Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                                  <ShieldIcon sx={{ fontSize: { xs: 14, md: 15, lg: 18 }, color: 'var(--color-primary-50)' }} />
                                  <Typography variant="caption" fontWeight={700} color="text.secondary"
                                    sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.7rem' }}>
                                    Reputation
                                  </Typography>
                                </Box>
                                <Stack spacing={0.75}>
                                  {ratingValue && (
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70, fontSize: '0.75rem' }}>Rating</Typography>
                                      <Typography variant="body2" fontWeight={700} color="text.primary">
                                        {ratingValue}
                                        {ratingCount !== null && (
                                          <Box component="span" sx={{ color: 'var(--theme-text-muted)', fontWeight: 500, ml: 0.5, fontSize: '0.85em' }}>
                                            ({ratingCount} {ratingCount === 1 ? 'review' : 'reviews'})
                                          </Box>
                                        )}
                                      </Typography>
                                    </Box>
                                  )}
                                  {completionValue !== null && (
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70, fontSize: '0.75rem' }}>Completion</Typography>
                                      <Typography variant="body2" fontWeight={700} sx={{ color: 'success.main' }}>
                                        {completionValue}%
                                      </Typography>
                                    </Box>
                                  )}
                                </Stack>
                              </Box>
                            )}

                            {sellerProfile?.colPoints !== undefined && (
                              <Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                                  <EmojiEventsIcon sx={{ fontSize: { xs: 14, md: 15, lg: 18 }, color: 'var(--color-primary-50)' }} />
                                  <Typography variant="caption" fontWeight={700} color="text.secondary"
                                    sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.7rem' }}>
                                    Earnings
                                  </Typography>
                                </Box>
                                <Stack spacing={0.75}>
                                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70, fontSize: '0.75rem' }}>COL-Points</Typography>
                                    <Typography variant="body2" fontWeight={700} color="text.primary">
                                      {formatNumber(sellerProfile.colPoints)}
                                      <Box component="span" sx={{ color: 'var(--theme-text-muted)', fontWeight: 500, ml: 0.5, fontSize: '0.85em' }}>pts</Box>
                                    </Typography>
                                  </Box>
                                </Stack>
                              </Box>
                            )}

                            {sellerProfile?.stats && (
                              <Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                                  <TrendingUp size={14} style={{ width: '100%', height: '100%', maxWidth: 18, maxHeight: 18, color: 'var(--color-primary-50)' }} />
                                  <Typography variant="caption" fontWeight={700} color="text.secondary"
                                    sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.7rem' }}>
                                    Activity
                                  </Typography>
                                </Box>
                                <Box sx={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                                  columnGap: { xs: 1, md: 1.5, lg: 2 },
                                  rowGap: { xs: 1, lg: 1.25 },
                                }}>
                                  <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>Offers</Typography>
                                    <Typography variant="body2" fontWeight={700} color="text.primary">{sellerProfile.stats.offersCreated}</Typography>
                                  </Box>
                                  <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>Completed</Typography>
                                    <Typography variant="body2" fontWeight={700} color="text.primary">{sellerProfile.stats.completedTickets}</Typography>
                                  </Box>
                                  <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>As Buyer</Typography>
                                    <Typography variant="body2" fontWeight={700} color="text.primary">{sellerProfile.stats.completedAsBuyer}</Typography>
                                  </Box>
                                  <Box>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>As Seller</Typography>
                                    <Typography variant="body2" fontWeight={700} color="text.primary">{sellerProfile.stats.completedAsSeller}</Typography>
                                  </Box>
                                </Box>
                              </Box>
                            )}
                          </Box>
                        )}

                        {/* About (Nostr Kind 0 bio) — clamped to 2 lines */}
                        {sellerProfile?.about && (
                          <Typography
                            color="text.secondary"
                            sx={{
                              display: '-webkit-box',
                              mt: { xs: 1.5, lg: 2 },
                              lineHeight: 1.5,
                              fontSize: { xs: '0.75rem', lg: '0.9rem' },
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {sellerProfile.about}
                          </Typography>
                        )}

                        {/* Footer — company storefront link (left) + View Profile CTA (right) */}
                        <Box sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 1.5,
                          mt: 1.5,
                          pt: 1.5,
                          borderTop: '1px solid var(--theme-border)',
                          flexWrap: 'wrap',
                        }}>
                          {sellerProfile?.company ? (
                            <Link to={`/buy/vendors/${initiatorPubkey ?? ''}`} style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, minWidth: 0 }}>
                                <Box sx={{
                                  width: 24, height: 24, borderRadius: 'var(--radius-sm, 6px)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: 'var(--color-primary-10)', color: 'var(--color-primary-50)',
                                  flexShrink: 0, overflow: 'hidden',
                                }}>
                                  {sellerProfile.company.logoUrl
                                    ? <Box component="img" src={sellerProfile.company.logoUrl} alt={sellerProfile.company.name} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : <StorefrontIcon sx={{ fontSize: 14 }} />}
                                </Box>
                                <Typography variant="caption" fontWeight={600} sx={{ color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {sellerProfile.company.name}
                                </Typography>
                                <ArrowRightIcon sx={{ fontSize: 14, color: 'var(--theme-text-muted)', flexShrink: 0 }} />
                              </Box>
                            </Link>
                          ) : initiatorDashboardUrl && (
                            <Link to={initiatorDashboardUrl} style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, minWidth: 0 }}>
                                <Box sx={{
                                  width: 24, height: 24, borderRadius: 'var(--radius-sm, 6px)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  background: 'var(--color-primary-10)', color: 'var(--color-primary-50)',
                                  flexShrink: 0, overflow: 'hidden',
                                }}>
                                  {effectiveCompany?.logoUrl
                                    ? <Box component="img" src={effectiveCompany.logoUrl} alt={effectiveCompany.name} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : <StorefrontIcon sx={{ fontSize: 14 }} />}
                                </Box>
                                <Typography variant="caption" fontWeight={600} sx={{ color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {effectiveCompany?.name || 'Storefront'}
                                </Typography>
                                <ArrowRightIcon sx={{ fontSize: 14, color: 'var(--theme-text-muted)', flexShrink: 0 }} />
                              </Box>
                            </Link>
                          )}

                          <UserLink
                            pubkey={initiatorPubkey ?? ''}
                            name="View Profile"
                            identityLevel={sellerIdentityLevel as IdentityLevel}
                            showBadge
                            size="small"
                          />
                        </Box>
                      </Box>
                    )}
                  </Box>
                </Box>
              </Grid>

              {isCooperation && cooperation?.partnerPubkey ? (
                <Grid size={{ xs: 12, xl: 6 }}>
                  <Box sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 'var(--radius-lg, 12px)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)', height: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <HandshakeIcon fontSize="small" sx={{ color: 'var(--theme-text-muted)' }} />
                      <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
                        Partner
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <UserLink pubkey={cooperation.partnerPubkey} name="View Profile" identityLevel={partnerIdentityLevel as IdentityLevel} showBadge size="small" />
                      <IdentityLevelBadge level={partnerIdentityLevel as IdentityLevel} size="small" />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 1.5, borderRadius: 'var(--radius-md, 8px)', transition: 'background 0.2s ease', cursor: 'default' }}>
                      {cooperation.partner?.logoUrl && (
                        <Box sx={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', border: '2px solid var(--theme-border)' }}>
                          <Box component="img" src={cooperation.partner.logoUrl} alt={cooperation.partner.name} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </Box>
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          {!cooperation.partner?.logoUrl && (
                            <HandshakeIcon sx={{ fontSize: 20, color: 'var(--color-status-success)', flexShrink: 0 }} />
                          )}
                          <Typography variant="body1" fontWeight={700} sx={{ color: 'var(--theme-text)', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {cooperation.partner?.name || cooperation.partnerPubkey.slice(0, 16)}
                          </Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary">Cooperation partner</Typography>
                      </Box>
                    </Box>
                  </Box>
                </Grid>
              ) : isCooperation && (
                <Grid size={{ xs: 12, xl: 6 }}>
                  <Box sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 'var(--radius-lg, 12px)', background: 'rgba(99,179,237,0.04)', border: '1px dashed rgba(99,179,237,0.35)', height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <InfoOutlinedIcon fontSize="small" sx={{ color: 'var(--color-primary-50)' }} />
                      <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
                        Potential Partner
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7 }}>
                      {cooperation?.partnerMode === 'PER_MILESTONE'
                        ? 'Partners can apply per milestone. The initiator will review and select the best fit for each phase.'
                        : 'This cooperation is open. A single partner can accept and collaborate on the full project.'}
                    </Typography>
                    {cooperation?.skills && (
                      <Box>
                        <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.5 }}>Skills sought</Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {(typeof cooperation.skills === 'string' ? cooperation.skills.split(',') : Array.isArray(cooperation.skills) ? cooperation.skills : [])
                            .map((s: string) => String(s).trim()).filter(Boolean).map((skill: string) => (
                              <Chip key={skill} label={skill} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20, borderColor: 'rgba(99,179,237,0.4)', color: 'var(--color-primary-50)' }} />
                            ))}
                        </Box>
                      </Box>
                    )}
                    {cooperation?.requirements && (
                      <Box>
                        <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" sx={{ mb: 0.5 }}>Requirements</Typography>
                        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.6, display: 'block' }}>{cooperation.requirements}</Typography>
                      </Box>
                    )}
                    {cooperation?.timeline && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Calendar size={13} style={{ color: 'var(--theme-text-disabled)', flexShrink: 0 }} />
                        <Typography variant="caption" color="text.secondary">Timeline: <strong>{cooperation.timeline}</strong></Typography>
                      </Box>
                    )}
                    <Box sx={{ mt: 'auto', pt: 0.5 }}>
                      <Chip
                        label="Open for applications"
                        size="small"
                        icon={<CheckCircleIcon sx={{ fontSize: '0.85rem !important', color: 'var(--color-status-success) !important' }} />}
                        sx={{ fontSize: '0.65rem', height: 22, fontWeight: 600, bgcolor: 'rgba(72,187,120,0.10)', border: '1px solid rgba(72,187,120,0.30)', color: 'var(--color-status-success)' }}
                      />
                    </Box>
                  </Box>
                </Grid>
              )}
            </Grid>

            {/* Details Section */}
            <Box className="section-animate" sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 'var(--radius-lg, 12px)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <LocalOfferIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
                <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>Details</Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                {categoryCode && (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}><LocalOfferIcon sx={{ fontSize: 17, color: 'text.disabled' }} /></Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Category</Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>{formatCategoryCode(categoryCode)}</Typography>
                    </Box>
                    <Divider sx={{ my: 1.25 }} />
                  </>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    {isService ? <WorkIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                      : isCooperation ? <HandshakeIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                      : <Inventory2Icon sx={{ fontSize: 17, color: 'text.disabled' }} />}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Type</Typography>
                  <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>
                    {isCooperation ? (cooperation?.cooperationType || 'Cooperation') : isNetworkOffer ? 'Network' : isService ? 'Service' : isItem ? 'Item' : 'Product'}
                  </Typography>
                </Box>
                {isCooperation && coopStatus && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                        {coopStatus === 'COMPLETED' || coopStatus === 'ACCEPTED'
                          ? <CheckCircleIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                          : <AccessTimeIcon sx={{ fontSize: 17, color: 'text.disabled' }} />}
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Status</Typography>
                      <Typography variant="body2" fontWeight={700} sx={{ color: statusColor(coopStatus) }}>
                        {coopStatus.replace(/_/g, ' ')}
                      </Typography>
                    </Box>
                  </>
                )}
                {isCooperation && cooperation?.partnerMode && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                        <HandshakeIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Partner Mode</Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>
                        {cooperation.partnerMode === 'PER_MILESTONE' ? 'Per Milestone' : 'Single Partner'}
                      </Typography>
                    </Box>
                  </>
                )}
                {isCorporate && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}><StorefrontIcon sx={{ fontSize: 17, color: 'text.disabled' }} /></Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Seller Type</Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>Business{effectiveCompany ? ` — ${effectiveCompany.name}` : ''}</Typography>
                    </Box>
                  </>
                )}
                <Divider sx={{ my: 1.25 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}><BoltIcon sx={{ fontSize: 17, color: 'text.disabled' }} /></Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Payment</Typography>
                  <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>
                    {isMilestone ? `Milestone (${milestones.length} phases)` : escrowActive ? 'Smart Order (Escrow)' : 'Smart Order (direct payment)'}
                  </Typography>
                </Box>
                {location && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}><PlaceIcon sx={{ fontSize: 17, color: 'text.disabled' }} /></Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Location</Typography>
                      <Typography variant="body2" fontWeight={600}>{location}</Typography>
                    </Box>
                  </>
                )}
                {isCooperation && cooperation?.timeline && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}><Calendar size={17} style={{ color: 'var(--theme-text-disabled)' }} /></Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Timeline</Typography>
                      <Typography variant="body2" fontWeight={600}>{cooperation.timeline}</Typography>
                    </Box>
                  </>
                )}
                {isCooperation && cooperation?.skills && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0, mt: 0.25 }}><Tag size={17} style={{ color: 'var(--theme-text-disabled)' }} /></Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0, display: 'block', mb: 0.25 }}>Skills</Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {(typeof cooperation.skills === 'string' ? cooperation.skills.split(',') : Array.isArray(cooperation.skills) ? cooperation.skills : []).map((s: string) => String(s).trim()).filter(Boolean).map((skill: string) => (
                            <Chip key={skill} label={skill} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                          ))}
                        </Box>
                      </Box>
                    </Box>
                  </>
                )}
                {isOffer && offer?.offerType === 'COOP' && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}><Users size={17} style={{ color: 'var(--theme-text-disabled)' }} /></Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Membership</Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>
                        {offer.networkType === 'closed' ? 'Closed (approval required)' : 'Open'}
                        {offer.maxMembers ? ` — max ${offer.maxMembers} members` : ''}
                      </Typography>
                    </Box>
                    {offer.membershipCriteria && (
                      <>
                        <Divider sx={{ my: 1.25 }} />
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                          <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0, mt: 0.25 }}><Tag size={17} style={{ color: 'var(--theme-text-disabled)' }} /></Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>Criteria</Typography>
                            <Typography variant="body2" sx={{ color: 'var(--theme-text)', lineHeight: 1.6 }}>{offer.membershipCriteria}</Typography>
                          </Box>
                        </Box>
                      </>
                    )}
                  </>
                )}
                <Divider sx={{ my: 1.25 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}><AccessTimeIcon sx={{ fontSize: 17, color: 'text.disabled' }} /></Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Published</Typography>
                  <Typography variant="body2" fontWeight={600}>{formatLocaleDate(new Date(createdAt ?? ''), { year: 'numeric', month: 'short', day: 'numeric' })}</Typography>
                </Box>
                {isCooperation && cooperation?.deadline && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                        <Calendar size={17} style={{ color: 'var(--theme-text-disabled)' }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Deadline</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {formatLocaleDate(new Date(cooperation.deadline), { year: 'numeric', month: 'short', day: 'numeric' })}
                      </Typography>
                    </Box>
                  </>
                )}
                {isCooperation && (isInitiator || isPartner) && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                        <HandshakeLucide size={17} style={{ color: 'var(--theme-text-disabled)' }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Your Role</Typography>
                      <Chip
                        label={isInitiator ? 'Initiator' : 'Partner'}
                        size="small"
                        sx={{
                          height: 22, fontSize: '0.7rem', fontWeight: 700,
                          background: isInitiator ? 'rgba(99,179,237,0.15)' : 'rgba(72,187,120,0.15)',
                          color: isInitiator ? 'var(--color-primary-50)' : 'var(--color-status-success)',
                        }}
                      />
                    </Box>
                  </>
                )}
                {isCooperation && cooperation?.requirements && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0, mt: 0.25 }}><InfoOutlinedIcon sx={{ fontSize: 17, color: 'text.disabled' }} /></Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0, display: 'block', mb: 0.25 }}>Requirements</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{cooperation.requirements}</Typography>
                      </Box>
                    </Box>
                  </>
                )}
              </Box>
            </Box>

            {/* Description */}
            <Box className="section-animate" sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 'var(--radius-lg, 12px)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <InfoOutlinedIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
                <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>Description</Typography>
              </Box>
              {/* ADR-295: sanitized rich text render (legacy plain-text fallback inside) */}
              <Box className="text-[15px]" sx={{ lineHeight: 1.8, mt: 0.5, color: 'var(--theme-text)' }}>
                <RichText value={description || 'No description provided.'} />
              </Box>
            </Box>

            {/* Milestones — shown for every cooperation regardless of payment
                structure (ADR-329 D3: SMART_ORDER phases are CoopMilestone
                rows driven through the same workflow) and for milestone-type
                offers. */}
            {(isCooperation || isMilestone) && milestones.length > 0 && (
              <Box className="section-animate" sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 'var(--radius-lg, 12px)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Flag size={16} style={{ color: 'var(--color-primary-50)', flexShrink: 0 }} />
                  <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>Milestones</Typography>
                  <Chip label={`${milestones.length} phases`} size="small" sx={{ fontSize: '0.6rem', height: 18, fontWeight: 700, background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.15)', color: 'var(--color-primary-50)' }} />
                </Box>

                {isCooperation && (
                  <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7, mb: 2.5 }}>
                    {canApply
                      ? 'Apply for individual milestones. The initiator will review and accept the best fit.'
                      : canAccept
                        ? 'Accept this cooperation to begin working on the milestones together.'
                        : isPerMilestone
                          ? 'Partners apply per-milestone. Review applications and accept the best fit.'
                          : 'This project is split into milestones. Payment is distributed per phase.'}
                  </Typography>
                )}

                {/* Progress summary bar */}
                {isCooperation && (
                  <Box sx={{ display: 'flex', gap: 1, mb: 2.5, p: 1.5, borderRadius: 'var(--radius-md, 8px)', background: 'var(--theme-bg-elevated)', border: '1px solid var(--theme-border)' }}>
                    {(milestones as any[]).map((m: any) => (
                      <Tooltip key={m.id} title={`${m.title}: ${formatNumber(m.amountSats ?? 0)} sats`} arrow>
                        <Box sx={{ flex: priceSats > 0 ? (m.amountSats ?? 0) / priceSats : 1 / milestones.length, height: 8, borderRadius: '4px', background: 'rgba(99,179,237,0.25)', border: '1px solid rgba(99,179,237,0.15)', cursor: 'default', position: 'relative', overflow: 'hidden' }}>
                          <Box sx={{ position: 'absolute', inset: 0, borderRadius: '4px', background: m.status === 'COMPLETED' || m.status === 'ACCEPTED' ? 'rgba(72,187,120,0.6)' : `linear-gradient(135deg, rgba(99,179,237,0.4) 0%, rgba(99,179,237,0.6) 100%)` }} />
                        </Box>
                      </Tooltip>
                    ))}
                  </Box>
                )}

                {(milestones as any[]).map((m: any, i: number) => (
                  <MilestoneStep
                    key={m.id}
                    index={i}
                    title={m.title}
                    description={m.description || undefined}
                    amountSats={isCooperation ? m.amountSats : Math.round(priceSats * (m.percentage || 0) / 100)}
                    status={m.status ?? ''}
                    isLast={i === milestones.length - 1}
                    budgetSats={priceSats}
                    messages={m.messages}
                    applications={m.applications}
                    isInitiator={!!isInitiator}
                    isPartner={!!isPartner}
                    actionLoading={actionLoading}
                    onStartWork={() => handleMilestoneAction(m, 'IN_PROGRESS')}
                    onMarkComplete={(message) => handleMilestoneAction(m, 'COMPLETED', message)}
                    onApprove={(message, opts) => handleMilestoneReleasePayment(m, message, opts)}
                    direct={isCooperation && !coopEscrowEnabled}
                    paidAt={m.paidAt}
                    onPayNow={() => handleMilestoneDirectPay(m, undefined, false)}
                    onConfirmReceived={() => handleConfirmReceived(m)}
                    onDecline={(message) => handleMilestoneAction(m, 'IN_PROGRESS', message)}
                    onAcceptApp={(_mid: string, aid: string) => handleApplicationAccept(m.id, aid)}
                    onDeclineApp={(_mid: string, aid: string) => handleApplicationDecline(m.id, aid)}
                  />
                ))}

                <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid var(--theme-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">Total value</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                    <BoltIcon sx={{ fontSize: 14, color: 'var(--color-primary-50)', alignSelf: 'center' }} />
                    <Typography variant="body2" fontWeight={800} sx={{ color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(priceSats)} sats</Typography>
                    <FiatHint sats={priceSats} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                  </Box>
                </Box>
              </Box>
            )}

            {/* Network Members */}
            {isNetworkOffer && offer && (
              <NetworkMembersSection
                members={offerMembers}
                isOwner={isCreator}
                loading={memberActionLoading}
                error={memberActionError}
                onAccept={(memberId) => handleMemberDecision(memberId, 'accept')}
                onDecline={(memberId) => handleMemberDecision(memberId, 'decline')}
              />
            )}

            {/* Chat Section */}
            {isCooperation && cooperation && cooperation.partnerPubkey && (
              <Box className="section-animate" sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 'var(--radius-lg, 12px)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ChatBubbleOutlineIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
                    <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>Chat</Typography>
                  </Box>
                  <Button size="small" variant="outlined" onClick={() => setChatOpen(prev => !prev)} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
                    {chatOpen ? 'Hide' : 'Show'} Chat
                  </Button>
                </Box>
                {chatOpen && (
                  <Box sx={{ mt: 2 }}>
                    <CoopTenderChat
                      tenderId={cooperation.id}
                      initiatorPubkey={cooperation.initiatorPubkey}
                      partnerPubkey={cooperation.partnerPubkey}
                    />
                  </Box>
                )}
              </Box>
            )}

          </Box>
        </Grid>

        {/* ── Right Column: Sticky CTA Panel ────────────────────────────────── */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Box ref={sidebarRef} className="section-animate" sx={{ bgcolor: 'var(--theme-surface)', border: '1px solid var(--theme-border)', borderRadius: 'var(--radius-lg, 12px)', position: { lg: 'sticky' }, top: { lg: 24 }, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)' }}>
            {/* Price hero — hidden for networks with no budget set (priceSats is 0 by default at creation) */}
            {(!isNetworkOffer || priceSats > 0) && (
              <DetailPriceHero sats={priceSats} label={isCooperation ? 'Budget' : 'Price'} />
            )}

            <Box sx={{ p: { xs: 2.5, sm: 3 } }}>
              {/* Escrow / Milestone info — not applicable to networks (no purchase/escrow) */}
              {!isNetworkOffer && (
              <Box sx={{ mb: 2.5 }}>
                {isMilestone ? (
                  <Box sx={{ p: 2, borderRadius: 'var(--radius-md, 8px)', background: 'rgba(99,179,237,0.06)', border: '1px solid rgba(99,179,237,0.15)' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Flag size={16} style={{ color: 'var(--color-primary-50)', flexShrink: 0 }} />
                      <Typography variant="caption" fontWeight={700} sx={{ color: 'var(--color-primary-50)' }}>
                        {isCooperation ? 'Milestone Project' : 'Milestone Service'}
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7 }}>
                      Payment split into {milestones.length} phases. Each milestone is paid individually upon confirmation.
                    </Typography>
                  </Box>
                ) : escrowActive ? (
                  <Tooltip title="Smart Order: Funds are held in escrow and released in three phases" arrow>
                    <Box sx={{ borderRadius: 'var(--radius-md, 8px)', border: '1px solid var(--theme-border)', overflow: 'hidden', background: 'var(--theme-bg-elevated)' }}>
                      {([
                        { label: 'Start', pct: 25, icon: <BoltIcon sx={{ fontSize: 12, color: 'var(--color-primary-50)' }} /> },
                        { label: 'Progress', pct: 50, icon: <TrendingUp size={12} style={{ color: 'var(--color-primary-50)' }} /> },
                        { label: 'Completion', pct: 25, icon: <CheckCircleIcon sx={{ fontSize: 12 }} /> },
                      ]).map((p, i, arr) => (
                        <Box key={p.label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 1.5, py: 1, borderBottom: i < arr.length - 1 ? '1px solid' : 'none', borderColor: 'var(--theme-border)' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Box sx={{ color: 'var(--color-primary-50)', display: 'flex', alignItems: 'center' }}>{p.icon}</Box>
                            <Typography variant="caption" color="text.secondary" fontWeight={500}>{p.label}</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                            <Typography variant="caption" fontWeight={700} sx={{ color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(Math.round(priceSats * p.pct / 100))} sats</Typography>
                            <FiatHint sats={Math.round(priceSats * p.pct / 100)} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Tooltip>
                ) : (
                  <Box sx={{ p: 2, borderRadius: 'var(--radius-md, 8px)', background: 'var(--theme-bg-elevated)', border: '1px solid var(--theme-border)' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <BoltIcon sx={{ fontSize: 16, color: 'var(--color-primary-50)' }} />
                      <Typography variant="caption" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                        Direct payment
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7 }}>
                      You pay your partner directly over Lightning. Colabonate never holds the funds.
                    </Typography>
                  </Box>
                )}

                {!isService && offer?.product && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.5 }}>
                    <Inventory2Icon sx={{ fontSize: 14, color: offer.product.isAvailable && (offer.product.stock ?? 0) > 0 ? 'success.main' : 'error.main' }} />
                    <Typography variant="body2" sx={{ fontSize: 12, color: offer.product.isAvailable && (offer.product.stock ?? 0) > 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                      {offer.product.isAvailable && (offer.product.stock ?? 0) > 0 ? `${offer.product.stock} in stock` : 'Out of stock'}
                    </Typography>
                  </Box>
                )}
              </Box>
              )}

              {/* Type info */}
              {!isNetworkOffer && (
              <Box sx={{ mb: 2.5, p: 2, borderRadius: 'var(--radius-md, 8px)', background: isService ? 'rgba(255,183,77,0.06)' : isCooperation ? 'rgba(99,179,237,0.06)' : 'rgba(72,187,120,0.06)', border: `1px solid ${isService ? 'rgba(255,183,77,0.15)' : isCooperation ? 'rgba(99,179,237,0.15)' : 'rgba(72,187,120,0.15)'}` }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                  {isService ? <InfoOutlinedIcon sx={{ fontSize: 16, color: '#FFB74D' }} />
                    : isCooperation ? <HandshakeIcon sx={{ fontSize: 16, color: '#63B3ED' }} />
                    : <CheckCircleIcon sx={{ fontSize: 16, color: '#48B978' }} />}
                  <Typography variant="caption" fontWeight={700} sx={{ color: isService ? '#FFB74D' : isCooperation ? '#63B3ED' : '#48B978' }}>
                    {isService ? 'Service — Seller confirmation required' : isCooperation ? 'Cooperation — Partner-based project' : isItem ? 'Item — Single article, auto-accept' : 'Product — Instantly available'}
                  </Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.6 }}>
                  {isService ? 'The seller must confirm your request before the payment is initiated.'
                    : isCooperation ? 'Cooperate with a partner on a milestone-based project'+(coopEscrowEnabled ? ' with Lightning escrow protection.' : ' — paid directly to your partner, milestone by milestone.')
                    : isItem ? 'Single article available — payment starts immediately after purchase.'
                    : 'Unlimited availability — payment starts immediately after purchase.'}
                </Typography>
              </Box>
              )}

              {/* Network membership CTA */}
              {isNetworkOffer && offer && (
                <NetworkJoinPanel
                  networkType={offer.networkType === 'closed' ? 'closed' : 'open'}
                  maxMembers={offer.maxMembers ?? null}
                  membershipCriteria={offer.membershipCriteria ?? null}
                  activeMemberCount={activeMemberCount}
                  isOwner={isCreator}
                  myStatus={(myMembership?.status as 'PENDING' | 'ACTIVE' | 'DECLINED' | 'REMOVED' | undefined) ?? null}
                  loading={memberActionLoading}
                  error={memberActionError}
                  onJoinOpen={() => handleJoinNetwork()}
                  onRequestClosed={() => { setMemberActionError(null); setJoinDialogOpen(true) }}
                  onLeave={handleLeaveNetwork}
                  onRequestAgain={() => { setMemberActionError(null); setJoinDialogOpen(true) }}
                />
              )}

              {/* Primary CTA */}
              {isOffer && offer && !isNetworkOffer && (
                <Tooltip title={isInCart(offer.id) ? 'Already in your basket' : 'Add to basket'} arrow>
                  <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    disabled={isInCart(offer.id)}
                    startIcon={isInCart(offer.id) ? <CheckIcon sx={{ fontSize: 16 }} /> : <ShoppingCartIcon sx={{ fontSize: 16 }} />}
                    onClick={() => {
                      addItem({
                        offerId: offer.id,
                        title: offer.title,
                        priceSats: offer.priceSats,
                        offerType: offer.offerType ?? 'PRODUCT',
                        category: offer.category,
                        image: offer.images?.[0],
                        company: offer.company ?? null,
                        sellerPubkey: offer.creatorPubkey,
                        stock: offer.product?.stock,
                        // ADR-183 Phase 2: forward offer.allowedVisibility so
                        // BuyCartFlow can render a per-item tier selector.
                        allowedVisibility: Array.isArray(offer.allowedVisibility) ? offer.allowedVisibility : null,
                      })
                    }}
                    sx={{
                      mb: 2.5, py: 1.5, fontSize: '1rem', fontWeight: 700,
                      transition: 'filter 150ms, transform 150ms',
                      '&:hover': !isInCart(offer.id) ? { filter: 'brightness(1.08)', transform: 'translateY(-1px)' } : {},
                      '&:active': !isInCart(offer.id) ? { transform: 'translateY(0)' } : {},
                      '&.Mui-disabled': { background: 'var(--color-status-success)', color: 'white', opacity: 1 },
                    }}
                  >
                    {isInCart(offer.id) ? 'In Cart' : 'Add to Cart'}
                  </Button>
                </Tooltip>
              )}

              {isCooperation && cooperation && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2.5 }}>
                  {isOpen && canAccept && (
                    <Button fullWidth variant="contained" size="large" disabled={actionLoading} onClick={handleAccept} sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700 }}>Accept Cooperation</Button>
                  )}
                  {isOpen && canApply && (
                    <Button fullWidth variant="contained" size="large" disabled={actionLoading} onClick={() => setApplyDialogOpen(true)} sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700 }}>Apply for Milestones</Button>
                  )}
                  {isOpen && isInitiator && (
                    <Button fullWidth variant="outlined" size="large" disabled={actionLoading} onClick={handleCancel} sx={{ py: 1.5, fontSize: '0.9rem' }}>Cancel</Button>
                  )}
                  {coopStatus === 'ACCEPTED' && isInitiator && coopEscrowEnabled && (
                    <Button fullWidth variant="contained" size="large" disabled={actionLoading} onClick={handleFundEscrow} sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700 }}>Fund Escrow</Button>
                  )}
                  {coopStatus === 'ACCEPTED' && isInitiator && !coopEscrowEnabled && (
                    <Tooltip title="Escrow protection for cooperations is coming soon. Until then you pay your partner directly, milestone by milestone.">
                      <span>
                        <Button fullWidth variant="outlined" size="large" disabled sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700 }}>Escrow — coming soon</Button>
                      </span>
                    </Tooltip>
                  )}
                  {coopStatus === 'ACCEPTED' && !coopEscrowEnabled && (isInitiator || isPartner) && (
                    <Button fullWidth variant="contained" size="large" disabled={actionLoading} onClick={() => handleStatusUpdate('IN_PROGRESS')} sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700 }}>Start Work</Button>
                  )}
                  {coopStatus === 'PAID' && (isInitiator || isPartner) && (
                    <Button fullWidth variant="contained" size="large" disabled={actionLoading} onClick={() => handleStatusUpdate('IN_PROGRESS')} sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700 }}>Start Work</Button>
                  )}
                </Box>
              )}

              {/* Milestone Actions Panel */}
              {isCooperation && cooperation && coopStatus === 'IN_PROGRESS' && (milestones as CoopMilestone[]).length > 0 && (
                <Box sx={{ mb: 2.5 }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" gutterBottom sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.65rem' }}>
                    Milestones
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {(milestones as CoopMilestone[]).map((m, idx) => {
                      const isDone = m.status === 'ACCEPTED' || m.status === 'COMPLETED'
                      const isActive = m.status === 'IN_PROGRESS'
                      const canStart = m.status === 'PENDING' && isPartner
                      const canComplete = m.status === 'IN_PROGRESS' && isPartner
                      const canApprove = m.status === 'COMPLETED' && isInitiator
                      return (
                        <Box
                          key={m.id}
                          sx={{
                            p: 1.5, borderRadius: 'var(--radius-md, 8px)',
                            border: '1px solid',
                            borderColor: isDone ? 'success.main' : isActive ? 'primary.main' : 'var(--theme-border)',
                            background: isDone ? 'rgba(72,187,120,0.06)' : isActive ? 'rgba(99,179,237,0.06)' : 'var(--theme-bg-elevated)',
                          }}
                        >
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: canStart || canComplete || canApprove ? 1 : 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                              <Box sx={{
                                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: isDone ? 'rgba(72,187,120,0.15)' : isActive ? 'rgba(99,179,237,0.15)' : 'rgba(99,179,237,0.08)',
                                border: `1.5px solid ${isDone ? 'var(--color-status-success)' : isActive ? 'var(--color-primary-50)' : 'var(--theme-border)'}`,
                              }}>
                                {isDone
                                  ? <CheckIcon sx={{ fontSize: '0.65rem', color: 'var(--color-status-success)' }} />
                                  : <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: isActive ? 'var(--color-primary-50)' : 'var(--theme-text-muted)' }}>{idx + 1}</Typography>}
                              </Box>
                              <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                              <Typography variant="caption" fontWeight={700} sx={{ fontSize: '0.65rem', color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(m.amountSats)} s</Typography>
                              {!isDone && m.status !== 'PENDING' && (
                                <Chip label={m.status.replace(/_/g, ' ')} size="small" sx={{ fontSize: '0.55rem', height: 16, fontWeight: 700, bgcolor: statusBg(m.status), color: statusColor(m.status), border: 'none' }} />
                              )}
                            </Box>
                          </Box>
                          {canStart && (
                            <Button fullWidth size="small" variant="outlined" disabled={actionLoading} onClick={() => handleMilestoneAction(m, 'IN_PROGRESS')} sx={{ fontSize: '0.7rem', textTransform: 'none' }}>Start Work</Button>
                          )}
                          {canComplete && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <Button fullWidth size="small" variant="contained" disabled={actionLoading} onClick={() => handleMilestoneAction(m, 'COMPLETED', sidebarMsMessages[m.id] || undefined)} sx={{ fontSize: '0.7rem', textTransform: 'none' }}>Mark Completed</Button>
                              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                                <TextField
                                  size="small"
                                  placeholder="Add a message..."
                                  value={sidebarMsMessages[m.id] ?? ''}
                                  onChange={e => setSidebarMsMessages(prev => ({ ...prev, [m.id]: e.target.value }))}
                                  fullWidth
                                  sx={{ '& .MuiInputBase-input': { fontSize: '0.7rem', py: 0.5 }, '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }}
                                />
                                <IconButton
                                  size="small"
                                  disabled={actionLoading || !sidebarMsMessages[m.id]?.trim()}
                                  onClick={() => {
                                    handleMilestoneAction(m, 'COMPLETED', sidebarMsMessages[m.id] || undefined)
                                    setSidebarMsMessages(prev => ({ ...prev, [m.id]: '' }))
                                  }}
                                  sx={{ flexShrink: 0, color: 'var(--color-primary-50)' }}
                                >
                                  <Send size={16} />
                                </IconButton>
                              </Box>
                            </Box>
                          )}
                          {canApprove && (
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              <Button fullWidth size="small" variant="contained" color="success" disabled={actionLoading} onClick={() => handleMilestoneReleasePayment(m)} sx={{ fontSize: '0.7rem', textTransform: 'none' }}>Approve</Button>
                              <Button fullWidth size="small" variant="outlined" color="error" disabled={actionLoading} onClick={() => handleMilestoneAction(m, 'IN_PROGRESS', 'Requested changes')} sx={{ fontSize: '0.7rem', textTransform: 'none' }}>Decline</Button>
                            </Box>
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              )}

              {/* Status Flow Stepper */}
              {isCooperation && cooperation && (isInitiator || isPartner || canAccept) && (
                <Box sx={{ mb: 2.5 }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" gutterBottom sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.65rem' }}>
                    Progress
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {(isInitiator
                      ? [
                          { icon: <FileTextLucide size={14} />, title: 'Create', desc: 'Define milestones and budget', done: true },
                          { icon: <HandshakeLucide size={14} />, title: 'Accept', desc: 'Partner accepts the cooperation', done: coopStatus !== 'OPEN' && coopStatus !== 'PENDING' },
                          { icon: <ZapLucide size={14} />, title: coopEscrowEnabled ? 'Fund' : 'Pay', desc: coopEscrowEnabled ? 'Fund the escrow with sats' : 'Pay your partner directly per milestone', done: ['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(coopStatus ?? '') },
                          { icon: <ClockLucide size={14} />, title: 'Deliver', desc: 'Partner completes milestones', done: coopStatus === 'COMPLETED' },
                        ]
                      : [
                          { icon: <FileTextLucide size={14} />, title: 'Review', desc: 'Read the requirements and milestones', done: true },
                          { icon: <HandshakeLucide size={14} />, title: 'Accept', desc: 'Accept the cooperation to begin', done: coopStatus !== 'OPEN' },
                          { icon: <ZapLucide size={14} />, title: coopEscrowEnabled ? 'Fund' : 'Payout', desc: coopEscrowEnabled ? 'Initiator funds the escrow' : 'Initiator pays you directly per milestone', done: ['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(coopStatus ?? '') },
                          { icon: <ClockLucide size={14} />, title: 'Deliver', desc: 'Start work, complete milestones, earn sats', done: coopStatus === 'COMPLETED' },
                          { icon: <CheckCircleLucide size={14} />, title: 'Get paid', desc: 'Initiator approves and releases funds', done: coopStatus === 'COMPLETED' },
                        ]
                    ).map((step, idx, arr) => (
                      <Box key={step.title}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1.25 }}>
                          <Box sx={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: step.done ? 'rgba(72,187,120,0.12)' : 'rgba(99,179,237,0.10)', color: step.done ? 'var(--color-status-success)' : 'var(--color-primary-50)' }}>
                            {step.done ? <CheckCircleLucide size={14} /> : step.icon}
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>{step.title}{step.title === 'Fund' && ticketData && (
                              <Typography component="span" variant="caption" sx={{ ml: 1, color: ticketData.status === 'PAID' ? 'var(--color-status-success)' : 'var(--color-primary-50)', fontWeight: 700, textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: '0.5px', verticalAlign: 'middle' }}>
                                [{ticketData.status}]
                              </Typography>
                            )}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>{step.desc}</Typography>
                          </Box>
                        </Box>
                        {idx < arr.length - 1 && (
                          <Box sx={{ width: 2, height: 8, ml: '13px', borderRadius: 1, background: step.done ? 'var(--color-status-success)' : 'var(--theme-border)', opacity: step.done ? 0.4 : 1 }} />
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              <Divider sx={{ mb: 2 }} />

              {/* Trust Badges */}
              <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" gutterBottom sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.65rem' }}>Secure Transaction</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <TrustBadge icon={<LockIcon sx={{ fontSize: 16 }} />} text="Lightning Payment" tooltip="Pay instantly via Bitcoin Lightning Network" />
                {coopEscrowEnabled ? (
                  <>
                    <TrustBadge icon={<ShieldIcon sx={{ fontSize: 16 }} />} text="Escrow Protected" tooltip="Funds are held securely until both parties confirm" />
                    <TrustBadge icon={<VerifiedUserIcon sx={{ fontSize: 16 }} />} text="Buyer Protection Included" tooltip="Full refund protection for verified disputes" />
                  </>
                ) : (
                  <TrustBadge icon={<ShieldIcon sx={{ fontSize: 16 }} />} text="Paid directly to your partner" tooltip="Colabonate never holds the funds. Escrow protection is coming soon." />
                )}
              </Box>
            </Box>
          </Box>
        </Grid>
      </Grid>
      </div>

      {/* ADR-188: sibling browsing as the last full-width section below the
          entire detail content — sibling cooperations from the same initiator +
          the marketplace discover list (Vendor ↔ Marketplace segments), with
          the currently-viewed cooperation visually marked in whichever segment
          is active. */}
      {isCooperation && cooperation && (
        <Box sx={{ mt: { xs: 3, md: 4 } }}>
          <DetailSliderNav
            activeId={cooperation.id}
            vendorItems={vendorCoopItems}
            allItems={allCoopItems}
            contextFilters={{ categoryPrefix: cooperation.categoryCode?.split('/')[0] }}
            loading={vendorCoopLoading || allCoopLoading}
            entityType="cooperation"
            hideWhenSingular
            activeSegment={sliderSegment}
            onSegmentChange={setSliderSegment}
            toDetailRoute={toCoopDetailRoute}
          />
        </Box>
      )}

      {/* ADR-188 (network variant): slider for Network offers (offerType=COOP)
          that are surfaced through this route. Mirrors BuyProductDetail —
          sibling browsing within the network universe below the detail content. */}
      {isOffer && offer?.offerType === 'COOP' && (
        <Box sx={{ mt: { xs: 3, md: 4 } }}>
          <DetailSliderNav
            activeId={offer.id}
            vendorItems={vendorOfferItems}
            allItems={allOfferItems}
            contextFilters={(() => {
              const mainCategory = offer.categoryCode?.split('/')[0] || undefined
              return { categoryPrefix: mainCategory, country: offer.country ?? null }
            })()}
            loading={vendorOffersLoading}
            entityType="offer"
            hideWhenSingular
            activeSegment={sliderSegment}
            onSegmentChange={setSliderSegment}
            toDetailRoute={toCoopDetailRoute}
          />
        </Box>
      )}

      <SwipeHint
        storageKey="coop-detail"
        demoRef={swipeRef}
        hasSiblings={hasCoopSiblings}
      />

      {/* Apply Dialog */}
      <Dialog open={Boolean(directPay)} onClose={() => { setDirectPay(null); setDirectPreimage('') }} maxWidth="sm" fullWidth>
        <DialogTitle>Pay {directPay?.milestone.title}</DialogTitle>
        <DialogContent>
          {directPay?.rail === 'CASHU' ? (
            <>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Your partner receives eCash (Cashu). Create a token locked to their key — only they can redeem it — and it appears on the milestone thread. Colabonate never holds the funds.
              </Typography>
              {!isCashuEnabled() && (
                <Alert severity="warning" sx={{ mb: 2 }}>The eCash wallet is not enabled in this app build. Ask your partner to add a Lightning address instead.</Alert>
              )}
              {directPay.token ? (
                <Alert severity="success">Token sent to the milestone thread. Your partner confirms receipt once they redeem it.</Alert>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  Amount: {formatNumber(directPay.milestone.amountSats)} sats · Mint: {directPay.cashu?.mintUrl}
                </Typography>
              )}
            </>
          ) : (
            <>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Pay this Lightning invoice from any wallet. It goes straight to your partner — Colabonate never holds the funds. Then paste the payment proof (preimage) your wallet shows.
              </Typography>
              <TextField fullWidth multiline minRows={3} value={directPay?.invoice ?? ''} InputProps={{ readOnly: true }} sx={{ mb: 1.5, '& textarea': { fontFamily: 'monospace', fontSize: '0.7rem' } }} />
              <Button size="small" onClick={() => { if (directPay?.invoice) void navigator.clipboard?.writeText(directPay.invoice) }} sx={{ mb: 2.5 }}>Copy invoice</Button>
              <TextField fullWidth label="Payment preimage" value={directPreimage} onChange={e => setDirectPreimage(e.target.value)} />
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setDirectPay(null); setDirectPreimage('') }}>{directPay?.token ? 'Close' : 'Cancel'}</Button>
          {directPay?.rail === 'CASHU' ? (
            !directPay.token && (
              <Button variant="contained" disabled={actionLoading || !isCashuEnabled() || !cashuWallet.walletPubkey} onClick={() => void handleCreateCashuToken()}>Create eCash token</Button>
            )
          ) : (
            <Button variant="contained" disabled={actionLoading || !directPreimage.trim()} onClick={() => void handleDirectPayProof()}>Confirm payment</Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={applyDialogOpen} onClose={() => { setApplyDialogOpen(false); setSelectedMilestoneIds(new Set()); setApplyMessage('') }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Apply for Milestones
          <IconButton onClick={() => { setApplyDialogOpen(false); setSelectedMilestoneIds(new Set()); setApplyMessage('') }} size="small"><X fontSize={18} /></IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Select the milestones you want to apply for and introduce yourself.</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2.5 }}>
            {(milestones as CoopMilestone[]).filter(m => !m.partnerPubkey && m.status === 'PENDING').map((m, idx) => {
              const isSelected = selectedMilestoneIds.has(m.id)
              return (
                <Box
                  key={m.id}
                  onClick={() => setSelectedMilestoneIds(prev => {
                    const next = new Set(prev)
                    if (next.has(m.id)) next.delete(m.id)
                    else next.add(m.id)
                    return next
                  })}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 'var(--radius-md, 8px)',
                    border: '1px solid', cursor: 'pointer',
                    borderColor: isSelected ? 'primary.main' : 'var(--theme-border)',
                    background: isSelected ? 'rgba(99,179,237,0.06)' : 'var(--theme-bg-elevated)',
                    transition: 'border-color 0.15s, background 0.15s',
                    '&:hover': { borderColor: isSelected ? 'primary.main' : 'rgba(99,179,237,0.4)' },
                  }}
                >
                  <Switch checked={isSelected} size="small" sx={{ '& .MuiSwitch-switchBase': { p: 0.5 } }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.8rem' }}>M{idx + 1}: {m.title}</Typography>
                    </Box>
                    {m.description && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{richTextToPlainText(m.description)}</Typography>
                    )}
                  </Box>
                  <Typography variant="caption" fontWeight={700} sx={{ color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatNumber(m.amountSats)} s</Typography>
                </Box>
              )
            })}
          </Box>
          <TextField multiline rows={3} fullWidth value={applyMessage} onChange={e => setApplyMessage(e.target.value)} placeholder="Describe your relevant experience and approach..." />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setApplyDialogOpen(false); setSelectedMilestoneIds(new Set()); setApplyMessage('') }}>Cancel</Button>
          <Button variant="contained" disabled={applying || selectedMilestoneIds.size === 0} onClick={submitApplication}>
            {applying ? 'Submitting...' : `Apply for ${selectedMilestoneIds.size} Milestone${selectedMilestoneIds.size !== 1 ? 's' : ''}`}
          </Button>
        </DialogActions>
      </Dialog>

      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Cancel Cooperation?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>&quot;{title}&quot; will be cancelled and cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirmOpen(false)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>
                Cancel
              </button>
              <button onClick={async () => { setDeleteConfirmOpen(false); await handleCancel(); navigate('/coop/manage?tab=cooperations', { replace: true }) }} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--color-status-error)', color: 'white' }}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {isCooperation && cooperation && (
        <CooperationEditDialog
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          onSave={handleSaveCooperationEdit}
          saving={editSaving}
          error={editError}
          isTender={cooperation.cooperationType === 'TENDER'}
          initial={{
            title: cooperation.title,
            description: cooperation.description ?? '',
            budgetSats: String(cooperation.budgetSats ?? 0),
            timeline: cooperation.timeline ?? '',
            deadline: cooperation.deadline ? cooperation.deadline.slice(0, 10) : '',
            requirements: cooperation.requirements ?? '',
            skills: typeof cooperation.skills === 'string' ? cooperation.skills : (Array.isArray(cooperation.skills) ? (cooperation.skills as string[]).join(', ') : ''),
          }}
        />
      )}

      {isOffer && offer && offer.offerType === 'COOP' && (
        <NetworkEditDialog
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          onSave={handleSaveNetworkEdit}
          saving={editSaving}
          error={editError}
          initial={{
            title: offer.title,
            description: offer.description ?? '',
            priceSats: String(offer.priceSats ?? 0),
            networkType: offer.networkType === 'closed' ? 'closed' : 'open',
            membershipCriteria: offer.membershipCriteria ?? '',
            maxMembers: offer.maxMembers ? String(offer.maxMembers) : '',
          }}
        />
      )}

      {/* ADR-386 D4: confirm before switching to the full Coop-Guide form. */}
      <FullEditConfirmDialog
        open={fullEditConfirmOpen}
        entityLabel={isCooperation ? 'cooperation' : 'network'}
        onClose={() => setFullEditConfirmOpen(false)}
        onConfirm={() => {
          setFullEditConfirmOpen(false)
          navigate('/coop/guide', { state: { editId: id } })
        }}
      />

      {isNetworkOffer && offer && (
        <RequestToJoinDialog
          open={joinDialogOpen}
          onClose={() => setJoinDialogOpen(false)}
          onSubmit={handleJoinNetwork}
          saving={memberActionLoading}
          error={memberActionError}
          membershipCriteria={offer.membershipCriteria ?? null}
        />
      )}

      <CartFAB />
    </PageContainer>
  )
}
