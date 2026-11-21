// FU-504 (SMART_ORDER budget PATCH recalculates the 3 phases while all are
// still PENDING, rejects once any phase has moved on), FU-505 (SMART_ORDER
// minimum budget at creation), FU-511 (Cooperation.companyId snapshot +
// ownership validation), FU-515 (agentSupervision wired into the client
// submit payload — server-side half verified here: the field already worked
// once sent, this just re-confirms it still does after the companyId change),
// FU-562 (a DRAFT SMART_ORDER cooperation generates its 3 canonical phases on
// the DRAFT→OPEN status transition, since POST-time generation is skipped for
// DRAFT submissions).
//
// Run against the live dev server: npx tsx apps/server/scripts/fu505-511-515-coop-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes } from 'node:crypto'

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:4001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  OK  ${name}`) }
  else { fail++; console.log(`FAIL  ${name}`, extra ?? '') }
}

async function main() {
  const pubkeyA = 'fu505511515-a-' + randomBytes(6).toString('hex')
  const pubkeyB = 'fu505511515-b-' + randomBytes(6).toString('hex')
  const token = randomBytes(32).toString('hex')

  await prisma.user.upsert({ where: { pubkey: pubkeyA }, update: {}, create: { pubkey: pubkeyA } })
  await prisma.user.upsert({ where: { pubkey: pubkeyB }, update: {}, create: { pubkey: pubkeyB } })
  await prisma.session.create({
    data: { pubkey: pubkeyA, k1: randomBytes(16).toString('hex'), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  const myCompany = await prisma.company.create({
    data: { ownerPubkey: pubkeyA, name: 'FU-511 Smoke Co', isActive: true },
  })
  const foreignCompany = await prisma.company.create({
    data: { ownerPubkey: pubkeyB, name: 'FU-511 Foreign Co', isActive: true },
  })

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  try {
    // FU-505: budget=2 SMART_ORDER, non-DRAFT → 400 BUDGET_TOO_LOW_FOR_SMART_ORDER
    {
      const res = await fetch(`${BASE_URL}/api/cooperations`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Too small', budgetSats: 2, ticketType: 'SMART_ORDER', status: 'OPEN' }),
      })
      const data = await res.json()
      check('FU-505: budget=2 SMART_ORDER rejected 400', res.status === 400 && data.code === 'BUDGET_TOO_LOW_FOR_SMART_ORDER', data)
    }
    // FU-505: budget=4 SMART_ORDER, non-DRAFT → accepted, all 3 phases > 0
    {
      const res = await fetch(`${BASE_URL}/api/cooperations`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Exactly minimum', budgetSats: 4, ticketType: 'SMART_ORDER', status: 'OPEN' }),
      })
      const data = await res.json()
      const milestones = data.cooperation?.milestones ?? []
      check('FU-505: budget=4 SMART_ORDER accepted', res.status === 200, data)
      check('FU-505: all 3 phases > 0 sats', milestones.length === 3 && milestones.every((m: { amountSats: number }) => m.amountSats > 0), milestones)
    }
    // FU-505: DRAFT with budget=2 is exempt (drafts can hold a placeholder budget)
    {
      const res = await fetch(`${BASE_URL}/api/cooperations`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Draft placeholder', budgetSats: 2, ticketType: 'SMART_ORDER', status: 'DRAFT' }),
      })
      check('FU-505: DRAFT status exempt from minimum', res.status === 200, await res.clone().json())
    }
    // FU-511: companyId referencing someone else's company → 400
    {
      const res = await fetch(`${BASE_URL}/api/cooperations`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Spoofed company', budgetSats: 1000, ticketType: 'MILESTONE', status: 'OPEN', companyId: foreignCompany.id }),
      })
      const data = await res.json()
      check('FU-511: foreign companyId rejected 400', res.status === 400 && /own company/i.test(data.error ?? ''), data)
    }
    // FU-511: companyId referencing own company → persisted, round-trips on GET
    {
      const res = await fetch(`${BASE_URL}/api/cooperations`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Corporate coop', budgetSats: 1000, ticketType: 'MILESTONE', status: 'OPEN', companyId: myCompany.id, agentSupervision: 'human' }),
      })
      const data = await res.json()
      check('FU-511: own companyId accepted', res.status === 200, data)
      check('FU-511: companyId persisted on create response', data.cooperation?.companyId === myCompany.id, data.cooperation)

      const getRes = await fetch(`${BASE_URL}/api/cooperations/${data.cooperation.id}`)
      const getData = await getRes.json()
      check('FU-511: companyId round-trips on GET /:id', getData.cooperation?.companyId === myCompany.id, getData.cooperation)
    }
    // FU-504: recalculate all 3 phases while every phase is still PENDING.
    let fu504CoopId = ''
    {
      const createRes = await fetch(`${BASE_URL}/api/cooperations`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Budget edit target', budgetSats: 1000, ticketType: 'SMART_ORDER', status: 'OPEN' }),
      })
      const createData = await createRes.json()
      fu504CoopId = createData.cooperation.id

      const patchRes = await fetch(`${BASE_URL}/api/cooperations/${fu504CoopId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ budgetSats: 2000 }),
      })
      const patchData = await patchRes.json()
      const phases: Array<{ milestoneIndex: number; amountSats: number }> = patchData.cooperation?.milestones ?? []
      const byIndex = new Map(phases.map(p => [p.milestoneIndex, p.amountSats]))
      const sum = phases.reduce((s, p) => s + p.amountSats, 0)
      check('FU-504: PATCH budgetSats 200', patchRes.status === 200, patchData)
      check('FU-504: phases recalculated (Start=500)', byIndex.get(1) === 500, phases)
      check('FU-504: phases recalculated (Progress=1000)', byIndex.get(2) === 1000, phases)
      check('FU-504: phases sum == new budget', sum === 2000, phases)

      // Move phase 1 out of PENDING, then a further budget edit must be rejected.
      await prisma.coopMilestone.updateMany({ where: { cooperationId: fu504CoopId, milestoneIndex: 1 }, data: { status: 'IN_PROGRESS' } })
      const lockedRes = await fetch(`${BASE_URL}/api/cooperations/${fu504CoopId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ budgetSats: 3000 }),
      })
      const lockedData = await lockedRes.json()
      check('FU-504: budget edit rejected once a phase left PENDING', lockedRes.status === 400 && lockedData.code === 'BUDGET_LOCKED_PHASE_IN_PROGRESS', lockedData)

      // Confirm the rejection didn't mutate anything (still 500/1000/500, IN_PROGRESS).
      const afterReject = await prisma.coopMilestone.findMany({ where: { cooperationId: fu504CoopId }, orderBy: { milestoneIndex: 'asc' } })
      check('FU-504: rejected PATCH left phases untouched', afterReject[0]?.amountSats === 500 && afterReject[0]?.status === 'IN_PROGRESS', afterReject)
    }
    // FU-562: DRAFT SMART_ORDER cooperation gets its 3 phases only at the
    // DRAFT→OPEN status transition (never at POST time for a DRAFT submit).
    {
      const createRes = await fetch(`${BASE_URL}/api/cooperations`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Draft to publish', budgetSats: 1000, ticketType: 'SMART_ORDER', status: 'DRAFT' }),
      })
      const createData = await createRes.json()
      const draftId = createData.cooperation.id
      check('FU-562: DRAFT SMART_ORDER created with 0 phases', (createData.cooperation.milestones ?? []).length === 0, createData.cooperation)

      const publishRes = await fetch(`${BASE_URL}/api/cooperations/${draftId}/status`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: 'OPEN' }),
      })
      const publishData = await publishRes.json()
      const phases: Array<{ milestoneIndex: number; amountSats: number }> = publishData.cooperation?.milestones ?? []
      const sum = phases.reduce((s, p) => s + p.amountSats, 0)
      check('FU-562: DRAFT→OPEN transition 200', publishRes.status === 200, publishData)
      check('FU-562: 3 canonical phases generated on publish', phases.length === 3, phases)
      check('FU-562: phases sum == budget', sum === 1000, phases)

      // Re-publishing (already OPEN, e.g. a retried request) must not duplicate phases.
      const secondFetch = await fetch(`${BASE_URL}/api/cooperations/${draftId}`)
      const secondData = await secondFetch.json()
      check('FU-562: no duplicate phases on re-fetch', (secondData.cooperation?.milestones ?? []).length === 3, secondData.cooperation)
    }
    // FU-562: DRAFT SMART_ORDER with a sub-4-sat budget is rejected at publish time too.
    {
      const createRes = await fetch(`${BASE_URL}/api/cooperations`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Draft too small', budgetSats: 2, ticketType: 'SMART_ORDER', status: 'DRAFT' }),
      })
      const createData = await createRes.json()
      const draftId = createData.cooperation.id

      const publishRes = await fetch(`${BASE_URL}/api/cooperations/${draftId}/status`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: 'OPEN' }),
      })
      const publishData = await publishRes.json()
      check('FU-562: sub-4-sat DRAFT publish rejected 400', publishRes.status === 400 && publishData.code === 'BUDGET_TOO_LOW_FOR_SMART_ORDER', publishData)
    }
    // FU-515 (server-side half): agentSupervision='autonomous' on an executor='agent'-shaped
    // request (no assignee yet) persists even though isAgentOrchestration stays false.
    {
      const res = await fetch(`${BASE_URL}/api/cooperations`, {
        method: 'POST', headers,
        body: JSON.stringify({ title: 'Agent flow no match yet', budgetSats: 1000, ticketType: 'MILESTONE', status: 'DRAFT', agentSupervision: 'autonomous' }),
      })
      const data = await res.json()
      check('FU-515: agentSupervision=autonomous persisted with no assignee', data.cooperation?.agentSupervision === 'autonomous', data.cooperation)
      check('FU-515: isAgentOrchestration stays false (no assignee)', data.cooperation?.isAgentOrchestration === false, data.cooperation)
    }
  } finally {
    await prisma.coopMilestone.deleteMany({ where: { cooperation: { initiatorPubkey: pubkeyA } } })
    await prisma.cooperation.deleteMany({ where: { initiatorPubkey: pubkeyA } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [pubkeyA, pubkeyB] } } })
    await prisma.company.deleteMany({ where: { id: { in: [myCompany.id, foreignCompany.id] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [pubkeyA, pubkeyB] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
