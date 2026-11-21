// ADR-320 live smoke test: D1 capability normalization + dedupe, D2 similar
// agents, D4 Pioneer badge boundary + early-booking COL-Points bonus
// boundary, D5 ecosystem stats shape.
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr320-network-effects-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { resolveMutualReviewBonus } from '../services/agent-marketplace.js'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function main() {
  const ownerPubkey = randomBytes(32).toString('hex')
  const rivalOwnerPubkey = randomBytes(32).toString('hex')
  const unrelatedOwnerPubkey = randomBytes(32).toString('hex')
  const buyerPubkey = randomBytes(32).toString('hex')
  const ownerToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: ownerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: rivalOwnerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: unrelatedOwnerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: ownerPubkey, k1: randomUUID(), token: ownerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  const ownerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` }

  const pioneerFillerOwnerPubkeys: string[] = []
  const pioneerFillerProfileIds: string[] = []
  let normalizedProfileId = ''
  let boundaryProfileId = ''
  let similarBaseId = ''
  let rivalId = ''
  let unrelatedId = ''
  let bonusOfferId = ''
  const bonusTicketIds: string[] = []

  try {
    // --- D1: normalization + dedupe ---
    let r = await fetch(`${BASE_URL}/api/agent-profiles`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ name: 'smoke-320-normalize', capabilities: ['Code Review', 'code_review', ' PR Review '] }),
    })
    let body = await r.json()
    check('POST /agent-profiles -> 201', r.status === 201, body)
    normalizedProfileId = body?.agentProfile?.id
    const caps = (body?.agentProfile?.capabilities ?? []).slice().sort()
    check('capabilities normalized + deduped to ["code-review","pr-review"]', JSON.stringify(caps) === JSON.stringify(['code-review', 'pr-review']), caps)

    r = await fetch(`${BASE_URL}/api/agent-profiles`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ name: 'smoke-320-bad-cap', capabilities: ['!!!'] }),
    })
    check('all-symbol capability -> 400 (not silently dropped)', r.status === 400, await r.json())

    // --- D4: Pioneer badge boundary. Fill to exactly 100 existing profiles
    // via direct rows (bypassing the API — this only tests the count() gate,
    // not the validation path already covered above), then the 101st via
    // the real API must NOT be a pioneer.
    const currentCount = await prisma.agentProfile.count()
    const need = Math.max(0, 100 - currentCount)
    if (need > 0) {
      const userRows = Array.from({ length: need }, () => ({ pubkey: randomBytes(32).toString('hex'), identityLevel: 1 }))
      await prisma.user.createMany({ data: userRows })
      pioneerFillerOwnerPubkeys.push(...userRows.map(u => u.pubkey))
      const profileRows = userRows.map((u, i) => ({
        ownerPubkey: u.pubkey, name: `smoke-320-filler-${i}`, capabilities: ['filler'], tools: [] as unknown as object,
      }))
      const created = await prisma.$transaction(profileRows.map(p => prisma.agentProfile.create({ data: p, select: { id: true } })))
      pioneerFillerProfileIds.push(...created.map(c => c.id))
    }
    const countAfterFill = await prisma.agentProfile.count()
    check(`filled to >= 100 existing profiles (now ${countAfterFill})`, countAfterFill >= 100, countAfterFill)

    r = await fetch(`${BASE_URL}/api/agent-profiles`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ name: 'smoke-320-boundary', capabilities: ['research'] }),
    })
    body = await r.json()
    boundaryProfileId = body?.agentProfile?.id
    check('the 101st+ profile created is NOT a pioneer', body?.agentProfile?.isPioneer === false, body?.agentProfile)

    // --- D2: similar agents ---
    r = await fetch(`${BASE_URL}/api/agent-profiles`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ name: 'smoke-320-base', capabilities: ['research', 'writing'], isPublic: true }),
    })
    body = await r.json()
    similarBaseId = body.agentProfile.id
    await prisma.offer.create({ data: { title: 'ADR-320 Base Offer', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: ownerPubkey, agentProfileId: similarBaseId, agentConfigSealed: 'fake', agentConfigMeta: {} } })

    const rivalProfile = await prisma.agentProfile.create({ data: { ownerPubkey: rivalOwnerPubkey, name: 'smoke-320-rival', capabilities: ['research', 'writing'], tools: [], isPublic: true } })
    rivalId = rivalProfile.id
    await prisma.offer.create({ data: { title: 'ADR-320 Rival Offer', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: rivalOwnerPubkey, agentProfileId: rivalId, agentConfigSealed: 'fake', agentConfigMeta: {} } })

    const unrelatedProfile = await prisma.agentProfile.create({ data: { ownerPubkey: unrelatedOwnerPubkey, name: 'smoke-320-unrelated', capabilities: ['legal-advice'], tools: [], isPublic: true } })
    unrelatedId = unrelatedProfile.id

    r = await fetch(`${BASE_URL}/api/agent-profiles/${similarBaseId}/similar`, { headers: ownerHeaders })
    body = await r.json()
    const similarIds = (body?.similar ?? []).map((s: { agentProfile: { id: string } }) => s.agentProfile.id)
    check('similar-agents includes the capability-overlapping rival', similarIds.includes(rivalId), body?.similar)
    check('similar-agents excludes the capability-unrelated profile', !similarIds.includes(unrelatedId), body?.similar)
    const rivalEntry = (body?.similar ?? []).find((s: { agentProfile: { id: string } }) => s.agentProfile.id === rivalId)
    check('identical capabilities + identical price -> score close to 0.7 (no shared customer yet)', rivalEntry && Math.abs(rivalEntry.score - 0.7) < 0.01, rivalEntry)

    // --- D4: early-booking COL-Points bonus boundary (checked directly
    // against resolveMutualReviewBonus with real seeded ticket rows, rather
    // than driving 11 full review HTTP round-trips).
    const bonusOffer = await prisma.offer.create({ data: { title: 'ADR-320 Bonus Offer', priceSats: 500, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: ownerPubkey, agentProfileId: normalizedProfileId, agentConfigSealed: 'fake', agentConfigMeta: {} } })
    bonusOfferId = bonusOffer.id

    const firstTicket = await prisma.ticket.create({ data: { offerId: bonusOfferId, buyerPubkey, sellerPubkey: ownerPubkey, status: 'COMPLETED', offerType: 'AGENT_SETUP', amountSats: 500 } })
    bonusTicketIds.push(firstTicket.id)
    let bonus = await resolveMutualReviewBonus(prisma, { offerType: 'AGENT_SETUP', offerId: bonusOfferId })
    check('booking #1 -> +5 COL-Points bonus', bonus === 5, bonus)

    const moreTickets = await prisma.$transaction(
      Array.from({ length: 10 }, () => prisma.ticket.create({ data: { offerId: bonusOfferId, buyerPubkey, sellerPubkey: ownerPubkey, status: 'COMPLETED', offerType: 'AGENT_SETUP', amountSats: 500 }, select: { id: true } }))
    )
    bonusTicketIds.push(...moreTickets.map(t => t.id))
    bonus = await resolveMutualReviewBonus(prisma, { offerType: 'AGENT_SETUP', offerId: bonusOfferId })
    check('booking #11 -> standard +3 COL-Points (past the 10-booking rookie window)', bonus === 3, bonus)

    const serviceOffer = await prisma.offer.create({ data: { title: 'ADR-320 Non-Agent Offer', priceSats: 500, categoryCode: 'services/other', offerType: 'SERVICE', status: 'ACTIVE', creatorPubkey: ownerPubkey } })
    bonus = await resolveMutualReviewBonus(prisma, { offerType: 'SERVICE', offerId: serviceOffer.id })
    check('non-AGENT_SETUP ticket -> standard +3 regardless of booking count', bonus === 3, bonus)
    await prisma.offer.delete({ where: { id: serviceOffer.id } })

    // --- D5: stats shape ---
    r = await fetch(`${BASE_URL}/api/agent-marketplace/stats`)
    body = await r.json()
    check('GET /agent-marketplace/stats -> 200 with the expected shape', r.status === 200 && typeof body.activeAgentSetupCount === 'number' && Array.isArray(body.topCapabilities), body)
    check('activeAgentSetupCount counts our own live ACTIVE offers', body.activeAgentSetupCount >= 3, body.activeAgentSetupCount)
  } finally {
    await prisma.ticket.deleteMany({ where: { id: { in: bonusTicketIds } } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: { in: [ownerPubkey, rivalOwnerPubkey] } } })
    await prisma.agentProfile.deleteMany({ where: { id: { in: [normalizedProfileId, boundaryProfileId, similarBaseId, rivalId, unrelatedId, ...pioneerFillerProfileIds].filter(Boolean) } } })
    await prisma.agentProfile.deleteMany({ where: { name: 'smoke-320-bad-cap' } })
    await prisma.session.deleteMany({ where: { pubkey: ownerPubkey } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [ownerPubkey, rivalOwnerPubkey, unrelatedOwnerPubkey, buyerPubkey, ...pioneerFillerOwnerPubkeys] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
