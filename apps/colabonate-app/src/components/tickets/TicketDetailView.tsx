import { useState, useEffect } from 'react'
import { useTranslation } from '../../contexts/LocaleContext'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material'
import ReportProblemIcon        from '@mui/icons-material/ReportProblem'
import ShoppingCartCheckoutIcon from '@mui/icons-material/ShoppingCartCheckout'
import StarIcon                 from '@mui/icons-material/Star'
import ThumbUpIcon              from '@mui/icons-material/ThumbUp'
import ThumbDownIcon            from '@mui/icons-material/ThumbDown'
import LockOutlinedIcon          from '@mui/icons-material/LockOutlined'
import ExpandMoreIcon           from '@mui/icons-material/ExpandMore'
import ChatBubbleOutlineIcon    from '@mui/icons-material/ChatBubbleOutline'
import CheckCircleIcon          from '@mui/icons-material/CheckCircle'
import {
  Zap, Calendar, Clock, CheckCircle, AlertCircle, User, Package, ShoppingBag, Handshake,
  Bell, Ticket as TicketIcon, MessageCircle, Settings, ArrowRight, Cpu,
  Frame, ExternalLink,
} from 'lucide-react'
import { UserLink } from '../user/UserLink'
import { Link, useNavigate } from 'react-router'
import { apiCall, ApiError } from '../../lib/api'
import { useCreateOrGetWorkspace } from '../../hooks/useWorkspaceQueries'
import { useInjectCanvasAgentConfig } from '../../hooks/useCanvasAgentConfig'
import { usePayment } from '../../hooks/usePayment'
import { useWallet } from '../../contexts/WalletContext'
import { checkAffordability, isInsufficientFundsError, shortfallMessage } from '../../lib/payment-affordability'
import { orderHeadline, showsEscrowPanel } from '../../lib/ticket-payment'
import { MutualArbiterPanel } from '../disputes'
import { DisputeModal, resolutionOptions } from './DisputeModal'
import { signAndPublishFromTemplate } from '../../lib/nostr-ticket'
import { getEscrowDisplayStatus, getEscrowReleasedPct } from '../../lib/escrow-utils'
import { useNotification } from '../../context/NotificationContext'
import { ReviewForm } from '../reputation/ReviewForm'
import { richTextToPlainText } from '../offers'
import { BountyBriefCard } from '../bounties/BountyBriefCard'
import { EscrowStatus } from './EscrowStatus'
import { TicketChat } from './TicketChat'
import { TicketPaymentCard } from './TicketPaymentCard'
import type { Ticket } from '../../types/api'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../currency/FiatHint'

interface TicketDetailViewProps {
  ticket: Ticket
  onBack: () => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusBg(status: string): string {
  switch (status?.toUpperCase()) {
    case 'PENDING':     return 'rgba(255,192,57,0.12)'
    case 'PAID':        return 'rgba(99,179,237,0.14)'
    case 'IN_PROGRESS': return 'rgba(99,179,237,0.14)'
    case 'COMPLETED':   return 'rgba(72,187,120,0.14)'
    case 'DISPUTED':    return 'rgba(245,101,101,0.14)'
    case 'CANCELLED':   return 'rgba(113,128,150,0.10)'
    default:            return 'rgba(113,128,150,0.10)'
  }
}

function statusColor(status: string): string {
  switch (status?.toUpperCase()) {
    case 'PENDING':     return '#FFC039'
    case 'PAID':        return 'var(--color-primary-50)'
    case 'IN_PROGRESS': return 'var(--color-primary-50)'
    case 'COMPLETED':   return 'var(--color-status-success)'
    case 'DISPUTED':    return 'var(--color-status-error)'
    default:            return 'var(--theme-text-muted)'
  }
}

function statusIcon(status: string) {
  switch (status?.toUpperCase()) {
    case 'COMPLETED': return <CheckCircle size={11} />
    case 'DISPUTED':  return <AlertCircle size={11} />
    default:          return <Clock size={11} />
  }
}

function milestoneStatusColor(status: string): string {
  switch (status?.toUpperCase()) {
    case 'PENDING':     return 'var(--theme-text-muted)'
    case 'IN_PROGRESS': return 'var(--color-primary-50)'
    case 'COMPLETED':   return '#F6AD55'
    case 'DISPUTED':    return 'var(--color-status-error)'
    default:            return 'var(--theme-text-muted)'
  }
}

function milestoneStatusBg(status: string): string {
  switch (status?.toUpperCase()) {
    case 'PENDING':     return 'var(--theme-surface-secondary)'
    case 'IN_PROGRESS': return 'rgba(99,179,237,0.10)'
    case 'COMPLETED':   return 'rgba(246,173,85,0.10)'
    case 'DISPUTED':    return 'rgba(245,101,101,0.10)'
    default:            return 'var(--theme-surface-secondary)'
  }
}

function offerTypeIcon(offerType: string, size = 56) {
  const color = 'var(--color-primary-50)'
  const opacity = 0.85
  switch (offerType?.toUpperCase()) {
    case 'PRODUCT': return <Package size={size} style={{ color, opacity }} />
    case 'ITEM':    return <ShoppingBag size={size} style={{ color, opacity }} />
    default:        return <Handshake size={size} style={{ color, opacity }} />
  }
}

const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/** ADR-342 D3 (Phase B): retry a failed hosted-canvas provisioning. */
function HostedCanvasRetryButton({ ticketId, onRetried }: { ticketId: string; onRetried: () => void }) {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await apiCall(`/api/tickets/${ticketId}/canvas-retry`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onRetried()
    } catch (err) {
      console.error('[canvas-retry] failed:', err instanceof Error ? err.message : err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outlined" size="small" onClick={onClick} disabled={busy}>
      {busy ? 'Retrying…' : 'Retry canvas'}
    </Button>
  )
}

/** ADR-342 D4/D5 (Phase B): fetch a one-time login URL then open in a new tab. */
function HostedCanvasOpenButton({ ticketId }: { ticketId: string }) {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await apiCall(`/api/tickets/${ticketId}/canvas-url`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (typeof data?.url === 'string') window.open(data.url, '_blank', 'noopener')
    } catch (err) {
      console.error('[canvas-url] failed:', err instanceof Error ? err.message : err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="outlined" size="small" onClick={onClick} disabled={busy} endIcon={<ExternalLink size={14} />}>
      {busy ? 'Opening…' : 'Open Canvas'}
    </Button>
  )
}

/** ADR-372 D3 (FU-697): buyer confirms the hosted-canvas fee from the ticket
 *  page — the abandoned-checkout / demo-balance-exhausted edge case where the
 *  seller leg is paid but the fee leg is still open. DEMO rail confirms
 *  preimage-free (server debits the demo wallet); LN rail pays the platform's
 *  own invoice then self-confirms with the wallet preimage. */
function HostedCanvasFeeConfirmButton({ ticket }: { ticket: Ticket }) {
  const { payInvoice } = usePayment()
  const { wallet, refreshBalance } = useWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fee = ticket.platformFee

  const onClick = async () => {
    if (busy || !fee) return
    setBusy(true)
    setError(null)
    try {
      if (fee.rail === 'DEMO') {
        const res = await apiCall(`/api/tickets/${ticket.id}/confirm-canvas-fee`, { method: 'POST', body: JSON.stringify({}) })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error || data.message || 'Fee confirmation failed')
          return
        }
        window.location.reload()
        return
      }
      if (!fee.invoice || !fee.paymentHash) {
        setError('Fee invoice missing')
        return
      }
      // ADR-413 D3: prove the shortfall before the wallet prompt when the
      // platform knows the balance — a proven shortfall only needs a top-up,
      // not a failed payment.
      let active = wallet
      try {
        active = (await refreshBalance()) ?? wallet
      } catch {
        /* keep the cached balance */
      }
      const affordability = checkAffordability(active, fee.amountSats)
      if (affordability.known && !affordability.sufficient && affordability.fresh) {
        setError(shortfallMessage(affordability, 'The service fee'))
        return
      }
      const result = await payInvoice({ invoice: fee.invoice, paymentHash: fee.paymentHash })
      if (!result.ok) {
        // A wallet that already settled the invoice answers "invoice already
        // paid" — the platform's reconcile tick books the fee seconds later,
        // so the ticket still confirms itself.
        const reason = result.error || 'Fee payment failed'
        setError(
          isInsufficientFundsError(reason)
            ? shortfallMessage(affordability, 'The service fee')
            : /already (paid|settled)/i.test(reason)
              ? 'The fee payment already went through — the ticket confirms itself once the platform sees it.'
              : reason,
        )
        return
      }
      if (result.preimage) {
        const res = await apiCall(`/api/tickets/${ticket.id}/confirm-canvas-fee`, {
          method: 'POST',
          body: JSON.stringify({ preimage: result.preimage }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error || data.message || 'Fee confirmation failed')
          return
        }
      }
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fee payment failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
      <Button variant="contained" size="small" onClick={onClick} disabled={busy} startIcon={busy ? undefined : <Zap size={14} />}>
        {busy ? 'Paying…' : 'Confirm fee'}
      </Button>
      {error && <Typography variant="caption" color="error">{error}</Typography>}
    </Box>
  )
}

/** ADR-370 D4/D5 (Phase 4b/5, FU-674): map an activation failure to copy the
 *  seller understands. apiCall() throws ApiError whose `.data.error` is the
 *  raw CODE (e.g. 'TICKET_TERMINAL'); the terminal/no-canvas codes get a
 *  generic German caption, everything else falls back to the server's
 *  human-readable `.data.message`. */
function canvasAgentErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.data?.error === 'TICKET_TERMINAL') return 'Aktivierung nicht möglich – das Ticket ist bereits beendet.'
    if (e.data?.error === 'NO_HOSTED_CANVAS') return 'Für dieses Ticket ist kein gehostetes Canvas hinterlegt.'
    return e.data?.message ?? e.message
  }
  return e instanceof Error ? e.message : String(e)
}

/** ADR-370 D4/D5 (Phase 5, FU-674): seller-only agent row inside the
 *  doop-hosted Collaboration-Canvas card. Once the canvas is provisioned the
 *  agent owner can re-seal the offer's persona onto the ticket's canvas-agent
 *  runner ("Activate agent"); while the runner is active (or starting) the
 *  row reflects the server-bookkeeping status instead of offering the button. */
function CanvasAgentSellerRow({ ticket }: { ticket: Ticket }) {
  const injectCanvasAgentConfig = useInjectCanvasAgentConfig(ticket.id, { onSuccess: () => window.location.reload() })

  const canvasReady = ticket.workspaceCanvas?.provisioningStatus === 'ready'
  const agentActive = ticket.agentRunnerStatus === 'running' || ticket.agentRunnerStatus === 'starting'
  const agentFailed = ticket.agentRunnerStatus === 'failed'
  const ticketEnded = ['COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED'].includes(ticket.status)
  const activationError = injectCanvasAgentConfig.error

  return (
    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Box
            sx={{
              width: 30, height: 30, borderRadius: 1.5, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(72,187,120,0.12)', color: 'var(--color-status-success)',
            }}
          >
            <Cpu size={15} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600}>
              Agent im Canvas
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.5 }}>
              Dein konfigurierter Agent arbeitet selbstständig auf diesem Canvas.
            </Typography>
          </Box>
        </Box>
        <Box sx={{ flexShrink: 0 }}>
          {(() => {
            if (!canvasReady) {
              return (
                <Typography variant="caption" color="text.secondary">
                  Die Agent-Aktivierung wird freigeschaltet, sobald das Canvas bereit ist.
                </Typography>
              )
            }
            if (agentActive) {
              const running = ticket.agentRunnerStatus === 'running'
              return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      bgcolor: running ? 'var(--color-status-success)' : '#FFC039',
                      ...(running
                        ? {}
                        : {
                            animation: 'pulse 2s ease-in-out infinite',
                            '@keyframes pulse': {
                              '0%, 100%': { opacity: 1 },
                              '50%': { opacity: 0.4 },
                            },
                          }),
                    }}
                  />
                  <Typography variant="caption" fontWeight={600}>
                    {running ? 'Agent active on canvas' : 'Agent starting…'}
                  </Typography>
                </Box>
              )
            }
            if (ticketEnded) {
              return (
                <Typography variant="caption" color="text.secondary">
                  Das Ticket ist beendet – der Canvas-Agent kann nicht wieder aktiviert werden.
                </Typography>
              )
            }
            return (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => injectCanvasAgentConfig.inject({ offerId: ticket.offerId })}
                  disabled={injectCanvasAgentConfig.isPending}
                >
                  {injectCanvasAgentConfig.isPending ? 'Activating…' : 'Activate agent'}
                </Button>
                {agentFailed && ticket.agentRunnerLastError && (
                  <Typography variant="caption" color="text.secondary">
                    {ticket.agentRunnerLastError}
                  </Typography>
                )}
                {activationError && (
                  <Typography variant="caption" sx={{ color: 'var(--color-status-error)' }}>
                    {canvasAgentErrorText(activationError)}
                  </Typography>
                )}
              </Box>
            )
          })()}
        </Box>
      </Box>
    </Box>
  )
}

const NOTIF_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', ACCEPTED: 'Accepted', PAID: 'Paid', IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed', DISPUTED: 'Disputed', CANCELLED: 'Cancelled',
}

const NOTIF_STATUS_COLOR: Record<string, string> = {
  PENDING: '#FFC039', ACCEPTED: 'var(--color-primary-50)', PAID: 'var(--color-primary-50)',
  IN_PROGRESS: 'var(--color-primary-50)', COMPLETED: 'var(--color-status-success)',
  DISPUTED: 'var(--color-status-error)', CANCELLED: 'var(--theme-text-muted)',
}

function getNotifIcon(type: string) {
  switch (type) {
    case 'ticket': return <TicketIcon size={14} />
    case 'message': return <MessageCircle size={14} />
    case 'system': return <Settings size={14} />
    default: return <Bell size={14} />
  }
}

function formatTimeAgo(timestamp: Date): string {
  const diffMs = Date.now() - timestamp.getTime()
  const mins = Math.floor(diffMs / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return timestamp.toLocaleDateString('en-US', { day: '2-digit', month: 'short' })
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TicketDetailView({ ticket, onBack }: TicketDetailViewProps) {
  const { formatDate } = useTranslation()
  const navigate = useNavigate()
  const createOrGetWorkspace = useCreateOrGetWorkspace()
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const { payInvoice, pollUntilPaid } = usePayment()
  const [loading, setLoading]             = useState(false)
  const [chatOpen, setChatOpen]           = useState(() => {
    try { return localStorage.getItem('ticket_chat_open') === 'true' } catch { return false }
  })
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [reviewOpen, setReviewOpen]       = useState(false)
  const [userHasReviewed, setUserHasReviewed] = useState(false)
  const [disputeModalOpen, setDisputeModalOpen] = useState(false)

  const [userPubkey] = useState(() => localStorage.getItem('pubkey'))
  const isBuyer  = userPubkey === ticket.buyerPubkey
  const isSeller = userPubkey === ticket.sellerPubkey

  // ADR-342 D2/D5 + ADR-370 D2/D6 (Phase 2): collaboration canvas. Trust-
  // transparent: the instance hostname is shown and there is no Colabonate
  // login for self-hosted instances.
  //
  // G3 fix (client half): for doop-local, the card renders from the TICKET
  // snapshot (ticket.ticketCanvas — captured at purchase) instead of the live
  // offer, so a seller editing/removing the canvas on an ACTIVE offer can no
  // longer rewrite what an existing ticket displays. Pre-Phase-1 legacy
  // tickets have no snapshot and fall back to the offer binding.
  const canvasConfig = ticket.offer?.agentConfigMeta?.canvas
  const ticketLocalCanvas = ticket.ticketCanvas?.provider === 'doop-local'
    ? { instanceUrl: ticket.ticketCanvas.instanceUrl, canvasId: ticket.ticketCanvas.canvasId }
    : null
  const localBinding = ticketLocalCanvas ?? (canvasConfig?.provider === 'doop-local'
    ? { instanceUrl: canvasConfig.instanceUrl ?? null, canvasId: canvasConfig.canvasId ?? null }
    : null)
  const canvasHost = (() => {
    try { return localBinding?.instanceUrl ? new URL(localBinding.instanceUrl).host : null } catch { return null }
  })()
  const canvasUrl = localBinding?.instanceUrl
    ? (localBinding.canvasId ? `${localBinding.instanceUrl}/c/${localBinding.canvasId}` : localBinding.instanceUrl)
    : null
  const amount   = ticket.amountSats ?? ticket.offer.priceSats
  const { addNotification, showSnackbar, notifications, markAsRead } = useNotification()

  const isCompleted        = ticket.status === 'COMPLETED'
  const reviewWindowClosed = isCompleted && (Date.now() - new Date(ticket.updatedAt ?? ticket.createdAt).getTime()) > REVIEW_WINDOW_MS
  const canReview          = isCompleted && !reviewWindowClosed && (isBuyer || isSeller) && !userHasReviewed && ticket.visibility !== 'PRIVATE'

  useEffect(() => {
    if (!isCompleted || !userPubkey) return
    apiCall(`/api/reviews/${userPubkey}?as=reviewer`)
      .then(r => r.json())
      .then(data => {
        const hasReview = (data.reviews ?? []).some(
          (r: { ticketId: string }) => r.ticketId === ticket.id,
        )
        setUserHasReviewed(hasReview)
      })
      .catch(() => {})
  }, [isCompleted, userPubkey, ticket.id])

  // NOTE (FU-736): the "Report issue" button previously called
  // handleAction('DISPUTED') — a generic PATCH /api/tickets/:id status
  // flip. It flipped the visible status but never created a Dispute row,
  // never queued the DAO Arbitration Council, and bypassed disputeMode
  // entirely (a NONE/PRIVATE-mode ticket would silently "succeed" instead
  // of hitting the real endpoint's guards). This calls the actual dispute
  // route (POST /api/tickets/:id/dispute, apps/server/routes/dispute.ts).
  async function handleOpenDispute(reason: string, description: string, desiredResolution: string) {
    const resolutionLabel = resolutionOptions.find(o => o.value === desiredResolution)?.label
    try {
      const response = await apiCall(`/api/tickets/${ticket.id}/dispute`, {
        method: 'POST',
        body: JSON.stringify({
          callerPubkey: userPubkey,
          reason,
          details: resolutionLabel ? `${description}\n\nDesired resolution: ${resolutionLabel}` : description,
        }),
      })
      const data = await response.json()
      if (data?.status === 'arbiter_nominated') {
        showSnackbar('Arbiter nominated — waiting for the other party to confirm before the dispute opens.', 'info')
        return
      }
      if (data.nostrEventTemplate) {
        signAndPublishFromTemplate(data.nostrEventTemplate).catch(() => {})
      }
      showSnackbar('Dispute opened — the Arbitration Council has been notified.', 'success')
      const partnerPubkey = isBuyer ? ticket.sellerPubkey : ticket.buyerPubkey
      addNotification({
        type: 'ticket',
        title: 'Dispute opened',
        message: ticket.offer?.title ?? `#${ticket.id.slice(0, 8)}`,
        relatedId: ticket.id,
        actionUrl: `/tickets/${ticket.id}`,
        meta: {
          offerTitle: ticket.offer?.title,
          statusFrom: ticket.status,
          statusTo: 'DISPUTED',
          partnerPubkey,
          amountSats: ticket.amountSats ?? ticket.offer?.priceSats,
          role: isBuyer ? 'buyer' : 'seller',
          ticketId: ticket.id,
          ticketType: ticket.ticketType,
          offerType: ticket.offerType,
          buyerPubkey: ticket.buyerPubkey,
          sellerPubkey: ticket.sellerPubkey,
          escrowStatus: ticket.escrowStatus,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
        },
      })
      setTimeout(() => onBack(), 3000)
    } catch (error) {
      const message = error instanceof ApiError
        ? (error.data?.message ?? error.data?.error ?? 'Failed to open the dispute.')
        : 'Failed to open the dispute.'
      showSnackbar(message, 'error')
      throw error
    }
  }

  async function handleReleasePayment() {
    setLoading(true)
    try {
      const invoiceRes = await apiCall(`/api/tickets/${ticket.id}/release-payment`, { method: 'POST' })
      if (!invoiceRes.ok) {
        const data = await invoiceRes.json()
        showSnackbar(data.error || 'Failed to create release invoice', 'error')
        setLoading(false)
        return
      }
      const { invoice, paymentHash } = await invoiceRes.json()

      // ADR-241 D4: single pay branch (isBeta demo-pay → NWC/ALBY_OAUTH → WebLN → MANUAL).
      const payResult = await payInvoice({ invoice, paymentHash })
      if (!payResult.ok) {
        showSnackbar(payResult.error || 'Payment failed', 'error')
        setLoading(false)
        return
      }

      const paid = await pollUntilPaid(paymentHash)
      if (paid) {
        showSnackbar('Payment released successfully!', 'success')
        setTimeout(() => onBack(), 1500)
        setLoading(false)
        return
      }

      showSnackbar('Payment sent but confirmation is taking longer than expected.', 'warning')
      setLoading(false)
    } catch {
      showSnackbar('Error releasing payment.', 'error')
      setLoading(false)
    }
  }

  // ADR-255 D7: a non-escrow (direct-pay) ticket already paid the seller
  // directly at checkout — nothing is held back to "release". Confirming
  // receipt here is a plain status transition, mirroring
  // the Cashu self-report in TicketPaymentCard, never a second payment.
  async function handleConfirmReceipt() {
    setLoading(true)
    try {
      const response = await apiCall(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'COMPLETED' }),
      })
      if (!response.ok) throw new Error('Update failed')
      const data = await response.json()
      if (data.nostrEventTemplate) {
        signAndPublishFromTemplate(data.nostrEventTemplate).catch(() => {})
      }
      showSnackbar('Receipt confirmed!', 'success')
      setTimeout(() => onBack(), 1500)
    } catch {
      showSnackbar('Error confirming receipt.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSellerAction(action: 'accept' | 'reject') {
    setLoading(true)
    try {
      const newStatus = action === 'accept' ? 'IN_PROGRESS' : 'CANCELLED'
      const response = await apiCall(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })
      if (!response.ok) throw new Error('Update failed')
      const data = await response.json()
      if (data.nostrEventTemplate) {
        signAndPublishFromTemplate(data.nostrEventTemplate).catch(() => {})
      }
      addNotification({
        type: 'offer',
        title: action === 'accept' ? 'Request accepted' : 'Request rejected',
        message: ticket.offer?.title ?? `#${ticket.id.slice(0, 8)}`,
        relatedId: ticket.id,
        actionUrl: `/tickets/${ticket.id}`,
        meta: {
          offerTitle: ticket.offer?.title,
          statusFrom: ticket.status,
          statusTo: newStatus,
          partnerPubkey: ticket.buyerPubkey,
          amountSats: ticket.amountSats ?? ticket.offer?.priceSats,
          role: 'seller',
          ticketId: ticket.id,
          ticketType: ticket.ticketType,
          offerType: ticket.offerType,
          buyerPubkey: ticket.buyerPubkey,
          sellerPubkey: ticket.sellerPubkey,
          escrowStatus: ticket.escrowStatus,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
        },
      })
      setTimeout(() => onBack(), 3000)
    } catch {
      showSnackbar('Error updating.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateInvoice() {
    setLoading(true)
    try {
      const response = await apiCall('/api/lightning/invoice', {
        method: 'POST',
        body: JSON.stringify({ ticketId: ticket.id, amountSats: amount }),
      })
      const data = await response.json()
      if (data.invoice) {
        showSnackbar('Lightning invoice created!', 'success')
      }
    } catch {
      showSnackbar('Error creating invoice.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleOpenWorkspace() {
    setWorkspaceError(null)
    try {
      const { workspace } = await createOrGetWorkspace.mutateAsync(ticket.id)
      navigate(`/workspaces/${workspace.id}`)
    } catch (e) {
      setWorkspaceError(e instanceof Error ? e.message : 'Could not open workspace')
    }
  }

  const canDispute = (isBuyer || isSeller) &&
    ticket.status !== 'COMPLETED' &&
    ticket.status !== 'CANCELLED'

  const getEscrowReleasedAmount = () =>
    Math.round((getEscrowReleasedPct(ticket.escrowStatus) / 100) * amount)

  const hasImage = ticket.offer.images && ticket.offer.images.length > 0
  const images   = ticket.offer.images ?? []

  // Step flow definition
  const isService = ticket.offerType === 'SERVICE'
  const buyerSteps = isService
    ? [
        { title: 'Request sent',    desc: 'Your request is awaiting seller review', done: true },
        { title: 'Accepted',        desc: 'Seller reviews and confirms',             done: ticket.status !== 'PENDING' },
        { title: 'In progress',     desc: 'Work is underway',                        done: ['IN_PROGRESS', 'COMPLETED'].includes(ticket.status) },
        { title: 'Release payment', desc: 'Confirm delivery to release funds',       done: ticket.status === 'COMPLETED' },
      ]
    : [
        { title: 'Order placed',   desc: ticket.status === 'PENDING' ? 'Pay the invoice to proceed' : 'Order submitted', done: true },
        { title: 'Payment sent',   desc: 'Invoice paid — waiting for seller',                done: ['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(ticket.status) },
        { title: 'In progress',    desc: 'Seller confirmed and started fulfillment',          done: ['IN_PROGRESS', 'COMPLETED'].includes(ticket.status) },
        { title: 'Completed',      desc: 'Delivery confirmed, payment released',              done: ticket.status === 'COMPLETED' },
      ]

  const sellerSteps = isService
    ? [
        { title: 'Review request', desc: 'Review the buyer\'s request',       done: true },
        { title: 'Accept & start', desc: 'Accept to begin work',              done: ticket.status !== 'PENDING' },
        { title: 'Complete work',  desc: 'Deliver and submit for approval',   done: ['IN_PROGRESS', 'COMPLETED'].includes(ticket.status) },
        { title: 'Get paid',       desc: 'Buyer confirms and releases funds', done: ticket.status === 'COMPLETED' },
      ]
    : [
        { title: 'Order received',  desc: 'New order from buyer',                           done: true },
        { title: 'Payment received', desc: 'Buyer paid — confirm to start fulfillment',     done: ['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(ticket.status) },
        { title: 'Confirm & start', desc: 'Confirm and begin fulfillment',                  done: ['IN_PROGRESS', 'COMPLETED'].includes(ticket.status) },
        { title: 'Payment',         desc: 'Funds released upon buyer confirmation',         done: ticket.status === 'COMPLETED' },
      ]

  const steps = isBuyer ? buyerSteps : sellerSteps

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box>

      {/* ── Section 1: Hero ──────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ overflow: 'hidden', mb: 3 }}>
        <Box
          sx={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 180,
            background: hasImage ? 'var(--theme-bg-subtle)' : 'rgba(99,179,237,0.14)',
            overflow: 'hidden',
          }}
        >
          {hasImage ? (
            <>
              <Box
                component="img"
                src={images[activeImageIndex]}
                alt={ticket.offer.title}
                onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9, display: 'block' }}
              />
              {/* Thumbnail strip */}
              {images.length > 1 && (
                <Box
                  sx={{
                    position: 'absolute', bottom: 12, left: 12,
                    display: 'flex', gap: 1, overflowX: 'auto', maxWidth: 'calc(100% - 120px)',
                    scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
                  }}
                >
                  {images.map((url, i) => (
                    <Box
                      key={i}
                      onClick={() => setActiveImageIndex(i)}
                      sx={{
                        flexShrink: 0, width: 56, height: 40, borderRadius: 1, overflow: 'hidden',
                        cursor: 'pointer', border: '2px solid',
                        borderColor: i === activeImageIndex ? 'primary.main' : 'rgba(255,255,255,0.5)',
                        opacity: i === activeImageIndex ? 1 : 0.65,
                        transition: 'opacity 150ms, border-color 150ms',
                      }}
                    >
                      <Box component="img" src={url} alt={`${i + 1}`} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </Box>
                  ))}
                </Box>
              )}
            </>
          ) : (
            offerTypeIcon(ticket.offerType ?? '', Math.round(180 * 0.28))
          )}

        </Box>
      </Paper>

      {/* ── Section 2: Two-column grid ───────────────────────────────────── */}
      <Grid container spacing={3}>

        {/* ── Left column: main content ──────────────────────────────────── */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

            {/* Details */}
            <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
              <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3, mb: 0.5 }}>
                {ticket.offer.title}
              </Typography>
              {ticket.offer.description && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.7 }}>
                  {richTextToPlainText(ticket.offer.description)}
                </Typography>
              )}

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                <Chip
                  icon={statusIcon(ticket.status)}
                  label={ticket.status}
                  size="small"
                  sx={{
                    fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase',
                    background: statusBg(ticket.status), color: statusColor(ticket.status),
                  }}
                />
                {amount > 0 && (
                  <>
                    <Chip
                      icon={<Zap size={12} />}
                      label={formatSats(amount, { compact: false })}
                      size="small"
                      sx={{
                        fontWeight: 700, fontSize: '0.7rem',
                        background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    />
                    <FiatHint sats={amount} className="text-[12px] self-center" style={{ color: 'var(--theme-text-muted)' }} />
                  </>
                )}
                <Chip
                  icon={<Calendar size={12} />}
                  label={formatDate(new Date(ticket.createdAt), { day: '2-digit', month: 'short', year: 'numeric' })}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
                {ticket.offerType && (
                  <Chip
                    label={ticket.offerType}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem' }}
                  />
                )}
                {ticket.variantLabel && (
                  <Chip
                    label={ticket.variantLabel}
                    size="small"
                    variant="outlined"
                    color="primary"
                    sx={{ fontSize: '0.7rem', fontWeight: 600 }}
                  />
                )}
                {ticket.ticketType && (
                  <Chip
                    label={ticket.ticketType.replace('_', ' ')}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem' }}
                  />
                )}
              </Box>

              {/* Escrow explanation */}
              {(ticket.escrowStatus && ticket.escrowStatus !== 'NONE') && (
                <Box
                  sx={{
                    mt: 2,
                    p: 2,
                    borderRadius: 2,
                    background: 'rgba(99,179,237,0.08)',
                    border: '1px solid rgba(99,179,237,0.2)',
                  }}
                >
                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.75, fontSize: '0.85rem' }}>
                    Escrow Payment: Your funds are protected
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
                    The satoshis are held securely in a Lightning hold invoice until you confirm receipt. Only when you approve the delivery will the funds be released to the seller. If there is a dispute, the Arbitration Council can release or refund the funds.
                    <Link
                      to="/help/buying#buy-4"
                      style={{ marginLeft: 8, color: 'var(--color-primary-50)', fontWeight: 600, textDecoration: 'underline' }}
                    >
                      Learn more &gt;
                    </Link>
                  </Typography>
                </Box>
              )}

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1 }}>
                <Paper variant="outlined" sx={{ p: 1.5, flex: '1 1 160px', minWidth: 140, borderRadius: 2 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={500} display="block" mb={0.5}>
                    Buyer
                  </Typography>
                  <UserLink pubkey={ticket.buyerPubkey} mono size="small" className={isBuyer ? 'opacity-60' : ''} />
                  {isBuyer && (
                    <Chip
                      icon={<User size={9} />}
                      label="You"
                      size="small"
                      sx={{ mt: 0.75, height: 18, fontSize: '0.6rem', fontWeight: 700, background: 'rgba(99,179,237,0.12)', color: 'var(--color-primary-50)' }}
                    />
                  )}
                </Paper>
                <Paper variant="outlined" sx={{ p: 1.5, flex: '1 1 160px', minWidth: 140, borderRadius: 2 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={500} display="block" mb={0.5}>
                    Seller
                  </Typography>
                  <UserLink pubkey={ticket.sellerPubkey} mono size="small" className={isSeller ? 'opacity-60' : ''} />
                  {isSeller && (
                    <Chip
                      icon={<User size={9} />}
                      label="You"
                      size="small"
                      sx={{ mt: 0.75, height: 18, fontSize: '0.6rem', fontWeight: 700, background: 'rgba(72,187,120,0.12)', color: 'var(--color-status-success)' }}
                    />
                  )}
                </Paper>
                {(ticket.escrowStatus && ticket.escrowStatus !== 'NONE') && (
                  <Paper variant="outlined" sx={{ p: 1.5, flex: '1 1 120px', minWidth: 100, borderRadius: 2 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={500} display="block" mb={0.5}>
                      Escrow
                    </Typography>
                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: '0.85rem' }}>
                      {ticket.escrowStatus}
                    </Typography>
                  </Paper>
                )}
              </Box>

              {/* ADR-399 D4: one payment card for every rail */}
              <TicketPaymentCard ticket={ticket} isBuyer={isBuyer} isSeller={isSeller} />
            </Paper>

            {/* ADR-397 D6: the bounty brief this ticket pays for (both parties). */}
            {ticket.bountyBrief && (isBuyer || isSeller) && <BountyBriefCard brief={ticket.bountyBrief} />}

            {/* Agent Workspace (AGENT_SETUP) — ADR-311/326 D5, FU-447 */}
            {ticket.offerType === 'AGENT_SETUP' && ['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(ticket.status) && (isBuyer || isSeller) && (
              <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Cpu size={20} />
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>Agent Workspace</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Status, cycle budget and outputs for this agent's runtime.
                      </Typography>
                    </Box>
                  </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleOpenWorkspace}
                    disabled={createOrGetWorkspace.isPending}
                  >
                    {createOrGetWorkspace.isPending ? 'Opening…' : 'Open Workspace'}
                  </Button>
                </Box>
                {workspaceError && (
                  <Alert severity="error" sx={{ mt: 1.5, borderRadius: 1.5 }}>{workspaceError}</Alert>
                )}
              </Paper>
            )}

            {/* Collaboration Canvas (AGENT_SETUP, doop-local) — ADR-342 D2/D5:
                sibling of the workspace card; canvas = collaboration surface,
                canister = execution surface. */}
            {ticket.offerType === 'AGENT_SETUP' && canvasUrl && ['PAID', 'IN_PROGRESS', 'COMPLETED'].includes(ticket.status) && (isBuyer || isSeller) && (
              <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Frame size={20} />
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>Collaboration Canvas</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Shared doop canvas on {canvasHost} — requires an account on {canvasHost}.
                      </Typography>
                    </Box>
                  </Box>
                  <Button
                    variant="outlined"
                    size="small"
                    href={canvasUrl}
                    target="_blank"
                    rel="noopener"
                    endIcon={<ExternalLink size={14} />}
                  >
                    Open Canvas
                  </Button>
                </Box>
                {canvasConfig?.probeStatus === 'unreachable' && (
                  <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 1.5 }}>
                    The canvas instance could not be reached during the last health check — it may be offline.
                  </Alert>
                )}
              </Paper>
            )}

            {/* Collaboration Canvas (AGENT_SETUP, doop-hosted) — ADR-342 D3/D5
                (Phase B): sibling of the workspace card. Status states follow
                Workspace.canvasProvisioningStatus (D3/A2): pending → disabled
                "Canvas wird vorbereitet…", failed → explicit retry, ready →
                one-time SSO URL via GET /api/tickets/:id/canvas-url then
                window.open (D4). D4a/F1: the buyer sees no button when
                buyerAccess === 'none' — the card shows the neutral
                "canvas is private" note instead. */}
            {ticket.offerType === 'AGENT_SETUP' && ticket.workspaceCanvas?.provider === 'doop-hosted'
              && ['PAID', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED'].includes(ticket.status)
              && (isBuyer || isSeller) && (
              <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Frame size={20} />
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>Collaboration Canvas</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Colabonate-hosted doop canvas — opened in a new tab.
                      </Typography>
                    </Box>
                  </Box>
                  {isBuyer && ticket.workspaceCanvas.buyerAccess === 'none' ? (
                    <Typography variant="body2" color="text.secondary">
                      The canvas for this setup is private.
                    </Typography>
                  ) : ticket.workspaceCanvas.provisioningStatus === 'pending' || !ticket.workspaceCanvas.provisioningStatus ? (
                    <Button variant="outlined" size="small" disabled startIcon={<Clock size={14} />}>
                      Canvas wird vorbereitet…
                    </Button>
                  ) : ticket.workspaceCanvas.provisioningStatus === 'failed' ? (
                    <HostedCanvasRetryButton ticketId={ticket.id} onRetried={() => window.location.reload()} />
                  ) : (
                    <HostedCanvasOpenButton ticketId={ticket.id} />
                  )}
                </Box>
                {isSeller && <CanvasAgentSellerRow ticket={ticket} />}
                {/* ADR-353 D5: terminal ticket states froze the canvas
                    read-only (dispute = evidence freeze); reads and comments
                    stay open — the open-canvas button above keeps working. */}
                {['COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED'].includes(ticket.status) && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                    {ticket.status === 'DISPUTED'
                      ? 'Ticket in dispute — the canvas is frozen read-only as evidence. Comments stay open.'
                      : 'The canvas is read-only (this ticket has ended). Comments stay open.'}
                  </Typography>
                )}
              </Paper>
            )}

            {/* ADR-372 D3 (FU-697): hosted-canvas service fee — a separate
                buyer→Colabonate payment. Rendered for every status (PENDING
                included) so the buyer can see the fee and, if the checkout was
                abandoned mid-flow, confirm it here and unlock PAID → canvas. */}
            {ticket.platformFee && (isBuyer || isSeller) && (
              <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Zap size={20} style={{ color: 'var(--color-primary-50)' }} />
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>Hosted-canvas service fee</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {ticket.platformFee.status === 'PAID'
                          ? 'Paid to Colabonate — covers the hosted canvas infrastructure (not refundable).'
                          : isBuyer
                            ? 'Still open — pay it to complete the purchase and unlock the canvas.'
                            : 'Still open — the buyer has to pay it to complete the purchase and unlock the canvas.'}
                      </Typography>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary-50)' }}>
                        {formatSats(ticket.platformFee.amountSats, { compact: false })}
                      </span>
                      <FiatHint sats={ticket.platformFee.amountSats} className="text-[11px]" />
                    </Box>
                    {ticket.platformFee.status === 'PAID' ? (
                      <Chip size="small" color="success" icon={<CheckCircle size={13} />} label="Paid" />
                    ) : (
                      <Chip size="small" sx={{ bgcolor: 'rgba(255,192,57,0.14)', color: '#FFC039' }} icon={<Clock size={13} />} label="Pending" />
                    )}
                    {isBuyer && ticket.platformFee.status === 'PENDING' && (
                      <HostedCanvasFeeConfirmButton ticket={ticket} />
                    )}
                  </Box>
                </Box>
              </Paper>
            )}

            {/* Delivery (ITEM / PRODUCT) */}
            {(ticket.offerType === 'ITEM' || ticket.offerType === 'PRODUCT') && ticket.deliveryAddress && (
              <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  Delivery
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight={500} display="block" mb={0.5}>
                      Delivery Address
                    </Typography>
                    <Typography variant="body2">{ticket.deliveryAddress.fullName}</Typography>
                    <Typography variant="body2" color="text.secondary">{ticket.deliveryAddress.street}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {ticket.deliveryAddress.zipCode} {ticket.deliveryAddress.city}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">{ticket.deliveryAddress.country}</Typography>
                    {ticket.deliveryAddress.phone && (
                      <Typography variant="body2" color="text.secondary" mt={0.5}>
                        Phone: {ticket.deliveryAddress.phone}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {ticket.deliveryTimeDays && (
                      <Box>
                        <Typography variant="caption" color="text.secondary" fontWeight={500} display="block" mb={0.25}>
                          Delivery Time
                        </Typography>
                        <Typography variant="body2" fontWeight={600}>
                          {ticket.deliveryTimeDays} {ticket.deliveryTimeDays === 1 ? 'Day' : 'Days'}
                        </Typography>
                      </Box>
                    )}
                    {ticket.deliveryCostSats !== undefined && ticket.deliveryCostSats > 0 && (
                      <Box>
                        <Typography variant="caption" color="text.secondary" fontWeight={500} display="block" mb={0.25}>
                          Delivery Cost
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Zap size={14} style={{ color: 'var(--color-primary-50)' }} />
                          <Typography variant="body2" fontWeight={600}>
                            {formatSats(ticket.deliveryCostSats, { compact: false })}
                          </Typography>
                          <FiatHint sats={ticket.deliveryCostSats} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                        </Box>
                      </Box>
                    )}
                  </Box>
                  {ticket.deliveryNotes && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight={500} display="block" mb={0.25}>
                        Additional Information
                      </Typography>
                      <Typography variant="body2" color="text.secondary">{ticket.deliveryNotes}</Typography>
                    </Box>
                  )}
                </Box>
              </Paper>
            )}

            {/* Milestones */}
            {ticket.ticketType === 'MILESTONE' && ticket.milestones && ticket.milestones.length > 0 && (
              <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="subtitle1" fontWeight={700}>
                    Milestones
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {ticket.milestones.filter(m => m.status === 'COMPLETED').length} / {ticket.milestones.length} done
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {ticket.milestones.map((m, idx) => (
                    <Paper
                      key={m.id}
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        background: milestoneStatusBg(m.status),
                        borderLeft: `3px solid ${milestoneStatusColor(m.status)}`,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                        <Box
                          sx={{
                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0, mt: 0.25,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: milestoneStatusBg(m.status),
                            border: `1.5px solid ${milestoneStatusColor(m.status)}`,
                            color: milestoneStatusColor(m.status),
                            fontSize: '0.7rem', fontWeight: 700,
                          }}
                        >
                          {m.status === 'COMPLETED' ? <CheckCircle size={14} />
                            : m.status === 'DISPUTED' ? <AlertCircle size={14} />
                            : idx + 1}
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600}>{m.title}</Typography>
                          {m.description && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                              {richTextToPlainText(m.description)}
                            </Typography>
                          )}
                          {m.dueDate && (
                            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.25 }}>
                              Due: {formatDate(new Date(m.dueDate))}
                            </Typography>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
                          {m.amountSats && (
                            <>
                              <Chip
                                icon={<Zap size={10} />}
                                label={formatSats(m.amountSats, { compact: false })}
                                size="small"
                                sx={{ height: 22, fontSize: '0.65rem', fontWeight: 700, background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)' }}
                              />
                              <FiatHint sats={m.amountSats} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
                            </>
                          )}
                          <Chip
                            label={m.status}
                            size="small"
                            sx={{
                              height: 20, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase',
                              background: milestoneStatusBg(m.status), color: milestoneStatusColor(m.status),
                              border: `1px solid ${milestoneStatusColor(m.status)}33`,
                            }}
                          />
                        </Box>
                      </Box>
                    </Paper>
                  ))}
                </Box>

                {ticket.totalHours !== undefined && ticket.totalHours > 0 && (
                  <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={500}>
                      Total Estimated Hours
                    </Typography>
                    <Typography variant="h6" fontWeight={700} color="primary.main">
                      {ticket.totalHours} {ticket.totalHours === 1 ? 'Hour' : 'Hours'}
                    </Typography>
                  </Box>
                )}
              </Paper>
            )}

            {/* Chat */}
            {(isBuyer || isSeller) && ticket.status !== 'COMPLETED' && ticket.status !== 'CANCELLED' && (
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                <Box
                  onClick={() => setChatOpen(o => {
                    const next = !o
                    try { localStorage.setItem('ticket_chat_open', String(next)) } catch { /* ignore */ }
                    return next
                  })}
                  sx={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    px: { xs: 2.5, sm: 3 }, py: 1.5, cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ChatBubbleOutlineIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                    <Typography variant="subtitle2" fontWeight={700}>Chat</Typography>
                    <Typography variant="caption" color="text.disabled" fontFamily="monospace">
                      #{ticket.id.slice(0, 8)}
                    </Typography>
                    <Chip
                      size="small"
                      label="E2E Encrypted"
                      color="success"
                      variant="outlined"
                      sx={{ fontSize: '0.6rem', height: 18 }}
                    />
                  </Box>
                  <Tooltip title={chatOpen ? 'Collapse' : 'Expand'}>
                    <IconButton size="small" tabIndex={-1}>
                      <ExpandMoreIcon
                        sx={{
                          fontSize: 20,
                          transition: 'transform 0.2s',
                          transform: chatOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        }}
                      />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Collapse in={chatOpen} appear={false}>
                  <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                    <TicketChat ticket={ticket} />
                  </Box>
                </Collapse>
              </Paper>
            )}

          </Box>
        </Grid>

        {/* ── Right column: sticky action panel ───────────────────────────── */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

            {/* Review Panel */}
            {isCompleted && (isBuyer || isSeller) && (
              <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                  Reputation
                </Typography>

                {ticket.visibility === 'PRIVATE' ? (
                  <Alert severity="info" icon={<LockOutlinedIcon />}>
                    <Typography variant="caption" fontWeight={600} display="block">
                      Private Trade — No Public Review
                    </Typography>
                    <Typography variant="caption">
                      Private trades do not build reputation. Reviews and COL-Points are disabled for this ticket.
                    </Typography>
                  </Alert>
                ) : (
                  <>
                    {canReview && (
                      <>
                        <Alert severity="success" sx={{ mb: 2 }} icon={<StarIcon />}>
                          <Typography variant="caption" fontWeight={600} display="block" mb={0.5}>
                            Rate this collaboration
                          </Typography>
                          <Typography variant="caption">
                            Earn +3 COL-Points when both parties submit a review.
                          </Typography>
                        </Alert>
                        <Button
                          fullWidth variant="contained"
                          startIcon={<StarIcon />}
                          onClick={() => setReviewOpen(true)}
                          sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                          Write Review
                        </Button>
                      </>
                    )}

                    {userHasReviewed && !reviewWindowClosed && (
                      <Alert severity="info" icon={<CheckCircleIcon />}>
                        <Typography variant="caption" fontWeight={600} display="block">
                          Review submitted ✓
                        </Typography>
                        <Typography variant="caption">
                          +3 COL-Points once your partner also reviews.
                        </Typography>
                      </Alert>
                    )}

                    {reviewWindowClosed && (
                      <Alert severity="warning">
                        <Typography variant="caption">
                          Review window (14 days) has closed.
                        </Typography>
                      </Alert>
                    )}
                  </>
                )}
              </Paper>
            )}

            {/* ADR-152 §A4 / PROB-002 A2: Mutual-Arbiter Setup (Phase 2.7) — only meaningful
                for private-mode tickets; the panel self-hides for PUBLIC/NONE disputeMode. */}
            <MutualArbiterPanel ticket={ticket} />

            {/* Action Panel */}
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 2.5, sm: 3 },
                display: 'flex', flexDirection: 'column', gap: 2,
                position: { lg: 'sticky' }, top: { lg: 80 },
              }}
            >
              {/* Header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                <Box
                  sx={{
                    width: 36, height: 36, borderRadius: 2,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: ticket.status === 'COMPLETED' ? 'rgba(72,187,120,0.12)' : 'rgba(99,179,237,0.12)',
                    color: ticket.status === 'COMPLETED' ? 'var(--color-status-success)' : 'var(--color-primary-50)',
                  }}
                >
                  {ticket.status === 'COMPLETED' ? <CheckCircle size={18} /> : <Zap size={18} />}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {isBuyer ? 'You are the buyer' : isSeller ? 'You are the seller' : 'Observer'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {orderHeadline(ticket, { isBuyer, isSeller, isService })}
                  </Typography>
                </Box>
              </Box>

              {/* Dispute resolution — outcome + arbitrator reasoning, only
                  once a DAO Arbitration Council verdict resolved this
                  ticket. Previously only visible on the Council-only
                  dispute page, so a disputant never learned WHY (2026-09-18). */}
              {ticket.disputeResolution && (
                <Alert severity={ticket.disputeResolution.outcome === 'RELEASE' ? 'success' : 'info'}>
                  <Typography variant="body2" fontWeight={600}>
                    {ticket.disputeResolution.outcome === 'RELEASE' ? 'Dispute resolved — payment released to seller' : 'Dispute resolved — payment refunded to buyer'}
                  </Typography>
                  {ticket.disputeResolution.reasoning && (
                    <Typography variant="body2" sx={{ mt: 0.5 }}>
                      Arbitrator's reasoning: {ticket.disputeResolution.reasoning}
                    </Typography>
                  )}
                </Alert>
              )}

              <Divider />

              {/* Step flow (visible for buyer/seller only) */}
              {(isBuyer || isSeller) && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {steps.map((step, idx, arr) => (
                    <Box key={step.title}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1.25 }}>
                        <Box
                          sx={{
                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: step.done ? 'rgba(72,187,120,0.12)' : 'rgba(99,179,237,0.10)',
                            color: step.done ? 'var(--color-status-success)' : 'var(--color-primary-50)',
                          }}
                        >
                          {step.done ? <CheckCircle size={14} /> : <Clock size={14} />}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }}>
                            {step.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                            {step.desc}
                          </Typography>
                        </Box>
                      </Box>
                      {idx < arr.length - 1 && (
                        <Box
                          sx={{
                            width: 2, height: 8, ml: '13px', borderRadius: 1,
                            background: step.done ? 'var(--color-status-success)' : 'var(--theme-border)',
                            opacity: step.done ? 0.4 : 1,
                          }}
                        />
                      )}
                    </Box>
                  ))}
                </Box>
              )}

              {/* Escrow progress (SMART_ORDER) — only for tickets that actually
                  use escrow. A direct-pay ticket (escrowEnabled = false, the
                  production default per the ADR-381 production escrow guard)
                  has no escrow: showing "Escrow pending" with the full amount
                  would claim a state that does not exist (ADR-413 D5). */}
              {showsEscrowPanel(ticket) && (isBuyer || isSeller) && (
                <>
                  <Divider />
                  <EscrowStatus
                    totalAmount={amount}
                    releasedAmount={getEscrowReleasedAmount()}
                    status={getEscrowDisplayStatus(ticket.escrowStatus ?? '')}
                  />
                </>
              )}

              <Divider />

              {/* Action buttons */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>

                {/* SERVICE: seller must accept first */}
                {ticket.offerType === 'SERVICE' && ticket.status === 'PENDING' && isSeller && (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      fullWidth variant="contained" color="success"
                      startIcon={<ThumbUpIcon />}
                      onClick={() => handleSellerAction('accept')}
                      disabled={loading}
                      sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
                    >
                      Accept
                    </Button>
                    <Button
                      fullWidth variant="outlined" color="error"
                      startIcon={<ThumbDownIcon />}
                      onClick={() => handleSellerAction('reject')}
                      disabled={loading}
                      sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
                    >
                      Reject
                    </Button>
                  </Box>
                )}

                {/* SERVICE: buyer waiting */}
                {ticket.offerType === 'SERVICE' && ticket.status === 'PENDING' && isBuyer && (
                  <Alert severity="info" sx={{ py: 0.75 }}>
                    <Typography variant="caption">
                      Waiting for seller approval.
                    </Typography>
                  </Alert>
                )}

                {/* PRODUCT/ITEM: seller confirms after buyer pays */}
                {ticket.offerType !== 'SERVICE' && ticket.status === 'PAID' && isSeller && (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      fullWidth variant="contained" color="success"
                      startIcon={<ThumbUpIcon />}
                      onClick={() => handleSellerAction('accept')}
                      disabled={loading}
                      sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
                    >
                      Confirm & Start
                    </Button>
                    <Button
                      fullWidth variant="outlined" color="error"
                      startIcon={<ThumbDownIcon />}
                      onClick={() => handleSellerAction('reject')}
                      disabled={loading}
                      sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
                    >
                      Cancel
                    </Button>
                  </Box>
                )}

                {/* PRODUCT/ITEM: buyer waiting for seller to start */}
                {ticket.offerType !== 'SERVICE' && ticket.status === 'PAID' && isBuyer && (
                  <Alert severity="info" sx={{ py: 0.75 }}>
                    <Typography variant="caption">
                      Payment confirmed — waiting for seller to start fulfillment.
                    </Typography>
                  </Alert>
                )}

                {/* Generate invoice: legacy tickets only; every direct-pay rail is handled by TicketPaymentCard (ADR-399) */}
                {isBuyer && ticket.status === 'PENDING' && !ticket.lightningInvoice && ticket.offerType !== 'SERVICE' && !ticket.directPayRail && (
                  <Button
                    fullWidth variant="contained"
                    startIcon={<Zap size={16} />}
                    onClick={handleCreateInvoice}
                    disabled={loading}
                    sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
                  >
                    Generate Invoice
                  </Button>
                )}

                {isBuyer && ticket.status === 'IN_PROGRESS' && !ticket.lightningInvoice && !ticket.directPayRail && (
                  <Button
                    fullWidth variant="contained"
                    startIcon={<Zap size={16} />}
                    onClick={handleCreateInvoice}
                    disabled={loading}
                    sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
                  >
                    Generate Invoice
                  </Button>
                )}

                {/* Release payment — escrow tickets only (held funds to release) */}
                {isBuyer && ticket.status === 'IN_PROGRESS' && ticket.escrowEnabled && (
                  <Button
                    fullWidth variant="contained" color="success"
                    startIcon={<ShoppingCartCheckoutIcon />}
                    onClick={handleReleasePayment}
                    disabled={loading}
                    sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
                  >
                    Release Payment
                  </Button>
                )}

                {/* Confirm receipt — non-escrow (direct-pay) tickets already paid the
                    seller directly at checkout; this is a plain status confirmation,
                    never a second payment (ADR-255 D7). */}
                {isBuyer && ticket.status === 'IN_PROGRESS' && !ticket.escrowEnabled && (
                  <Button
                    fullWidth variant="contained" color="success"
                    startIcon={<ShoppingCartCheckoutIcon />}
                    onClick={handleConfirmReceipt}
                    disabled={loading}
                    sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
                  >
                    Confirm Receipt
                  </Button>
                )}

                {/* Dispute */}
                {canDispute && (
                  <Button
                    fullWidth variant="outlined" color="error"
                    startIcon={<ReportProblemIcon />}
                    onClick={() => setDisputeModalOpen(true)}
                    disabled={loading || ticket.status === 'DISPUTED'}
                    sx={{ textTransform: 'none', fontWeight: 500 }}
                  >
                    {ticket.status === 'DISPUTED' ? 'Dispute active' : 'Report issue'}
                  </Button>
                )}

                {loading && <LinearProgress sx={{ borderRadius: 1 }} />}
              </Box>
            </Paper>

            {/* Ticket Activity */}
            {(() => {
              const ticketNotifs = notifications
                .filter(n => !n.archived && (n.relatedId === ticket.id || n.meta?.ticketId === ticket.id))
                .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
                .slice(0, 8)
              return ticketNotifs.length > 0 && (
                <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Box
                      sx={{
                        width: 28, height: 28, borderRadius: '8px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        bgcolor: 'var(--theme-bg-hover)',
                        color: 'var(--theme-text-muted)',
                      }}
                    >
                      <Bell size={15} />
                    </Box>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Ticket Activity
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        ml: 'auto', px: 1, py: 0.25, borderRadius: 1, fontSize: '0.65rem', fontWeight: 600,
                        bgcolor: 'var(--theme-bg-hover)', color: 'var(--theme-text-muted)',
                      }}
                    >
                      {ticketNotifs.length}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {ticketNotifs.map((n, idx) => (
                      <Box
                        key={n.id}
                        sx={{
                          display: 'flex', alignItems: 'flex-start', gap: 1.5,
                          py: 1.25,
                          borderBottom: idx < ticketNotifs.length - 1 ? '1px solid var(--theme-border-subtle)' : 'none',
                          opacity: n.read ? 0.6 : 1,
                          cursor: !n.read ? 'pointer' : 'default',
                          '&:hover': !n.read ? { bgcolor: 'var(--theme-bg-hover)', borderRadius: 1, mx: -1, px: 1 } : {},
                        }}
                        onClick={() => { if (!n.read) markAsRead(n.id) }}
                      >
                        <Box
                          sx={{
                            mt: 0.25, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 28, height: 28, borderRadius: '8px',
                            color: !n.read ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
                            bgcolor: !n.read ? 'rgba(232, 69, 65, 0.08)' : 'var(--theme-bg-hover)',
                          }}
                        >
                          {getNotifIcon(n.type)}
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: !n.read ? 600 : 400,
                              color: 'var(--theme-text)',
                              lineHeight: 1.4,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              fontSize: '0.8rem',
                            }}
                          >
                            {n.title}
                          </Typography>
                          {(n.meta?.statusFrom || n.meta?.statusTo) && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                              {n.meta.statusFrom && (
                                <Chip
                                  label={NOTIF_STATUS_LABEL[n.meta.statusFrom] ?? n.meta.statusFrom}
                                  size="small" variant="outlined"
                                  sx={{
                                    fontSize: '0.65rem', height: 20,
                                    borderColor: `${NOTIF_STATUS_COLOR[n.meta.statusFrom] ?? 'var(--theme-border)'}66`,
                                    color: NOTIF_STATUS_COLOR[n.meta.statusFrom] ?? 'var(--theme-text-muted)',
                                    '& .MuiChip-label': { px: 0.75 },
                                  }}
                                />
                              )}
                              {n.meta.statusFrom && n.meta.statusTo && (
                                <ArrowRight size={10} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
                              )}
                              {n.meta.statusTo && (
                                <Chip
                                  label={NOTIF_STATUS_LABEL[n.meta.statusTo] ?? n.meta.statusTo}
                                  size="small"
                                  sx={{
                                    fontSize: '0.65rem', height: 20, fontWeight: 600,
                                    bgcolor: `${NOTIF_STATUS_COLOR[n.meta.statusTo] ?? 'var(--theme-text-muted)'}14`,
                                    color: NOTIF_STATUS_COLOR[n.meta.statusTo] ?? 'var(--theme-text-muted)',
                                    border: 'none',
                                    '& .MuiChip-label': { px: 0.75 },
                                  }}
                                />
                              )}
                            </Box>
                          )}
                          {n.meta?.amountSats != null && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                              <Zap size={12} style={{ color: 'var(--color-primary-50)' }} />
                              <Typography variant="body2" sx={{ color: 'var(--color-primary-50)', fontWeight: 600, fontSize: '0.75rem' }}>
                                {formatSats(n.meta.amountSats, { compact: false })}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                        <Typography
                          variant="body2"
                          sx={{ color: 'var(--theme-text-muted)', flexShrink: 0, mt: 0.25, fontSize: '0.7rem' }}
                        >
                          {formatTimeAgo(n.timestamp)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Paper>
              )
            })()}

          </Box>
        </Grid>

      </Grid>

      {/* Review Modal */}
      {reviewOpen && userPubkey && (
        <ReviewForm
          ticketId={ticket.id}
          reviewerPubkey={userPubkey}
          revieweePubkey={
            userPubkey === ticket.buyerPubkey
              ? ticket.sellerPubkey
              : ticket.buyerPubkey
          }
          offerType={ticket.offerType}
          onSuccess={() => {
            setUserHasReviewed(true)
            setReviewOpen(false)
            showSnackbar('Review submitted! +3 COL-Points if partner also reviews.', 'success')
          }}
          onCancel={() => setReviewOpen(false)}
        />
      )}

      <DisputeModal
        open={disputeModalOpen}
        onClose={() => setDisputeModalOpen(false)}
        onSubmit={handleOpenDispute}
      />

    </Box>
  )
}
