// ADR-315 D3 live smoke test: verifies the Foundation-admin Verified Agent
// Badge flow end-to-end:
//   1. POST /api/admin/agent-profiles/:id/verify  → 200, sets isVerified fields
//   2. POST /api/admin/agent-profiles/:id/verify  (idempotent re-verify) → 200
//   3. POST /api/admin/agent-profiles/:id/unverify → 200, clears all fields
//   4. POST /api/admin/agent-profiles/:id/unverify (already-cleared) → 200
//      with alreadyUnverified=true
//   5. GET /api/admin/agent-profiles?verified=true|false  → filter works
//   6. Public read: GET /api/agent-profiles/:id returns isVerified (verified path)
//   7. Notes-too-long rejected 400
//   8. Nonexistent id 404
//   9. Non-admin caller 403
//  10. requireAuth-only caller (no admin) 403
// Also checks that the server enqueues an outbox upsert for every offer of
// the verified agent so the Meilisearch agentIsVerified facet updates on the
// next worker tick.
// Run with: DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr315-verified-agent-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const FOUNDATION_DAO_ID = 'colabonate-foundation'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function main() {
  const ownerPubkey = randomBytes(32).toString('hex')
  const adminPubkey = randomBytes(32).toString('hex')
  const intruderPubkey = randomBytes(32).toString('hex')
  const adminToken = randomBytes(32).toString('hex')
  const intruderToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: ownerPubkey, identityLevel: 1 } })
  await prisma.user.create({ data: { pubkey: adminPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: intruderPubkey, identityLevel: 1 } })
  // Session has a FK on User.pubkey — must create both users before the session.
  await prisma.session.create({ data: { pubkey: adminPubkey, k1: randomUUID(), token: adminToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: intruderPubkey, k1: randomUUID(), token: intruderToken, expiresAt: new Date(Date.now() + 3600_000) } })

  const existingDao = await prisma.dao.findUnique({ where: { id: FOUNDATION_DAO_ID } })
  if (!existingDao) {
    await prisma.dao.create({
      data: {
        id: FOUNDATION_DAO_ID,
        name: 'Colabonate Foundation DAO',
        codexHash: 'deadbeef'.repeat(8),
        codexVersion: 'v0-smoke',
        codexUrl: 'docs/decisions/130-foundation-codex-bootstrap.md',
      },
    })
  }
  await prisma.daoMember.create({
    data: { daoId: FOUNDATION_DAO_ID, pubkey: adminPubkey, role: 'ADMIN', status: 'ACTIVE' },
  })

  const agentProfile = await prisma.agentProfile.create({
    data: {
      ownerPubkey,
      name: `smoke-315-agent-${Date.now()}`,
      capabilities: ['text-generation'],
      tools: [],
      isPublic: true,
    },
  })
  const agentOffer = await prisma.offer.create({
    data: {
      title: 'ADR-315 Smoke Agent',
      priceSats: 5000,
      categoryCode: 'services/other',
      offerType: 'AGENT_SETUP',
      status: 'ACTIVE',
      creatorPubkey: ownerPubkey,
      agentProfileId: agentProfile.id,
      agentConfigSealed: 'fake-nip44-ciphertext',
      agentConfigMeta: { capabilities: ['text-generation'] },
    },
  })

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${BASE_URL}${path}`, { headers })
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${BASE_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  })

  try {
    // 1. Verify without auth → 401
    const beforeVerify = await prisma.agentProfile.findUniqueOrThrow({ where: { id: agentProfile.id } })
    check('trustScore is null before any verify/review', beforeVerify.trustScore === null, beforeVerify.trustScore)

    let r = await post(`/api/admin/agent-profiles/${agentProfile.id}/verify`, {})
    check('POST verify without auth → 401', r.status === 401, `got ${r.status}`)

    // 2. Verify with non-admin session → 403
    r = await post(`/api/admin/agent-profiles/${agentProfile.id}/verify`, {}, auth(intruderToken))
    check('POST verify with non-admin session → 403', r.status === 403, `got ${r.status}`)

    // 3. Verify with admin session → 200, sets fields
    r = await post(`/api/admin/agent-profiles/${agentProfile.id}/verify`, { notes: 'audited 2026-08-20' }, auth(adminToken))
    let body = await r.json()
    check('POST verify with admin session → 200', r.status === 200, body)
    check('response.isVerified=true', body?.agentProfile?.isVerified === true, body?.agentProfile)
    check('response.verifiedAt is not null', !!body?.agentProfile?.verifiedAt, body?.agentProfile?.verifiedAt)
    check('response.verifiedByPubkey matches admin', body?.agentProfile?.verifiedByPubkey === adminPubkey, body?.agentProfile?.verifiedByPubkey)
    check('response.verificationNotes persisted', body?.agentProfile?.verificationNotes === 'audited 2026-08-20', body?.agentProfile)

    // 4. Verify is idempotent (re-verify with new notes overwrites)
    r = await post(`/api/admin/agent-profiles/${agentProfile.id}/verify`, { notes: 're-audited' }, auth(adminToken))
    body = await r.json()
    check('POST verify (idempotent re-verify) → 200', r.status === 200, body)
    check('notes overwrite on re-verify', body?.agentProfile?.verificationNotes === 're-audited', body?.agentProfile)

    // 4b. ADR-317 D1/FU-414: verify upserts a single AuditClaim and lifts trustScore to 1.0
    const auditClaims = await prisma.agentClaim.findMany({ where: { agentProfileId: agentProfile.id, claimType: 'AuditClaim' } })
    check('exactly one AuditClaim row after two verifies (upsert, not accumulate)', auditClaims.length === 1, auditClaims.length)
    check('AuditClaim attesterType is dao', auditClaims[0]?.attesterType === 'dao', auditClaims[0]?.attesterType)
    check('AuditClaim attesterPubkey is the admin who verified', auditClaims[0]?.attesterPubkey === adminPubkey, auditClaims[0]?.attesterPubkey)
    const afterVerify = await prisma.agentProfile.findUniqueOrThrow({ where: { id: agentProfile.id } })
    // Hand-computed: verificationScore=1.0 (dao weight alone caps it), completionRate=1.0
    // + disputePenalty=1.0 (fresh agent, no tickets/disputes, both fall back to 1.0),
    // ownerReputationNormalized=0.63 (owner has identityLevel:1, no reviews/tickets ->
    // reputationService fallbacks -> 3.5 raw * 0.90 multiplier = 3.15 / 5.0).
    // trustScore = 1.0*.35 + 1.0*.25 + 0.63*.15 + 0*.10 + 1.0*.15 = 0.8445 -> rounds to 0.84.
    check('trustScore matches the hand-computed formula (0.84) after Foundation verify', Math.abs((afterVerify.trustScore ?? -1) - 0.84) < 0.01, afterVerify.trustScore)

    // 5. Public read exposes isVerified on the agent profile (note: the
    // /api/agent-profiles route is mounted behind requireAuth, so we send
    // a non-admin bearer token — the public-read rules in the handler are
    // what matter, not the auth gate)
    r = await get(`/api/agent-profiles/${agentProfile.id}`, auth(intruderToken))
    body = await r.json()
    check('GET /api/agent-profiles/:id public-read exposes isVerified', body?.agentProfile?.isVerified === true, body?.agentProfile)
    check('GET /api/agent-profiles/:id exposes verifiedAt', !!body?.agentProfile?.verifiedAt, body?.agentProfile?.verifiedAt)
    check('GET /api/agent-profiles/:id does NOT leak verifiedByPubkey', body?.agentProfile?.verifiedByPubkey === undefined, body?.agentProfile)
    check('GET /api/agent-profiles/:id does NOT leak verificationNotes', body?.agentProfile?.verificationNotes === undefined, body?.agentProfile)

    // 6. outbox upsert enqueued for every offer of the verified agent
    const outboxRows = await prisma.outboxEvent.findMany({
      where: { aggregate: 'offer', aggregateId: agentOffer.id },
      orderBy: { createdAt: 'desc' },
    })
    const verOutbox = outboxRows.find(o => (o.payload as { reason?: string } | null)?.reason === 'agent-verified')
    check('outbox upsert enqueued for every offer of the verified agent', !!verOutbox, outboxRows.length)

    // 7. GET /api/admin/agent-profiles?verified=true filters correctly
    r = await get(`/api/admin/agent-profiles?verified=true&limit=50`, auth(adminToken))
    body = await r.json()
    check('GET verified=true list returns our profile', body?.agentProfiles?.some((p: { id: string }) => p.id === agentProfile.id), body?.agentProfiles?.length)
    check('admin list includes verifiedByPubkey', body?.agentProfiles?.some((p: { id: string; verifiedByPubkey: string }) => p.id === agentProfile.id && p.verifiedByPubkey === adminPubkey))

    r = await get(`/api/admin/agent-profiles?verified=false&limit=50`, auth(adminToken))
    body = await r.json()
    check('GET verified=false list excludes our profile', !body?.agentProfiles?.some((p: { id: string }) => p.id === agentProfile.id))

    // 8. notes-too-long rejected 400
    const tooLong = 'x'.repeat(2001)
    r = await post(`/api/admin/agent-profiles/${agentProfile.id}/verify`, { notes: tooLong }, auth(adminToken))
    check('notes > 2000 chars → 400', r.status === 400, `got ${r.status}`)

    // 9. notes must be a string
    r = await post(`/api/admin/agent-profiles/${agentProfile.id}/verify`, { notes: 123 }, auth(adminToken))
    check('notes non-string → 400', r.status === 400, `got ${r.status}`)

    // 10. Nonexistent id 404
    r = await post(`/api/admin/agent-profiles/nonexistent-id/verify`, {}, auth(adminToken))
    check('POST verify on nonexistent id → 404', r.status === 404, `got ${r.status}`)

    // 11. Unverify → clears fields, enqueues outbox event
    r = await post(`/api/admin/agent-profiles/${agentProfile.id}/unverify`, {}, auth(adminToken))
    body = await r.json()
    check('POST unverify → 200', r.status === 200, body)
    check('isVerified cleared', body?.agentProfile?.isVerified === false, body?.agentProfile)
    check('verifiedAt cleared', body?.agentProfile?.verifiedAt === null, body?.agentProfile)
    check('verifiedByPubkey cleared', body?.agentProfile?.verifiedByPubkey === null, body?.agentProfile)
    check('verificationNotes cleared', body?.agentProfile?.verificationNotes === null, body?.agentProfile)

    // 11b. ADR-317 D1/FU-414: unverify removes the AuditClaim and drops trustScore
    const auditClaimsAfterUnverify = await prisma.agentClaim.findMany({ where: { agentProfileId: agentProfile.id, claimType: 'AuditClaim' } })
    check('AuditClaim removed after unverify', auditClaimsAfterUnverify.length === 0, auditClaimsAfterUnverify.length)
    const afterUnverify = await prisma.agentProfile.findUniqueOrThrow({ where: { id: agentProfile.id } })
    check('trustScore drops after unverify (verificationScore no longer capped by dao weight)', (afterUnverify.trustScore ?? 1) < (afterVerify.trustScore ?? 0), { before: afterVerify.trustScore, after: afterUnverify.trustScore })

    // 12. Unverify idempotent (already-unverified)
    r = await post(`/api/admin/agent-profiles/${agentProfile.id}/unverify`, {}, auth(adminToken))
    body = await r.json()
    check('POST unverify (already unverified) → 200 with alreadyUnverified', r.status === 200 && body?.alreadyUnverified === true, body)

    // 13. Public read after unverify → isVerified=false
    r = await get(`/api/agent-profiles/${agentProfile.id}`, auth(intruderToken))
    body = await r.json()
    check('public read after unverify → isVerified=false', body?.agentProfile?.isVerified === false, body?.agentProfile)

    // 14. Sub-router shared mount: GET /api/admin/agents/:id also works
    r = await get(`/api/admin/agent-profiles/${agentProfile.id}`, auth(adminToken))
    body = await r.json()
    check('GET /api/admin/agent-profiles/:id (admin view) → 200', r.status === 200, body)
    check('admin view includes verifiedByPubkey', body?.agentProfile?.verifiedByPubkey === null, body?.agentProfile)
  } finally {
    await prisma.outboxEvent.deleteMany({ where: { aggregate: 'offer', aggregateId: agentOffer.id } })
    await prisma.offer.deleteMany({ where: { id: agentOffer.id } })
    await prisma.agentProfile.deleteMany({ where: { id: agentProfile.id } })
    await prisma.daoMember.deleteMany({ where: { pubkey: adminPubkey } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [adminPubkey, intruderPubkey] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [ownerPubkey, adminPubkey, intruderPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
