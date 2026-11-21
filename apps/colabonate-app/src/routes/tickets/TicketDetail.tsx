import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Box, Chip, CircularProgress, Typography, IconButton } from '@mui/material'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import SyncIcon from '@mui/icons-material/Sync'
import { PageContainer, DisputeBanner, AppealBanner } from '@ds/ui'
import { TicketDetailView } from '../../components/tickets/TicketDetailView'
import { NotFoundState } from '../../components/NotFoundState'
import { PageHeader } from '../../components/PageHeader'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { statusLabel } from '../../lib/ticket-status-config'
import { IdentityLevelBadge } from '../../components/identity/IdentityLevelBadge'
import { UserLink } from '../../components/user/UserLink'
import { useTicket, useIdentity } from '../../hooks/useEntityQueries'
import type { IdentityLevel } from '../../types/identity'
import type { TicketStatus } from '../../types/api'

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  PENDING:     { bg: 'rgba(245,166,35,0.15)',   text: '#B87A00' },
  ACCEPTED:    { bg: 'rgba(99,179,237,0.15)',   text: 'var(--color-primary-50)' },
  PAID:        { bg: 'rgba(16,185,129,0.15)',   text: '#059669' },
  IN_PROGRESS: { bg: 'rgba(99,179,237,0.15)',   text: 'var(--color-primary-50)' },
  COMPLETED:   { bg: 'rgba(72,187,120,0.15)',   text: '#276749' },
  DISPUTED:    { bg: 'rgba(245,101,101,0.15)',  text: '#C53030' },
  CANCELLED:   { bg: 'rgba(113,128,150,0.12)',  text: 'var(--color-neutral-5)' },
}
const STATUS_BADGE_FALLBACK = { bg: 'rgba(113,128,150,0.12)', text: 'var(--color-neutral-5)' }

export function TicketDetail() {
  const { ticketId } = useParams<{ ticketId: string }>()
  const navigate = useNavigate()

  const { data: ticket, isLoading: loading, error: queryError, refetch, isFetching } = useTicket(ticketId || '')
  const [error, setError] = useState<string | null>(null)

  const { data: sellerIdentity } = useIdentity(ticket?.sellerPubkey ?? '')
  const sellerIdentityLevel = sellerIdentity?.identityLevel ?? 0

  const containerRef = usePageAnimation(
    [{ selector: '.hero-animate', from: { duration: 0.5, stagger: 0.1, y: 20 } }],
    loading,
  )

  useEffect(() => {
    if (queryError) {
      setError(queryError instanceof Error ? queryError.message : 'Failed to load ticket.')
    }
  }, [queryError])

  const refreshTicket = async () => {
    await refetch()
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  if (error || !ticket) {
    return (
      <NotFoundState
        icon={<ReceiptLongIcon sx={{ fontSize: { xs: 44, sm: 52 } }} />}
        title="Ticket not found"
        message="This ticket may have been deleted, or the link is incorrect."
        detail={ticketId ? `Ticket ${ticketId}` : undefined}
        primary={{ label: 'Back to tickets', to: '/tickets' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  return (
    <PageContainer size="wide" spacing="md" ref={containerRef}>
      <div className="hero-animate">
        <PageHeader
          icon={<ReceiptLongIcon fontSize="medium" />}
          title={ticket.offer?.title ?? 'Ticket Detail'}
          subtitle={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 0.5 }}>
              <Chip
                label={ticket.ticketType.replace('_', ' ')}
                size="small"
                variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
              <Box
                component="span"
                sx={{
                  display: 'inline-flex', alignItems: 'center',
                  px: '6px', py: '2px', borderRadius: '4px',
                  fontSize: '12px', fontWeight: 700, letterSpacing: '0.07em',
                  textTransform: 'uppercase', lineHeight: 1,
                  bgcolor: (STATUS_BADGE[ticket.status] ?? STATUS_BADGE_FALLBACK).bg,
                  color: (STATUS_BADGE[ticket.status] ?? STATUS_BADGE_FALLBACK).text,
                }}
              >
                {statusLabel[ticket.status as TicketStatus] ?? ticket.status}
              </Box>
              <Typography variant="caption" color="text.disabled" fontFamily="monospace">
                #{ticket.id.slice(0, 8)}
              </Typography>
              
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <IconButton 
                  size="small" 
                  onClick={refreshTicket}
                  disabled={isFetching}
                  sx={{ 
                    p: 0.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                  }}
                >
                  <SyncIcon 
                    sx={{ 
                      fontSize: '1rem', 
                      color: isFetching ? 'primary.main' : 'text.disabled',
                      animation: isFetching ? 'spin 1s linear infinite' : 'none',
                      '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } }
                    }} 
                  />
                </IconButton>
              </Box>

              <IdentityLevelBadge level={sellerIdentityLevel as IdentityLevel} size="small" />
              {ticket && <UserLink pubkey={ticket.sellerPubkey} name="Seller Profile" size="small" />}
            </Box>
          }
          onBack={() => navigate(-1)}
          backLabel="Zurück"
        />
      </div>
      {ticket.status === 'DISPUTED' && (
        <div className="hero-animate">
          <DisputeBanner className="mb-4" />
        </div>
      )}
      {ticket.status === 'DISPUTED' && (
        <div className="hero-animate">
          <AppealBanner ticketId={ticket.id} className="mb-4" />
        </div>
      )}
      <div className="hero-animate">
        <TicketDetailView
          ticket={ticket}
          onBack={() => navigate(-1)}
        />
      </div>
    </PageContainer>
  )
}
