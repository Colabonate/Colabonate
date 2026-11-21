// ADR-418 smoke: GET /api/search/facets against a running server.
//
// For four parameter sets it checks:
//   1. sum(country) + countryless == total
//   2. the facet key set == the distinct non-null countries gathered by walking
//      GET /api/search (first=100, following `after` until hasNextPage=false)
//      with the SAME non-country params. The facet ignores `country` by design,
//      so the oracle walk never sends it.
//
// Usage: BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr418-search-facets-smoke.ts
// Read-only (GET only). Default target is the local dev server.

export {}

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:4001').replace(/\/$/, '')
const MAX_PAGES = 1000

interface FacetsResponse {
  country: Record<string, number>
  countryless: number
  total: number
}

interface ListResponse {
  hits: Array<{ country?: string | null }>
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
}

interface ParamSet {
  label: string
  params: Record<string, string>
}

const PARAM_SETS: ParamSet[] = [
  { label: 'none', params: {} },
  { label: 'offerType=PRODUCT', params: { offerType: 'PRODUCT' } },
  { label: 'q=bitcoin', params: { q: 'bitcoin' } },
  { label: 'country=DE (must be ignored)', params: { country: 'DE' } },
]

// The oracle walk never sends `country`: the facet ignores it by design.
function withoutCountry(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) if (k !== 'country') out[k] = v
  return out
}

function toQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`)
  return (await res.json()) as T
}

async function walkDistinctCountries(params: Record<string, string>): Promise<{ countries: Set<string>; rows: number }> {
  const countries = new Set<string>()
  let rows = 0
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = toQuery({ ...params, first: '100', ...(after ? { after } : {}) })
    const body = await getJson<ListResponse>(`/api/search?${qs}`)
    for (const hit of body.hits ?? []) {
      rows++
      if (hit.country) countries.add(hit.country)
    }
    if (!body.pageInfo?.hasNextPage || !body.pageInfo.endCursor) {
      return { countries, rows }
    }
    after = body.pageInfo.endCursor
  }
  throw new Error(`walk exceeded ${MAX_PAGES} pages without hasNextPage=false`)
}

let failures = 0

function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

async function main(): Promise<void> {
  console.log(`ADR-418 facets smoke against ${BASE_URL}`)

  for (const set of PARAM_SETS) {
    const label = set.label
    try {
      const facetParams = toQuery(set.params)
      const facets = await getJson<FacetsResponse>(`/api/search/facets${facetParams ? `?${facetParams}` : ''}`)

      const countrySum = Object.values(facets.country).reduce((a, b) => a + b, 0)
      check(
        `[${label}] sum(country) + countryless == total`,
        countrySum + facets.countryless === facets.total,
        `${countrySum} + ${facets.countryless} vs ${facets.total}`,
      )

      const walk = await walkDistinctCountries(withoutCountry(set.params))
      const facetKeys = new Set(Object.keys(facets.country))
      const missing = [...walk.countries].filter(c => !facetKeys.has(c))
      const extra = [...facetKeys].filter(c => !walk.countries.has(c))
      check(
        `[${label}] facet keys == distinct non-null countries from walk`,
        missing.length === 0 && extra.length === 0,
        `facet ${facetKeys.size} vs walk ${walk.countries.size} over ${walk.rows} rows` +
          (missing.length ? `; missing in facet: ${missing.join(',')}` : '') +
          (extra.length ? `; extra in facet: ${extra.join(',')}` : ''),
      )
    } catch (err) {
      check(`[${label}] request completed`, false, err instanceof Error ? err.message : String(err))
    }
  }

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('FAIL  smoke crashed:', err)
  process.exit(1)
})
