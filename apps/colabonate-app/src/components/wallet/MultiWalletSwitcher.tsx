import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Plus, Check, AlertCircle, Zap } from 'lucide-react'
import { cn } from '@ds/utils'
import type { WalletSummary } from '../../contexts/WalletContext'
import { walletProviderLabel } from '../../lib/walletProviderLabels'

interface MultiWalletSwitcherProps {
  wallets: WalletSummary[]
  activeWalletId: string | undefined
  onSelect: (id: string) => Promise<void>
  onConnectWebLN: () => Promise<void>
}

export function MultiWalletSwitcher({
  wallets,
  activeWalletId,
  onSelect,
  onConnectWebLN,
}: MultiWalletSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const activeLabel = walletProviderLabel(wallets.find(w => w.id === activeWalletId)?.provider)

  async function handleSelect(id: string) {
    if (id === activeWalletId) { setOpen(false); return }
    await onSelect(id)
    setOpen(false)
  }

  async function handleConnectWebLN() {
    setConnecting(true)
    setConnectError(null)
    try {
      await onConnectWebLN()
      setOpen(false)
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-xl border text-[13px] font-semibold transition-all duration-150',
          'hover:bg-[var(--theme-surface-secondary)] active:scale-[0.98]',
        )}
        style={{
          border: '1px solid var(--theme-border)',
          background: 'var(--theme-surface)',
          color: 'var(--theme-text)',
        }}
      >
        <Zap size={14} style={{ color: 'var(--color-btc)' }} />
        <span className="truncate">{activeLabel}</span>
        <ChevronDown
          size={14}
          className={cn('transition-transform duration-200 shrink-0', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 w-64 rounded-xl border shadow-lg z-50 overflow-hidden"
          style={{
            background: 'var(--theme-surface)',
            border: '1px solid var(--theme-border)',
          }}
        >
          <div className="flex flex-col py-1">
            {wallets.map(wallet => (
              <button
                key={wallet.id}
                type="button"
                onClick={() => void handleSelect(wallet.id)}
                className={cn(
                  'flex-1 flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors duration-150 w-full',
                  'hover:bg-[var(--theme-surface-secondary)]',
                  wallet.id === activeWalletId && 'bg-[var(--theme-surface-secondary)]',
                )}
                style={{ color: 'var(--theme-text)' }}
              >
                <Check
                  size={14}
                  className={cn('shrink-0', wallet.id === activeWalletId ? 'opacity-100' : 'opacity-0')}
                  style={{ color: 'var(--color-status-success)' }}
                />
                <span className="truncate">{walletProviderLabel(wallet.provider)}</span>
                <span className="text-[10px] uppercase font-semibold ml-auto" style={{ color: 'var(--theme-text-muted)' }}>
                  {wallet.mode === 'CUSTODIAL' ? 'Custodial' : 'Non-custodial'}
                </span>
              </button>
            ))}
          </div>

          {connectError && (
            <div
              className="flex items-start gap-2 px-3 py-2 text-[11px]"
              style={{ background: 'var(--color-status-error-bg)', color: 'var(--color-status-error)' }}
            >
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              {connectError}
            </div>
          )}

          <div className="border-t flex flex-col" style={{ borderColor: 'var(--theme-border)' }}>
            <button
              type="button"
              onClick={() => void handleConnectWebLN()}
              disabled={connecting}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-[13px] text-left transition-colors duration-150 hover:bg-[var(--theme-surface-secondary)] disabled:opacity-60"
              style={{ color: 'var(--theme-text)' }}
            >
              <Plus size={14} style={{ color: 'var(--color-status-success)' }} />
              {connecting ? 'Connecting…' : 'Connect WebLN wallet'}
            </button>
            <Link
              to="/settings#wallet"
              onClick={() => setOpen(false)}
              className="px-3 py-2 text-[11px] transition-colors duration-150 hover:bg-[var(--theme-surface-secondary)]"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              Manage Nostr Wallet Connect / eCash in Settings →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
