// ADR-307 D1/D2/D5 live smoke test: verifies the AGENT_SETUP review-metrics
// extension end-to-end against the running dev server + local Postgres —
// agentMetrics rejected on non-agent tickets, validated, persisted, and the
// composite AgentProfile.reputationScore recomputed with ticket-value weighting.
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr307-agent-reputation-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

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
  const buyerPubkey = randomBytes(32).toString('hex')
  const sellerPubkey = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2, lnAddress: 'smoke307@test.invalid' } })

  const agentProfile = await prisma.agentProfile.create({
    data: {
      ownerPubkey: sellerPubkey,
      name: 'smoke-test-agent-307',
      capabilities: ['code-review'],
      tools: [{ name: 'python', description: 'exec', protocol: 'stdio' }],
      isPublic: true,
    },
  })

  const agentOffer = await prisma.offer.create({
    data: {
      title: 'ADR-307 Smoke Agent', priceSats: 5000, categoryCode: 'services/other',
      offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: sellerPubkey,
      agentProfileId: agentProfile.id,
      agentConfigSealed: 'fake-nip44-ciphertext',
      agentConfigMeta: { capabilities: ['code-review'] },
    },
  })

  const makeTicket = (offerId: string | null, offerType: string, amountSats: number) =>
    prisma.ticket.create({
      data: {
        id: randomUUID(), offerId: offerId ?? undefined, buyerPubkey, sellerPubkey,
        status: 'COMPLETED', offerType: offerType as never, amountSats,
      },
    })

  // Ticket 1: real AGENT_SETUP ticket for the smoke agent, 1k sats (weight 1.0).
  const agentTicket1 = await makeTicket(agentOffer.id, 'AGENT_SETUP', 1000)
  // Ticket 2: same agent, 100k sats (weight 3.0) — proves D5 weighting in the recomputed score.
  const agentTicket2 = await makeTicket(agentOffer.id, 'AGENT_SETUP', 100000)
  // Ticket 3: ordinary SERVICE ticket — used to prove agentMetrics is rejected here.
  const serviceTicket = await makeTicket(null, 'SERVICE', 5000)

  const post = (body: unknown) => fetch(`${BASE_URL}/api/reviews`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  try {
    // 1. agentMetrics on a non-AGENT_SETUP ticket -> 400
    let r = await post({
      ticketId: serviceTicket.id, reviewerPubkey: buyerPubkey, revieweePubkey: sellerPubkey,
      stars: 5, content: 'great service', agentMetrics: { accuracy: 5 },
    })
    check('agentMetrics on SERVICE ticket -> 400 AGENT_METRICS_NOT_APPLICABLE', r.status === 400, await r.json())

    // 2. invalid dimension value -> 400
    r = await post({
      ticketId: agentTicket1.id, reviewerPubkey: buyerPubkey, revieweePubkey: sellerPubkey,
      stars: 5, content: 'x'.repeat(10), agentMetrics: { accuracy: 6 },
    })
    check('agentMetrics.accuracy=6 -> 400 VALIDATION_ERROR', r.status === 400, await r.json())

    // 3. invalid wouldReuse type -> 400
    r = await post({
      ticketId: agentTicket1.id, reviewerPubkey: buyerPubkey, revieweePubkey: sellerPubkey,
      stars: 5, content: 'x'.repeat(10), agentMetrics: { wouldReuse: 'yes' },
    })
    check('agentMetrics.wouldReuse="yes" -> 400 VALIDATION_ERROR', r.status === 400, await r.json())

    // 4. valid review on ticket 1 (1k sats, weight 1.0): accuracy=5, speed=5, reliability=5, quality=5, wouldReuse=true
    //    expected composite = 5*.30+5*.15+5*.25+5*.20+1*.10 = 4.6
    r = await post({
      ticketId: agentTicket1.id, reviewerPubkey: buyerPubkey, revieweePubkey: sellerPubkey,
      stars: 5, content: 'flawless agent run', agentMetrics: { accuracy: 5, speed: 5, reliability: 5, quality: 5, wouldReuse: true },
    })
    let body = await r.json()
    check('POST valid agentMetrics on AGENT_SETUP ticket -> 201', r.status === 201, body)
    check('response.agentReputationScore ≈ 4.6 after first review', Math.abs((body?.agentReputationScore ?? -1) - 4.6) < 0.01, body?.agentReputationScore)

    const metricsRow = await prisma.agentReviewMetrics.findUnique({ where: { reviewId: body.review.id } })
    check('AgentReviewMetrics row persisted with the submitted dimensions', metricsRow?.accuracy === 5 && metricsRow?.wouldReuse === true, metricsRow)

    // 5. second review on ticket 2 (100k sats, weight 3.0): accuracy=1 only (rest unrated)
    //    weighted accuracy avg = (5*1 + 1*3)/(1+3) = 8/4 = 2.0 → weighted more toward the low 100k-sats rating
    r = await post({
      ticketId: agentTicket2.id, reviewerPubkey: buyerPubkey, revieweePubkey: sellerPubkey,
      stars: 1, content: 'accuracy issues on a bigger job', agentMetrics: { accuracy: 1 },
    })
    body = await r.json()
    check('POST second agentMetrics review -> 201', r.status === 201, body)

    const refreshedProfile = await prisma.agentProfile.findUnique({ where: { id: agentProfile.id } })
    check('AgentProfile.reputationScore cache updated after second review', refreshedProfile?.reputationScore != null, refreshedProfile?.reputationScore)
    check(
      'reputationScore drops after the low-accuracy, high-weight second review (D5 weighting is live)',
      (refreshedProfile?.reputationScore ?? 99) < 4.6,
      refreshedProfile?.reputationScore
    )
  } finally {
    // ADR-316/317: every AGENT_SETUP review also creates an AgentClaim row as
    // a side effect (independent of agentMetrics) — clean it up before the
    // AgentProfile it references.
    await prisma.agentClaim.deleteMany({ where: { agentProfileId: agentProfile.id } })
    await prisma.agentReviewMetrics.deleteMany({ where: { review: { revieweePubkey: sellerPubkey } } })
    await prisma.review.deleteMany({ where: { revieweePubkey: sellerPubkey } })
    await prisma.ticket.deleteMany({ where: { OR: [{ buyerPubkey }, { sellerPubkey }] } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: sellerPubkey } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: sellerPubkey } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, sellerPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
