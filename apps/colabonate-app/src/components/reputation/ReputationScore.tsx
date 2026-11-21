import { Box, Rating, Tooltip, Typography } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

interface ReputationScoreProps {
  score: number
  reviewCount: number
  size?: 'compact' | 'full'
}

export function ReputationScore({ score, reviewCount, size = 'compact' }: ReputationScoreProps) {
  const scoreDisplay = score.toFixed(2)

  const tooltipContent = (
    <Box sx={{ p: 1, maxWidth: 220 }}>
      <Typography variant="caption" display="block" fontWeight={700} sx={{ mb: 0.5 }}>Score-Berechnung</Typography>
      <Typography variant="caption" display="block">⭐ Sterne (50%)</Typography>
      <Typography variant="caption" display="block">✅ Abschlussrate (25%)</Typography>
      <Typography variant="caption" display="block">⚖️ Dispute-Rate (15%)</Typography>
      <Typography variant="caption" display="block">🎯 COL-Points (10%)</Typography>
      <Typography variant="caption" display="block" sx={{ mt: 0.5 }} color="text.secondary">
        × Identity-Level-Multiplikator
      </Typography>
    </Box>
  )

  if (size === 'compact') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1 }}>{scoreDisplay}</Typography>
        <Rating value={score} precision={0.1} size="small" readOnly />
        <Typography variant="caption" color="text.secondary">({reviewCount})</Typography>
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="h4" fontWeight={700}>{scoreDisplay}</Typography>
        <Typography variant="body2" color="text.secondary">/ 5.0</Typography>
        <Tooltip title={tooltipContent} placement="right">
          <InfoOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', cursor: 'help' }} />
        </Tooltip>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Rating value={score} precision={0.1} readOnly />
        <Typography variant="body2" color="text.secondary">
          {reviewCount === 0 ? 'Noch keine Bewertungen' : `${reviewCount} Bewertung${reviewCount !== 1 ? 'en' : ''}`}
        </Typography>
      </Box>
    </Box>
  )
}
