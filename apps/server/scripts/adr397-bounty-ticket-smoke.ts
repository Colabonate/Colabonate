// ADR-397 D3/D4 live smoke (FU-863/864): a bounty ticket charges the agreed
// price, is linked to the bounty, drives the bounty status, and a failed
// ticket creation can be recovered by reverting the selection.
// Creates and deletes its own throwaway users/profiles/offers/bounty.
// Run against a server with this code (not the non-reloading dev :4001):
//   DATABASE_URL=... BASE_URL=http://localhost:4098 npx tsx apps/server/scripts/adr397-bounty-ticket-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  const posterPubkey = randomBytes(32).toString('hex')
  const payableOwner = randomBytes(32).toString('hex') // has a Cashu rail
  const unpayableOwner = randomBytes(32).toString('hex') // no payment rail
  const pubkeys = [posterPubkey, payableOwner, unpayableOwner]
  const tokens: Record<string, string> = {}
  let taskId: string | undefined

  await prisma.user.create({ data: { pubkey: posterPubkey, identityLevel: 2, walletModeStrategy: 'NONCUSTODIAL_ONLY', wallets: { create: { provider: 'WEBLN', mode: 'NON_CUSTODIAL', status: 'ACTIVE' } } } })
  const payable = await prisma.user.create({ data: { pubkey: payableOwner, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: unpayableOwner, identityLevel: 2 } })
  // Cashu rail resolves without any network call (see adr308 smoke).
  await prisma.wallet.create({
    data: {
      userId: payable.id, provider: 'CASHU', mode: 'NON_CUSTODIAL', status: 'ACTIVE',
      cashuReceivePubkey: '02' + randomBytes(32).toString('hex'), cashuReceiveMintUrl: 'https://smoke-mint.test.invalid',
    },
  })
  for (const pk of pubkeys) {
    tokens[pk] = randomBytes(32).toString('hex')
    await prisma.session.create({ data: { pubkey: pk, k1: randomUUID(), token: tokens[pk], expiresAt: new Date(Date.now() + 3600_000) } })
  }
  const H = (pk?: string) => ({ 'Content-Type': 'application/json', ...(pk ? { Authorization: `Bearer ${tokens[pk]}` } : {}) })
  const call = async (method: string, path: string, pk?: string, body?: unknown) => {
    const res = await fetch(`${BASE_URL}${path}`, { method, headers: H(pk), body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, body: await res.json().catch(() => ({})) as any }
  }

  const cap = `smoke-397-${randomBytes(3).toString('hex')}`
  const makeAgent = async (owner: string, name: string, priceSats: number) => {
    const profile = await prisma.agentProfile.create({
      data: { ownerPubkey: owner, name, capabilities: [cap], tools: [], isPublic: true, requireHumanApproval: false },
    })
    const offer = await prisma.offer.create({
      data: {
        title: `${name} listing`, priceSats, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
        creatorPubkey: owner, agentProfileId: profile.id,
        agentConfigSealed: 'fake-nip44-ciphertext', agentConfigMeta: { capabilities: [cap] },
      },
    })
    return { profile, offer }
  }

  try {
    const payableAgent = await makeAgent(payableOwner, 'smoke-397-payable', 20_000)
    const unpayableAgent = await makeAgent(unpayableOwner, 'smoke-397-unpayable', 8_000)

    const bountyBody = { title: 'ADR-397 smoke bounty', description: 'Smoke test bounty', requiredCapabilities: [cap], budgetSats: 15_000 }
    const notify = async (pk: string, event: string) =>
      prisma.notification.count({ where: { ownerPubkey: pk, type: 'bounty', relatedId: taskId, meta: { path: ['event'], equals: event } } })

    // ── D2-B: publishing needs a paying wallet ──────────────────────────
    const noWallet = await call('POST', '/api/agent-tasks', unpayableOwner, bountyBody)
    check('posting without a paying wallet → 422 PAYER_WALLET_REQUIRED', noWallet.status === 422 && noWallet.body.error === 'PAYER_WALLET_REQUIRED', noWallet)
    // ── D8 / FU-870 validation ──────────────────────────────────────────
    const tooLong = await call('POST', '/api/agent-tasks', posterPubkey, { ...bountyBody, acceptanceCriteria: 'x'.repeat(2001) })
    check('acceptance criteria over 2,000 chars → 400', tooLong.status === 400, tooLong)
    const badStatus = await call('GET', '/api/agent-tasks?status=BOGUS')
    check('unknown ?status= → 400', badStatus.status === 400, badStatus)

    const created = await call('POST', '/api/agent-tasks', posterPubkey, { ...bountyBody, acceptanceCriteria: 'A report with a source for every number.' })
    check('bounty created', created.status === 201 || created.status === 200, created)
    taskId = created.body.task?.id
    if (!taskId) throw new Error('no task id')
    const fresh = await call('GET', `/api/agent-tasks/${taskId}`)
    check('acceptance criteria stored and public', fresh.body.task?.acceptanceCriteria === 'A report with a source for every number.', fresh.body.task)
    check('new poster reliability is empty', fresh.body.task?.posterReliability?.decided === 0, fresh.body.task?.posterReliability)

    const appPayable = await call('POST', `/api/agent-tasks/${taskId}/applications`, payableOwner, {
      agentProfileId: payableAgent.profile.id, offerId: payableAgent.offer.id, proposedPriceSats: 5_000,
    })
    const appUnpayable = await call('POST', `/api/agent-tasks/${taskId}/applications`, unpayableOwner, {
      agentProfileId: unpayableAgent.profile.id, offerId: unpayableAgent.offer.id, proposedPriceSats: 7_000,
    })
    check('both agents applied', appPayable.status === 201 && appUnpayable.status === 201, [appPayable, appUnpayable])
    const payableAppId = appPayable.body.application.id as string
    const unpayableAppId = appUnpayable.body.application.id as string
    await sleep(300)
    check('D5: poster notified of both applications', (await notify(posterPubkey, 'application_received')) === 2)

    // ── Failure path: winner has no payment rail ────────────────────────
    const sel1 = await call('POST', `/api/agent-tasks/${taskId}/select`, posterPubkey, { applicationId: unpayableAppId })
    check('select returns nextStep carrying agentTaskApplicationId', sel1.body?.nextStep?.body?.agentTaskApplicationId === unpayableAppId, sel1.body?.nextStep)
    await sleep(300)
    check('D5: winner notified (selected)', (await notify(unpayableOwner, 'selected')) === 1)
    check('D5: other applicant notified (rejected)', (await notify(payableOwner, 'rejected')) === 1)
    const failTicket = await call('POST', '/api/tickets', posterPubkey, sel1.body.nextStep.body)
    check('ticket for a rail-less winner fails with 422', failTicket.status === 422, failTicket)
    let detail = await call('GET', `/api/agent-tasks/${taskId}`, posterPubkey)
    check('bounty stays ASSIGNED without a ticket', detail.body.task?.status === 'ASSIGNED' && detail.body.ticket === null, detail.body)

    const foreign = await call('POST', '/api/tickets', payableOwner, sel1.body.nextStep.body)
    check('only the poster can create the bounty ticket (403)', foreign.status === 403 && foreign.body.error === 'BOUNTY_NOT_POSTER', foreign)
    const mismatch = await call('POST', '/api/tickets', posterPubkey, { offerId: payableAgent.offer.id, agentTaskApplicationId: unpayableAppId })
    check('offer/application mismatch rejected (400)', mismatch.status === 400 && mismatch.body.error === 'BOUNTY_OFFER_MISMATCH', mismatch)

    const revertForeign = await call('POST', `/api/agent-tasks/${taskId}/revert-selection`, payableOwner)
    check('non-poster cannot revert (403)', revertForeign.status === 403, revertForeign)
    const revert = await call('POST', `/api/agent-tasks/${taskId}/revert-selection`, posterPubkey)
    check('poster reverts the selection → SELECTING', revert.status === 200 && revert.body.task?.status === 'SELECTING', revert)
    const appsAfterRevert = await prisma.agentTaskApplication.findMany({ where: { taskId }, select: { status: true } })
    check('all applications back to PENDING', appsAfterRevert.every(a => a.status === 'PENDING'), appsAfterRevert)
    const staleTicket = await call('POST', '/api/tickets', posterPubkey, sel1.body.nextStep.body)
    check('stale nextStep after revert rejected (409)', staleTicket.status === 409 && staleTicket.body.error === 'BOUNTY_NOT_ASSIGNED', staleTicket)

    // ── FU-870: an edit re-validates live applications ─────────────────
    const edit = await call('PATCH', `/api/agent-tasks/${taskId}`, posterPubkey, {
      action: 'update', ...bountyBody, budgetSats: 6_000, acceptanceCriteria: 'A report with a source for every number.',
    })
    check('poster lowers the budget to 6,000', edit.status === 200, edit)
    const afterEdit = await prisma.agentTaskApplication.findMany({ where: { taskId }, select: { id: true, status: true } })
    check('7,000-sat bid rejected, 5,000-sat bid kept', afterEdit.find(a => a.id === unpayableAppId)?.status === 'REJECTED' && afterEdit.find(a => a.id === payableAppId)?.status === 'PENDING', afterEdit)
    await sleep(300)
    check('D5: dropped applicant notified (no_longer_eligible)', (await notify(unpayableOwner, 'no_longer_eligible')) === 1)
    const mine = await call('GET', '/api/agent-tasks/applications/mine', unpayableOwner)
    check('D7: applications/mine lists the own application', mine.status === 200 && mine.body.applications?.some((a: any) => a.id === unpayableAppId && a.status === 'REJECTED'), mine.body)

    // ── Happy path: agreed price charged, ticket linked ─────────────────
    const sel2 = await call('POST', `/api/agent-tasks/${taskId}/select`, posterPubkey, { applicationId: payableAppId })
    check('re-select a different winner', sel2.status === 200, sel2)
    const ticketRes = await call('POST', '/api/tickets', posterPubkey, sel2.body.nextStep.body)
    check('bounty ticket created', ticketRes.status === 200, ticketRes)
    const ticket = ticketRes.body.ticket
    check('ticket charges the agreed 5,000 sats, not the 20,000-sat listing', ticketRes.body.amountSats === 5_000 && ticket?.amountSats === 5_000, ticketRes.body.amountSats)
    check('ticket is linked to the bounty', ticket?.agentTaskId === taskId, ticket?.agentTaskId)
    check('D6: ticket carries the frozen brief', ticket?.bountyBrief?.bountyId === taskId && ticket?.bountyBrief?.acceptanceCriteria === 'A report with a source for every number.', ticket?.bountyBrief)

    const dup = await call('POST', '/api/tickets', posterPubkey, sel2.body.nextStep.body)
    check('second ticket refused (409 BOUNTY_TICKET_EXISTS)', dup.status === 409 && dup.body.error === 'BOUNTY_TICKET_EXISTS' && dup.body.ticketId === ticket.id, dup)
    const revertLive = await call('POST', `/api/agent-tasks/${taskId}/revert-selection`, posterPubkey)
    check('revert refused while a live ticket exists (409)', revertLive.status === 409, revertLive)

    detail = await call('GET', `/api/agent-tasks/${taskId}`, posterPubkey)
    check('poster sees the linked ticket', detail.body.ticket?.id === ticket.id, detail.body.ticket)
    const winnerView = await call('GET', `/api/agent-tasks/${taskId}`, payableOwner)
    check('winner sees the linked ticket', winnerView.body.ticket?.id === ticket.id, winnerView.body.ticket)
    const loserView = await call('GET', `/api/agent-tasks/${taskId}`, unpayableOwner)
    check('rejected applicant does not see the ticket', loserView.body.ticket === null, loserView.body.ticket)
    const anonView = await call('GET', `/api/agent-tasks/${taskId}`)
    check('anonymous viewer does not see the ticket', anonView.body.ticket === null, anonView.body.ticket)

    // ── Status sync: PAID → IN_PROGRESS, COMPLETED → COMPLETED ──────────
    const paid = await call('PATCH', `/api/tickets/${ticket.id}`, payableOwner, { status: 'PAID' })
    check('seller self-reports Cashu PAID', paid.status === 200, paid)
    await sleep(500)
    let task = await prisma.agentTask.findUnique({ where: { id: taskId }, select: { status: true } })
    check('bounty → IN_PROGRESS after PAID', task?.status === 'IN_PROGRESS', task)
    const rel = (await call('GET', `/api/agent-tasks/${taskId}`)).body.task?.posterReliability
    check('D2-C: poster reliability counts the paid winner', rel?.decided === 1 && rel?.paid === 1 && rel?.medianHoursToPay !== null, rel)
    const done = await call('PATCH', `/api/tickets/${ticket.id}`, payableOwner, { status: 'COMPLETED' })
    check('ticket COMPLETED', done.status === 200, done)
    await sleep(500)
    task = await prisma.agentTask.findUnique({ where: { id: taskId }, select: { status: true } })
    check('bounty → COMPLETED after ticket COMPLETED', task?.status === 'COMPLETED', task)
  } finally {
    if (taskId) {
      await prisma.ticket.deleteMany({ where: { agentTaskId: taskId } })
      await prisma.agentTaskApplication.deleteMany({ where: { taskId } })
      await prisma.agentTask.deleteMany({ where: { id: taskId } })
    }
    await prisma.ticket.deleteMany({ where: { buyerPubkey: posterPubkey } })
    await prisma.notification.deleteMany({ where: { ownerPubkey: { in: pubkeys } } }).catch(() => undefined)
    await prisma.offer.deleteMany({ where: { creatorPubkey: { in: pubkeys } } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: { in: pubkeys } } })
    await prisma.wallet.deleteMany({ where: { userId: payable.id } })
    await prisma.session.deleteMany({ where: { pubkey: { in: pubkeys } } })
    // ADR-397 D2-B: the poster's paying wallet (Wallet has no cascade).
    await prisma.wallet.deleteMany({ where: { user: { pubkey: posterPubkey } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
