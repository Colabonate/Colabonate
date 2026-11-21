/**
 * Nostr-Auth Live Smoke Test (ADR-158 Part A)
 *
 * Verifies the new /api/auth/nostr flow end-to-end against the running
 * dev server:
 *   1. POST /challenge with expectedPubkey
 *   2. Sign a kind-27235 event with a freshly generated Nostr key
 *   3. POST /verify with the signed event
 *   4. Assert the response contains a `token` + `pubkey`
 *   5. Use the token to call /api/auth/me (proves Bearer auth works)
 *   6. Cleanup: delete the Session + User rows from the DB
 *
 * Mirrors what `TabNostr.tsx` does in the browser, minus window.nostr.
 *
 * Run with:
 *   scripts/run-nostr-auth-smoke.cmd
 *
 * Exit code 0 = success; non-zero = failure.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

let assertionCount = 0
function assert(cond: unknown, label: string) {
  assertionCount++
  if (cond) {
    console.log(`   \u2713 ${label}`)
  } else {
    console.log(`   \u2717 ${label}`)
    throw new Error(`Assertion failed: ${label}`)
  }
}

async function main() {
  console.log('Nostr-Auth Live Smoke Test (ADR-158 Part A)')
  console.log('===========================================\n')

  // --- 0. Health
  const health = await fetch(`${BASE}/health`)
  assert(health.status === 200, `dev server reachable at ${BASE}/health`)

  // --- 1. Generate a fresh Nostr keypair (simulates a NIP-07 extension's key)
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  console.log(`\nGenerated Nostr keypair: ${pubkey.slice(0, 16)}…\n`)

  // --- 2. Request a challenge bound to this pubkey
  console.log('1) POST /api/auth/nostr/challenge (bound to expectedPubkey)…')
  const cRes = await fetch(`${BASE}/api/auth/nostr/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedPubkey: pubkey }),
  })
  assert(cRes.status === 200, `challenge status 200 (got ${cRes.status})`)
  const challenge = await cRes.json() as { nonce: string; expiresAt: string; ttlSeconds: number }
  assert(/^[0-9a-f]{64}$/.test(challenge.nonce), `nonce is 64-char hex (${challenge.nonce.slice(0, 16)}…)`)
  assert(challenge.ttlSeconds === 300, `TTL is 5min (got ${challenge.ttlSeconds}s)`)

  // --- 3. Sign kind-27235 (Nostr-Auth / LN-Auth compatible challenge)
  console.log('\n2) Sign kind-27235 event with challenge tag…')
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['challenge', challenge.nonce]],
      content: '',
    },
    sk,
  )
  assert(event.pubkey === pubkey, 'event.pubkey matches our keypair')
  assert(event.id.length === 64, 'event.id is 64-char hex (Schnorr id)')

  // --- 4. POST /verify
  console.log('\n3) POST /api/auth/nostr/verify with signed event…')
  const vRes = await fetch(`${BASE}/api/auth/nostr/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  })
  assert(vRes.status === 200, `verify status 200 (got ${vRes.status})`)
  const verify = await vRes.json() as { ok: boolean; pubkey: string; token: string; expiresAt: string }
  assert(verify.ok === true, 'verify response ok=true')
  assert(verify.pubkey === pubkey, 'verify response pubkey matches')
  assert(/^[0-9a-f]{64}$/.test(verify.token), `verify response token is 64-char hex (${verify.token.slice(0, 16)}…)`)
  assert(new Date(verify.expiresAt).getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000, 'token expires > 6 days from now')

  // --- 5. Use the token to call /api/auth/me
  console.log('\n4) Bearer-authenticated GET /api/auth/me…')
  const meRes = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${verify.token}` },
  })
  assert(meRes.status === 200, `me status 200 (got ${meRes.status})`)
  const me = await meRes.json() as { pubkey: string; identityLevel: number }
  assert(me.pubkey === pubkey, `me.pubkey matches (got ${me.pubkey})`)
  assert(me.identityLevel === 0, `me.identityLevel=0 (Nostr-only user, got ${me.identityLevel})`)

  // --- 6. Replay protection: same signed event must now fail
  console.log('\n5) Replay protection (same challenge cannot be consumed twice)…')
  const replay = await fetch(`${BASE}/api/auth/nostr/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  })
  assert(replay.status === 403, `replay returns 403 (got ${replay.status})`)
  const replayBody = await replay.json() as { error: string }
  assert(replayBody.error === 'AUTH_FAILED', 'replay error is AUTH_FAILED')

  // --- 7. Wrong-pubkey binding check: sign with a different key
  console.log('\n6) Cross-pubkey binding rejection (issue challenge for A, sign with B)…')
  const sk2 = generateSecretKey()
  const pubkey2 = getPublicKey(sk2)
  const cRes2 = await fetch(`${BASE}/api/auth/nostr/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedPubkey: pubkey2 }),
  })
  const challenge2 = await cRes2.json() as { nonce: string }
  const wrongEvent = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['challenge', challenge2.nonce]],
      content: '',
    },
    sk, // signed with sk1, but challenge bound to pubkey2
  )
  const wrongRes = await fetch(`${BASE}/api/auth/nostr/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: wrongEvent }),
  })
  assert(wrongRes.status === 403, `wrong-key verify returns 403 (got ${wrongRes.status})`)

  console.log(`\n\u2713 Nostr-Auth live smoke test passed (${assertionCount} assertions).`)
  console.log('  Receipt: POST /challenge -> sign kind-27235 -> POST /verify -> token + /me OK -> replay 403 -> cross-key 403.')
}

async function cleanup() {
  console.log('\n\u2192 Cleaning up…')
  // Find all sessions created during this run (last 60 seconds)
  const recent = new Date(Date.now() - 60_000)
  const sessions = await prisma.session.findMany({ where: { createdAt: { gte: recent } } })
  for (const s of sessions) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => {})
  }
  // Delete ephemeral users (Nostr-only, identityLevel=0, created in last 60s)
  const users = await prisma.user.findMany({
    where: { createdAt: { gte: recent }, identityLevel: 0 },
    select: { pubkey: true },
  })
  for (const u of users) {
    await prisma.user.delete({ where: { pubkey: u.pubkey } }).catch(() => {})
  }
  // Also clean any challenges created in the last 60s
  const challenges = await prisma.nostrAuthChallenge.findMany({ where: { createdAt: { gte: recent } } })
  for (const c of challenges) {
    await prisma.nostrAuthChallenge.delete({ where: { nonce: c.nonce } }).catch(() => {})
  }
  console.log(`  ✓ cleanup done (removed ${sessions.length} sessions, ${users.length} users, ${challenges.length} challenges)`)
}

process.on('SIGINT', async () => {
  await cleanup()
  await prisma.$disconnect()
  process.exit(130)
})

main()
  .then(() => cleanup())
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('\n\u2717 Smoke test failed:', err)
    await cleanup()
    await prisma.$disconnect()
    process.exit(1)
  })
