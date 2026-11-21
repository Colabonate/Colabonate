import { useState, useEffect } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import WarningIcon from '@mui/icons-material/Warning'
import { cn } from '@ds/utils'

export interface AppealBannerProps {
  ticketId: string
  className?: string
}

interface DisputeData {
  id: string
  status: string
  verdictIssuedAt: string | null
  outcome: string | null
  verdicts: Array<{
    round: number
    outcome: string
    arbitratorPubkey: string
    reasoning: string | null
    createdAt: string
  }>
  appealWindowExpiresAt: string | null
}

function calcCountdown(expiresAt: string | null): { label: string; pct: number; expired: boolean } | null {
  if (!expiresAt) return null
  const remaining = new Date(expiresAt).getTime() - Date.now()
  if (remaining <= 0) return { label: 'Expired', pct: 0, expired: true }
  const total = 72 * 3600_000
  const pct = Math.min(100, (remaining / total) * 100)
  const h = Math.floor(remaining / 3600_000)
  const m = Math.floor((remaining % 3600_000) / 60_000)
  return { label: `${h}h ${m}m`, pct, expired: false }
}

export function AppealBanner({ ticketId, className }: AppealBannerProps) {
  const [dispute, setDispute] = useState<DisputeData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticketId) return
    fetch(`/api/disputes?ticketId=${ticketId}`)
      .then(r => r.json())
      .then(data => {
        const found = (data.disputes || []).find((d: DisputeData) =>
          ['RESOLVED_PENDING', 'APPEALED'].includes(d.status)
        )
        setDispute(found || null)
      })
      .catch(() => setDispute(null))
      .finally(() => setLoading(false))
  }, [ticketId])

  if (loading) {
    return (
      <Box className={cn('flex items-center justify-center py-3', className)}>
        <CircularProgress size={16} />
      </Box>
    )
  }

  if (!dispute) return null

  const { appealWindowExpiresAt, status } = dispute
  const countdown = calcCountdown(appealWindowExpiresAt)

  const isAppealed = status === 'APPEALED'

  return (
    <Box
      className={cn(
        'flex flex-col gap-2 px-4 py-3 rounded-lg border',
        isAppealed
          ? 'bg-purple-50 border-purple-300'
          : 'bg-amber-50 border-amber-300',
        className
      )}
    >
      <Box className="flex items-center gap-2">
        <WarningIcon sx={{ fontSize: 14 }} className={isAppealed ? 'text-purple-600' : 'text-amber-600'} />
        <Typography
          variant="caption"
          fontWeight={700}
          sx={{ color: isAppealed ? 'var(--color-purple-50)' : 'var(--color-amber-50)', textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: '0.65rem' }}
        >
          {isAppealed ? 'Appeal Filed — Round 2 Active' : 'Verdict Issued — Appeal Window Open'}
        </Typography>
      </Box>

      {countdown && !isAppealed && (
        <Box className="flex items-center gap-2">
          <CircularProgress
            variant="determinate"
            value={countdown.pct}
            size={18}
            thickness={4}
            sx={{ color: countdown.expired ? 'var(--color-text-muted)' : 'var(--color-amber-50)' }}
          />
          <Typography variant="caption" sx={{ color: 'var(--theme-text-secondary)', fontSize: '0.7rem' }}>
            {countdown.expired ? 'Window expired' : `${countdown.label} remaining to appeal`}
          </Typography>
        </Box>
      )}

      {isAppealed && (
        <Typography variant="caption" sx={{ color: 'var(--theme-text-secondary)', fontSize: '0.7rem', lineHeight: 1.5 }}>
          The losing party has filed an appeal. A new round of arbitrators is reviewing the case.
        </Typography>
      )}
    </Box>
  )
}