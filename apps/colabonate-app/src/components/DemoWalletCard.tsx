import { useBetaMode } from '../hooks/useBetaMode'
import { formatSats } from '../lib/currency'

interface DemoWalletCardProps {
  balanceSats?: number
}

export function DemoWalletCard({ balanceSats }: DemoWalletCardProps) {
  const { isBeta, demoStartBalance } = useBetaMode()
  if (!isBeta) return null

  const balance = balanceSats ?? demoStartBalance

  return (
    <div style={{
      border: '1px solid var(--color-warning-default, #f59e0b)',
      borderRadius: 8,
      padding: '12px 16px',
      background: 'var(--color-warning-subtle, #fef3c7)',
      color: 'var(--color-warning-emphasis, #92400e)',
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: '0.9rem' }}>
        <span>Demo wallet (Beta)</span>
        <span style={{
          fontSize: '0.7rem',
          fontWeight: 700,
          background: 'var(--color-warning-default, #f59e0b)',
          color: '#fff',
          borderRadius: 4,
          padding: '1px 6px',
          letterSpacing: '0.04em',
        }}>
          DEMO
        </span>
      </div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: 4 }}>
        {formatSats(balance, { compact: false })}
      </div>
      <div style={{ fontSize: '0.75rem', marginTop: 2, opacity: 0.75 }}>
        Demo sats · no real value
      </div>
    </div>
  )
}
