import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material'
import { signOpenDisputeEvent, signReleaseMilestoneEvent } from '../../lib/escrow-auth-events'
import {
  checkEscrowTradeFunding,
  claimEscrowTimeoutRefund,
  openEscrowDispute,
  releaseEscrowMilestone,
  type EscrowTrade,
  type EscrowTradeState,
} from '../../lib/escrow-trade'
import { icpTradeStateView, type EscrowAction, type EscrowActor } from '../../lib/icp-escrow-status'

/**
 * TradeActionBar — the cockpit's D6 action bar (ADR-357). Exactly the actions
 * the current state authorizes for this actor, driven by `icpTradeStateView`
 * (STATE-MODEL §4). One primary action at a time; a concurrent duplicate is a
 * 409 the server maps to ALREADY_COMPLETED, never an error here.
 */
export function TradeActionBar({
  trade,
  canisterState,
  viewerPubkey,
  onChanged,
}: {
  trade: EscrowTrade
  canisterState: EscrowTradeState | null
  viewerPubkey: string | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<EscrowAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [releaseIdx, setReleaseIdx] = useState<number | null>(null)

  const actor: EscrowActor =
    viewerPubkey === trade.buyerPubkey ? 'buyer' : viewerPubkey === trade.sellerPubkey ? 'seller' : 'external'
  const state = (canisterState ?? trade.state) as EscrowTradeState
  const settled =
    trade.settledBuyerBps !== null && trade.settledSellerBps !== null
      ? { buyerBps: trade.settledBuyerBps, sellerBps: trade.settledSellerBps }
      : null
  const view = icpTradeStateView(state, actor, settled)

  const unreleased = trade.milestones.map((m, i) => ({ m, i })).filter(({ m }) => !m.released)
  const selIdx = releaseIdx ?? unreleased[0]?.i ?? null
  const hasTradeId = trade.canisterTradeId.length > 0

  async function run(action: EscrowAction, fn: () => Promise<unknown>) {
    setBusy(action)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function doRelease() {
    if (selIdx == null || !hasTradeId) return
    void run('release_milestone', async () => {
      const event = await signReleaseMilestoneEvent(BigInt(trade.canisterTradeId), selIdx)
      await releaseEscrowMilestone(trade.id, selIdx, event)
    })
  }

  function doDispute() {
    if (!hasTradeId) return
    if (!window.confirm('Open a dispute on this trade? The timeout refund becomes unavailable while disputed.')) return
    void run('open_dispute', async () => {
      const event = await signOpenDisputeEvent(BigInt(trade.canisterTradeId))
      await openEscrowDispute(trade.id, event)
    })
  }

  function doTimeoutRefund() {
    if (!window.confirm('Claim the timeout refund? This is permissionless and final — anyone may call it.')) return
    void run('timeout_refund', () => claimEscrowTimeoutRefund(trade.id))
  }

  function renderAction(action: EscrowAction) {
    const disabled = busy !== null
    switch (action) {
      case 'check_funding':
        return (
          <Button key={action} variant="outlined" disabled={disabled} onClick={() => void run('check_funding', () => checkEscrowTradeFunding(trade.id))} sx={{ textTransform: 'none' }}>
            {busy === 'check_funding' ? <CircularProgress size={16} sx={{ mr: 1 }} color="inherit" /> : null}
            Check funding
          </Button>
        )
      case 'release_milestone':
        return (
          <Box key={action} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="release-milestone-label">Milestone</InputLabel>
              <Select
                labelId="release-milestone-label"
                label="Milestone"
                value={selIdx ?? ''}
                disabled={disabled || unreleased.length === 0}
                onChange={(e) => setReleaseIdx(Number(e.target.value))}
              >
                {unreleased.map(({ m, i }) => (
                  <MenuItem key={i} value={i}>{i + 1} · {m.pctBps / 100}%</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button variant="contained" disabled={disabled || selIdx == null || !hasTradeId} onClick={doRelease} sx={{ textTransform: 'none' }}>
              {busy === 'release_milestone' ? <CircularProgress size={16} sx={{ mr: 1 }} color="inherit" /> : null}
              Release
            </Button>
          </Box>
        )
      case 'open_dispute':
        return (
          <Button key={action} variant="outlined" color="warning" disabled={disabled || !hasTradeId} onClick={doDispute} sx={{ textTransform: 'none' }}>
            {busy === 'open_dispute' ? <CircularProgress size={16} sx={{ mr: 1 }} color="inherit" /> : null}
            Open dispute
          </Button>
        )
      case 'timeout_refund':
        return (
          <Button key={action} variant="outlined" disabled={disabled} onClick={doTimeoutRefund} sx={{ textTransform: 'none' }}>
            {busy === 'timeout_refund' ? <CircularProgress size={16} sx={{ mr: 1 }} color="inherit" /> : null}
            Claim timeout refund
          </Button>
        )
      case 'submit_verdict':
        // REQ-DISPUTE-02: no DAO key configured → recorded but not enforceable.
        return (
          <Button key={action} variant="outlined" disabled sx={{ textTransform: 'none' }} title="Requires the DAO governance key (FU-253-H).">
            DAO verdict — not yet enforceable
          </Button>
        )
      default:
        return null
    }
  }

  if (!view.authorizedActions.length) {
    return view.notice ? (
      <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>{view.notice}</Typography>
    ) : null
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {view.notice && (
        <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>{view.notice}</Typography>
      )}
      {error && (
        <Alert severity="error" sx={{ borderRadius: 2 }} onClose={() => setError(null)}>{error}</Alert>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        {view.authorizedActions.map(renderAction)}
      </Box>
    </Box>
  )
}
