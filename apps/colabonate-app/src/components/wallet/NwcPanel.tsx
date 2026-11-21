/**
 * NwcPanel — the Nostr Wallet Connect (NIP-47) surface in the Wallet dashboard
 * (ADR-208). Renders only when the user's active wallet is NWC. Shows the
 * connected wallet alias, balance, and last sync; provides refresh + disconnect.
 *
 * NWC is the user's non-custodial spending wallet — a peer of WebLN/Cashu —
 * NOT a platform PaymentProvider. It pays invoices over Nostr relays.
 */
import { useState } from 'react'
import { RefreshCw, Unlink, Zap, AlertTriangle } from 'lucide-react'
import { cn } from '@ds/utils'
import { useWallet } from '../../contexts/WalletContext'
import { formatSatsNumber } from '../../lib/currency'
import { FiatHint } from '../currency/FiatHint'
import { walletProviderLabel } from '../../lib/walletProviderLabels'

export function NwcPanel() {
  const { wallet, refreshNWC, refreshBalance, disconnectNWC } = useWallet()
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  // ADR-228 D5: NWC and ALBY_OAUTH are peer non-custodial rails. The Alby row is
  // created automatically at Alby login (auth-alby.ts), so it needs the same
  // dashboard surface (status, balance, sync). WebLN has the BalanceCard and
  // Cashu has its own panel; everything else is generic.
  const provider = wallet?.provider
  const isNwc = provider === 'NWC'
  if (!wallet || (!isNwc && provider !== 'ALBY_OAUTH')) return null

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      // NWC does a live relay round-trip; Alby re-syncs through GET /api/wallet
      // (the server refreshes the OAuth balance on read).
      if (isNwc) await refreshNWC()
      else await refreshBalance()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  async function disconnect() {
    setDisconnecting(true)
    setError(null)
    try {
      await disconnectNWC()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDisconnecting(false)
    }
  }

  const lastSync = wallet.nwcLastSyncedAt ?? wallet.lastSyncedAt
  const lastSyncLabel = lastSync ? new Date(lastSync).toLocaleString() : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={14} style={{ color: 'var(--theme-text-muted)' }} />
          <span className="text-[12px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
            {walletProviderLabel(provider)} · non-custodial
          </span>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="text-[11px] font-semibold transition-colors disabled:opacity-50"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          {refreshing ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      <div
        className="flex flex-col gap-3 p-4 rounded-xl border"
        style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
      >
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col min-w-0">
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
              Connected wallet
            </span>
            <span className="text-[15px] font-semibold truncate" style={{ color: 'var(--theme-text)' }} title={wallet.nwcWalletPubkey ?? undefined}>
              {isNwc
                ? (wallet.nwcWalletPubkey ? `Connected wallet ${wallet.nwcWalletPubkey.slice(0, 16)}…` : 'Connected wallet')
                : 'Alby account (linked at login)'}
            </span>
            {lastSyncLabel && (
              <span className="text-[11px] mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>
                Last sync: {lastSyncLabel}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end shrink-0">
            <span className="text-[22px] font-bold leading-tight" style={{ color: 'var(--theme-text)' }}>
              {formatSatsNumber(wallet.balanceSats, { compact: false })}{' '}
              <span className="text-[14px] font-semibold" style={{ color: 'var(--theme-text-muted)' }}>sats</span>
            </span>
            <FiatHint sats={wallet.balanceSats} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
          </div>
        </div>

        {error && (
          <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}>
            {error}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150')}
            style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
          >
            <RefreshCw size={14} style={{ color: 'var(--color-primary-50)' }} />
            Sync
          </button>
          {isNwc ? (
            <button
              type="button"
              onClick={() => void disconnect()}
              disabled={disconnecting}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all duration-150"
              style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
            >
              <Unlink size={14} />
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          ) : (
            // ADR-298: the Alby row comes from the OAuth login, there is nothing
            // to disconnect here — revoke the grant in your Alby account.
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
              Managed by your Alby login
            </span>
          )}
        </div>

        <div className="flex items-start gap-2 text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            {isNwc
              ? 'Non-custodial: payments route through your wallet over Nostr relays. The connection key is separate from your Nostr identity and stored encrypted.'
              : 'Non-custodial: payments route through your Alby account using the OAuth grant from login. Colabonate never holds your funds.'}
          </span>
        </div>
      </div>
    </div>
  )
}
