import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

interface ToolActivityIndicatorProps {
  label: string;
}

export function ToolActivityIndicator({ label }: ToolActivityIndicatorProps) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        px: 1.5,
        py: 1,
        borderRadius: 2,
        background: 'var(--theme-bg-subtle)',
        alignSelf: 'flex-start',
      }}
    >
      <CircularProgress size={14} sx={{ color: 'var(--color-primary-50)' }} />
      <Typography sx={{ fontSize: 12, color: 'var(--theme-text-muted)' }}>
        {label}
      </Typography>
    </Stack>
  );
}
