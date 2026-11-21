import { Lock, Wallet, AlertCircle, AlertTriangle } from 'lucide-react'
import { cn } from '@ds/utils'
import type { SubWalletEntry } from '../../hooks/useEntityQueries'

interface SubWalletPanelProps {
  subWallets: SubWalletEntry[]
  loading?: boolean
  onOfferClick?: (offerId: string) => void
  warning?: boolean
  limitReached?: boolean
}

const ESCROW_LABEL: Record<string, string> = {
  INITIATED: 'Initiated',
  PHASE_1_PENDING: 'Phase 1 pending',
  RESERVED: 'Reserved',
  PHASE_2_PENDING: 'Phase 2 pending',
  DELIVERY_STARTED: 'In delivery',
  PHASE_3_PENDING: 'Phase 3 pending',
  DELIVERY_CONFIRMED: 'Confirmed',
  RELEASED: 'Released',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Disputed',
}

export function SubWalletPanel({ subWallets, loading, onOfferClick, warning, limitReached }: SubWalletPanelProps) {
  if (!loading && subWallets.length === 0 && !warning && !limitReached) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Lock size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <span
          className="text-[12px] uppercase font-semibold tracking-wider"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          Private Trade Sub-Wallets
        </span>
      </div>

      {limitReached && (
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[13px]"
          style={{ background: 'rgba(232,69,65,0.10)', border: '1px solid rgba(232,69,65,0.25)', color: 'var(--color-primary-50)' }}
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            Sub-wallet limit reached (50). New private offers cannot be created until you archive inactive ones or contact support.
          </span>
        </div>
      )}

      {!limitReached && warning && (
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-xl text-[13px]"
          style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)', color: 'rgb(180,120,10)' }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Approaching sub-wallet limit (20+). Consider archiving completed private offers to free up capacity.
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2].map(i => (
            <div
              key={i}
              className="h-14 rounded-xl animate-pulse"
              style={{ background: 'var(--theme-surface)' }}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {subWallets.map(sw => {
            const ticket = sw.latestTicket
            const escrowLabel = ticket?.escrowStatus ? (ESCROW_LABEL[ticket.escrowStatus] ?? ticket.escrowStatus) : null
            const isActive = ticket && !['RELEASED', 'CANCELLED'].includes(ticket.escrowStatus ?? '')

            return (
              <button
                key={sw.offerId}
                type="button"
                onClick={() => onOfferClick?.(sw.offerId)}
                className={cn(
                  'flex items-center justify-between gap-3 p-3 rounded-xl border text-left transition-all duration-200',
                  onOfferClick ? 'hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer' : 'cursor-default',
                )}
                style={{
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface)',
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Wallet
                    size={14}
                    style={{ color: isActive ? 'var(--color-primary-50)' : 'var(--theme-text-muted)', flexShrink: 0 }}
                  />
                  <div className="flex flex-col min-w-0">
                    <span
                      className="text-[13px] font-semibold truncate"
                      style={{ color: 'var(--theme-text)' }}
                    >
                      {sw.offerTitle}
                    </span>
                    {sw.subWalletId && (
                      <span
                        className="text-[11px] font-mono truncate"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        {sw.subWalletId.slice(0, 16)}…
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {escrowLabel && (
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                      style={{
                        background: isActive ? 'rgba(232,69,65,0.10)' : 'var(--theme-bg-subtle)',
                        color: isActive ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
                      }}
                    >
                      {escrowLabel}
                    </span>
                  )}
                  {!ticket && (
                    <AlertCircle size={13} style={{ color: 'var(--theme-text-muted)' }} />
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
