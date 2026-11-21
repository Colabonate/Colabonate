/**
 * CurrencyContext — the one client-side currency surface (ADR-235 D4).
 *
 * Exposes the user's selected display currency + the live BTC↔fiat rate (proxied
 * through the server) plus bound conversion/formatting helpers. Pure formatting
 * helpers live in `lib/currency.ts`; this wraps them with the current rate.
 *
 * Persistence: the selected currency is the account-level value (server, ADR-235
 * D2) hydrated on login, with localStorage as the offline cache + logged-out
 * fallback. The old `primaryCurrency` localStorage key is reused for that cache.
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall, ApiError } from '../lib/api'
import { getPref, setPref } from '../utils/userPreferences'
import {
  DEFAULT_FIAT_CURRENCY,
  toFiatCurrency,
  type FiatCurrency,
} from '../config/currencies'
import {
  satsToFiat as satsToFiatPure,
  fiatToSats as fiatToSatsPure,
  formatSats as formatSatsPure,
  formatFiat as formatFiatPure,
  formatSatsWithFiat as formatSatsWithFiatPure,
} from '../lib/currency'

const PRIMARY_CURRENCY_PREF = 'primaryCurrency'
const RATES_POLL_MS = 60_000

interface RateEntry {
  price: number
  change24h: number
}
type RateMap = Record<string, RateEntry>

// Stable fallback while rates are unloaded — a fresh `{}` per render would
// change the context value's identity every render and re-render all consumers.
const EMPTY_RATES: RateMap = {}

interface ExchangeRatesResponse {
  rates: RateMap
  lastUpdated: string
  stale: boolean
  fetchedAt: string
}

interface CurrencyContextValue {
  currency: FiatCurrency
  setCurrency: (c: FiatCurrency) => void
  /** Price of 1 BTC in the selected fiat currency, or null when unavailable. */
  rate: number | null
  rateUpdatedAt: Date | null
  rateStale: boolean
  hasRate: boolean
  /** Force a fresh rate fetch (wallet refresh button). */
  refetchRates: () => void
  /** Full rate map keyed by lower-case ISO code (for surfaces needing a secondary currency). */
  rates: RateMap
  satsToFiat: (sats: number) => number | null
  fiatToSats: (fiat: number) => number | null
  formatSats: (sats: number) => string
  formatFiat: (value: number) => string
  formatSatsWithFiat: (sats: number) => string
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

function readPubkey(): string | null {
  try {
    const pk = localStorage.getItem('pubkey')
    return pk && pk !== 'undefined' && pk !== 'null' ? pk : null
  } catch {
    return null
  }
}

async function fetchExchangeRates(): Promise<ExchangeRatesResponse> {
  const res = await apiCall('/api/exchange-rates')
  return (await res.json()) as ExchangeRatesResponse
}

async function fetchServerCurrency(pubkey: string): Promise<FiatCurrency | null> {
  try {
    const res = await apiCall(`/api/user/${pubkey}/currency`)
    const data = (await res.json()) as { preferredFiatCurrency?: string }
    return toFiatCurrency(data.preferredFiatCurrency)
  } catch (e) {
    // 404 (user row absent yet) → fall back to local; other errors → local too.
    if (e instanceof ApiError && e.status === 404) return null
    return null
  }
}

async function patchServerCurrency(pubkey: string, currency: FiatCurrency): Promise<void> {
  try {
    await apiCall(`/api/user/${pubkey}/currency`, {
      method: 'PATCH',
      body: JSON.stringify({ preferredFiatCurrency: currency }),
    })
  } catch {
    // Non-fatal: the local pref is already set; the server will be retried on
    // the next explicit change. Never block the UI on this.
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [currency, setCurrencyState] = useState<FiatCurrency>(() =>
    toFiatCurrency(getPref<string>(PRIMARY_CURRENCY_PREF, DEFAULT_FIAT_CURRENCY)),
  )
  // Becomes true once the user explicitly changes currency this session — stops a
  // slow in-flight hydration from reverting a just-made choice.
  const userTouchedRef = useRef(false)
  const hydratedRef = useRef(false)

  // ── Rate query (server proxy, 60 s poll) ────────────────────────────────
  const ratesQuery = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: fetchExchangeRates,
    refetchInterval: RATES_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: RATES_POLL_MS / 2,
  })

  const rates: RateMap = ratesQuery.data?.rates ?? EMPTY_RATES
  const rateStale = ratesQuery.data?.stale ?? false
  // Memoize on the ISO string so the Date identity only changes when the
  // timestamp actually changes (a fresh Date per render would defeat the
  // context-value useMemo below and churn every consumer).
  const lastUpdatedIso = ratesQuery.data?.lastUpdated ?? null
  const rateUpdatedAt = useMemo(
    () => (lastUpdatedIso ? new Date(lastUpdatedIso) : null),
    [lastUpdatedIso],
  )
  const rate = rates[currency.toLowerCase()]?.price ?? null

  // ── Account-level hydration (login) ─────────────────────────────────────
  const pubkey = readPubkey()
  const serverCurrencyQuery = useQuery({
    queryKey: ['user-currency', pubkey],
    queryFn: () => (pubkey ? fetchServerCurrency(pubkey) : Promise.resolve(null)),
    enabled: !!pubkey,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const serverCurrency = serverCurrencyQuery.data ?? null

  // Depend on the resolved query data directly — reading it imperatively via
  // queryClient.getQueryData never re-ran this effect when the fetch resolved,
  // so the account-level value was never applied.
  useEffect(() => {
    if (!pubkey) {
      hydratedRef.current = false
      return
    }
    if (serverCurrency === null) return
    if (hydratedRef.current || userTouchedRef.current) return
    hydratedRef.current = true
    if (serverCurrency !== currency) {
      setPref(PRIMARY_CURRENCY_PREF, serverCurrency)
      setCurrencyState(serverCurrency)
    }
  }, [pubkey, serverCurrency, currency])

  // ── Cross-tab / external pref sync ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.key === PRIMARY_CURRENCY_PREF) {
        setCurrencyState(toFiatCurrency(detail.value))
      }
    }
    window.addEventListener('pref-change', handler)
    return () => window.removeEventListener('pref-change', handler)
  }, [])

  const setCurrency = useCallback(
    (c: FiatCurrency) => {
      userTouchedRef.current = true
      setPref(PRIMARY_CURRENCY_PREF, c)
      setCurrencyState(c)
      const pk = readPubkey()
      if (pk) {
        queryClient.setQueryData(['user-currency', pk], c)
        void patchServerCurrency(pk, c)
      }
    },
    [queryClient],
  )

  // ── Bound helpers ───────────────────────────────────────────────────────
  const satsToFiat = useCallback((sats: number) => satsToFiatPure(sats, rate), [rate])
  const fiatToSats = useCallback((fiat: number) => fiatToSatsPure(fiat, rate), [rate])
  const formatSats = useCallback((sats: number) => formatSatsPure(sats), [])
  const formatFiat = useCallback((value: number) => formatFiatPure(value, currency), [currency])
  const formatSatsWithFiat = useCallback(
    (sats: number) => formatSatsWithFiatPure(sats, rate, currency),
    [rate, currency],
  )

  const refetchRates = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['exchange-rates'] })
  }, [queryClient])

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency,
      rate,
      rateUpdatedAt,
      rateStale,
      hasRate: rate !== null,
      refetchRates,
      rates,
      satsToFiat,
      fiatToSats,
      formatSats,
      formatFiat,
      formatSatsWithFiat,
    }),
    [
      currency,
      setCurrency,
      rate,
      rateUpdatedAt,
      rateStale,
      refetchRates,
      rates,
      satsToFiat,
      fiatToSats,
      formatSats,
      formatFiat,
      formatSatsWithFiat,
    ],
  )

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext)
  if (!ctx) {
    throw new Error('useCurrency must be used within a <CurrencyProvider>')
  }
  return ctx
}
