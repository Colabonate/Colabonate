import { useState } from 'react'
import { useTranslation } from '../../contexts/LocaleContext'
import {
  Alert,
  Avatar,
  Box,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import BoltIcon from '@mui/icons-material/Bolt'
import FlagIcon from '@mui/icons-material/Flag'
import HandshakeIcon from '@mui/icons-material/Handshake'
import LockIcon from '@mui/icons-material/Lock'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import {
  Modal,
  ModalHeader,
  ModalContent,
  ModalActions,
} from '@ds/ui'
import { apiCall } from '../../lib/api'
import { signAndPublishFromTemplate } from '../../lib/nostr-ticket'
import { useNotification } from '../../context/NotificationContext'
import type { OfferMilestone } from '../../types/api'

interface OfferConfirmationDialogProps {
  offer: {
    id: string
    title: string
    priceSats: number
    creatorPubkey: string
    ticketType?: string
    offerType?: 'SERVICE' | 'PRODUCT' | 'ITEM'
    offerMilestones?: OfferMilestone[]
    allowedVisibility?: number[]
  }
  onSuccess: () => void
  onCancel: () => void
}

export function OfferConfirmationDialog({ offer, onSuccess, onCancel }: OfferConfirmationDialogProps) {
  const { formatNumber } = useTranslation()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { addNotification } = useNotification()

  const allowedTiers = offer.allowedVisibility ?? [0]
  const showVisibilitySelector = allowedTiers.length > 1 || allowedTiers.includes(1)
  const [selectedVisibility, setSelectedVisibility] = useState<number>(allowedTiers.includes(0) ? 0 : allowedTiers[0])

  const userPubkey = localStorage.getItem('pubkey') ?? ''
  const isMilestone = offer.ticketType === 'MILESTONE'
  const isService = offer.offerType === 'SERVICE'
  const isItem = offer.offerType === 'ITEM'
  const milestones = offer.offerMilestones ?? []

  async function handleConfirm() {
    if (!userPubkey) {
      setError('Not logged in. Please log in first.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const response = await apiCall('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId: offer.id,
          buyerPubkey: userPubkey,
          sellerPubkey: offer.creatorPubkey,
          amountSats: offer.priceSats,
          visibility: selectedVisibility,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Error creating ticket')

      // NIP-B v2: Sign and publish Kind 30407 with NIP-07 or burner key (ADR-107)
      if (data.nostrEventTemplate) {
        signAndPublishFromTemplate(data.nostrEventTemplate).catch(() => {
          // Non-blocking — server already published with ephemeral key as fallback
        })
      }

      addNotification({
        type: 'offer',
        title: isService ? 'Anfrage gesendet' : 'Kauf erfolgreich',
        message: offer.title,
        relatedId: data.ticket?.id ?? data.id,
        actionUrl: data.ticket?.id ? `/tickets/${data.ticket.id}` : (data.id ? `/tickets/${data.id}` : undefined),
        meta: {
          offerTitle: offer.title,
          statusTo: isService ? 'PENDING' : 'IN_PROGRESS',
          partnerPubkey: offer.creatorPubkey,
          amountSats: offer.priceSats,
          role: 'buyer',
          ticketId: data.ticket?.id ?? data.id,
          ticketType: offer.ticketType,
          offerType: offer.offerType,
          buyerPubkey: userPubkey,
          sellerPubkey: offer.creatorPubkey,
        },
      })

      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error creating ticket')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onCancel}
      size="lg"
    >
      <ModalHeader
        title={isService ? 'Submit request' : 'Confirm purchase'}
        subtitle={offer.title}
        onClose={onCancel}
      />
      <ModalContent>
        {/* Offer Summary */}
        <Box sx={{ mb: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={600} color="text.primary" gutterBottom>
            {offer.title}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BoltIcon sx={{ fontSize: 20, color: 'primary.main' }} />
            <Typography variant="h6" fontWeight={700} color="primary.main">
              {formatNumber(offer.priceSats)} sats
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 2.5 }} />

        {/* Ticket Type */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: isMilestone ? 'secondary.main' : 'primary.main' }}>
            {isMilestone ? <FlagIcon sx={{ fontSize: 16 }} /> : <BoltIcon sx={{ fontSize: 16 }} />}
          </Avatar>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">
              Ticket type
            </Typography>
            <Typography variant="body2" fontWeight={600} color="text.primary">
              {isMilestone ? 'Milestone project' : 'Smart order'}
            </Typography>
          </Box>
        </Box>

        {/* Milestone list */}
        {isMilestone && milestones.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.75 }}>
              Milestones (set by seller)
            </Typography>
            <List dense disablePadding sx={{ bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden' }}>
              {milestones.map((m, i) => {
                const amtSats = Math.round(offer.priceSats * m.percentage / 100)
                return (
                  <ListItem key={m.id} divider={i < milestones.length - 1} sx={{ py: 0.75 }}>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" fontWeight={500}>
                            {i + 1}. {m.title}
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 1 }}>
                            <Chip label={`${m.percentage}%`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                            <Typography variant="caption" color="primary.main" fontWeight={600}>
                              {formatNumber(amtSats)} sats
                            </Typography>
                          </Box>
                        </Box>
                      }
                      secondary={m.description}
                    />
                  </ListItem>
                )
              })}
            </List>
          </Box>
        )}

        {/* Smart Order escrow info */}
        {!isMilestone && (
          <Box sx={{ mb: 2, bgcolor: 'action.hover', borderRadius: 1, p: 1.5 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
              Escrow phases
            </Typography>
            {[
              { label: 'Phase 1 – Reservation', pct: 25 },
              { label: 'Phase 2 – Delivery', pct: 50 },
              { label: 'Phase 3 – Completion', pct: 25 },
            ].map(p => (
              <Box key={p.label} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary">{p.label}</Typography>
                <Typography variant="caption" color="primary.main" fontWeight={600}>
                  {formatNumber(Math.round(offer.priceSats * p.pct / 100))} sats
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {/* Visibility Tier Selector (ADR-151) */}
        {showVisibilitySelector && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" sx={{ mb: 0.75 }}>
              Transaction visibility
            </Typography>
            <ToggleButtonGroup
              value={selectedVisibility}
              exclusive
              onChange={(_, v) => { if (v !== null) setSelectedVisibility(v) }}
              size="small"
              fullWidth
            >
              {allowedTiers.includes(0) && (
                <ToggleButton value={0} sx={{ textTransform: 'none', gap: 0.5 }}>
                  <LockOpenIcon sx={{ fontSize: 14 }} />
                  Public
                </ToggleButton>
              )}
              {allowedTiers.includes(1) && (
                <ToggleButton value={1} sx={{ textTransform: 'none', gap: 0.5 }}>
                  <LockIcon sx={{ fontSize: 14 }} />
                  Private payload
                </ToggleButton>
              )}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {selectedVisibility === 0
                ? 'Transaction details are public — max auditability & reputation.'
                : 'Commercial details encrypted — visible only to you, seller, and arbitrator on dispute.'}
            </Typography>
          </Box>
        )}

        {/* Trust note */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.disabled', mb: 2 }}>
          <LockIcon sx={{ fontSize: 14 }} />
          <Typography variant="caption">Payment secured via Lightning Escrow</Typography>
        </Box>

        {/* SERVICE vs PRODUCT – Next Steps */}
        {isService ? (
          <Alert severity="info" icon={<HandshakeIcon />}>
            <Typography variant="caption" fontWeight={600} display="block" gutterBottom>
              Process for service offers
            </Typography>
            <Typography variant="caption" component="div" sx={{ lineHeight: 1.7 }}>
              1. Your request is submitted with status <strong>Pending</strong><br />
              2. The seller reviews and <strong>accepts or rejects</strong><br />
              3. Upon acceptance, payment starts via Lightning
            </Typography>
          </Alert>
        ) : (
          <Alert severity="success" icon={<ShoppingCartIcon />}>
            <Typography variant="caption" fontWeight={600} display="block" gutterBottom>
              {isItem ? 'Single article purchase' : 'Immediately available'}
            </Typography>
            <Typography variant="caption">
              {isItem
                ? 'This is a single article. The Lightning invoice is issued immediately after purchase.'
                : 'Products are automatically confirmed. The Lightning invoice is issued immediately after purchase.'}
            </Typography>
          </Alert>
        )}

        {error && (
          <Typography variant="body2" color="error" sx={{ mt: 2, p: 1.5, bgcolor: 'error.light', borderRadius: 1 }}>
            {error}
          </Typography>
        )}
      </ModalContent>
      <ModalActions
        cancel={{ onClick: onCancel, children: 'Cancel', disabled: submitting }}
        confirm={{
          onClick: handleConfirm,
          children: submitting
            ? 'Processing...'
            : isService ? 'Send request' : 'Buy now',
          disabled: submitting,
          loading: submitting,
          startIcon: submitting ? undefined : (isService ? <HandshakeIcon /> : <ShoppingCartIcon />),
        }}
      />
    </Modal>
  )
}
