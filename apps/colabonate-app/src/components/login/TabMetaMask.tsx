import { useEffect, useState } from 'react'
import { Button, CircularProgress } from '@mui/material'
import { createDerivedIdentity } from '../../lib/metamask-identity'
import { buildMetamaskDerivationMessage } from '@col/nostr-schema'

interface ChallengeResponse {
  nonce: string
  message: string
  expiresAt: string
  ttlSeconds: number
}

function getMetaMaskProvider(): Window['ethereum'] | null {
  if (typeof window === 'undefined') return null
  const provider = window.ethereum
  if (!provider || !provider.isMetaMask || typeof provider.request !== 'function') {
    return null
  }
  return provider
}

function shortAddress(address: string): string {
  if (address.length < 10) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function TabMetaMask({ embedded = false }: { embedded?: boolean }) {
  const [hasMetaMask, setHasMetaMask] = useState<boolean | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setHasMetaMask(getMetaMaskProvider() !== null)
  }, [])

  async function handleMetaMaskLogin() {
    setError(null)
    setLoading(true)

    try {
      const provider = getMetaMaskProvider()
      if (!provider) {
        setError('MetaMask extension not detected. Please install MetaMask and refresh the page.')
        return
      }

      // 1) Request accounts.
      const accounts = (await provider.request({
        method: 'eth_requestAccounts',
      })) as string[]
      if (!accounts || accounts.length === 0) {
        setError('No MetaMask account selected.')
        return
      }
      const selectedAddress = accounts[0]
      setAddress(selectedAddress)

      // 2) Derive Nostr identity (signs derivation message once, caches result).
      const identity = await createDerivedIdentity(selectedAddress, async (message) => {
        return (await provider.request({
          method: 'personal_sign',
          params: [message, selectedAddress],
        })) as string
      })

      // 3) Fetch authentication challenge from server.
      const challengeRes = await fetch(`/api/auth/metamask/challenge?address=${encodeURIComponent(selectedAddress)}`)
      if (!challengeRes.ok) {
        throw new Error(`Challenge request failed: ${challengeRes.status}`)
      }
      const challenge: ChallengeResponse = await challengeRes.json()

      // 4) Sign the SIWE-style challenge.
      const authSignature = (await provider.request({
        method: 'personal_sign',
        params: [challenge.message, selectedAddress],
      })) as string

      // 5) Verify on server. The server redirects to /login/demo on success.
      const verifyRes = await fetch('/api/auth/metamask/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: selectedAddress,
          pubkey: identity.pubkey,
          derivationMessage: buildMetamaskDerivationMessage(selectedAddress),
          derivationSignature: identity.derivationSignature,
          authMessage: challenge.message,
          authSignature,
        }),
      })

      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data.message || `Verification failed: ${verifyRes.status}`)
      }

      // Server responds with a redirect; follow it.
      if (verifyRes.redirected && verifyRes.url) {
        window.location.href = verifyRes.url
      } else {
        // Fallback: parse the redirect from the response URL if the browser did
        // not automatically follow it.
        window.location.href = verifyRes.url
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MetaMask login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={embedded ? 'space-y-3 h-full' : 'space-y-4'}>
      <div>
        <p className="mb-3 text-xs font-medium text-center" style={{ color: 'var(--theme-text-muted)' }}>
          Sign in with your MetaMask wallet
        </p>

        {hasMetaMask === false && (
          <div
            className="p-3 mb-3 text-xs rounded-xl"
            style={{ background: 'var(--color-status-error-bg)', color: 'var(--color-status-error)' }}
          >
            MetaMask was not detected. Install the extension and refresh the page.
          </div>
        )}

        {address && (
          <p className="mb-3 text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
            Address: {shortAddress(address)}
          </p>
        )}

        <Button
          variant="contained"
          fullWidth
          onClick={handleMetaMaskLogin}
          disabled={loading || hasMetaMask === false}
          startIcon={
            loading ? (
              <CircularProgress size={16} sx={{ color: 'currentColor' }} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M21.1 1.5L13.6 7.8l-1.3-2.7 8.8-3.6z" fill="#E17726" />
                <path d="M2.9 1.5l7.4 6.3-1.2 2.7-8.6-3.5z" fill="#E27625" />
                <path d="M19.1 15.5l-2.3 3.5 5 1.5 1.4-4.8z" fill="#E27625" />
                <path d="M.8 15.7l1.4 4.8 5-1.5-2.3-3.5z" fill="#E27625" />
                <path d="M6.5 10.8l-1.5 2.2 6.5.3-.2-7z" fill="#E27625" />
                <path d="M17.5 10.8l-4.7-4.6-.3 7.1 6.5-.3z" fill="#E27625" />
                <path d="M6.5 18.9l3.9-1.9-3.3-2.6z" fill="#E27625" />
                <path d="M13.6 17l3.9 1.9-.6-4.5z" fill="#E27625" />
                <path d="M16.8 14.4l-3.2 2.4 3.7.5z" fill="#D5BFB2" />
                <path d="M7.2 14.4l-.5 3 3.7-.5z" fill="#D5BFB2" />
                <path d="M10.4 16.8l-.4-3.3-2.8.6z" fill="#233447" />
                <path d="M13.6 16.8l3.2-2.7-2.8-.6z" fill="#233447" />
                <path d="M13.6 16.8l-3.2 0-.2-3.4h3.6z" fill="#CC6228" />
                <path d="M17.5 10.8l-4.8 2.6.2 3.4 4.7-2.7z" fill="#E27525" />
                <path d="M6.5 10.8l-.1 3.3 4.8 2.7.2-3.4z" fill="#E27525" />
                <path d="M6.5 10.8l4.9-2.5-4.6-1.7z" fill="#F5841F" />
                <path d="M17.5 10.8l-.3-4.2-4.6 1.7 4.9 2.5z" fill="#F5841F" />
                <path d="M13.6 7.8l4.6-1.7-3.9-3.3z" fill="#C0AC9D" />
                <path d="M6.5 10.8l4.6-3-4.4-1.4z" fill="#C0AC9D" />
                <path d="M10.4 16.8l3.2 0-.3 2z" fill="#E17726" />
              </svg>
            )
          }
          sx={{
            py: 1.5,
            fontSize: '0.875rem',
            fontWeight: 600,
            textTransform: 'none',
            backgroundColor: 'var(--theme-button-primary-bg)',
            color: 'var(--theme-button-primary-text)',
            '&:hover': { backgroundColor: 'var(--theme-button-primary-bg-hover)' },
          }}
        >
          {loading ? 'Connecting…' : 'Connect MetaMask'}
        </Button>

        {error && (
          <div
            className="p-3 mt-3 text-xs rounded-xl"
            style={{ background: 'var(--color-status-error-bg)', color: 'var(--color-status-error)' }}
          >
            {error}
          </div>
        )}
      </div>

      <div
        className="pt-3 border-t"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <p className="text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
          <span style={{ color: 'var(--color-primary-50)' }}>🔐</span> Your Nostr identity is derived from your
          MetaMask signature. No seed is stored by Colabonate. MetaMask does not replace a Lightning wallet.
        </p>
      </div>
    </div>
  )
}
