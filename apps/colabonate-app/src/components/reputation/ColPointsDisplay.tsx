import { Box, Chip, Divider, List, ListItem, ListItemText, Typography } from '@mui/material'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import { useTranslation } from '../../contexts/LocaleContext'
import type { ColPointsHistoryEntry } from '../../types/identity'

interface ColPointsDisplayProps {
  colPoints: number
  history?: ColPointsHistoryEntry[]
}

const REASON_LABELS: Record<string, string> = {
  TICKET_COMPLETED_SELLER: 'Ticket abgeschlossen (Verkäufer)',
  TICKET_COMPLETED_BUYER: 'Ticket abgeschlossen (Käufer)',
  MUTUAL_REVIEW: 'Gegenseitige Bewertung',
  HID_L2_UPGRADE: 'Identity Level 2 erreicht',
  HID_L3_UPGRADE: 'Identity Level 3 erreicht',
}

export function ColPointsDisplay({ colPoints, history }: ColPointsDisplayProps) {
  const { formatNumber, formatDate } = useTranslation()
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <EmojiEventsIcon sx={{ color: '#f57f17' }} />
        <Typography variant="h5" fontWeight={700}>{formatNumber(colPoints)}</Typography>
        <Typography variant="body2" color="text.secondary">COL-Points</Typography>
      </Box>

      {history && history.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="caption" color="text.secondary" fontWeight={600}>Letzte Aktivitäten</Typography>
          <List dense disablePadding>
            {history.slice(0, 5).map(entry => (
              <ListItem key={entry.id} disablePadding sx={{ py: 0.25 }}>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        label={`${entry.delta > 0 ? '+' : ''}${entry.delta}`}
                        size="small"
                        sx={{
                          bgcolor: entry.delta > 0 ? '#e8f5e9' : '#ffebee',
                          color: entry.delta > 0 ? '#2e7d32' : '#c62828',
                          fontWeight: 700,
                          height: 20,
                          fontSize: '0.7rem',
                        }}
                      />
                      <Typography variant="caption">
                        {REASON_LABELS[entry.reason] ?? entry.reason}
                      </Typography>
                    </Box>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(new Date(entry.createdAt))}
                    </Typography>
                  }
                />
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Box>
  )
}
