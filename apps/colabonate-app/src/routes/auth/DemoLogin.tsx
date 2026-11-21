import { useEffect, useState } from 'react'
import { useSearchParams, Navigate } from 'react-router-dom'
import { AppLogo } from '../../components/branding/AppLogo'
import { Seo } from '../../components/Seo'

/**
 * Demo login landing route.
 *
 * The Playground (or any other dev tool) calls POST /api/auth/demo to mint a
 * Bearer token, then opens the app with ?token=<token>. This route validates
 * the token against /api/auth/me and, if valid, persists the same localStorage
 * keys that the normal Nostr/Google/Email login flows set.
 */
export function DemoLogin() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = searchParams.get('token')

    if (!token) {
      setStatus('error')
      setError('Missing login token. Please initiate the demo login from the Playground.')
      return
    }

    async function verifyAndStore(sessionToken: string) {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${sessionToken}` },
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.message || `Session verification failed (${res.status})`)
        }

        const data = await res.json()
        if (!data.pubkey) {
          throw new Error('Invalid session response from server')
        }

        localStorage.setItem('authToken', sessionToken)
        localStorage.setItem('pubkey', data.pubkey)
        if (data.lnAddress) {
          localStorage.setItem('lnAddress', data.lnAddress)
        }
        if (data.evmAddress) {
          localStorage.setItem('evmAddress', data.evmAddress)
        }

        setStatus('success')
      } catch (err) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Demo login failed')
      }
    }

    verifyAndStore(token)
  }, [searchParams])

  if (status === 'success') {
    return <Navigate to="/" replace />
  }

  return (
    <>
      <Seo noindex />
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
        className="w-full max-w-sm p-6 rounded-xl"
        style={{
          background: 'var(--theme-surface)',
          border: '1px solid var(--theme-border)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <h1 className="mb-4 text-lg font-semibold text-center" style={{ color: 'var(--theme-text)' }}>
          Demo Login
        </h1>

        {status === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <div
              className="w-8 h-8 border-2 rounded-full border-t-transparent animate-spin"
              style={{ borderColor: 'var(--color-primary-50)', borderTopColor: 'transparent' }}
            />
            <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
              Verifying demo session…
            </p>
          </div>
        )}

        {status === 'error' && (
          <div
            className="p-3 text-sm rounded-xl"
            style={{ background: 'var(--color-status-error-bg)', color: 'var(--color-status-error)' }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
