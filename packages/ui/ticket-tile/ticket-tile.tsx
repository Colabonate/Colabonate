import ScheduleIcon from '@mui/icons-material/Schedule'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningIcon from '@mui/icons-material/Warning'
import CancelIcon from '@mui/icons-material/Cancel'
import BoltIcon from '@mui/icons-material/Bolt'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { cn } from '@ds/utils'
import type { TicketTileProps } from './ticket-tile.types'

// Status-Konfiguration mit Design-Tokens (CSS-Variablen für Dark/Light Mode)
const STATUS_CONFIG: Record<string, {
  icon: React.ReactNode
  accentColor: string
  labelBg: string
  labelText: string
  labelBorder: string
}> = {
  PENDING:     {
    icon: <ScheduleIcon sx={{ fontSize: 16 }} />,
    accentColor: 'var(--color-neutral-6)',
    labelBg: 'var(--color-neutral-9)', labelText: 'var(--color-neutral-5)', labelBorder: 'var(--color-neutral-7)',
  },
  ACCEPTED:    {
    icon: <CheckCircleIcon sx={{ fontSize: 16 }} />,
    accentColor: 'var(--color-status-info)',
    labelBg: 'var(--color-status-info-bg)', labelText: 'var(--color-status-info)', labelBorder: 'var(--color-status-info)',
  },
  PAID:        {
    icon: <CheckCircleIcon sx={{ fontSize: 16 }} />,
    accentColor: 'var(--color-status-info)',
    labelBg: 'var(--color-status-info-bg)', labelText: 'var(--color-status-info)', labelBorder: 'var(--color-status-info)',
  },
  IN_PROGRESS: {
    icon: <ScheduleIcon sx={{ fontSize: 16 }} />,
    accentColor: 'var(--color-primary-50)',
    labelBg: 'var(--color-primary-10)', labelText: 'var(--color-primary-50)', labelBorder: 'var(--color-primary-30)',
  },
  COMPLETED:   {
    icon: <CheckCircleIcon sx={{ fontSize: 16 }} />,
    accentColor: 'var(--color-status-success)',
    labelBg: 'var(--color-status-success-bg)', labelText: 'var(--color-status-success)', labelBorder: 'var(--color-status-success)',
  },
  DISPUTED:    {
    icon: <WarningIcon sx={{ fontSize: 16 }} />,
    accentColor: 'var(--color-status-warning)',
    labelBg: 'var(--color-status-warning-bg)', labelText: 'var(--color-status-warning)', labelBorder: 'var(--color-status-warning)',
  },
  CANCELLED:   {
    icon: <CancelIcon sx={{ fontSize: 16 }} />,
    accentColor: 'var(--color-neutral-7)',
    labelBg: 'var(--color-neutral-9)', labelText: 'var(--color-neutral-5)', labelBorder: 'var(--color-neutral-7)',
  },
}

export function TicketTile({ variant, ticket, statusLabel, onClick, className, ...props }: TicketTileProps) {
  const cfg   = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.PENDING
  const label = statusLabel ?? ticket.status

  // ── list variant ──────────────────────────────────────────────────────────
  if (variant === 'list') {
    return (
      <div
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-3 rounded-xl',
          'bg-[var(--theme-surface,var(--color-neutral-white))]',
          'border border-[var(--theme-border,var(--color-neutral-8))]',
          'shadow-[0_1px_4px_rgba(0,0,0,0.05)]',
          'hover:shadow-[0_4px_16px_rgba(0,0,0,0.09)] hover:border-[var(--color-neutral-7)]',
          'transition-all duration-200',
          onClick && 'cursor-pointer',
          'overflow-hidden relative',
          className
        )}
        {...props}
      >
        {/* Linker Accent-Stripe */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
          style={{ background: cfg.accentColor }}
        />

        <div className="flex flex-col flex-1 min-w-0 ml-1">
          <span
            className="text-[13px] font-semibold truncate leading-tight"
            style={{ fontFamily: 'var(--typography-fontfamily-sans)', color: 'var(--theme-text,var(--color-neutral-black))' }}
          >
            {ticket.title}
          </span>
          {ticket.amountSats !== undefined && (
            <span className="flex items-center gap-1 mt-0.5">
              <BoltIcon sx={{ fontSize: 10, color: 'var(--color-primary-50)' }} className="flex-shrink-0" />
              <span
                className="text-[12px] font-bold tabular-nums leading-none"
                style={{
                  fontFamily: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)',
                  color: 'var(--color-primary-50)',
                  letterSpacing: '-0.02em',
                }}
              >
                {ticket.amountSats.toLocaleString('de-DE')}
                <span className="text-[9px] font-semibold ml-0.5 opacity-70">sats</span>
              </span>
            </span>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center gap-1.5">
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.06em]"
            style={{
              background: cfg.labelBg,
              color: cfg.labelText,
              border: `1px solid ${cfg.labelBorder}`,
              fontFamily: 'var(--typography-fontfamily-sans)',
            }}
          >
            {cfg.icon} {label}
          </span>
          {onClick && <ArrowForwardIcon sx={{ fontSize: 12, color: 'var(--color-neutral-7)' }} />}
        </div>
      </div>
    )
  }

  // ── overview & pending: Figma-Kachel (dark fintech style) ─────────────────
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        'flex-shrink-0 snap-start flex flex-col w-29.5 items-start p-3 rounded-xl cursor-pointer',
        'relative overflow-hidden',
        'transition-all duration-250 ease-out',
        'hover:scale-[1.04] hover:shadow-[0_8px_24px_rgba(0,0,0,0.16)]',
        onClick && 'cursor-pointer',
        className
      )}
      style={{
        background: 'linear-gradient(145deg, var(--color-secondary-70) 0%, var(--color-secondary-90) 100%)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
      {...props}
    >
      {/* Accent-Stripe oben */}
      <div
        className="absolute top-0 left-0 right-0 h-[2.5px]"
        style={{ background: cfg.accentColor }}
      />

      {/* Status Badge */}
      <span
        className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-[0.07em] mt-1 mb-1.5 truncate"
        style={{ color: cfg.accentColor, fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {cfg.icon} {label}
      </span>

      {/* Titel */}
      <span
        className="text-[11px] font-medium leading-snug text-white/75 line-clamp-2"
        style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {ticket.title}
      </span>

      {/* Betrag – Barlow Bold, prominent */}
      {ticket.amountSats !== undefined && (
        <div className="mt-auto pt-2.5">
          <div className="flex items-end gap-0.5">
            <BoltIcon sx={{ fontSize: 10, color: 'var(--color-primary-50)' }} className="mb-0.5 flex-shrink-0" />
            <span
              className="text-[22px] font-bold leading-none tabular-nums text-white"
              style={{
                fontFamily: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)',
                letterSpacing: '-0.04em',
              }}
            >
              {ticket.amountSats.toLocaleString('de-DE')}
            </span>
          </div>
          <span
            className="text-[9px] font-semibold uppercase tracking-[0.06em] text-white/40 mt-0.5 block"
            style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            sats
          </span>
        </div>
      )}
    </div>
  )
}
