// Custom i18n system – EN-only for v1, extensible for DE in v2 (ADR-059 NS-1)
//
// Usage:
//   import { useTranslation } from '../contexts/LocaleContext'
//   const { t } = useTranslation()
//   <span>{t('goods.electronics')}</span>

import { createContext, useContext, type ReactNode } from 'react'

import en from '../../../../packages/data/categories/i18n/en.json'

// ─── Types ──────────────────────────────────────────────────────────────────

export type Locale = 'en' // Extend to 'en' | 'de' in v2

type TranslationMap = Record<string, string>

// ─── Translation Data ───────────────────────────────────────────────────────

const translations: Record<Locale, TranslationMap> = {
  en: en as TranslationMap,
  // de: de as TranslationMap, // v2: add de.json import
}

/** Current locale – single source of truth for v1 */
const CURRENT_LOCALE: Locale = 'en'

// ─── Utility Functions (for use outside React components / hooks) ───────────

/** Format a number using the current locale (e.g. 1,234) */
export function formatLocaleNumber(value: number): string {
  return value.toLocaleString('en-US')
}

/** Format a Date using the current locale */
export function formatLocaleDate(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const defaultOptions: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }
  return d.toLocaleDateString('en-US', options ?? defaultOptions)
}

/** Format a time using the current locale */
export function formatLocaleTime(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-US', options ?? { hour: '2-digit', minute: '2-digit' })
}

// ─── Context ────────────────────────────────────────────────────────────────

interface LocaleContextValue {
  locale: Locale
  t: (key: string) => string
  /** Format a number using the current locale (e.g. 1_234) */
  formatNumber: (value: number) => string
  /** Format a Date using the current locale */
  formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) => string
  /** Format a time using the current locale */
  formatTime: (date: Date | string, options?: Intl.DateTimeFormatOptions) => string
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

// ─── Provider ───────────────────────────────────────────────────────────────

export function LocaleProvider({ children }: { children: ReactNode }) {
  const t = (key: string): string => {
    return translations[CURRENT_LOCALE][key] ?? key
  }

  const formatNumber = formatLocaleNumber
  const formatDate = formatLocaleDate
  const formatTime = formatLocaleTime

  return (
    <LocaleContext.Provider value={{ locale: CURRENT_LOCALE, t, formatNumber, formatDate, formatTime }}>
      {children}
    </LocaleContext.Provider>
  )
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useTranslation(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useTranslation must be used within a <LocaleProvider>')
  }
  return ctx
}
