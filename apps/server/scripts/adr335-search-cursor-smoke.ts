// ADR-335 — Search Cursor Pagination smoke test.
//
// Verifies /api/search's cursor pagination against a running dev server
// (assumes SEARCH_BACKEND from the environment; run once against the default
// and once with SEARCH_BACKEND=database to cover both code paths — the
// AGENT_SETUP offset-branch only exists in the DB-fallback path).
//
// Usage: APP_PORT=<port> npx pnpm --filter server exec tsx scripts/adr335-search-cursor-smoke.ts

const BASE_URL = `http://localhost:${process.env.APP_PORT || 4001}`

let pass = 0
let fail = 0

function check(label: string, condition: boolean) {
  if (condition) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.error(`  ✗ ${label}`)
  }
}

async function fetchPage(params: string, after?: string): Promise<any> {
  const url = `${BASE_URL}/api/search?${params}${after ? `&after=${encodeURIComponent(after)}` : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return { body: await res.json(), headers: res.headers }
}

async function paginateAll(params: string, pageSize: number, maxPages = 50) {
  const seenIds: string[] = []
  let after: string | undefined
  let pages = 0
  let firstTotal: number | undefined
  let lastPageInfo: any = null

  while (true) {
    const { body } = await fetchPage(`${params}&first=${pageSize}`, after)
    if (firstTotal === undefined) firstTotal = body.estimatedTotalHits
    for (const hit of body.hits) seenIds.push(hit.id)
    pages++
    lastPageInfo = body.pageInfo
    if (!body.pageInfo?.hasNextPage) break
    after = body.pageInfo.endCursor
    if (pages > maxPages) throw new Error(`paginateAll(${params}) exceeded ${maxPages} pages — possible infinite loop`)
  }

  return { seenIds, pages, firstTotal, lastPageInfo }
}

async function main() {
  console.log(`ADR-335 search cursor smoke — target ${BASE_URL}`)

  // ── Default marketplace query: paginate everything, no duplicates/skips ──
  console.log('\n[1] Default marketplace pagination')
  const { seenIds, pages, firstTotal, lastPageInfo } = await paginateAll('', 50)
  check('at least one page fetched', pages >= 1)
  check('final page has hasNextPage=false', lastPageInfo?.hasNextPage === false)
  check('final page has endCursor=null', lastPageInfo?.endCursor === null)
  check('no duplicate ids across pages', new Set(seenIds).size === seenIds.length)
  check(`total paginated (${seenIds.length}) matches page-1 estimatedTotalHits (${firstTotal})`, seenIds.length === firstTotal)

  // ── AGENT_SETUP: separate pagination path (offset-based in DB fallback) ──
  console.log('\n[2] AGENT_SETUP pagination (offset-based fallback branch)')
  const agentResult = await paginateAll('offerType=AGENT_SETUP', 10)
  check('no duplicate/skipped AGENT_SETUP ids', new Set(agentResult.seenIds).size === agentResult.seenIds.length)
  check(
    `AGENT_SETUP total paginated (${agentResult.seenIds.length}) matches page-1 total (${agentResult.firstTotal})`,
    agentResult.seenIds.length === agentResult.firstTotal,
  )

  // ── D8 cache: repeat request -> HIT; mutation -> MISS ──────────────────
  console.log('\n[3] Server-side response cache (D8)')
  const cacheQ = `q=zzz-adr335-smoke-${Date.now()}`
  const first = await fetchPage(`${cacheQ}&first=5`)
  check('first request is a cache MISS', first.headers.get('x-cache') === 'MISS')
  const second = await fetchPage(`${cacheQ}&first=5`)
  check('repeat identical request is a cache HIT', second.headers.get('x-cache') === 'HIT')

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
