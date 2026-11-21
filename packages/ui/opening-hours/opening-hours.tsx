import { useState, useCallback } from 'react'
import ScheduleIcon from '@mui/icons-material/Schedule'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { cn } from '@ds/utils'
import type { OpeningHoursProps, DayKey, OpeningHoursData, DayHours } from './opening-hours.types'

const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

function getTodayKey(): DayKey {
  const jsDay = new Date().getDay()
  return DAY_ORDER[jsDay === 0 ? 6 : jsDay - 1]
}

function formatRange(hours: DayHours | null): string {
  if (!hours) return 'Closed'
  return `${hours.start} – ${hours.end}`
}

function isOpenNow(hours: OpeningHoursData | null): boolean | null {
  if (!hours) return null
  const today = getTodayKey()
  const todayHours = hours[today]
  if (!todayHours) return false

  const now = new Date()
  const [startH, startM] = todayHours.start.split(':').map(Number)
  const [endH, endM] = todayHours.end.split(':').map(Number)
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  return currentMinutes >= startH * 60 + startM && currentMinutes < endH * 60 + endM
}

function getStatusDot(open: boolean | null) {
  if (open === null) {
    return <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--theme-text-muted)' }} />
  }
  if (open) {
    return (
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: 'var(--color-status-success)' }}
      />
    )
  }
  return (
    <span
      className="w-1.5 h-1.5 rounded-full"
      style={{ background: 'var(--color-status-error)' }}
    />
  )
}

export function OpeningHours({
  hours,
  compact = false,
  showIcon = true,
  label = 'Opening Hours',
  className,
  ...props
}: OpeningHoursProps) {
  const [expanded, setExpanded] = useState(false)
  const parsed = hours && Object.keys(hours).length > 0 ? (hours as OpeningHoursData) : null
  const todayKey = getTodayKey()
  const open = isOpenNow(parsed)

  const toggle = useCallback(() => setExpanded(prev => !prev), [])

  if (!parsed) return null

  return (
    <div className={cn('flex gap-2 text-[13px]', className)} {...props}>
      {showIcon && (
        <ScheduleIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
      )}
      <div className="flex-1">
        <div
          className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          {label}
        </div>

        {compact ? (
          <div className="flex items-center gap-1.5" style={{ color: 'var(--theme-text)' }}>
            {getStatusDot(open)}
            <span className="font-medium">{formatRange(parsed[todayKey])}</span>
          </div>
        ) : (
          <>
            <button
              onClick={toggle}
              className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
              style={{ color: 'var(--theme-text)' }}
              aria-expanded={expanded}
              aria-label={`${label}: ${formatRange(parsed[todayKey])}. ${expanded ? 'Collapse' : 'Expand'} weekly schedule`}
            >
              <div className="flex items-center gap-1.5">
                {getStatusDot(open)}
                <span className="font-medium">
                  {open === true ? 'Open now' : open === false ? 'Closed now' : 'Today'}: {formatRange(parsed[todayKey])}
                </span>
              </div>
              <ExpandMoreIcon
                sx={{ fontSize: 12 }}
                className={cn('transition-transform duration-200', expanded && 'rotate-180')}
              />
            </button>

            {expanded && (
              <div
                className="mt-3 w-full max-w-[260px] space-y-1 text-[12px]"
                style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
                role="list"
                aria-label="Weekly opening hours"
              >
                {DAY_ORDER.map((day) => {
                  const hours = parsed[day]
                  const isToday = day === todayKey
                  const isClosed = !hours
                  return (
                    <div
                      key={day}
                      role="listitem"
                      className="flex items-baseline justify-between gap-2 rounded px-1.5 py-1"
                      style={{
                        color: isToday
                          ? 'var(--color-primary-50)'
                          : isClosed
                            ? 'var(--theme-text-muted)'
                            : 'var(--theme-text)',
                        background: isToday ? 'rgba(99,179,237,0.08)' : 'transparent',
                      }}
                    >
                      <span className={cn('w-7 shrink-0', isToday && 'font-semibold')}>
                        {DAY_LABELS[day]}
                      </span>
                      <span className={cn(isToday && 'font-medium')}>
                        {formatRange(hours)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
