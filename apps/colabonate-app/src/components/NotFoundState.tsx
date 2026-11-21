import type { ReactNode } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import SearchOffIcon from '@mui/icons-material/SearchOff'

interface NotFoundAction {
  label: string
  /** SPA navigation target (renders a router Link). Use either `to` or `onClick`. */
  to?: string
  /** Imperative action (renders a button). Use either `to` or `onClick`. */
  onClick?: () => void
}

export interface NotFoundStateProps {
  /** Large icon shown in the accent circle (default: SearchOff). */
  icon?: ReactNode
  /** Page heading (default: "Not found"). */
  title?: string
  /** Explanatory copy below the title. */
  message?: ReactNode
  /** Muted detail line — e.g. the ID that wasn't found. */
  detail?: string
  /** Primary action (contained, accent). */
  primary?: NotFoundAction
  /** Secondary action (outlined). */
  secondary?: NotFoundAction
}

/**
 * Embedded "not found" / unavailable state — mirrors the global `ErrorBoundary`
 * visual language (accent visual, friendly copy, recovery actions) but renders
 * INSIDE the layout (no full-screen logo takeover) for entity detail pages
 * (ticket / offer / product …) whose data didn't load.
 */
export function NotFoundState({
  icon,
  title = 'Not found',
  message = "We couldn't find what you were looking for.",
  detail,
  primary,
  secondary,
}: NotFoundStateProps) {
  return (
    <Box
      sx={{
        minHeight: { xs: '50vh', sm: '60vh' },
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        py: { xs: 6, sm: 8 },
        px: { xs: 2, sm: 3 },
        color: 'var(--theme-text)',
      }}
    >
      <Box
        aria-hidden
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: { xs: 88, sm: 104 },
          height: { xs: 88, sm: 104 },
          mb: 3,
          borderRadius: '50%',
          bgcolor: 'rgba(232,69,65,0.10)',
          color: 'var(--color-action-primary-default)',
        }}
      >
        {icon ?? <SearchOffIcon sx={{ fontSize: { xs: 44, sm: 52 } }} />}
      </Box>

      <h1>{title}</h1>

      <Typography sx={{ maxWidth: 420, mt: 1, color: 'var(--theme-text-secondary)', lineHeight: 1.6, mb: detail ? 1 : 4 }}>
        {message}
      </Typography>

      {detail && (
        <Typography
          sx={{
            maxWidth: 520,
            mb: 4,
            fontFamily: 'var(--typography-fontfamily-mono)',
            fontSize: 12,
            color: 'var(--theme-text-muted)',
            wordBreak: 'break-all',
          }}
        >
          {detail}
        </Typography>
      )}

      {(primary || secondary) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'center' }}>
          {primary && (
            <Button
              variant="contained"
              {...(primary.to ? { component: Link, to: primary.to } : { onClick: primary.onClick })}
              sx={{
                bgcolor: 'var(--color-action-primary-default)',
                '&:hover': { bgcolor: 'var(--color-action-primary-active)' },
                textTransform: 'none',
                fontWeight: 600,
                px: 3,
              }}
            >
              {primary.label}
            </Button>
          )}
          {secondary && (
            <Button
              variant="outlined"
              {...(secondary.to ? { component: Link, to: secondary.to } : { onClick: secondary.onClick })}
              sx={{
                borderColor: 'var(--theme-border)',
                color: 'var(--theme-text)',
                textTransform: 'none',
                fontWeight: 600,
                px: 3,
                '&:hover': {
                  borderColor: 'var(--theme-text-muted)',
                  bgcolor: 'var(--theme-bg-subtle)',
                },
              }}
            >
              {secondary.label}
            </Button>
          )}
        </Box>
      )}
    </Box>
  )
}

export default NotFoundState
