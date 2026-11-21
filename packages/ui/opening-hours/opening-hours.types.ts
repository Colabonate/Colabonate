import type { HTMLAttributes } from 'react'

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface DayHours {
  start: string
  end: string
}

export type OpeningHoursData = Record<DayKey, DayHours | null>

export interface OpeningHoursProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Opening hours per weekday, e.g. { mon: { start: "09:00", end: "17:00" }, sat: null, ... } */
  hours: Partial<OpeningHoursData> | null | undefined
  /** Compact mode – shows only today's hours without expand toggle */
  compact?: boolean
  /** Show the icon (Clock) */
  showIcon?: boolean
  /** Custom label for the section header (default: "Opening Hours") */
  label?: string
}
