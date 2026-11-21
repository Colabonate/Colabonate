/**
 * MutualArbiterPanel — Display nomination state and nominate/accept actions.
 *
 * ADR-152 §A4 / PROB-002 A2: Phase 2.7 — Mutual-Arbiter UI.
 * Embeds on a private-mode ticket page above the dispute button. Renders one
 * of four phase views:
 *
 *  - NONE: nothing has been nominated. Buyer and seller see a "Nominate"
 *    button; the nominated arbiter (if any) is unknown.
 *  - ONE_NOMINATED: exactly one of {buyer, seller} has nominated an npub.
 *    The other party sees a "Nominate" button prefilled with the existing
 *    candidate; the nominated arbiter sees an "Accept as Arbiter" button only
 *    once BOTH_NOMINATED is reached.
 *  - BOTH_NOMINATED: both parties have nominated the same npub. That npub
 *    sees an "Accept as Arbiter" button. The buyer/seller see a "waiting on
 *    arbiter" message.
 *  - ACCEPTED: arbiter accepted. The panel collapses to a confirmation card.
 *  - REJECTED: rare; the arbiter explicitly rejected. Re-nominate possible.
 *
 * The panel is headless-ish: data flows in via props, mutations are wired by
 * the parent (so the panel is testable in isolation if needed).
 */

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import GavelIcon from '@mui/icons-material/Gavel'
import { apiCall } from '../../lib/api'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import {
  useArbiters,
  deriveArbiterPhase,
} from '../../hooks/useArbiters'
import { useNominateArbiter } from '../../hooks/useNominateArbiter'
import { useAcceptArbiter } from '../../hooks/useAcceptArbiter'
import { shouldShowVerdictCard } from '../../hooks/useArbiterVerdict'
import { NominateArbiterModal } from './NominateArbiterModal'
import { PrivateVerdictCard } from './PrivateVerdictCard'
import type {
  PrivateArbiterNomination,
  Ticket,
} from '../../types/api'

export interface MutualArbiterPanelProps {
  ticket: Pick<Ticket, 'id' | 'buyerPubkey' | 'sellerPubkey' | 'disputeMode' | 'status' | 'viewerRole'> & {
    offer?: { title?: string }
  }
  /**
   * If true, the panel renders nothing when there's nothing to act on
   * (e.g. when the ticket is COMPLETED and there's no need to set up an
   * arbiter post-hoc). Default false — we always show the panel for
   * PRIVATE disputeMode tickets.
   */
  hideIfInactive?: boolean
  /** Optional refetch interval (ms). Defaults to 0 (no polling). */
  refetchInterval?: number
}

function shortPubkey(pk: string): string {
  if (pk.length <= 12) return pk
  return `${pk.slice(0, 6)}…${pk.slice(-6)}`
}

interface StepDotProps {
  done: boolean
  active: boolean
  label: string
  hint?: string
}

function StepDot({ done, active, label, hint }: StepDotProps) {
  const Icon = done
    ? CheckCircleIcon
    : active
    ? HourglassEmptyIcon
    : RadioButtonUncheckedIcon
  const color = done
    ? 'var(--color-status-success, #48BB78)'
    : active
    ? 'var(--color-primary-50)'
    : 'var(--theme-text-muted, #858C94)'
  return (
    <Stack alignItems="center" spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: done
            ? 'rgba(72,187,120,0.12)'
            : active
            ? 'rgba(99,179,237,0.14)'
            : 'var(--theme-bg-subtle, rgba(0,0,0,0.04))',
          color,
          border: '2px solid',
          borderColor: done
            ? 'rgba(72,187,120,0.5)'
            : active
            ? 'var(--color-primary-50)'
            : 'var(--theme-text-muted, #C0C5CC)',
          transition: 'all 0.2s',
        }}
      >
        <Icon sx={{ fontSize: 16 }} />
      </Box>
      <Typography
        variant="caption"
        fontWeight={active || done ? 700 : 500}
        sx={{ textAlign: 'center', color, lineHeight: 1.2 }}
      >
        {label}
      </Typography>
      {hint && (
        <Typography
          variant="caption"
          sx={{
            textAlign: 'center',
            color: 'var(--theme-text-muted, #858C94)',
            fontSize: '0.65rem',
            lineHeight: 1.2,
            maxWidth: 110,
          }}
        >
          {hint}
        </Typography>
      )}
    </Stack>
  )
}

export function MutualArbiterPanel({
  ticket,
  hideIfInactive = false,
  refetchInterval = 0,
}: MutualArbiterPanelProps) {
  const { id: ticketId, buyerPubkey, sellerPubkey, disputeMode, status, viewerRole } = ticket

  // current user
  const currentPubkey =
    typeof window !== 'undefined' ? localStorage.getItem('pubkey') : null

  // ADR-162 / NIP-51: load the viewer's trusted-arbiter follow-set so the
  // nomination modal can offer a quick-pick. Best-effort — empty on failure.
  const [trustedArbiters, setTrustedArbiters] = useState<string[]>([])
  useEffect(() => {
    if (!currentPubkey) return
    let cancelled = false
    apiCall(`/api/nostr/trusted-arbiters/${currentPubkey}`)
      .then(r => r.json())
      .then((data: { pubkeys?: string[] }) => {
        if (!cancelled && Array.isArray(data.pubkeys)) setTrustedArbiters(data.pubkeys)
      })
      .catch(() => {
        /* best-effort; modal still works with manual input */
      })
    return () => {
      cancelled = true
    }
  }, [currentPubkey])

  const role: 'buyer' | 'seller' | 'arbiter' | 'observer' = useMemo(() => {
    if (!currentPubkey) return 'observer'
    if (currentPubkey === buyerPubkey) return 'buyer'
    if (currentPubkey === sellerPubkey) return 'seller'
    return 'arbiter' // or just 'observer' — refined later via nomination
  }, [currentPubkey, buyerPubkey, sellerPubkey])

  const isParty = role === 'buyer' || role === 'seller'
  const isArbiterCandidate = role === 'arbiter' // any non-party user

  const { data, isLoading, error, refetch, isFetching } = useArbiters(ticketId, {
    refetchInterval: refetchInterval > 0 ? refetchInterval : undefined,
  })

  const phase = useMemo(() => deriveArbiterPhase(data), [data])
  const nominations = data?.nominations ?? []
  const ready = data?.ready_for_dispute ?? false

  // The "primary" nomination row: a fully-nominated (or accepted) one takes
  // precedence; otherwise the first row.
  const primaryNomination: PrivateArbiterNomination | null = useMemo(() => {
    if (nominations.length === 0) return null
    return (
      nominations.find((n) => n.nominatedByBuyer && n.nominatedBySeller) ??
      nominations.find((n) => n.acceptedAt) ??
      nominations[0]
    )
  }, [nominations])

  const nominatedArbiterPubkey = primaryNomination?.arbiterPubkey ?? null
  const isCurrentUserNominatedArbiter =
    !!currentPubkey &&
    !!nominatedArbiterPubkey &&
    currentPubkey === nominatedArbiterPubkey

  const showVerdict = shouldShowVerdictCard({
    viewerRole: viewerRole ?? null,
    phase,
    ticketStatus: status,
    nomination: primaryNomination,
  })

  // -- Mutations -------------------------------------------------------------
  const nominate = useNominateArbiter(ticketId)
  const accept = useAcceptArbiter(ticketId)

  // -- UI state --------------------------------------------------------------
  const [nominateOpen, setNominateOpen] = useState(false)
  const [nominateError, setNominateError] = useState<string | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false) // collapsed by default (Phase 6: mobile-first)

  const handleNominate = useCallback(
    async (arbiterPubkey: string) => {
      if (!currentPubkey) {
        setNominateError('You must be logged in to nominate an arbiter.')
        return
      }
      setNominateError(null)
      try {
        await nominate.mutateAsync({ callerPubkey: currentPubkey, arbiterPubkey })
        setNominateOpen(false)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to nominate arbiter'
        setNominateError(msg)
      }
    },
    [currentPubkey, nominate],
  )

  const handleAccept = useCallback(async () => {
    if (!nominatedArbiterPubkey) return
    setAcceptError(null)
    try {
      await accept.mutateAsync({ arbiterPubkey: nominatedArbiterPubkey })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to accept arbiter role'
      setAcceptError(msg)
    }
  }, [nominatedArbiterPubkey, accept])

  // -- Guards ----------------------------------------------------------------
  if (disputeMode !== 'PRIVATE') {
    if (hideIfInactive) return null
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: 'var(--radius-md, 8px)',
          borderColor: 'divider',
          bgcolor: 'var(--theme-bg-subtle, rgba(0,0,0,0.02))',
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <LockOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Typography variant="body2" color="text.secondary">
            Mutual-arbiter setup is only relevant for private-mode tickets
            (this ticket uses <strong>{disputeMode ?? 'PUBLIC'}</strong> dispute
            handling).
          </Typography>
        </Stack>
      </Paper>
    )
  }

  // -- Render ----------------------------------------------------------------

  const buyerNominated = nominations.some((n) => n.nominatedByBuyer)
  const sellerNominated = nominations.some((n) => n.nominatedBySeller)
  const step1Done = buyerNominated && sellerNominated
  const step2Done = ready
  const step3Done = ready // same flag — once accepted, dispute can be opened

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 2.5 },
        borderRadius: 'var(--radius-lg, 12px)',
        borderColor: 'rgba(159,122,234,0.4)',
        bgcolor: 'rgba(159,122,234,0.04)',
      }}
      data-testid="mutual-arbiter-panel"
    >
      <Stack spacing={2}>
        {/* Header */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
        >
          <Stack direction="row" alignItems="center" spacing={1.25}>
            <GavelIcon sx={{ color: '#9F7AEA' }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
              Mutual Arbiter Setup
            </Typography>
            <Chip
              label="PRIVATE TRADE"
              size="small"
              sx={{
                bgcolor: 'rgba(159,122,234,0.12)',
                color: '#6B46C1',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                height: 20,
              }}
            />
          </Stack>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="Refresh">
              <span>
                <IconButton
                  size="small"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  aria-label="Refresh arbiter state"
                >
                  <RefreshIcon
                    sx={{
                      fontSize: 18,
                      animation: isFetching ? 'spin 1s linear infinite' : 'none',
                      '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
                    }}
                  />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={expanded ? 'Collapse' : 'Expand'}>
              <IconButton
                size="small"
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? 'Collapse' : 'Expand'}
              >
                <Collapse in={expanded} orientation="horizontal">
                  <CancelOutlinedIcon sx={{ fontSize: 18, opacity: 0 }} />
                </Collapse>
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <Collapse in={expanded} unmountOnExit={false}>
          {isLoading && !data ? (
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                Loading arbiter state…
              </Typography>
            </Stack>
          ) : error ? (
            <Alert severity="error">
              Failed to load arbiter nominations: {error.message}
            </Alert>
          ) : (
            <Stack spacing={2.5}>
              {/* Explainer */}
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
                Private trades don't use the public DAO-Council dispute path.
                Both buyer and seller must nominate the <strong>same</strong>{' '}
                trusted npub; that person must then accept the role before a
                dispute can be opened.
              </Typography>

              {/* Stepper */}
              <Stack
                direction="row"
                alignItems="flex-start"
                spacing={1.5}
                sx={{
                  px: { xs: 0, sm: 1 },
                  '& > .MuiStack-root:first-of-type, & > .MuiStack-root:last-of-type':
                    { flex: '0 0 auto', maxWidth: 110 },
                }}
              >
                <StepDot
                  done={step1Done}
                  active={!step1Done && (buyerNominated || sellerNominated)}
                  label="Nominate"
                  hint="Buyer & Seller"
                />
                <Divider
                  sx={{
                    flex: 1,
                    alignSelf: 'center',
                    borderColor: step1Done
                      ? 'rgba(72,187,120,0.5)'
                      : 'var(--theme-text-muted, #C0C5CC)',
                    borderBottomWidth: 2,
                    mt: '-22px',
                  }}
                />
                <StepDot
                  done={step2Done}
                  active={step1Done && !step2Done}
                  label="Accept"
                  hint="Arbiter"
                />
                <Divider
                  sx={{
                    flex: 1,
                    alignSelf: 'center',
                    borderColor: step2Done
                      ? 'rgba(72,187,120,0.5)'
                      : 'var(--theme-text-muted, #C0C5CC)',
                    borderBottomWidth: 2,
                    mt: '-22px',
                  }}
                />
                <StepDot
                  done={step3Done}
                  active={false}
                  label="Dispute-Ready"
                  hint="Open dispute"
                />
              </Stack>

              {/* Current state detail */}
              <Stack spacing={1}>
                {phase === 'NONE' && (
                  <Typography variant="body2" color="text.secondary">
                    No arbiter has been nominated yet. Either party can start the
                    process.
                  </Typography>
                )}

                {phase === 'ONE_NOMINATED' && primaryNomination && (
                  <Stack spacing={0.5}>
                    <Typography variant="body2" color="text.secondary">
                      One party has nominated{' '}
                      <code style={{ fontFamily: 'monospace' }}>
                        {shortPubkey(primaryNomination.arbiterPubkey)}
                      </code>
                      . Waiting for the {primaryNomination.nominatedByBuyer ? 'seller' : 'buyer'} to
                      nominate the same npub.
                    </Typography>
                  </Stack>
                )}

                {phase === 'BOTH_NOMINATED' && primaryNomination && (
                  <Stack spacing={0.5}>
                    <Typography variant="body2" color="text.secondary">
                      Both parties nominated{' '}
                      <code style={{ fontFamily: 'monospace' }}>
                        {shortPubkey(primaryNomination.arbiterPubkey)}
                      </code>
                      . Waiting for that npub to accept the role.
                    </Typography>
                  </Stack>
                )}

                {phase === 'ACCEPTED' && primaryNomination && (
                  <Alert severity="success" icon={<CheckCircleIcon />}>
                    Arbiter{' '}
                    <code style={{ fontFamily: 'monospace' }}>
                      {shortPubkey(primaryNomination.arbiterPubkey)}
                    </code>{' '}
                    accepted. A private dispute can now be opened by either party.
                  </Alert>
                )}

                {phase === 'REJECTED' && (
                  <Alert severity="warning" icon={<CancelOutlinedIcon />}>
                    The nominated arbiter rejected the role. Both parties can
                    nominate a different npub to retry.
                  </Alert>
                )}
              </Stack>

              {/* Actions */}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                {/* Buyer / Seller: Nominate */}
                {isParty && phase !== 'ACCEPTED' && phase !== 'REJECTED' && (
                  <Button
                    variant={phase === 'NONE' ? 'contained' : 'outlined'}
                    color="primary"
                    size="medium"
                    startIcon={<GavelIcon />}
                    onClick={() => {
                      setNominateError(null)
                      setNominateOpen(true)
                    }}
                    disabled={nominate.isPending}
                    data-testid="nominate-arbiter-button"
                  >
                    {phase === 'NONE' ? 'Nominate Arbiter' : 'Re-nominate'}
                  </Button>
                )}

                {/* Nominated arbiter: Accept */}
                {isCurrentUserNominatedArbiter && phase === 'BOTH_NOMINATED' && (
                  <Button
                    variant="contained"
                    color="primary"
                    size="medium"
                    startIcon={<CheckCircleIcon />}
                    onClick={handleAccept}
                    disabled={accept.isPending}
                    data-testid="accept-arbiter-button"
                  >
                    {accept.isPending ? 'Accepting…' : 'Accept as Arbiter'}
                  </Button>
                )}

                {/* Nominated-but-not-fully arbiter hint */}
                {isArbiterCandidate &&
                  !isCurrentUserNominatedArbiter &&
                  nominatedArbiterPubkey &&
                  phase !== 'ACCEPTED' && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ alignSelf: 'center' }}
                    >
                      The nominated arbiter is{' '}
                      <code style={{ fontFamily: 'monospace' }}>
                        {shortPubkey(nominatedArbiterPubkey)}
                      </code>{' '}
                      — not your pubkey.
                    </Typography>
                  )}
              </Stack>

              {acceptError && (
                <Alert severity="error" onClose={() => setAcceptError(null)}>
                  {acceptError}
                </Alert>
              )}

              {showVerdict && nominatedArbiterPubkey && (
                <PrivateVerdictCard
                  ticketId={ticketId}
                  arbiterPubkey={nominatedArbiterPubkey}
                  ticketTitle={ticket.offer?.title}
                />
              )}

              {/* Helper text: how the nominated arbiter learns */}
              {phase === 'BOTH_NOMINATED' && !isCurrentUserNominatedArbiter && (
                <Alert severity="info" icon={false}>
                  The nominated arbiter can accept via this page after both
                  parties have agreed. They can also accept via the Open Dispute
                  flow once it's started.{' '}
                  <strong>Phase 2.8</strong> will wire a NIP-17 DM notification
                  to the nominated npub.
                  <Box sx={{ mt: 0.5 }}>
                    <Button
                      size="small"
                      variant="text"
                      endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                      onClick={() => window.open('https://njump.me/' + nominatedArbiterPubkey, '_blank')}
                      disabled={!nominatedArbiterPubkey}
                    >
                      View npub on njump.me
                    </Button>
                  </Box>
                </Alert>
              )}
            </Stack>
          )}
        </Collapse>
      </Stack>

      <NominateArbiterModal
        open={nominateOpen}
        onClose={() => {
          setNominateOpen(false)
          setNominateError(null)
        }}
        onSubmit={handleNominate}
        existingArbiterPubkey={
          phase === 'ONE_NOMINATED' && primaryNomination
            ? primaryNomination.arbiterPubkey
            : undefined
        }
        submitting={nominate.isPending}
        errorMessage={nominateError}
        trustedArbiters={trustedArbiters}
      />
    </Paper>
  )
}
