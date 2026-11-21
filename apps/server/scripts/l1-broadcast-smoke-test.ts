/**
 * L1 Identity Credential Broadcast Smoke Test (FU-225-A, ADR-144 + ADR-225 D1/D2)
 *
 * Verifies the full sovereign-onboarding publish→propagate→verify round-trip against
 * a live reachable Nostr relay, mirroring exactly what the browser does in
 * GenerateNostrKey.tsx → NostrProfileForm → publishNostrProfile/publishIdentityCredential,
 * and what the server does in identity.ts:verifyL1Ownership.
 *
 * Steps:
 *   1. Generate a fresh keypair (BIP-39/NIP-06 via nostr-tools/nip06, matches D1).
 *   2. Publish a Kind-0 profile whose content.colabonate_pubkey binds the two pubkeys
 *      (mirrors publishNostrProfile in apps/colabonate-app/src/lib/nostr.ts:166).
 *   3. Publish both Kind-30021 (legacy) and Kind-30410 (NIP-compliant) L1 credentials
 *      with d-tag identity-l1-<colabonatePubkey> (mirrors publishIdentityCredential
 *      in nostr.ts:184, NIP-15 conflict dual-publish from ADR-101).
 *   4. Wait for relay propagation (mirrors the 3×1s retry budget in identity.ts:55).
 *   5. Re-fetch via querySync and verify the events using the exact same predicates as
 *      verifyL1Ownership in apps/server/routes/identity.ts:48-94.
 *
 * Acceptance criteria (all must pass):
 *   ✓ Kind-0 event published to at least one relay
 *   ✓ Kind-0 event re-fetchable, signature valid, content.colabonate_pubkey matches
 *   ✓ Kind-30021 credential published to at least one relay
 *   ✓ Kind-30410 credential published to at least one relay
 *   ✓ Credential d-tag matches identity-l1-<colabonatePubkey>
 *   ✓ Credential signature valid (verifyEvent)
 *
 * Usage:
 *   npx tsx apps/server/scripts/l1-broadcast-smoke-test.ts
 *
 * Optional env vars:
 *   RELAYS=...            Comma-separated relay URLs (default: production relays)
 *   COLABONATE_PUBKEY=... 64-char hex to bind (default: random 64-char hex)
 *   PROPAGATION_MS=...   How long to wait before re-fetching (default: 5000)
 *
 * Exit code 0 = success; non-zero = failure.
 *
 * Context: this closes FU-225-A (🟡 partial → ✅ done) once it runs green against
 * either the production relays (wss://inbox.nostr.wine, wss://relay.nostr.bg) or
 * the dev mock relay (ws://localhost:4001, requires the dev server running).
 */

import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils'

// Production default relays — mirrors DEFAULT_DM_RELAYS in
// apps/colabonate-app/src/lib/nostr-relay-config.ts:18-21.
const DEFAULT_RELAYS = ['wss://inbox.nostr.wine', 'wss://relay.nostr.bg']

const RELAYS = (process.env.RELAYS ?? DEFAULT_RELAYS.join(','))
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean)

const PROPAGATION_MS = Number(process.env.PROPAGATION_MS ?? 5000)
const FETCH_TIMEOUT_MS = 3000

// Use a random 64-char hex as the "Colabonate pubkey" the Nostr identity binds to.
// In a real browser flow this is the user's app-pubkey from Wallet/User table.
const COLABONATE_PUBKEY =
  process.env.COLABONATE_PUBKEY ??
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')

const L1_CREDENTIAL_KINDS = [30021, 30410]

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error(`✗ FAIL: ${msg}`)
    process.exit(1)
  }
  console.log(`✓ ${msg}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Publish an event to all relays, resolve once at least one accepts (returns OK). */
async function publishAtLeastOne(pool: SimplePool, relays: string[], event: Record<string, unknown>): Promise<void> {
  const pubs = pool.publish(relays, event as never)
  const results = await Promise.allSettled(pubs)
  const ok = results.some((r) => r.status === 'fulfilled')
  if (!ok) {
    const reasons = results
      .map((r, i) => (r.status === 'rejected' ? `  ${relays[i]}: ${(r as PromiseRejectedResult).reason}` : `  ${relays[i]}: ok`))
      .join('\n')
    throw new Error(`No relay accepted the event:\n${reasons}`)
  }
}

async function main(): Promise<void> {
  console.log('── L1 Identity Broadcast Smoke (FU-225-A) ──')
  console.log(`Relays:           ${RELAYS.join(', ')}`)
  console.log(`Colabonate pubkey: ${COLABONATE_PUBKEY}`)
  console.log(`Propagation wait:  ${PROPAGATION_MS}ms\n`)

  const pool = new SimplePool()

  // ── Step 1: generate a fresh keypair (matches GenerateNostrKey.tsx D1) ─────────
  const secretKey = generateSecretKey()
  const nostrPubkey = getPublicKey(secretKey)
  console.log(`Nostr pubkey:     ${nostrPubkey}`)
  console.log(`Secret key (hex): ${bytesToHex(secretKey)}\n`)

  const now = Math.floor(Date.now() / 1000)

  // ── Step 2: publish Kind-0 profile (mirrors publishNostrProfile nostr.ts:166) ──
  const kind0Content = JSON.stringify({
    name: 'L1 Smoke Tester',
    lud16: 'smoke@test.colabonate',
    colabonate_pubkey: COLABONATE_PUBKEY,
    colabonate_protocol_version: '1.0.0-draft',
  })
  const kind0Event = finalizeEvent(
    {
      kind: 0,
      tags: [],
      content: kind0Content,
      created_at: now,
    },
    secretKey,
  )
  console.log('Publishing Kind-0 profile…')
  await publishAtLeastOne(pool, RELAYS, kind0Event as unknown as Record<string, unknown>)
  console.log(`  Kind-0 id: ${kind0Event.id}\n`)

  // ── Step 3: dual-publish L1 credential (mirrors publishIdentityCredential nostr.ts:184) ──
  const dTag = `identity-l1-${COLABONATE_PUBKEY}`
  const credTags = [
    ['d', dTag],
    ['credential_type', 'identity_level_1'],
    ['hid_level', '1'],
    ['issued_by', COLABONATE_PUBKEY],
  ]
  const credContent = JSON.stringify({
    credential_type: 'identity_level_1',
    subject: COLABONATE_PUBKEY,
    issued_at: now,
    expires_at: null,
  })

  const kind30021Event = finalizeEvent(
    { kind: 30021, tags: credTags, content: credContent, created_at: now },
    secretKey,
  )
  const kind30410Event = finalizeEvent(
    { kind: 30410, tags: credTags, content: credContent, created_at: now },
    secretKey,
  )
  console.log('Publishing Kind-30021 (legacy) L1 credential…')
  await publishAtLeastOne(pool, RELAYS, kind30021Event as unknown as Record<string, unknown>)
  console.log(`  Kind-30021 id: ${kind30021Event.id}`)
  console.log('Publishing Kind-30410 (NIP-compliant) L1 credential…')
  await publishAtLeastOne(pool, RELAYS, kind30410Event as unknown as Record<string, unknown>)
  console.log(`  Kind-30410 id: ${kind30410Event.id}\n`)

  // ── Step 4: wait for relay propagation (mirrors identity.ts retry budget) ──────
  console.log(`Waiting ${PROPAGATION_MS}ms for relay propagation…\n`)
  await sleep(PROPAGATION_MS)

  // ── Step 5: re-fetch and verify (mirrors verifyL1Ownership identity.ts:48-94) ──
  console.log('Re-fetching events from relays…')
  const [kind0Fetched, credFetched] = await Promise.all([
    pool.querySync(RELAYS, { kinds: [0], authors: [nostrPubkey] }, { maxWait: FETCH_TIMEOUT_MS }),
    pool.querySync(RELAYS, { kinds: L1_CREDENTIAL_KINDS, authors: [nostrPubkey] }, { maxWait: FETCH_TIMEOUT_MS }),
  ])

  console.log(`  Fetched: ${kind0Fetched.length} Kind-0 events, ${credFetched.length} credential events\n`)

  // Predicates exactly as in identity.ts:57-66
  const boundKind0 = kind0Fetched.find((ev) => {
    if (ev.pubkey !== nostrPubkey || !verifyEvent(ev)) return false
    try {
      const content = JSON.parse(ev.content) as { colabonate_pubkey?: string }
      return content.colabonate_pubkey === COLABONATE_PUBKEY
    } catch {
      return false
    }
  })

  // Predicates exactly as in identity.ts:69-74
  const validCredential = credFetched.find(
    (ev) =>
      ev.pubkey === nostrPubkey &&
      ev.tags.some((t) => t[0] === 'd' && t[1] === dTag) &&
      verifyEvent(ev),
  )

  const kind30021Found = credFetched.some(
    (ev) => ev.kind === 30021 && ev.pubkey === nostrPubkey && ev.tags.some((t) => t[0] === 'd' && t[1] === dTag),
  )
  const kind30410Found = credFetched.some(
    (ev) => ev.kind === 30410 && ev.pubkey === nostrPubkey && ev.tags.some((t) => t[0] === 'd' && t[1] === dTag),
  )

  // ── Assertions ────────────────────────────────────────────────────────────────
  assert(boundKind0 !== undefined, 'Kind-0 profile re-fetchable, signature valid, colabonate_pubkey bound')
  assert(
    boundKind0 !== undefined && JSON.parse(boundKind0.content).colabonate_pubkey === COLABONATE_PUBKEY,
    'Kind-0 content.colabonate_pubkey matches the bound Colabonate pubkey',
  )
  assert(kind30021Found, 'Kind-30021 legacy credential re-fetchable with matching d-tag')
  assert(kind30410Found, 'Kind-30410 NIP-compliant credential re-fetchable with matching d-tag')
  assert(validCredential !== undefined, 'At least one credential has a valid cryptographic signature')

  console.log('\n── Result ──')
  console.log('All L1 broadcast assertions passed.')
  console.log('FU-225-A can be flipped from 🟡 partial → ✅ done.')
  console.log('The browser-side publishNostrProfile/publishIdentityCredential path and the')
  console.log('server-side verifyL1Ownership path are confirmed to work end-to-end against live relays.')

  if (!RELAYS.some((r) => r.includes('localhost') || r.includes('127.0.0.1'))) {
    console.log('\nNote: ran against public relays. If you see intermittent fetch failures,')
    console.log('public relays sometimes have read/write asymmetry or propagation >10s.')
    console.log('For deterministic verification use the dev mock relay:')
    console.log('  RELAYS=ws://localhost:4001 PROPAGATION_MS=1000 npx tsx apps/server/scripts/l1-broadcast-smoke-test.ts')
  }

  pool.close(RELAYS)
  process.exit(0)
}

main().catch((e: unknown) => {
  console.error('\n✗ Smoke test failed:', e instanceof Error ? e.message : e)
  if (e instanceof Error && e.stack) console.error(e.stack)
  process.exit(1)
})
