import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material'

// ADR-386 D4: confirmation shown before switching from the lightweight edit
// dialog to the full Coop-Guide form for an unengaged, published entity.
// Kept deliberately small and shared by the three entry points (Manage tab,
// guide result view, detail page) so the copy stays identical.
export function FullEditConfirmDialog({
  open, onClose, onConfirm, entityLabel,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  entityLabel: 'cooperation' | 'network'
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Open the full edit form?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          Nobody has engaged with this {entityLabel} yet, so every field can still be changed.
          This opens the Coop Guide form pre-filled with the saved values. Once someone has applied
          or a partner is engaged, only quick edits remain available.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={onConfirm}>Open full form</Button>
      </DialogActions>
    </Dialog>
  )
}
