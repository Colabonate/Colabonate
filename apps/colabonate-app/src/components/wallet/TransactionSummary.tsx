import { ArrowUpRight, ArrowDownRight, BarChart3 } from 'lucide-react'
import { cn } from '@ds/utils'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../currency/FiatHint'

export type TimeFilter = '1m' | '3m' | '1y' | 'all'

interface TransactionSummaryProps {
  totalSent: number
  totalReceived: number
  countSent: number
  countReceived: number
  timeFilter: TimeFilter
  onTimeFilterChange: (filter: TimeFilter) => void
}

const TIME_OPTIONS: { value: TimeFilter; label: string }[] = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
]

export function TransactionSummary({
  totalSent,
  totalReceived,
  countSent,
  countReceived,
  timeFilter,
  onTimeFilterChange,
}: TransactionSummaryProps) {
  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-xl border"
      style={{
        border: '1px solid var(--theme-border)',
        background: 'var(--theme-surface)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} style={{ color: 'var(--theme-text-muted)' }} />
          <span
            className="text-[11px] uppercase font-semibold tracking-wider"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            Summary
          </span>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg" style={{ background: 'var(--theme-bg-subtle)', padding: 2 }}>
          {TIME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onTimeFilterChange(opt.value)}
              className={cn(
                'px-2 py-1 rounded-md text-[11px] font-semibold transition-all duration-150',
                timeFilter === opt.value ? 'cursor-pointer' : 'cursor-pointer hover:opacity-70',
              )}
              style={{
                background: timeFilter === opt.value ? 'var(--color-primary-50)' : 'transparent',
                color: timeFilter === opt.value ? 'white' : 'var(--theme-text-muted)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-stretch gap-3">
        <div
          className="flex-1 flex flex-col gap-1 p-3 rounded-lg"
          style={{ background: 'var(--theme-bg-subtle)' }}
        >
          <div className="flex items-center gap-1.5">
            <ArrowUpRight size={12} style={{ color: 'var(--color-sats-negative)' }} />
            <span className="text-[10px] uppercase font-semibold" style={{ color: 'var(--theme-text-muted)' }}>
              Sent
            </span>
          </div>
          <span className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--color-sats-negative)' }}>
            {formatSats(totalSent, { compact: false })}
          </span>
          <FiatHint sats={totalSent} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
          <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
            {countSent} transaction{countSent !== 1 ? 's' : ''}
          </span>
        </div>

        <div
          className="flex-1 flex flex-col gap-1 p-3 rounded-lg"
          style={{ background: 'var(--theme-bg-subtle)' }}
        >
          <div className="flex items-center gap-1.5">
            <ArrowDownRight size={12} style={{ color: 'var(--color-sats-positive)' }} />
            <span className="text-[10px] uppercase font-semibold" style={{ color: 'var(--theme-text-muted)' }}>
              Received
            </span>
          </div>
          <span className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--color-sats-positive)' }}>
            {formatSats(totalReceived, { compact: false })}
          </span>
          <FiatHint sats={totalReceived} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
          <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
            {countReceived} transaction{countReceived !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
