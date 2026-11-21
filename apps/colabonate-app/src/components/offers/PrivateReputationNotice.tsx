import { Box, Typography } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

/**
 * Phase 4.5 (ADR-152): prominent notice shown whenever a user selects the
 * PRIVATE trade-visibility mode during offer / cooperation creation.
 *
 * Explains the core trade-off of private trades: they are not listed
 * publicly and neither party earns reputation (reviews, COL-Points).
 * Kept token-only (no hardcoded CSS) and presentational so it can be
 * reused by CreateOfferPage, CreateOfferModal and CoopCreateSteps.
 */
export function PrivateReputationNotice() {
  return (
    <Box
      role="status"
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        p: 2,
        borderRadius: 'var(--radius-md, 8px)',
        border: '1px solid var(--color-status-warning)',
        bgcolor: 'var(--theme-bg-subtle)',
      }}
    >
      <InfoOutlinedIcon sx={{ fontSize: 18, color: 'var(--color-status-warning)', mt: 0.25 }} />
      <Box>
        <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
          Reputation will not be built
        </Typography>
        <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', lineHeight: 1.5 }}>
          You are starting a private trade. It is not listed publicly, and neither party earns reviews or COL-Points for it.
        </Typography>
      </Box>
    </Box>
  )
}
