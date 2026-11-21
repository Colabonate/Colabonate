import { Box, Button, Typography } from '@mui/material'
import {
  isRouteErrorResponse,
  Link,
  useNavigate,
  useRouteError,
} from 'react-router-dom'
import { AppLogo } from './branding/AppLogo'

/**
 * Global route-level error boundary (React Router v6 `errorElement`).
 *
 * Catches every failure that the default React Router screen would otherwise
 * surface ("Unexpected Application Error! / 💿 Hey developer 👋"):
 *   - unmatched routes  → 404 (no route matched the URL)
 *   - loader/action throws → 4xx / 5xx (isRouteErrorResponse)
 *   - render errors      → unknown Error
 *
 * Rendered at the router ROOT, so it is self-contained (no Layout / Navbar).
 */
export function ErrorBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()

  const isResponse = isRouteErrorResponse(error)
  const status = isResponse ? error.status : 0
  const is404 = isResponse && status === 404

  const title = is404
    ? 'Page not found'
    : isResponse
      ? `Something went wrong (${status})`
      : 'Something went wrong'

  const message = is404
    ? "The page you're looking for doesn't exist or may have been moved."
    : isResponse
      ? error.statusText || 'An unexpected response was received. Please try again.'
      : 'An unexpected error occurred while loading this page.'

  const detail =
    !is404 && import.meta.env.DEV
      ? error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : undefined
      : undefined

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: { xs: 3, sm: 4 },
        py: { xs: 6, sm: 8 },
        textAlign: 'center',
        bgcolor: 'transparent',
        color: 'var(--theme-text)',
      }}
    >
      <Box sx={{ mb: { xs: 5, sm: 6 } }}>
        <Link to="/" aria-label="Colabonate home" style={{ display: 'inline-flex' }}>
          <AppLogo height={24} />
        </Link>
      </Box>

      <Box
        component="span"
        aria-hidden
        sx={{
          fontSize: { xs: 80, sm: 110 },
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '-0.04em',
          color: 'var(--color-action-primary-default)',
          mb: 2,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {is404 ? '404' : isResponse ? status || '500' : '500'}
      </Box>

      <h1>{title}</h1>

      <Typography
        sx={{
          maxWidth: 420,
          mt: 1,
          color: 'var(--theme-text-secondary)',
          lineHeight: 1.6,
          mb: detail ? 2 : 4,
        }}
      >
        {message}
      </Typography>

      {detail && (
        <Box
          sx={{
            maxWidth: 520,
            width: '100%',
            mb: 4,
            p: 2,
            borderRadius: 'var(--radius-md)',
            bgcolor: 'var(--theme-bg-subtle)',
            border: '1px solid var(--theme-border)',
          }}
        >
          <Typography
            component="pre"
            sx={{
              margin: 0,
              fontFamily: 'var(--typography-fontfamily-mono)',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--theme-text-muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              textAlign: 'left',
            }}
          >
            {detail}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, justifyContent: 'center' }}>
        <Button
          variant="contained"
          component={Link}
          to="/"
          sx={{
            bgcolor: 'var(--color-action-primary-default)',
            '&:hover': { bgcolor: 'var(--color-action-primary-active)' },
            textTransform: 'none',
            fontWeight: 600,
            px: 3,
          }}
        >
          Back to home
        </Button>

        <Button
          variant="outlined"
          onClick={() => navigate(-1)}
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
          Go back
        </Button>

        {!is404 && (
          <Button
            variant="text"
            onClick={() => window.location.reload()}
            sx={{
              color: 'var(--theme-text-secondary)',
              textTransform: 'none',
              fontWeight: 600,
              px: 2,
            }}
          >
            Reload page
          </Button>
        )}
      </Box>
    </Box>
  )
}

export default ErrorBoundary
