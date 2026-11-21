import { Button } from '@mui/material'
import { Shield, ArrowRight } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { getValidatedReturnTo } from '../../lib/auth-guard'
import { DEMO_LOGIN_ENABLED } from '../branding/beta'

interface DemoLoginSectionProps {
  embedded?: boolean
  className?: string
}

interface DemoAccount {
  pubkey: string
  lnAddress: string
  label: string
  color: 'primary' | 'secondary'
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    pubkey: 'test-buyer-pubkey',
    lnAddress: 'buyer@getalby.com',
    label: 'Buyer',
    color: 'secondary',
  },
  {
    pubkey: 'test-seller-1-pubkey',
    lnAddress: 'seller1@getalby.com',
    label: 'Seller 1',
    color: 'primary',
  },
  {
    pubkey: 'test-seller-2-pubkey',
    lnAddress: 'seller2@getalby.com',
    label: 'Seller 2',
    color: 'primary',
  },
]

async function handleDemoLogin(
  pubkey: string,
  lnAddress: string,
  returnTo: string,
) {
  try {
    const response = await apiCall('/api/auth/demo', {
      method: 'POST',
      body: JSON.stringify({ pubkey }),
    })
    const data = await response.json()
    localStorage.setItem('pubkey', data.pubkey)
    localStorage.setItem('authToken', data.token)
    localStorage.setItem('lnAddress', lnAddress)
    // ADR-303 D10: return the user to the page that asked for login.
    window.location.href = returnTo
  } catch (err) {
    console.error('Demo login failed:', err)
  }
}

/**
 * Standalone demo-login section — dev/E2E only (`DEMO_LOGIN_ENABLED` is false
 * in every PROD build).
 *
 * - Supports a compact `embedded` variant for the Home page hero.
 */
export function DemoLoginSection({ embedded = false, className }: DemoLoginSectionProps) {
  const location = useLocation()
  if (!DEMO_LOGIN_ENABLED) return null

  const returnTo = getValidatedReturnTo(location.state, location.search)

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-xl',
        embedded ? 'p-4' : 'p-6',
        className,
      )}
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Shield size={16} style={{ color: 'var(--color-primary-50)' }} aria-hidden="true" />
        <p className="text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
          Demo Login
        </p>
      </div>

      <p className="mb-4 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
        {embedded
          ? 'Try the beta instantly — no wallet required.'
          : 'Explore the beta without a real wallet. These demo accounts let you test buyer and seller flows.'}
      </p>

      <div className="flex flex-col gap-2">
        {DEMO_ACCOUNTS.map((account) => (
          <Button
            key={account.pubkey}
            variant="outlined"
            color="secondary"
            fullWidth
            onClick={() => handleDemoLogin(account.pubkey, account.lnAddress, returnTo)}
            endIcon={<ArrowRight size={14} />}

            sx={{
              py: 1.25,
              fontSize: embedded ? '0.75rem' : '0.875rem',
              fontWeight: 600,
              textTransform: 'none',
              color: 'var(--theme-text)',
              borderColor: 'var(--theme-border)',
              '&:hover': {
                color: 'var(--theme-text)',
                borderColor: 'var(--theme-text-muted)',
                backgroundColor: 'rgba(0,0,0,0.04)',
              },
            }}
          >
            Demo-Login ({account.label})
          </Button>
        ))}
      </div>
    </div>
  )
}
