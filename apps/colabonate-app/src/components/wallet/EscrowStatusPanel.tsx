import { Clock, CheckCircle, Reply } from 'lucide-react'
import { cn } from '@ds/utils'
import { getEscrowDisplayStatus, getEscrowReleasedPct, type EscrowDisplayStatus } from '../../lib/escrow-utils'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../currency/FiatHint'
import type { Ticket } from '../../types/api'

interface EscrowStatusPanelProps {
  tickets: Ticket[]
  onTicketClick?: (ticketId: string) => void
}

export function EscrowStatusPanel({ tickets, onTicketClick }: EscrowStatusPanelProps) {
  const activeTickets = tickets.filter(t => {
    const status = getEscrowDisplayStatus(t.escrowStatus)
    return status === 'held' || status === 'partially-released'
  })

  if (activeTickets.length === 0) return null

  const statusConfig: Record<EscrowDisplayStatus, { label: string; color: string; icon: React.ReactNode }> = {
    pending: { label: 'Pending', color: 'var(--theme-text-muted)', icon: <Clock size={12} /> },
    held: { label: 'Held', color: 'var(--color-escrow-held)', icon: <Clock size={12} /> },
    'partially-released': { label: 'Released', color: 'var(--color-status-success)', icon: <CheckCircle size={12} /> },
    'fully-released': { label: 'Released', color: 'var(--color-status-success)', icon: <CheckCircle size={12} /> },
    refunded: { label: 'Refunded', color: 'var(--color-status-warning)', icon: <Reply size={12} /> },
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Clock size={14} style={{ color: 'var(--theme-text-muted)' }} />
        <span className="text-[12px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
          Active Escrow
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {activeTickets.map(ticket => {
          const status = getEscrowDisplayStatus(ticket.escrowStatus)
          const pct = getEscrowReleasedPct(ticket.escrowStatus)
          const config = statusConfig[status]
          const amountSats = ticket.amountSats ?? ticket.offer.priceSats

          return (
            <button
              key={ticket.id}
              type="button"
              onClick={() => onTicketClick?.(ticket.id)}
              className={cn(
                'flex flex-col gap-2 p-3 rounded-xl border text-left transition-all duration-200',
                'hover:-translate-y-0.5 active:scale-[0.98]',
              )}
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface)',
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--theme-text)' }}>
                  {ticket.offer.title}
                </span>
                <span
                  className="flex items-center gap-1 text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full"
                  style={{ background: `${config.color}18`, color: config.color }}
                >
                  {config.icon}
                  {config.label}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                    {formatSats(amountSats, { compact: false })} held{' '}
                    <FiatHint sats={amountSats} className="text-[11px]" />
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: config.color }}>
                    {pct}% released
                  </span>
                </div>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'var(--theme-surface-secondary)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      background: config.color,
                    }}
                  />
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}