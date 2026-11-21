import {
  Avatar,
  Box,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Typography,
} from '@mui/material'
import { useTranslation } from '../../contexts/LocaleContext'
import { FiatHint } from '../currency/FiatHint'
import CheckIcon      from '@mui/icons-material/Check'
import LockIcon       from '@mui/icons-material/Lock'
import LockOpenIcon   from '@mui/icons-material/LockOpen'

interface EscrowPhase {
  label: string
  percentage: number
  description: string
}

interface EscrowStatusProps {
  totalAmount: number
  releasedAmount?: number
  status: 'pending' | 'held' | 'partially-released' | 'fully-released' | 'refunded'
  phases?: EscrowPhase[]
}

const defaultPhases: EscrowPhase[] = [
  { label: 'First payment',   percentage: 25, description: 'Upon delivery' },
  { label: 'Main payment',    percentage: 50, description: 'After quality check' },
  { label: 'Final payment',   percentage: 25, description: 'Upon completion' },
]

const statusConfig: Record<EscrowStatusProps['status'], {
  label: string
  description: string
  color: 'default' | 'warning' | 'success' | 'info' | 'error'
  progressColor: 'primary' | 'warning' | 'success' | 'error' | 'info'
}> = {
  pending:             { label: 'Escrow pending',             description: 'Waiting for payment',                 color: 'default',  progressColor: 'primary' },
  held:                { label: 'In escrow',                  description: 'Amount securely held',                color: 'info',     progressColor: 'primary' },
  'partially-released': { label: 'Partially released',        description: '% released',                          color: 'warning',  progressColor: 'warning' },
  'fully-released':    { label: 'Fully released',             description: 'All payments completed',              color: 'success',  progressColor: 'success' },
  refunded:            { label: 'Refunded',                   description: 'Amount refunded to buyer',            color: 'error',    progressColor: 'error'   },
}

export function EscrowStatus({
  totalAmount,
  releasedAmount = 0,
  status,
  phases = defaultPhases,
}: EscrowStatusProps) {
  const { formatNumber } = useTranslation()
  const releasePercentage = totalAmount > 0 ? (releasedAmount / totalAmount) * 100 : 0
  const cfg = statusConfig[status]

  const descriptionText = status === 'partially-released'
    ? `${releasePercentage.toFixed(0)}% freigegeben`
    : cfg.description

  const calculatePhaseStatus = (phaseIndex: number) => {
    const cumulativePct = phases
      .slice(0, phaseIndex + 1)
      .reduce((sum, p) => sum + p.percentage, 0)
    if (status === 'fully-released' || status === 'refunded') return 'released'
    if (status === 'pending') return 'pending'
    return releasePercentage >= cumulativePct ? 'released' : 'locked'
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2.5 }}>
        <Box>
          <Typography variant="h6" fontWeight={600} mb={0.5}>Escrow status</Typography>
          <Chip label={cfg.label} color={cfg.color} size="small" sx={{ fontWeight: 600 }} />
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="h5" fontWeight={700} color="primary.main">
            {formatNumber(totalAmount)} sats
          </Typography>
          <FiatHint sats={totalAmount} className="block text-[13px]" style={{ color: 'var(--theme-text-muted)' }} />
          {releasedAmount > 0 && (
            <Typography variant="caption" color="text.secondary">
              {formatNumber(releasedAmount)} sats released
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── Fortschrittsbalken ────────────────────────────────────────────── */}
      <Box mb={0.75}>
        <LinearProgress
          variant="determinate"
          value={status === 'fully-released' || status === 'refunded' ? 100 : releasePercentage}
          color={cfg.progressColor}
          sx={{ height: 10, borderRadius: 5 }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary">{descriptionText}</Typography>

      {/* ── Zahlungsphasen ───────────────────────────────────────────────── */}
      {status !== 'pending' && status !== 'refunded' && (
        <>
          <Divider sx={{ my: 2.5 }} />
          <Typography variant="body2" fontWeight={600} color="text.secondary" mb={1.5}>
            Payment phases
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {phases.map((phase, index) => {
              const phaseStatus = calculatePhaseStatus(index)
              const isReleased = phaseStatus === 'released'
              const isLocked   = phaseStatus === 'locked'

              return (
                <Box
                  key={index}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1.5,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: isReleased ? 'success.light' : isLocked ? 'divider' : 'primary.light',
                    bgcolor: isReleased ? 'success.50' : isLocked ? 'action.hover' : 'primary.50',
                    // MUI doesn't have .50 shades natively — use alpha fallback
                    backgroundColor: isReleased
                      ? 'rgba(35, 202, 97, 0.08)'
                      : isLocked
                      ? 'rgba(0,0,0,0.02)'
                      : 'rgba(232, 69, 65, 0.06)',
                  }}
                >
                  <Avatar
                    sx={{
                      width: 32,
                      height: 32,
                      bgcolor: isReleased ? 'success.main' : isLocked ? 'action.disabled' : 'primary.main',
                      flexShrink: 0,
                    }}
                  >
                    {isReleased
                      ? <CheckIcon sx={{ fontSize: 18 }} />
                      : isLocked
                      ? <LockIcon sx={{ fontSize: 16 }} />
                      : <LockOpenIcon sx={{ fontSize: 16 }} />
                    }
                  </Avatar>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      color={isReleased ? 'success.dark' : isLocked ? 'text.disabled' : 'text.primary'}
                    >
                      {phase.label} ({phase.percentage}%)
                    </Typography>
                    <Typography
                      variant="caption"
                      color={isReleased ? 'success.main' : 'text.disabled'}
                    >
                      {phase.description}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                    <Typography
                      variant="body2"
                      fontWeight={700}
                      color={isReleased ? 'success.main' : isLocked ? 'text.disabled' : 'primary.main'}
                    >
                      {formatNumber((totalAmount * phase.percentage) / 100)} sats
                    </Typography>
                    <FiatHint sats={(totalAmount * phase.percentage) / 100} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
                  </Box>
                </Box>
              )
            })}
          </Box>
        </>
      )}

      {/* ── Hinweis ──────────────────────────────────────────────────────── */}
      <Box
        sx={{
          mt: 2.5,
          p: 1.5,
          borderRadius: 1,
          bgcolor: 'action.hover',
          display: 'flex',
          gap: 1,
          alignItems: 'flex-start',
        }}
      >
        <LockIcon fontSize="small" color="action" sx={{ flexShrink: 0, mt: 0.15 }} />
        <Typography variant="caption" color="text.secondary">
          <strong>Note:</strong> The escrow payment protects both buyer and seller.
          Payments are only released when both parties confirm the transaction.
        </Typography>
      </Box>

    </Paper>
  )
}
