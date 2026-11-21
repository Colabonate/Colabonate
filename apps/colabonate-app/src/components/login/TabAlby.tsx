import { useState } from 'react'
import { Button, CircularProgress } from '@mui/material'
import { NewsletterOptInCheckbox } from '../newsletter/NewsletterOptInCheckbox'

/**
 * ADR-191: Alby OAuth2 login (Authorization Code flow).
 *
 * Unlike the other tabs, this is a top-level browser navigation: clicking the
 * button sends the user to the server (`/api/auth/alby`), which redirects to
 * getalby.com, and after consent back to `/api/auth/alby/callback`. The server
 * then redirects to `/login/demo?token=…`, where DemoLogin persists the session
 * (same path used by the demo/playground login).
 */
export function TabAlby({ embedded = false }: { embedded?: boolean }) {
  const [loading, setLoading] = useState(false)
  const [newsletterOptIn, setNewsletterOptIn] = useState(false)

  function handleAlbyLogin() {
    setLoading(true)
    // Top-level navigation so the OAuth redirects work (not a fetch).
    // ADR-402 D16: the server keeps the choice with the OAuth state.
    window.location.href = newsletterOptIn ? '/api/auth/alby?newsletter=1' : '/api/auth/alby'
  }

  return (
    <div className={embedded ? 'space-y-3 h-full' : 'space-y-4'}>
      <div>
        <p className="mb-3 text-xs font-medium text-center" style={{ color: 'var(--theme-text-muted)' }}>
          Sign in with your Alby account
        </p>

        <Button
          variant="contained"
          fullWidth
          onClick={handleAlbyLogin}
          disabled={loading}
          aria-describedby="alby-login-note"
          startIcon={
            loading ? (
              <CircularProgress size={16} sx={{ color: 'currentColor' }} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true" focusable="false">
                <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
              </svg>
            )
          }
          sx={{
            py: 1.5,
            fontSize: '0.875rem',
            fontWeight: 600,
            textTransform: 'none',
            backgroundColor: '#FFDF6F',
            color: '#1a1a1a',
            '&:hover': { backgroundColor: '#FFD64A' },
          }}
        >
          {loading ? 'Redirecting...' : 'Mit Alby anmelden'}
        </Button>

        <div className="mt-3">
          <NewsletterOptInCheckbox checked={newsletterOptIn} onChange={setNewsletterOptIn} disabled={loading} />
        </div>

        <p id="alby-login-note" className="mt-3 text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
          Log in with Alby (including Google) to get a real Nostr identity and Lightning address — no browser extension required.
        </p>
      </div>

      <div
        className="pt-3 border-t"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <p className="text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
          <span aria-hidden="true" style={{ color: 'var(--color-primary-50)' }}>⚡</span> Your Nostr key is managed by Alby — export it anytime from getalby.com/settings for full self-custody.
        </p>
      </div>
    </div>
  )
}
