import { Box, Skeleton } from '@mui/material'

export function PageLoader() {
  return (
    <Box sx={{ width: '100%', pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1, bgcolor: 'var(--theme-surface-2)' }} />
      <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 1, bgcolor: 'var(--theme-surface-2)' }} />
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Skeleton variant="rectangular" height={80} sx={{ flex: 1, borderRadius: 1, bgcolor: 'var(--theme-surface-2)' }} />
        <Skeleton variant="rectangular" height={80} sx={{ flex: 1, borderRadius: 1, bgcolor: 'var(--theme-surface-2)' }} />
        <Skeleton variant="rectangular" height={80} sx={{ flex: 1, borderRadius: 1, bgcolor: 'var(--theme-surface-2)' }} />
      </Box>
    </Box>
  )
}
