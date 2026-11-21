/**
 * PrivateOfferDetailPage — Route /messages/offers/:id
 *
 * ADR-152: Phase 2.3 — Privat-Offer-Detail-Page.
 * Fetches a DmMessage by id and renders the PrivateOfferDetail component.
 * Provides the page chrome (PageContainer, PageHeader, back button).
 */
import { useParams, useNavigate } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { NotFoundState } from '../../components/NotFoundState'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { PrivateOfferDetail } from '../../components/offers/PrivateOfferDetail'
import { useDmMessage } from '../../hooks/useDmMessage'

export function PrivateOfferDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, isLoading, error, refetch } = useDmMessage(id)

  if (isLoading) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <PageHeader title="Private Offer" subtitle="Decrypting gift wrap…" onBack={() => navigate('/messages')} />
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={32} />
        </Box>
      </PageContainer>
    )
  }

  if (error) {
    const is404 = error.status === 404
    return (
      <NotFoundState
        title={is404 ? 'Offer not found' : 'Failed to load'}
        message={is404
          ? 'This private offer no longer exists or has been removed from your inbox.'
          : (error.message || 'An unexpected error occurred.')}
        detail={id ? `Offer ${id}` : undefined}
        primary={{ label: 'Back to inbox', to: '/messages' }}
        secondary={is404 ? undefined : { label: 'Retry', onClick: () => refetch() }}
      />
    )
  }

  if (!data) {
    return null
  }

  const { message, payload } = data

  return (
    <PageContainer size="narrow" spacing="lg">
      <PageHeader
        title="Private Offer"
        subtitle="Decrypted from NIP-17 gift wrap"
        onBack={() => navigate('/messages')}
        backLabel="Back to Inbox"
      />
      <PrivateOfferDetail
        message={message}
        payload={payload}
        onAccepted={(ticketId) => navigate(`/tickets/${ticketId}`)}
        onClose={() => navigate('/messages')}
      />
    </PageContainer>
  )
}
