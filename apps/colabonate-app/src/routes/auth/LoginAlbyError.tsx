import { useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Button } from '@mui/material'
import { AppLogo } from '../../components/branding/AppLogo'
import { getAlbyErrorCopy } from '../../lib/alby-error-codes'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'

/**
 * ADR-225 D4: landing page for `/api/auth/alby`'s redirect-on-error (D3).
 *
 * Before D3, a failed Alby OAuth callback returned raw JSON in the browser
 * because TabAlby.tsx does a top-level navigation to `/api/auth/alby` — the
 * SPA never saw the failure. This route gives that failure a contextual,
 * actionable landing spot instead of a JSON dump.
 */
export function LoginAlbyError() {
  const [searchParams] = useSearchParams()
  const code = searchParams.get('code')
  const copy = getAlbyErrorCopy(code)

  // This route is reached via a full server-side redirect (not SPA routing),
  // so the tab title still reads whatever index.html sets by default — give
  // it the specific failure so the browser tab and screen-reader window
  // announcement both reflect what actually happened.
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${copy.title} – Colabonate`
    return () => { document.title = previousTitle }
  }, [copy.title])

  return (
    <div
      className="relative flex flex-col items-center justify-center min-h-screen p-4 overflow-hidden"
      style={{ background: 'var(--theme-bg-elevated)' }}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div
          className="absolute rounded-full w-125 h-125 -top-32 -right-32 blur-3xl opacity-10"
          style={{ background: 'var(--color-primary-50)' }}
        />
        <div
          className="absolute rounded-full w-100 h-100 -bottom-24 -left-24 blur-3xl opacity-10"
          style={{ background: 'var(--color-secondary-50)' }}
        />
      </div>

      <div className="mb-8 text-center">
        <div className="flex items-center justify-center mb-3">
          <AppLogo brand="colabonate" height={32} />
        </div>
        <p className="text-sm font-light tracking-wide" style={{ color: 'var(--theme-text-muted)' }}>
          Decentralized Collaboration and Commerce
        </p>
      </div>

      <div
        className="w-full max-w-md p-6 rounded-xl"
        style={{
          background: 'var(--theme-surface)',
          border: '1px solid var(--theme-border)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <h1 className="mb-2 text-lg font-semibold" style={{ color: 'var(--theme-text)' }}>
          {copy.title}
        </h1>
        <p className="mb-5 text-sm leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
          {copy.body}
        </p>

        <div className="flex flex-col gap-2.5">
          <Button
            component={Link}
            to="/onboarding/generate-nostr-key"
            variant="contained"
            fullWidth
            endIcon={<ArrowForwardIcon sx={{ fontSize: 16 }} />}
            sx={{ justifyContent: 'space-between', textTransform: 'none', fontWeight: 600, fontSize: 14, borderRadius: '12px', py: 1.25 }}
          >
            Generate a Nostr key now
          </Button>
          <Button
            component={Link}
            to="/account#identity-security"
            variant="outlined"
            fullWidth
            endIcon={<ArrowForwardIcon sx={{ fontSize: 16 }} />}
            sx={{ justifyContent: 'space-between', textTransform: 'none', fontWeight: 600, fontSize: 14, borderRadius: '12px', py: 1.25 }}
          >
            I already have a Nostr key
          </Button>
        </div>

        <p className="mt-4 text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
          Both paths require you to be logged in first (Email, Lightning, or Nostr).{' '}
          <Link to="/login" className="font-semibold" style={{ color: 'var(--color-primary-50)' }}>
            Use a different login
          </Link>
        </p>
      </div>
    </div>
  )
}
