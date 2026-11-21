/**
 * Exchange-Rate Proxy Service (ADR-235 D3)
 *
 * Server-side proxy for BTC↔fiat rates. Replaces the per-client direct
 * CoinGecko fetch (one upstream call per minute total instead of one per
 * client), hides the third party from the SPA (ADR-212 closed-beta trust
 * model), and survives short upstream outages by serving the last good value
 * marked `stale` (up to 24 h).
 *
 * No API key required (CoinGecko free tier). Adding a currency = add it to
 * `SUPPORTED_RATE_CURRENCIES` (FU-235-A).
 */

export const SUPPORTED_RATE_CURRENCIES = ['eur', 'usd', 'rub', 'jpy'] as const
export type RateCurrency = (typeof SUPPORTED_RATE_CURRENCIES)[number]

// Kept separate from SUPPORTED_RATE_CURRENCIES on purpose: that list is also the
// allowed set for a user's preferred display currency (index.ts) and mirrors the
// client registry, so widening it would change user-facing behavior. These are
// best-effort "approx sats" estimates only (ADR-415): CoinGecko may omit them and
// the service must still serve the core currencies when it does.
export const ESTIMATE_ONLY_RATE_CURRENCIES = [
  'gbp', 'ars', 'brl', 'ngn', 'cad', 'aud', 'cny', 'inr', 'chf', 'krw', 'sgd', 'idr', 'clp',
] as const

export interface ExchangeRateEntry {
  /** Price of 1 BTC in this fiat currency. */
  price: number
  /** 24h percentage change (CoinGecko `24h_change`). */
  change24h: number
}

export interface ExchangeRatesResponse {
  rates: Record<string, ExchangeRateEntry>
  /** ISO timestamp of the last successful upstream fetch. */
  lastUpdated: string
  /** True when the value is older than the fresh window (served from cache). */
  stale: boolean
  /** ISO timestamp of this response (when the cache answered). */
  fetchedAt: string
}

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin' +
  `&vs_currencies=${[...SUPPORTED_RATE_CURRENCIES, ...ESTIMATE_ONLY_RATE_CURRENCIES].join(',')}` +
  '&include_24hr_change=true'

const FRESH_TTL_MS = 60_000
const STALE_MAX_MS = 24 * 60 * 60 * 1000
const UPSTREAM_TIMEOUT_MS = 8_000

interface CacheEntry {
  rates: Record<string, ExchangeRateEntry>
  updatedAt: number
}

let cache: CacheEntry | null = null
let inflight: Promise<ExchangeRatesResponse | null> | null = null

async function fetchFromCoinGecko(): Promise<Record<string, ExchangeRateEntry>> {
  const res = await fetch(COINGECKO_URL, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`CoinGecko upstream HTTP ${res.status}`)
  const data = (await res.json()) as {
    bitcoin?: Record<string, number>
  }
  const btc = data.bitcoin
  if (!btc || typeof btc !== 'object') {
    throw new Error('CoinGecko upstream returned no bitcoin object')
  }
  const rates: Record<string, ExchangeRateEntry> = {}
  for (const cur of SUPPORTED_RATE_CURRENCIES) {
    const price = btc[cur]
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      throw new Error(`CoinGecko upstream missing/invalid price for ${cur}`)
    }
    const changeKey = `${cur}_24h_change`
    const change24h = typeof btc[changeKey] === 'number' ? (btc[changeKey] as number) : 0
    rates[cur] = { price, change24h }
  }
  for (const cur of ESTIMATE_ONLY_RATE_CURRENCIES) {
    const price = btc[cur]
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue
    const changeKey = `${cur}_24h_change`
    const change24h = typeof btc[changeKey] === 'number' ? (btc[changeKey] as number) : 0
    rates[cur] = { price, change24h }
  }
  return rates
}

/**
 * Returns the current exchange rates. Serves from in-memory cache while fresh
 * (60 s); on upstream failure serves the last good value marked `stale` for up
 * to 24 h; after the stale window a fresh fetch is attempted and, if it fails,
 * an error is thrown so the route can answer 503.
 *
 * Concurrent callers share a single in-flight fetch.
 */
export async function getExchangeRates(): Promise<ExchangeRatesResponse> {
  const now = Date.now()

  if (cache && now - cache.updatedAt < FRESH_TTL_MS) {
    return {
      rates: cache.rates,
      lastUpdated: new Date(cache.updatedAt).toISOString(),
      stale: false,
      fetchedAt: new Date(now).toISOString(),
    }
  }

  // Single-flight: all concurrent callers share ONE upstream refresh — cold
  // cache included, so a burst of first requests can't stampede CoinGecko.
  if (!inflight) {
    inflight = refresh().catch((err) => {
      // Keep any stale cache; surface nothing here (callers decide).
      console.warn('[exchange-rates] refresh failed:', err instanceof Error ? err.message : err)
      return null
    }).finally(() => {
      inflight = null
    })
  }
  // Capture before awaiting: `finally` above nulls the shared slot as soon as
  // the promise settles, and `await inflight` would then await null.
  const flight = inflight

  // Serve stale immediately while the shared refresh runs in the background.
  if (cache && now - cache.updatedAt < STALE_MAX_MS) {
    return {
      rates: cache.rates,
      lastUpdated: new Date(cache.updatedAt).toISOString(),
      stale: true,
      fetchedAt: new Date(now).toISOString(),
    }
  }

  // Cold cache or older than 24 h — wait for the shared fresh value.
  const fresh = await flight
  if (fresh) return fresh
  throw new Error('Exchange rates unavailable (upstream fetch failed)')
}

async function refresh(): Promise<ExchangeRatesResponse> {
  const rates = await fetchFromCoinGecko()
  const updatedAt = Date.now()
  cache = { rates, updatedAt }
  return {
    rates,
    lastUpdated: new Date(updatedAt).toISOString(),
    stale: false,
    fetchedAt: new Date(updatedAt).toISOString(),
  }
}

/** Synchronously expose the cache freshness for the boot canary without fetching. */
export function exchangeRatesCacheState(): { warm: boolean; ageMs: number | null } {
  if (!cache) return { warm: false, ageMs: null }
  return { warm: true, ageMs: Date.now() - cache.updatedAt }
}

/** Warm the cache at boot (best-effort, never throws). */
export async function warmExchangeRates(): Promise<void> {
  try {
    await refresh()
  } catch {
    // Non-fatal; the route will retry on first request.
  }
}
