import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Box, IconButton, Typography, TextField, ToggleButtonGroup, ToggleButton, CircularProgress } from '@mui/material'
import { useIsMobile } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { useNotification } from '../../context/NotificationContext'

const HIDDEN_PREFIXES = ['/login', '/admin', '/onboarding']

const KINDS = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
] as const

type Kind = (typeof KINDS)[number]['value']

export function FeedbackWidget() {
  const location = useLocation()
  const { showSnackbar } = useNotification()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('bug')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (HIDDEN_PREFIXES.some(p => location.pathname.startsWith(p))) return null
  if (location.pathname !== '/') return null

  const reset = () => {
    setTitle('')
    setBody('')
    setEmail('')
    setKind('bug')
    setOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await apiCall('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          title,
          body,
          email: email.trim() || undefined,
          context: {
            route: location.pathname,
            pubkey: localStorage.getItem('pubkey') ?? undefined,
            userAgent: navigator.userAgent,
          },
        }),
      })
      showSnackbar('Feedback received — thank you!', 'success')
      reset()
    } catch {
      showSnackbar('Failed to send feedback. Please try again.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Floating trigger – bottom-left, equal left/bottom inset */}
      <Box
        className="fab-layer"
        sx={{
          position: 'fixed',
          bottom: isMobile
            ? 'calc(58px + env(safe-area-inset-bottom, 0px) + 12px)'
            : '1.5rem',
          left: '1.5rem',
          right: 'auto',
          zIndex: 1300,
          transition: 'bottom 220ms ease, left 220ms ease',
        }}
      >
        <IconButton
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close feedback panel' : 'Send beta feedback'}
          title="Beta feedback"
          sx={{
            width: 48,
            height: 48,
            bgcolor: 'var(--color-accent, #7c3aed)',
            color: '#fff',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            '&:hover': { bgcolor: 'var(--color-accent-hover, #6d28d9)' },
          }}
        >
          {open ? '✕' : '💬'}
        </IconButton>
      </Box>

      {/* Glass panel */}
      {open && (
        <Box
          component="aside"
          sx={{
            position: 'fixed',
            bottom: isMobile ? 'calc(58px + env(safe-area-inset-bottom, 0px) + 72px)' : '5.5rem',
            left: '1.5rem',
            right: 'auto',
            zIndex: 1300,
            width: isMobile ? 'calc(100vw - 3rem)' : '22rem',
            maxHeight: '80vh',
            overflowY: 'auto',
            bgcolor: 'rgba(18, 18, 28, 0.88)',
            backdropFilter: 'blur(20px)',
            borderRadius: '1rem',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.55)',
            p: '1.5rem',
            color: 'rgba(255,255,255,0.92)',
          }}
        >
          <Typography variant="subtitle1" fontWeight={700} mb={1.5} sx={{ color: 'rgba(255,255,255,0.92)' }}>
            Beta Feedback
          </Typography>

          <Box component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={1.5}>
            <ToggleButtonGroup
              exclusive
              value={kind}
              onChange={(_e, v) => v && setKind(v as Kind)}
              size="small"
              fullWidth
              sx={{
                '& .MuiToggleButton-root': {
                  flex: 1,
                  color: 'rgba(255,255,255,0.92)',
                  borderColor: 'rgba(255,255,255,0.15)',
                  fontSize: '0.75rem',
                  py: 0.5,
                },
                '& .Mui-selected': {
                  bgcolor: 'rgba(124,58,237,0.3) !important',
                  borderColor: 'var(--color-accent, #7c3aed) !important',
                  color: '#fff !important',
                },
              }}
            >
              {KINDS.map(k => (
                <ToggleButton key={k.value} value={k.value}>
                  {k.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <TextField
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Short title (5–120 chars)"
              required
              inputProps={{ minLength: 5, maxLength: 120 }}
              size="small"
              fullWidth
              sx={inputSx}
            />

            <TextField
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Describe the issue or idea… (10–4000 chars)"
              required
              inputProps={{ minLength: 10, maxLength: 4000 }}
              multiline
              rows={4}
              size="small"
              fullWidth
              sx={inputSx}
            />

            <TextField
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              placeholder="Email (optional — so we can reply)"
              inputProps={{ maxLength: 254 }}
              size="small"
              fullWidth
              sx={inputSx}
            />

            <Box
              component="button"
              type="submit"
              disabled={submitting}
              sx={{
                width: '100%',
                py: '0.6rem',
                borderRadius: '0.5rem',
                bgcolor: 'var(--color-accent, #7c3aed)',
                color: '#fff',
                border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
                fontWeight: 600,
                fontSize: '0.875rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
              }}
            >
              {submitting && <CircularProgress size={14} sx={{ color: '#fff' }} />}
              {submitting ? 'Sending…' : 'Send Feedback'}
            </Box>
          </Box>
        </Box>
      )}
    </>
  )
}

const inputSx = {
  '& .MuiInputBase-root': {
    bgcolor: 'rgba(255,255,255,0.06)',
    borderRadius: '0.5rem',
    color: 'rgba(255,255,255,0.92)',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: 'rgba(255,255,255,0.15)',
  },
  '& .MuiInputBase-input::placeholder': {
    color: 'rgba(255,255,255,0.4)',
  },
}
