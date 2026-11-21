import { ArrowUp, ArrowDown, Clock, CheckCircle, Reply, Lock, ChevronRight } from 'lucide-react'
import { cn } from '@ds/utils'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../currency/FiatHint'
import { railBadge, statusPresentation, type StatusTone } from '../../lib/walletTransactionView'
import type { Transaction } from '../../types/api'

interface TransactionCardProps {
  transaction: Transaction
  onClick?: (ticketId: string) => void
}

// Marketplace rows are ticket-derived and link into the ticket; the platform
// payments unioned into the same history (AI credits, MCP passes, workspace
// funding, support tips) carry `ticketId: null` and render as plain rows with no
// link. A Lightning `paymentHash` is not a Bitcoin txid, so there is no explorer
// link either way.
const TONE_STYLE: Record<StatusTone, { background: string; color: string }> = {
  success: { background: 'var(--color-status-success-bg)', color: 'var(--color-status-success)' },
  warning: { background: 'var(--color-status-warning-bg)', color: 'var(--color-status-warning)' },
  error: { background: 'var(--color-status-error-bg)', color: 'var(--color-status-error)' },
  neutral: { background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' },
}

export function TransactionCard({ transaction, onClick }: TransactionCardProps) {
  const { type, amountSats, offerTitle, createdAt, ticketId } = transaction
  const interactive = Boolean(ticketId)

  const icons: Record<Transaction['type'], React.ReactNode> = {
    SENT: <ArrowUp size={14} />,
    RECEIVED: <ArrowDown size={14} />,
    ESCROW_HOLD: <Clock size={14} />,
    ESCROW_RELEASE: <CheckCircle size={14} />,
    ESCROW_REFUND: <Reply size={14} />,
  }

  const colors: Record<Transaction['type'], string> = {
    SENT: 'var(--color-sats-negative)',
    RECEIVED: 'var(--color-sats-positive)',
    ESCROW_HOLD: 'var(--color-escrow-held)',
    ESCROW_RELEASE: 'var(--color-status-success)',
    ESCROW_REFUND: 'var(--color-status-warning)',
  }

  const color = colors[type]
  const isNegative = type === 'SENT'
  const rail = railBadge(transaction)
  const status = statusPresentation(transaction)
  const toneStyle = TONE_STYLE[status.tone]

  const className = cn(
    'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-200',
    interactive && 'cursor-pointer hover:-translate-y-0.5 active:scale-[0.98]',
  )
  const style = {
    border: '1px solid var(--theme-border)',
    background: 'var(--theme-surface)',
  }

  const content = (
    <>
      <div
        className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
        style={{ background: `${color}18`, color }}
      >
        {icons[type]}
      </div>

      <div className="flex flex-col min-w-0 flex-1 gap-1">
        <span
          className="text-[13px] font-semibold truncate"
          style={{ color: 'var(--theme-text)' }}
        >
          {offerTitle}
        </span>
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
            {new Date(createdAt).toLocaleDateString('en-US', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {rail && (
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
              title={rail.title}
            >
              {rail.label}
            </span>
          )}
          {transaction.visibility === 'PRIVATE' && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
            >
              <Lock size={10} /> Private
            </span>
          )}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[13px] font-semibold tabular-nums" style={{ color }}>
            {isNegative ? '-' : '+'}{formatSats(amountSats, { compact: false })}
          </span>
          <FiatHint sats={amountSats} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
          <span
            className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded"
            style={toneStyle}
          >
            {status.label}
          </span>
        </div>

        {interactive && <ChevronRight size={14} style={{ color: 'var(--theme-text-muted)' }} aria-hidden />}
      </div>
    </>
  )

  if (interactive) {
    return (
      <button type="button" onClick={() => ticketId && onClick?.(ticketId)} className={className} style={style}>
        {content}
      </button>
    )
  }
  return (
    <div className={className} style={style}>
      {content}
    </div>
  )
}
