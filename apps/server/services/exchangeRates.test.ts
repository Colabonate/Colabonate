import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type ExchangeRatesModule = typeof import('./exchangeRates.js')

const CORE = ['eur', 'usd', 'rub', 'jpy'] as const
const ESTIMATE = [
  'gbp', 'ars', 'brl', 'ngn', 'cad', 'aud', 'cny', 'inr', 'chf', 'krw', 'sgd', 'idr', 'clp',
] as const

function buildPayload(
  overrides: Record<string, unknown> = {},
  omit: string[] = [],
): { bitcoin: Record<string, unknown> } {
  const btc: Record<string, unknown> = {}
  for (const cur of [...CORE, ...ESTIMATE]) {
    btc[cur] = 100_000 + cur.charCodeAt(0)
    btc[`${cur}_24h_change`] = 1.5
  }
  for (const key of omit) delete btc[key]
  return { bitcoin: { ...btc, ...overrides } }
}

describe('exchangeRates service', () => {
  let mod: ExchangeRatesModule
  let fetchMock: ReturnType<typeof vi.fn>

  function stubFetch(payload: unknown) {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  beforeEach(async () => {
    // Fresh module per test: the service keeps a module-level cache.
    vi.resetModules()
    mod = await import('./exchangeRates.js')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps SUPPORTED_RATE_CURRENCIES unchanged', () => {
    expect([...mod.SUPPORTED_RATE_CURRENCIES]).toEqual(['eur', 'usd', 'rub', 'jpy'])
  })

  it('returns core and all estimate-only rates on the happy path', async () => {
    stubFetch(buildPayload())

    const res = await mod.getExchangeRates()

    for (const cur of [...CORE, ...ESTIMATE]) {
      expect(res.rates[cur]).toBeDefined()
      expect(res.rates[cur].price).toBe(100_000 + cur.charCodeAt(0))
      expect(res.rates[cur].change24h).toBe(1.5)
    }
    expect(res.stale).toBe(false)
  })

  it('resolves when an estimate-only currency is missing from the payload', async () => {
    stubFetch(buildPayload({}, ['ars']))

    const res = await mod.getExchangeRates()

    expect(res.rates.ars).toBeUndefined()
    for (const cur of CORE) {
      expect(res.rates[cur]).toBeDefined()
    }
  })

  it('skips estimate-only currencies with invalid values without throwing', async () => {
    stubFetch(buildPayload({ clp: 0, krw: 'x', idr: -5 }))

    const res = await mod.getExchangeRates()

    expect(res.rates.clp).toBeUndefined()
    expect(res.rates.krw).toBeUndefined()
    expect(res.rates.idr).toBeUndefined()
    for (const cur of CORE) {
      expect(res.rates[cur]).toBeDefined()
    }
  })

  it('rejects on a cold cache when a core currency is missing', async () => {
    stubFetch(buildPayload({}, ['jpy']))

    await expect(mod.getExchangeRates()).rejects.toThrow()
  })

  it('requests core and estimate-only currencies in one CoinGecko call', async () => {
    stubFetch(buildPayload())

    await mod.getExchangeRates()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain(
      'vs_currencies=eur,usd,rub,jpy,gbp,ars,brl,ngn,cad,aud,cny,inr,chf,krw,sgd,idr,clp',
    )
    expect(url).toContain('include_24hr_change=true')
    expect(url).toContain('ids=bitcoin')
  })
})
