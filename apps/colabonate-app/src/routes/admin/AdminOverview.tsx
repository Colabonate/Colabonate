import { Box, Typography, Divider } from '@mui/material'
import { AdminKpiStrip } from './AdminKpiStrip'
import { HealthSection } from './sections/HealthSection'

export function AdminOverview() {
  return (
    <Box>
      <Typography variant="h6" fontWeight={700} sx={{ color: 'var(--theme-text)', mb: 0.5 }}>
        Overview
      </Typography>
      <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', mb: 3 }}>
        Platform metrics and service health — metrics refresh every 60s, health every 30s
      </Typography>
      <AdminKpiStrip />
      <Divider sx={{ my: 3, borderColor: 'var(--theme-border)' }} />
      <HealthSection />
    </Box>
  )
}
