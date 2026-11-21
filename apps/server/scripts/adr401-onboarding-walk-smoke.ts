// ADR-401 D8 — live HTTP walk of the email-less onboarding path (Path B) and
// the D7.4 sovereign-key account recovery, including the resolution-order fix
// from the 2026-09-26 review (an exact pubkey match beats a nostrPubkey binding).
//
// Mirrors the browser: device signer → /api/auth/nostr/challenge + /verify →
// sovereign key publishes kind:0 + L1 credential → /api/identity/upgrade-l1
// (Bearer + NIP-98) → sovereign key signs in again → same account.
//
// Needs a running server whose read relay is its own mock relay, e.g. a
// throwaway instance (the dev server on :4001 does not hot-reload):
//   APP_PORT=4098 NOSTR_RELAY_URLS=ws://localhost:4098 npx tsx apps/server/index.ts
//   DATABASE_URL=... BASE_URL=http://localhost:4098 npx tsx apps/server/scripts/adr401-onboarding-walk-smoke.ts
// Every row it creates is deleted at the end.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
const RELAY_URL = process.env.RELAY_URL || BASE_URL.replace(/^http/, 'ws')
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const pool = new SimplePool()

const createdPubkeys = new Set<string>()
const nonces: string[] = []
let failures = 0

function check(cond: boolean, label: string, detail?: unknown) {
  if (cond) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}`, detail ?? '')
  }
}

async function login(sk: Uint8Array, expected = true): Promise<{ status: number; pubkey?: string; token?: string }> {
  const pk = getPublicKey(sk)
  const ch = await fetch(`${BASE_URL}/api/auth/nostr/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expected ? { expectedPubkey: pk } : {}),
  }).then(r => r.json()) as { nonce: string }
  nonces.push(ch.nonce)
  const event = finalizeEvent(
    { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['challenge', ch.nonce]], content: '' },
    sk,
  )
  const res = await fetch(`${BASE_URL}/api/auth/nostr/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  })
  const body = await res.json().catch(() => ({})) as { pubkey?: string; token?: string }
  if (body.pubkey) createdPubkeys.add(body.pubkey)
  createdPubkeys.add(pk)
  return { status: res.status, ...body }
}

async function me(token: string): Promise<string | undefined> {
  const res = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json().catch(() => ({})) as { pubkey?: string; user?: { pubkey?: string } }
  return body.pubkey ?? body.user?.pubkey
}

/** Publish kind:0 + the L1 credential for `account`, signed by the sovereign key (publishNostrProfile / publishIdentityCredential). */
async function publishL1(sovereignSk: Uint8Array, account: string) {
  const now = Math.floor(Date.now() / 1000)
  const profile = finalizeEvent({ kind: 0, created_at: now, tags: [], content: JSON.stringify({ name: 'adr401-walk' }) }, sovereignSk)
  const credential = finalizeEvent({
    kind: 30021,
    created_at: now,
    tags: [['d', `identity-l1-${account}`], ['credential_type', 'identity_level_1'], ['hid_level', '1'], ['issued_by', account]],
    content: JSON.stringify({ credential_type: 'identity_level_1', subject: account, issued_at: now, expires_at: null }),
  }, sovereignSk)
  for (const ev of [profile, credential]) await Promise.any(pool.publish([RELAY_URL], ev))
}

async function upgradeL1(token: string, account: string, sovereignSk: Uint8Array) {
  const nip98 = finalizeEvent({
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    content: `colabonate-l1-upgrade:${account}:${Date.now()}`,
    tags: [['u', `${BASE_URL}/api/identity/upgrade-l1`], ['method', 'POST']],
  }, sovereignSk)
  const res = await fetch(`${BASE_URL}/api/identity/upgrade-l1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Nostr-Auth': `Nostr ${Buffer.from(JSON.stringify(nip98)).toString('base64')}`,
    },
    body: JSON.stringify({ pubkey: account, nostrPubkey: getPublicKey(sovereignSk) }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) as { identityLevel?: number; nostrPubkey?: string; error?: string } }
}

async function main() {
  console.log(`ADR-401 onboarding walk against ${BASE_URL} (relay ${RELAY_URL})`)

  console.log('\n1. Path B: device signer creates a Nostr-only account (D5/D7)')
  const deviceSk = generateSecretKey()
  const device = getPublicKey(deviceSk)
  const a = await login(deviceSk)
  check(a.status === 200 && a.pubkey === device, 'verify → account keyed by the device signer', a)
  check(!!a.token && (await me(a.token)) === device, 'Bearer session resolves to the device account')

  console.log('\n2. Activation binds the sovereign key as nostrPubkey (D6)')
  const sovereignSk = generateSecretKey()
  const sovereign = getPublicKey(sovereignSk)
  await publishL1(sovereignSk, device)
  const up = await upgradeL1(a.token!, device, sovereignSk)
  check(up.status === 200 && up.body.identityLevel === 1 && up.body.nostrPubkey === sovereign, 'upgrade-l1 → L1 with nostrPubkey = sovereign key', up)
  const stored = await prisma.user.findUnique({ where: { pubkey: device }, select: { nostrPubkey: true } })
  check(stored?.nostrPubkey === sovereign, 'DB: device account carries the sovereign nostrPubkey')
  check(!(await prisma.user.findUnique({ where: { pubkey: sovereign } })), 'no account is keyed by the sovereign key (never the login key)')

  console.log('\n3. Sovereign key signs in on "another device" → same account (D7.4)')
  const r = await login(sovereignSk, false)
  check(r.status === 200 && r.pubkey === device, 'verify with the sovereign key returns the device account', r)
  check(!!r.token && (await me(r.token)) === device, 'recovered session resolves to the device account')
  check(!(await prisma.user.findUnique({ where: { pubkey: sovereign } })), 'recovery created no extra account')

  console.log('\n4. Resolution order: an account keyed by the signer wins over a binding elsewhere')
  const ownSk = generateSecretKey()
  const own = getPublicKey(ownSk)
  const o = await login(ownSk)
  check(o.status === 200 && o.pubkey === own, 'key K has its own account')
  const otherSk = generateSecretKey()
  const other = await login(otherSk)
  await publishL1(ownSk, other.pubkey!)
  const bind = await upgradeL1(other.token!, other.pubkey!, ownSk)
  check(bind.status === 200 && bind.body.nostrPubkey === own, 'a second account binds K as its nostrPubkey', bind)
  const again = await login(ownSk)
  check(again.status === 200 && again.pubkey === own, 'K still signs in to its own account, not the binding one', again)

  console.log('\n5. Unknown key still creates a fresh account')
  const freshSk = generateSecretKey()
  const f = await login(freshSk)
  check(f.status === 200 && f.pubkey === getPublicKey(freshSk), 'unknown key → new account keyed by it', f)

  console.log('\n6. Logout revokes the session server-side (lib/logout.ts calls this)')
  const out = await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${f.token}` } })
  check(out.status === 200, 'POST /api/auth/logout → 200')
  const after = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${f.token}` } })
  check(after.status === 401, 'the revoked token no longer authenticates', after.status)
}

main()
  .catch(err => {
    failures++
    console.error('Smoke crashed:', err)
  })
  .finally(async () => {
    const pubkeys = [...createdPubkeys]
    await prisma.session.deleteMany({ where: { pubkey: { in: pubkeys } } }).catch(e => console.warn('cleanup sessions:', e))
    await prisma.user.deleteMany({ where: { pubkey: { in: pubkeys } } }).catch(e => console.warn('cleanup users:', e))
    await prisma.nostrAuthChallenge.deleteMany({ where: { nonce: { in: nonces } } }).catch(e => console.warn('cleanup challenges:', e))
    pool.close([RELAY_URL])
    await prisma.$disconnect()
    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
    process.exit(failures === 0 ? 0 : 1)
  })
