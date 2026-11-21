/**
 * Messages — Global DM Inbox View at /messages.
 *
 * ADR-152: Phase 2.5 + 2.6 — Inbox + Filter (All / Offers / Coops / Chat).
 * Fetches the user's cached DmMessages and renders them as clickable
 * cards. Click on an offer navigates to the PrivateOfferDetailPage
 * (built in Phase 2.3). Chat / cooperation are not yet navigable —
 * the full chat thread view is a later phase.
 */
import { useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { DmMessageCard, inferDmCategory, type DmCategory } from '../../components/messages/DmMessageCard'
import { useDmInbox } from '../../hooks/useDmInbox'
import type { DmMessage } from '../../hooks/useDmMessage'

type FilterTab = 'all' | DmCategory

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'offer', label: 'Offers' },
  { id: 'cooperation', label: 'Cooperations' },
  { id: 'chat', label: 'Chat' },
  { id: 'other', label: 'Other' },
]

export function Messages() {
  const navigate = useNavigate()
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDmInbox()
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [navError, setNavError] = useState<string | null>(null)

  const messages = useMemo(() => data?.pages.flatMap((p) => p.messages), [data])
  const totalCount = data?.pages[0]?.totalCount

  // Filter by tab
  const filtered = useMemo(() => {
    if (!messages) return []
    if (activeTab === 'all') return messages
    return messages.filter((m) => inferDmCategory(m) === activeTab)
  }, [messages, activeTab])

  // Count per category for tab badges
  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = { all: 0, offer: 0, cooperation: 0, chat: 0, other: 0 }
    if (!messages) return c
    for (const m of messages) {
      c.all++
      c[inferDmCategory(m)]++
    }
    return c
  }, [messages])

  const handleCardClick = useCallback((message: DmMessage) => {
    setNavError(null)
    const cat = inferDmCategory(message)
    if (cat === 'offer') {
      navigate(`/messages/offers/${message.id}`)
    } else {
      // chat + cooperation + other: chat thread view is a later phase
      setNavError('Chat and cooperation thread views are not yet available (Phase 2.7+).')
    }
  }, [navigate])

  // ── Loading ──
  if (isLoading) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <PageHeader
          title="Messages"
          subtitle="Loading your encrypted inbox…"
        />
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={32} />
        </Box>
      </PageContainer>
    )
  }

  // ── Error ──
  if (error) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <PageHeader title="Messages" subtitle="Failed to load your inbox" />
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          {error.message || 'An unexpected error occurred.'}
        </Alert>
      </PageContainer>
    )
  }

  // ── Not logged in ──
  if (!localStorage.getItem('pubkey')) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <PageHeader title="Messages" subtitle="Sign in to view your encrypted inbox" />
        <Alert severity="info">
          You need to be signed in to see your private messages.
        </Alert>
      </PageContainer>
    )
  }

  // ── Empty inbox ──
  const isEmpty = !messages || messages.length === 0

  return (
    <PageContainer size="narrow" spacing="lg">
      <PageHeader
        icon={
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: '20px',
              bgcolor: 'rgba(159,122,234,0.12)',
              border: '1px solid rgba(159,122,234,0.30)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LockOutlinedIcon sx={{ fontSize: 32, color: '#B794F4' }} />
          </Box>
        }
        title="Messages"
        subtitle={
          totalCount !== undefined
            ? `${totalCount} encrypted message${totalCount === 1 ? '' : 's'} in your inbox`
            : 'Your encrypted inbox'
        }
        actions={
          <Button
            size="small"
            variant="text"
            startIcon={isFetching ? <CircularProgress size={14} /> : <RefreshIcon />}
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Refresh
          </Button>
        }
      />

      {/* ── Filter Tabs ── */}
      <Box
        sx={{
          display: 'flex',
          gap: 1,
          overflowX: 'auto',
          pb: 1,
          // Hide scrollbar on mobile for tab bar
          '&::-webkit-scrollbar': { display: 'none' },
          scrollbarWidth: 'none',
        }}
      >
        {FILTER_TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const count = counts[tab.id]
          return (
            <Button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              size="small"
              variant={isActive ? 'contained' : 'outlined'}
              color="primary"
              sx={{
                minWidth: 'auto',
                whiteSpace: 'nowrap',
                borderRadius: '999px',
                px: 2,
                py: 0.5,
                fontSize: '0.8125rem',
                fontWeight: 600,
                textTransform: 'none',
              }}
            >
              {tab.label}
              {count > 0 && (
                <Box
                  component="span"
                  sx={{
                    ml: 0.75,
                    px: 0.75,
                    py: 0.125,
                    borderRadius: '999px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    bgcolor: isActive ? 'rgba(255,255,255,0.20)' : 'var(--theme-bg-subtle)',
                    color: isActive ? 'white' : 'var(--theme-text-secondary)',
                    minWidth: 18,
                    textAlign: 'center',
                    lineHeight: 1.4,
                  }}
                >
                  {count}
                </Box>
              )}
            </Button>
          )
        })}
      </Box>

      {navError && (
        <Alert severity="info" onClose={() => setNavError(null)}>
          {navError}
        </Alert>
      )}

      {/* ── Empty state per filter ── */}
      {isEmpty && activeTab === 'all' && (
        <EmptyInbox />
      )}
      {!isEmpty && filtered.length === 0 && (
        <Box
          sx={{
            p: 4,
            textAlign: 'center',
            border: '1px dashed var(--theme-border)',
            borderRadius: 'var(--radius-md, 8px)',
            color: 'var(--theme-text-muted)',
          }}
        >
          <Typography variant="body2">
            No messages in <strong>{FILTER_TABS.find((t) => t.id === activeTab)?.label}</strong>.
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
            Try another filter, or refresh.
          </Typography>
        </Box>
      )}

      {/* ── Message List ── */}
      <Stack spacing={1.5}>
        {filtered.map((m) => (
          <DmMessageCard
            key={m.id}
            message={m}
            onClick={() => handleCardClick(m)}
          />
        ))}
      </Stack>

      {/* ── Load older messages ── */}
      {hasNextPage && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            startIcon={isFetchingNextPage ? <CircularProgress size={14} /> : undefined}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </Box>
      )}
    </PageContainer>
  )
}

function EmptyInbox() {
  return (
    <Box
      sx={{
        p: 6,
        textAlign: 'center',
        border: '1px dashed var(--theme-border)',
        borderRadius: 'var(--radius-lg, 12px)',
        bgcolor: 'var(--theme-bg-subtle)',
      }}
    >
      <Box
        sx={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          bgcolor: 'rgba(159,122,234,0.10)',
          border: '1px solid rgba(159,122,234,0.30)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mx: 'auto',
          mb: 2,
        }}
      >
        <InboxOutlinedIcon sx={{ fontSize: 32, color: '#B794F4' }} />
      </Box>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5, color: 'var(--theme-text)' }}>
        Your inbox is empty
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360, mx: 'auto', lineHeight: 1.6 }}>
        Private offers and encrypted messages from other users will appear here. All messages are
        decrypted locally from NIP-17 gift wraps and never published publicly.
      </Typography>
    </Box>
  )
}
