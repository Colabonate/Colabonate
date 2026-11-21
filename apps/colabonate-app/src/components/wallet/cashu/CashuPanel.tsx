/**
 * CashuPanel — the non-custodial eCash surface in the Wallet dashboard (ADR-187).
 * Self-gates: renders nothing unless the wallet is active (build flag + opt-in).
 * Shows total eCash balance, per-mint breakdown, and the full P2P + Lightning
 * loop: Receive / Send (token), Top up (Lightning → ecash, FU-46), Withdraw
 * (ecash → Lightning, FU-46), Nutzap (NIP-61, Phase 3), and Mints management.
 */
import { useState } from 'react'
import { Coins, Download, Upload, Settings2, AlertTriangle, Zap, ArrowUpToLine, Send } from 'lucide-react'
import { cn } from '@ds/utils'
import { useCashu } from '../../../contexts/CashuContext'
import { formatSatsNumber } from '../../../lib/currency'
import { FiatHint } from '../../currency/FiatHint'
import { ReceiveTokenModal } from './ReceiveTokenModal'
import { SendTokenModal } from './SendTokenModal'
import { MintManagerModal } from './MintManagerModal'
import { MintViaLightningModal } from './MintViaLightningModal'
import { MeltToLightningModal } from './MeltToLightningModal'
import { SendNutzapModal } from './SendNutzapModal'

export function CashuPanel() {
  const { enabled, status, balanceSats, state, error, refresh, claimIncomingNutzaps } = useCashu()
  const [modal, setModal] = useState<null | 'receive' | 'send' | 'mints' | 'mint' | 'melt' | 'nutzap'>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimResult, setClaimResult] = useState<string | null>(null)

  if (!enabled) return null

  const buckets = state.buckets.filter((b) => b.proofs.length > 0)
  const loading = status === 'loading'

  const actionBtn =
    'flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-150 hover:bg-[var(--theme-surface-secondary)] active:scale-[0.98]'

  async function claim() {
    setClaiming(true)
    setClaimResult(null)
    try {
      const { claimed } = await claimIncomingNutzaps()
      if (claimed.length === 0) {
        setClaimResult('No new nutzaps.')
      } else {
        const total = claimed.reduce((s, c) => s + c.sats, 0)
        setClaimResult(`+${total.toLocaleString()} sats from ${claimed.length} nutzap${claimed.length === 1 ? '' : 's'}.`)
      }
    } catch (e) {
      setClaimResult(e instanceof Error ? e.message : String(e))
    } finally {
      setClaiming(false)
      setTimeout(() => setClaimResult(null), 4000)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins size={14} style={{ color: 'var(--theme-text-muted)' }} />
          <span className="text-[12px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
            eCash (Cashu) · non-custodial
          </span>
        </div>
        {status === 'ready' && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void claim()}
              disabled={claiming}
              className="text-[11px] font-semibold transition-colors disabled:opacity-50"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              {claiming ? 'Claiming…' : 'Claim nutzaps'}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="text-[11px] font-semibold transition-colors"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      <div
        className="flex flex-col gap-3 p-4 rounded-xl border"
        style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
      >
        <div className="flex items-end justify-between">
          <div className="flex flex-col">
            <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
              Total eCash balance
            </span>
            {loading ? (
              <div className="h-7 w-28 rounded animate-pulse mt-1" style={{ background: 'var(--theme-bg-subtle)' }} />
            ) : (
              <span className="text-[22px] font-bold leading-tight" style={{ color: 'var(--theme-text)' }}>
                {formatSatsNumber(balanceSats, { compact: false })} <span className="text-[14px] font-semibold" style={{ color: 'var(--theme-text-muted)' }}>sats</span>{' '}
                <FiatHint sats={balanceSats} className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }} />
              </span>
            )}
            {claimResult && (
              <span className="text-[11px] mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                {claimResult}
              </span>
            )}
          </div>
        </div>

        {error && status === 'error' && (
          <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-primary-50)' }}>
            {error}
          </div>
        )}

        {buckets.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {buckets.map((b) => {
              const bal = b.proofs.reduce((s, p) => s + p.amount, 0)
              return (
                <div key={b.mintUrl} className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-mono truncate" style={{ color: 'var(--theme-text-muted)' }}>
                    {b.mintUrl}
                  </span>
                  <span className="text-[12px] font-semibold shrink-0" style={{ color: 'var(--theme-text)' }}>
                    {bal.toLocaleString()} sats
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mt-1">
          <button type="button" onClick={() => setModal('mint')} className={actionBtn} style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
            <Zap size={14} style={{ color: 'var(--color-primary-50)' }} />
            Top up
          </button>
          <button type="button" onClick={() => setModal('melt')} className={actionBtn} style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
            <ArrowUpToLine size={14} style={{ color: 'var(--color-primary-50)' }} />
            Withdraw
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <button type="button" onClick={() => setModal('receive')} className={actionBtn} style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
            <Download size={14} style={{ color: 'var(--color-primary-50)' }} />
            Receive
          </button>
          <button type="button" onClick={() => setModal('send')} className={actionBtn} style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
            <Upload size={14} style={{ color: 'var(--color-primary-50)' }} />
            Send
          </button>
          <button type="button" onClick={() => setModal('nutzap')} className={actionBtn} style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
            <Send size={14} style={{ color: 'var(--color-primary-50)' }} />
            Nutzap
          </button>
          <button type="button" onClick={() => setModal('mints')} className={cn(actionBtn)} style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}>
            <Settings2 size={14} style={{ color: 'var(--theme-text-muted)' }} />
            Mints
          </button>
        </div>

        <div className="flex items-start gap-2 text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            Non-custodial: you hold the proofs. Losing your wallet key or a mint going insolvent means losing funds — Colabonate cannot recover them.
          </span>
        </div>
      </div>

      <ReceiveTokenModal open={modal === 'receive'} onClose={() => setModal(null)} />
      <SendTokenModal open={modal === 'send'} onClose={() => setModal(null)} />
      <MintManagerModal open={modal === 'mints'} onClose={() => setModal(null)} />
      <MintViaLightningModal open={modal === 'mint'} onClose={() => setModal(null)} />
      <MeltToLightningModal open={modal === 'melt'} onClose={() => setModal(null)} />
      <SendNutzapModal open={modal === 'nutzap'} onClose={() => setModal(null)} />
    </div>
  )
}
