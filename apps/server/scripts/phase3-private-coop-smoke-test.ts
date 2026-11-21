/**
 * Phase 3 Private-Cooperation Smoke Test (ADR-152 / Plan §Phase 3.1–3.2)
 *
 * Verifies that PRIVATE cooperations are NOT published to public relays and
 * instead travel via NIP-17 DM (mirrors the private-offer pattern):
 *
 *  1. POST /api/cooperations with visibility=PRIVATE → persisted as PRIVATE,
 *     nostrEventTemplate is a Kind-14 DM template (not public Kind 30414),
 *     carries a visibility=PRIVATE tag, and a DmMessage inbox row exists for
 *     the partner.
 *  2. POST /api/cooperations with visibility=PUBLIC → nostrEventTemplate is a
 *     public Kind 30414 template, and NO DmMessage inbox row is written.
 *  3. Negative: invalid visibility → 400.
 *  4. Cleanup.
 *
 * Run with:
 *   cd apps/server && DATABASE_URL="postgresql://colabonate:dev@localhost:5434/colabonate" \
 *     ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase3-private-coop-smoke-test.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

const INITIATOR_PUBKEY = 'd'.repeat(63) + '1'
const PARTNER_PUBKEY = 'e'.repeat(63) + '2'

let initiatorId: string | null = null
let partnerId: string | null = null
let sessionId: string | null = null
let privateCoopId: string | null = null
let publicCoopId: string | null = null

let assertionCount = 0
function assert(cond: unknown, label: string) {
  assertionCount++
  if (cond) {
    console.log(`   ✓ ${label}`)
  } else {
    console.log(`   ✗ ${label}`)
    throw new Error(`Assertion failed: ${label}`)
  }
}

async function api(path: string, opts: RequestInit = {}, bearerToken?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    ...(opts.headers as Record<string, string> | undefined ?? {}),
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

function tagValue(tags: string[][], name: string): string | undefined {
  const t = tags.find(t => t[0] === name)
  return t?.[1]
}

async function cleanup() {
  console.log('\n→ Cleaning up…')
  for (const cid of [privateCoopId, publicCoopId]) {
    if (!cid) continue
    try { await prisma.dmMessage.deleteMany({ where: { eventId: `coop-proposal:${cid}:${PARTNER_PUBKEY}` } }) } catch {}
    try { await prisma.coopMilestone.deleteMany({ where: { cooperationId: cid } }) } catch {}
    try { await prisma.cooperation.delete({ where: { id: cid } }) } catch {}
  }
  if (sessionId) try { await prisma.session.delete({ where: { id: sessionId } }) } catch {}
  if (initiatorId) try { await prisma.user.delete({ where: { id: initiatorId } }) } catch {}
  if (partnerId) try { await prisma.user.delete({ where: { id: partnerId } }) } catch {}
  console.log('  ✓ done')
}

async function main() {
  console.log('=== Phase 3 Private-Cooperation Smoke Test ===\n')
  console.log(`Initiator: ${INITIATOR_PUBKEY.slice(0, 12)}…`)
  console.log(`Partner:   ${PARTNER_PUBKEY.slice(0, 12)}…\n`)

  // ── 0. Setup: initiator user + session ──────────────────────────────────
  const initiator = await prisma.user.create({
    data: { pubkey: INITIATOR_PUBKEY, lnAddress: `${INITIATOR_PUBKEY.slice(0, 8)}@ln.test`, identityLevel: 1, colPoints: 100 },
  })
  initiatorId = initiator.id
  const session = await prisma.session.create({
    data: {
      pubkey: initiator.pubkey,
      k1: 'phase3-k1-' + Date.now(),
      token: 'phase3-test-' + Date.now(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
  sessionId = session.id
  const token = session.token
  console.log('0) Setup complete (initiator + session)\n')

  // ── 1. Create PRIVATE cooperation ───────────────────────────────────────
  console.log('1) POST /api/cooperations (visibility=PRIVATE)…')
  const priv = await api('/api/cooperations', {
    method: 'POST',
    body: JSON.stringify({
      title: '[Phase 3] Private Coop Smoke',
      description: 'private cooperation publish-gating test',
      partnerPubkey: PARTNER_PUBKEY,
      cooperationType: 'SERVICE',
      budgetSats: 10000,
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
    }),
  }, token ?? undefined)
  assert(priv.ok, 'PRIVATE coop create returns 200')
  privateCoopId = priv.data.cooperation?.id
  assert(!!privateCoopId, 'cooperation id returned')
  assert(priv.data.cooperation?.visibility === 'PRIVATE', 'cooperation.visibility = PRIVATE')
  assert(priv.data.cooperation?.disputeMode === 'PRIVATE', 'cooperation.disputeMode = PRIVATE')
  assert(!!priv.data.nostrEventTemplate, 'nostrEventTemplate present')
  assert(priv.data.nostrEventTemplate?.kind === 14, 'template kind = 14 (NIP-17 DM, not public 30414)')
  assert(tagValue(priv.data.nostrEventTemplate.tags, 'visibility') === 'PRIVATE', 'template has visibility=PRIVATE tag')
  assert(tagValue(priv.data.nostrEventTemplate.tags, 'cooperation') === privateCoopId, 'template cooperation tag = coop id')
  assert(tagValue(priv.data.nostrEventTemplate.tags, 'partner') === PARTNER_PUBKEY, 'template partner tag set')

  // DB persisted visibility
  const dbPriv = await prisma.cooperation.findUnique({ where: { id: privateCoopId! } })
  assert(dbPriv?.visibility === 'PRIVATE', 'DB cooperation.visibility = PRIVATE')

  // DmMessage inbox row for the partner
  const coopDm = await prisma.dmMessage.findUnique({
    where: { eventId: `coop-proposal:${privateCoopId}:${PARTNER_PUBKEY}` },
  })
  assert(!!coopDm, 'partner DmMessage inbox row written')
  assert(coopDm?.ownerPubkey === PARTNER_PUBKEY, 'DmMessage owner = partner')
  assert(coopDm?.peerPubkey === INITIATOR_PUBKEY, 'DmMessage peer = initiator')
  assert(coopDm?.kind === 14, 'DmMessage kind = 14')
  assert(coopDm?.visibility === 'PRIVATE', 'DmMessage visibility = PRIVATE')
  const dmPayload = JSON.parse(coopDm!.payload)
  assert(dmPayload.type === 'cooperation_proposal', 'DmMessage payload type = cooperation_proposal')
  assert(dmPayload.cooperationId === privateCoopId, 'DmMessage payload cooperationId matches')
  console.log()

  // ── 2. Create PUBLIC cooperation ────────────────────────────────────────
  console.log('2) POST /api/cooperations (visibility=PUBLIC)…')
  const pub = await api('/api/cooperations', {
    method: 'POST',
    body: JSON.stringify({
      title: '[Phase 3] Public Coop Smoke',
      description: 'public cooperation control case',
      partnerPubkey: PARTNER_PUBKEY,
      cooperationType: 'SERVICE',
      budgetSats: 10000,
      visibility: 'PUBLIC',
    }),
  }, token ?? undefined)
  assert(pub.ok, 'PUBLIC coop create returns 200')
  publicCoopId = pub.data.cooperation?.id
  assert(pub.data.cooperation?.visibility === 'PUBLIC', 'cooperation.visibility = PUBLIC')
  assert(pub.data.nostrEventTemplate?.kind === 30414, 'template kind = 30414 (public addressable event)')
  assert(tagValue(pub.data.nostrEventTemplate.tags, 'visibility') === undefined, 'public template has NO visibility=PRIVATE tag')

  // No DmMessage inbox row for a public coop
  const pubDm = await prisma.dmMessage.findUnique({
    where: { eventId: `coop-proposal:${publicCoopId}:${PARTNER_PUBKEY}` },
  })
  assert(!pubDm, 'no DmMessage inbox row for PUBLIC coop')
  console.log()

  // ── 3. Negative: invalid visibility ─────────────────────────────────────
  console.log('3) Negative: invalid visibility value…')
  const bad = await api('/api/cooperations', {
    method: 'POST',
    body: JSON.stringify({
      title: '[Phase 3] Bad Visibility',
      partnerPubkey: PARTNER_PUBKEY,
      budgetSats: 1000,
      visibility: 'SECRET',
    }),
  }, token ?? undefined)
  assert(!bad.ok, 'invalid visibility returns non-OK')
  assert(bad.status === 400, 'invalid visibility returns 400')
  console.log()

  console.log(`\n✅ All ${assertionCount} Phase 3 private-cooperation assertions passed.`)
}

main()
  .catch(err => {
    console.error('\n❌ Phase 3 smoke test failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
  })
