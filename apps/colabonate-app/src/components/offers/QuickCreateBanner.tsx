import {
  Box,
  Button,
  Typography,
} from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

export interface QuickCreateBannerProps {
  description: string
  onSwitchToFullForm: () => void
}

export function QuickCreateBanner({ description, onSwitchToFullForm }: QuickCreateBannerProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        p: 1.5,
        borderRadius: 'var(--radius-md, 8px)',
        bgcolor: 'action.hover',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.25, flexShrink: 0 }} />
        <Box>
          <Typography variant="caption" fontWeight={600} color="text.primary" display="block">
            Quick Create
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        </Box>
      </Box>
      <Button
        size="small"
        variant="outlined"
        endIcon={<OpenInNewIcon fontSize="small" />}
        onClick={onSwitchToFullForm}
        sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        Full Form
      </Button>
    </Box>
  )
}
