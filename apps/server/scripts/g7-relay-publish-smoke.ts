// FU-658 / Gate G7 — live Nostr relay smoke: publish → third-party relay observability.
//
// Proves a Kind 30402 offer published through the server's own NostrRelayService
// (publishOffer → publishBounded) actually lands on real, third-party relays and
// is observable back from at least one of them — i.e. it is on the open network,
// not just the local mock relay. ("foreign" = a third-party relay, in contrast to
// the mock relay; Nostr relays do NOT gossip events to each other, so a read relay
// MUST be in the write set — that is the honest meaning of the G7 proof.)
//
// Robust against single-relay flakiness / rate-limiting: it reads back from EVERY
// write relay and passes when at least one third-party relay delivers the event.
//
// Opt-in LIVE smoke — it reaches public mainnet relays and publishes one
// throwaway, clearly-marked test event. No DB / Prisma required.
//
// Run (from repo root):
//   npx tsx apps/server/scripts/g7-relay-publish-smoke.ts
// Overrides:
//   PUBLISH_RELAYS=wss://ribo.nostria.app,wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net   (write set)
//   POLL_MS=20000                                                               (max wait for delivery per relay)
import { SimplePool, type Event } from 'nostr-tools'

const PUBLISH_RELAYS = (process.env.PUBLISH_RELAYS ?? 'wss://ribo.nostria.app,wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net')
  .split(',').map(u => u.trim()).filter(Boolean)
const POLL_MS = Number(process.env.POLL_MS ?? 20_000)

// The service resolves its write relays from NOSTR_RELAY_URLS at construction,
// so set it before the dynamic import below (the singleton also reads it there).
process.env.NOSTR_RELAY_URLS = PUBLISH_RELAYS.join(',')

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

function readBackFrom(relay: string, id: string, timeoutMs: number): Promise<Event | null> {
  const pool = new SimplePool()
  const started = Date.now()
  return new Promise((resolve) => {
    let got: Event | null = null
    const sub = pool.subscribeMany([relay], { ids: [id] }, {
      onevent: (ev) => { got = ev },
      oneose: () => { sub.close(); resolve(got) },
    })
    const timer = setInterval(() => {
      if (got || Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        sub.close()
        resolve(got)
      }
    }, 1000)
  })
}

async function main() {
  console.log('=== FU-658 / G7 — Nostr publish → third-party relay observability ===\n')
  console.log(`Write relays:    ${PUBLISH_RELAYS.join(', ')}`)
  console.log(`Max delivery wait (per relay): ${POLL_MS}ms\n`)

  const thirdParty = PUBLISH_RELAYS.filter(u => !/localhost|127\.0\.0\.1/.test(u))
  check('write set contains at least one third-party relay', thirdParty.length > 0)

  const { NostrRelayService } = await import('../services/nostr-relay.js')
  const svc = new NostrRelayService()
  check('write set resolved from NOSTR_RELAY_URLS', JSON.stringify(svc.relays) === JSON.stringify(PUBLISH_RELAYS), svc.relays)

  const offerId = `g7-smoke-${Date.now()}`
  const event = await svc.publishOffer({
    id: offerId,
    title: '[Colabonate G7 smoke] test offer — safe to ignore',
    description: 'Throwaway verification event for launch gate G7 (FU-658).',
    priceSats: 1,
    creatorPubkey: 'c'.repeat(64),
    categoryCode: 'goods',
    visibility: 'PUBLIC',
  })

  if (!event) {
    check('offer published (non-null event)', false)
    console.error('\nPublish returned null — aborting before the read step.')
    process.exit(1)
  }
  check('offer published (non-null event)', true)
  check('published event is Kind 30402 (NIP-99)', event.kind === 30402, event.kind)

  console.log(`\n  → published event id: ${event.id} (d=${offerId})`)
  console.log(`  → reading back from each write relay…\n`)

  const deliveries: Array<{ relay: string; ok: boolean }> = []
  for (const relay of thirdParty) {
    const observed = await readBackFrom(relay, event.id, POLL_MS)
    const ok = observed?.id === event.id && observed?.kind === 30402
    deliveries.push({ relay, ok })
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${relay} delivered Kind 30402`)
  }

  const deliveredAny = deliveries.some(d => d.ok)
  check('at least one third-party relay delivered the event', deliveredAny, deliveries)
  check('at least one third-party relay delivered Kind 30402', deliveredAny)

  console.log(`\n${fail === 0 ? '✅' : '❌'} G7 relay smoke complete: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('smoke failed:', e); process.exit(1) })
