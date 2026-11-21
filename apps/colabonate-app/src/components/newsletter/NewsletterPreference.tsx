// ADR-402 D15: in-app newsletter opt-in / opt-out for the signed-in identity.
//   variant="settings" → ListItem rows for Settings → Account → Notifications
//   variant="summary"  → one status line for the Account page, links to Settings
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  Button,
  CircularProgress,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead'
import { useNewsletterPreference, type MyNewsletterAddress } from '../../hooks/useNewsletterPreference'

const switchSx = {
  '& .MuiSwitch-switchBase.Mui-checked': { color: 'var(--color-primary-50)' },
  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: 'var(--color-primary-50)' },
  '& .MuiSwitch-track': { borderRadius: 13 },
  '& .MuiSwitch-thumb': { boxShadow: '0 1px 3px rgba(0,0,0,0.2)' },
}

function statusText(a: MyNewsletterAddress): string {
  switch (a.status) {
    case 'CONFIRMED':
      return a.confirmedAt ? `Subscribed since ${new Date(a.confirmedAt).toLocaleDateString()}` : 'Subscribed'
    case 'PENDING':
      return 'Waiting for your confirmation. Check your inbox.'
    case 'UNSUBSCRIBED':
      return 'Unsubscribed'
    default:
      return 'Not subscribed'
  }
}

const isOn = (a: MyNewsletterAddress) => a.status === 'CONFIRMED' || a.status === 'PENDING'

export function NewsletterPreference({ variant }: { variant: 'settings' | 'summary' }) {
  const { addresses, isLoading, loadError, subscribe, unsubscribe } = useNewsletterPreference()
  const [newEmail, setNewEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const busy = subscribe.isPending || unsubscribe.isPending
  const mutationError =
    (subscribe.error instanceof Error && subscribe.error.message) ||
    (unsubscribe.error instanceof Error && unsubscribe.error.message) ||
    null

  if (variant === 'summary') {
    const primary = addresses.find((a) => a.accountEmail) ?? addresses[0]
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 md:p-6"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-surface)' }}
      >
        <div className="flex items-center gap-3">
          <MarkEmailReadIcon sx={{ color: 'var(--theme-text-muted)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
              Newsletter: {isLoading ? '…' : primary && isOn(primary) ? 'on' : 'off'}
            </p>
            <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
              {isLoading ? 'Loading…' : primary ? `${primary.email} · ${statusText(primary)}` : 'No email linked'}
            </p>
          </div>
        </div>
        <Button component={Link} to="/settings#account" size="small" variant="outlined" sx={{ textTransform: 'none' }}>
          Manage
        </Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <ListItem sx={{ py: 1.75, px: 2.5 }}>
        <CircularProgress size={18} />
      </ListItem>
    )
  }

  const errorAlert = (loadError || mutationError) && (
    <ListItem sx={{ px: 2.5, pb: 1.75, pt: 0 }}>
      <Alert severity="error" sx={{ width: '100%' }}>{mutationError || loadError}</Alert>
    </ListItem>
  )

  if (addresses.length === 0) {
    return (
      <>
        <ListItem sx={{ py: 1.75, px: 2.5, display: 'block' }}>
          <div className="flex items-start gap-3">
            <MarkEmailReadIcon sx={{ color: 'var(--theme-text-muted)', mt: 0.25 }} />
            <div className="flex-1">
              <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>Newsletter</Typography>
              <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', mb: 1.5 }}>
                No email is linked to your account. Enter an address to receive the newsletter. We send a
                confirmation link first.
              </Typography>
              <div className="flex flex-wrap gap-2">
                <TextField
                  size="small"
                  type="email"
                  label="Email address"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  sx={{ flex: 1, minWidth: 200 }}
                />
                <Button
                  variant="contained"
                  disabled={busy || !newEmail.includes('@')}
                  onClick={() =>
                    subscribe.mutate(newEmail.trim(), { onSuccess: () => setSentTo(newEmail.trim()) })
                  }
                  sx={{ textTransform: 'none' }}
                >
                  Subscribe
                </Button>
              </div>
              {sentTo && (
                <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', mt: 1.5 }}>
                  If {sentTo} can receive our newsletter, a confirmation link is on its way.
                </Typography>
              )}
            </div>
          </div>
        </ListItem>
        {errorAlert}
      </>
    )
  }

  return (
    <>
      {addresses.map((a) => (
        <ListItem key={a.email} sx={{ py: 1.75, px: 2.5 }}>
          <ListItemIcon sx={{ minWidth: 40 }}>
            <MarkEmailReadIcon sx={{ color: 'var(--theme-text-muted)' }} />
          </ListItemIcon>
          <ListItemText
            sx={{ pr: 7 }}
            primary={<Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>Newsletter</Typography>}
            secondary={
              <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', wordBreak: 'break-all' }}>
                {a.email} · {statusText(a)}
              </Typography>
            }
          />
          <ListItemSecondaryAction>
            <Switch
              checked={isOn(a)}
              disabled={busy}
              onChange={(e) => (e.target.checked ? subscribe.mutate(a.email) : unsubscribe.mutate(a.email))}
              size="small"
              sx={switchSx}
              slotProps={{ input: { role: 'switch', 'aria-label': `Newsletter for ${a.email}` } }}
            />
          </ListItemSecondaryAction>
        </ListItem>
      ))}
      {errorAlert}
    </>
  )
}
