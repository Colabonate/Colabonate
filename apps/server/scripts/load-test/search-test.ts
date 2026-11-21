import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const errorRate = new Rate('errors')
const searchDuration = new Trend('search_p95')
const offerDetailDuration = new Trend('offer_detail_p95')
const offerListDuration = new Trend('offer_list_p95')

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4001'
const SEARCH_THRESHOLD_MS = 200
const OFFER_DETAIL_THRESHOLD_MS = 80
const OFFER_LIST_THRESHOLD_MS = 150

export const options = {
  thresholds: {
    errors: ['rate<0.05'],
    search_p95: [`p(95)<${SEARCH_THRESHOLD_MS}`],
    offer_detail_p95: [`p(95)<${OFFER_DETAIL_THRESHOLD_MS}`],
    offer_list_p95: [`p(95)<${OFFER_LIST_THRESHOLD_MS}`],
  },
  scenarios: {
    search: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      exec: 'searchTest',
    },
    offerDetail: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      exec: 'offerDetailTest',
    },
    offerList: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      exec: 'offerListTest',
    },
  },
}

export function searchTest() {
  const res = http.get(`${BASE_URL}/api/search?q=service&first=20`, {
    tags: { name: 'GET /api/search' },
  })
  const passed = check(res, {
    'search status 200': (r) => r.status === 200,
    'search has results': (r) => {
      try {
        const body = JSON.parse(r.body as string)
        return body.hits || body.results || Array.isArray(body)
      } catch {
        return false
      }
    },
  })
  errorRate.add(!passed)
  searchDuration.add(res.timings.duration)
  sleep(1)
}

export function offerDetailTest() {
  const listRes = http.get(`${BASE_URL}/api/offers?first=1&status=ACTIVE`, {
    tags: { name: 'GET /api/offers (for id)' },
  })
  let offerId = '1'
  try {
    const body = JSON.parse(listRes.body as string)
    offerId = body.edges?.[0]?.node?.id || body.data?.[0]?.id || '1'
  } catch {
    // use default
  }

  const res = http.get(`${BASE_URL}/api/offers/${offerId}`, {
    tags: { name: 'GET /api/offers/:id' },
  })
  const passed = check(res, {
    'offer detail status 200': (r) => r.status === 200,
  })
  errorRate.add(!passed)
  offerDetailDuration.add(res.timings.duration)
  sleep(1)
}

export function offerListTest() {
  const res = http.get(`${BASE_URL}/api/offers?first=20&status=ACTIVE`, {
    tags: { name: 'GET /api/offers' },
  })
  const passed = check(res, {
    'offer list status 200': (r) => r.status === 200,
    'offer list has edges or data': (r) => {
      try {
        const body = JSON.parse(r.body as string)
        return !!(body.edges || body.data)
      } catch {
        return false
      }
    },
  })
  errorRate.add(!passed)
  offerListDuration.add(res.timings.duration)
  sleep(1)
}

export function handleSummary(data: {
  metrics: Record<string, { values: Record<string, number> }>
}) {
  const searchP95 = data.metrics.search_p95?.values?.['p(95)'] ?? 0
  const offerDetailP95 = data.metrics.offer_detail_p95?.values?.['p(95)'] ?? 0
  const offerListP95 = data.metrics.offer_list_p95?.values?.['p(95)'] ?? 0

  const failed = []
  if (searchP95 >= SEARCH_THRESHOLD_MS) failed.push(`search p95 ${searchP95}ms >= ${SEARCH_THRESHOLD_MS}ms`)
  if (offerDetailP95 >= OFFER_DETAIL_THRESHOLD_MS) failed.push(`offer_detail p95 ${offerDetailP95}ms >= ${OFFER_DETAIL_THRESHOLD_MS}ms`)
  if (offerListP95 >= OFFER_LIST_THRESHOLD_MS) failed.push(`offer_list p95 ${offerListP95}ms >= ${OFFER_LIST_THRESHOLD_MS}ms`)

  // k6 has no Node `process` global — the configured `thresholds` (above)
  // already fail the run (nonzero exit code) on their own when crossed.
  // This summary only adds a human-readable one-line verdict to stdout.
  if (failed.length > 0) {
    return {
      'stdout': `LOAD TEST FAILED: ${failed.join(', ')}\n`,
    }
  }

  return {
    'stdout': `Load test passed — search p95: ${searchP95}ms, offer_detail p95: ${offerDetailP95}ms, offer_list p95: ${offerListP95}ms\n`,
  }
}