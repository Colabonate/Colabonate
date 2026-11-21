// ADR-328 FU-484 live smoke test: creates a throwaway user/session/AgentProfile
// against the running dev server + local Postgres, then exercises the
// agent-networks CRUD over real HTTP. Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr328-agent-networks-smoke.ts
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
  else { fail++; console.log(`  FAIL ${name}`, JSON.stringify(detail ?? '')) }
}

async function createUserAndSession(): Promise<{ pubkey: string; token: string }> {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  return { pubkey, token }
}

async function createAgentProfile(ownerPubkey: string, name: string, reputationScore: number | null = null): Promise<string> {
  const ap = await prisma.agentProfile.create({
    data: {
      ownerPubkey,
      name,
      capabilities: [`cap-${name}`],
      tools: [],
      isPublic: true,
      ...(reputationScore !== null ? { reputationScore } : {}),
    },
  })
  return ap.id
}

async function main() {
  const owner = await createUserAndSession()
  const member = await createUserAndSession()
  const outsider = await createUserAndSession()

  const ownerAp1 = await createAgentProfile(owner.pubkey, 'agent-owner-1', 4.0)
  const ownerAp2 = await createAgentProfile(owner.pubkey, 'agent-owner-2', 5.0)
  const memberAp = await createAgentProfile(member.pubkey, 'agent-member-1', 3.0)

  const headers = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` })
  const base = `${BASE_URL}/api/agent-networks`
  const rGet = (token: string | null, path: string) =>
    fetch(`${base}${path}`, token ? { headers: headers(token) } : {})
  const rSend = (token: string, path: string, method: string, body: Record<string, unknown>) =>
    fetch(`${base}${path}`, { method, headers: headers(token), body: JSON.stringify(body) })
  const rDel = (token: string, path: string) => fetch(`${base}${path}`, { method: 'DELETE', headers: headers(token) })

  const networkIds: string[] = []

  try {
    // 1. Unauthenticated create -> 401
    let r = await fetch(`${base}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'no-auth' }),
    })
    check('unauthenticated POST / -> 401', r.status === 401, await r.json())

    // 2. Owner creates a public, closed network seeded with one owned agent.
    r = await rSend(owner.token, '/', 'POST', { name: 'First Network', description: 'hello', orchestrationMode: 'AUTONOMOUS', isPublic: true, memberAgentProfileIds: [ownerAp1] })
    const created = await r.json()
    check('owner POST / public closed -> 201', r.status === 201, created)
    check('ownerPubkey persisted', created?.network?.ownerPubkey === owner.pubkey, created?.network?.ownerPubkey)
    check('orchestrationMode persisted', created?.network?.orchestrationMode === 'AUTONOMOUS', created?.network?.orchestrationMode)
    check('seed member present', created?.network?.members?.length === 1, created?.network?.members?.length)
    check('reputationScore seeded from one member', created?.network?.reputationScore === 4.0, created?.network?.reputationScore)
    networkIds.push(created.network.id)

    // 3. Member seeded profile belongs to owner -> second seed validates ownership.
    r = await rSend(owner.token, '/', 'POST', { name: 'Foreign-seed', memberAgentProfileIds: [memberAp] })
    check('owner POST with foreign seed -> 400 VALIDATION_ERROR', r.status === 400 && (await r.json()).error === 'VALIDATION_ERROR')

    // 4. Public list returns the network (anonymous).
    r = await rGet(null, '/')
    const listed = await r.json()
    check('GET / (anon) returns public network', r.status === 200 && listed?.networks?.some((n: { id: string }) => n.id === created.network.id), listed)
    check('GET / entry has memberCount', listed?.networks?.find((n: { id: string }) => n.id === created.network.id)?.memberCount === 1)
    check('GET / entry exposes aggregated capabilities', Array.isArray(listed?.networks?.find((n: { id: string }) => n.id === created.network.id)?.capabilities))

    // 5. Open filter excludes closed networks.
    r = await rGet(null, '/?open=1')
    const openListed = await r.json()
    check('GET /?open=1 excludes closed', !openListed?.networks?.some((n: { id: string }) => n.id === created.network.id))

    // 6. Non-public network hidden from non-owner.
    r = await rSend(owner.token, `/${created.network.id}`, 'PATCH', { isPublic: false })
    check('owner PATCH isPublic=false -> 200', r.status === 200)
    r = await rGet(null, `/${created.network.id}`)
    check('anonymous GET non-public -> 404', r.status === 404, await r.json())
    r = await rGet(outsider.token, `/${created.network.id}`)
    check('outsider GET non-public -> 404', r.status === 404, await r.json())
    r = await rGet(owner.token, `/${created.network.id}`)
    const ownerView = await r.json()
    check('owner GET private -> 200 viewerIsOwner=true', r.status === 200 && ownerView?.viewerIsOwner === true)

    // 7. Outsider cannot edit.
    r = await rSend(outsider.token, `/${created.network.id}`, 'PATCH', { name: 'hijack' })
    check('outsider PATCH -> 403', r.status === 403, await r.json())

    // 8. Re-publish then have the member agent's owner attempt to self-join
    // a closed network via members -> 403 MEMBERSHIP_CLOSED.
    r = await rSend(owner.token, `/${created.network.id}`, 'PATCH', { isPublic: true, openMembership: false })
    check('owner PATCH reopen public+closed -> 200', r.status === 200)
    r = await rSend(member.token, `/${created.network.id}/members`, 'POST', { agentProfileId: memberAp })
    check('self-join on closed -> 403 MEMBERSHIP_CLOSED', r.status === 403 && (await r.json()).error === 'MEMBERSHIP_CLOSED')

    // 9. Member submits a join request.
    r = await rSend(member.token, `/${created.network.id}/join-requests`, 'POST', { agentProfileId: memberAp, message: 'hi' })
    const join = await r.json()
    check('join-request POST -> 201', r.status === 201, join)
    const requestId = join?.joinRequest?.id as string

    // 10. Duplicate PENDING request -> 409 ALREADY_REQUESTED.
    r = await rSend(member.token, `/${created.network.id}/join-requests`, 'POST', { agentProfileId: memberAp })
    check('duplicate join-request -> 409 ALREADY_REQUESTED', r.status === 409 && (await r.json()).error === 'ALREADY_REQUESTED')

    // 11. Owner sees the request in /mine pending list.
    r = await rGet(owner.token, '/mine')
    const mine = await r.json()
    check('owner /mine includes pending request', mine?.networks?.some((n: { joinRequests: Array<{ id: string }> }) => n.joinRequests.some(j => j.id === requestId)))

    // 12. Outsider cannot decide.
    r = await rSend(outsider.token, `/${created.network.id}/join-requests/${requestId}`, 'PATCH', { action: 'approve' })
    check('outsider PATCH join-request -> 403', r.status === 403, await r.json())

    // 13. Owner approves -> member row created + reputation recomputed to mean(4,3)=3.5.
    r = await rSend(owner.token, `/${created.network.id}/join-requests/${requestId}`, 'PATCH', { action: 'approve' })
    check('owner approve -> 200', r.status === 200, await r.json())
    r = await rGet(owner.token, `/${created.network.id}`)
    const afterApprove = await r.json()
    check('approved request appears APPROVED', afterApprove?.network?.joinRequests?.find((j: { id: string }) => j.id === requestId)?.status === 'APPROVED', afterApprove?.network?.joinRequests?.length)
    check('member row created (memberCount=2)', afterApprove?.network?.members?.length === 2, afterApprove?.network?.members?.length)
    check('reputationScore recomputed mean(4,3)=3.5', afterApprove?.network?.reputationScore === 3.5, afterApprove?.network?.reputationScore)

    // 14. Direct add (path (a) — network owner invites a foreign agent).
    r = await rSend(owner.token, `/${created.network.id}/members`, 'POST', { agentProfileId: ownerAp2, role: 'LEAD' })
    check('owner invite third-party + LEAD -> 201', r.status === 201)
    r = await rGet(owner.token, `/${created.network.id}`)
    const afterInvite = await r.json()
    check('LEAD role persisted', afterInvite?.network?.members?.some((m: { agentProfileId: string; role: string }) => m.agentProfileId === ownerAp2 && m.role === 'LEAD'))
    check('reputationScore recomputed mean(4,3,5)=4.0', afterInvite?.network?.reputationScore === 4.0, afterInvite?.network?.reputationScore)

    // 15. Duplicate member add -> 409 ALREADY_MEMBER.
    r = await rSend(owner.token, `/${created.network.id}/members`, 'POST', { agentProfileId: ownerAp1 })
    check('duplicate add -> 409 ALREADY_MEMBER', r.status === 409 && (await r.json()).error === 'ALREADY_MEMBER')

    // 16. Self-join on an open network works.
    r = await rSend(owner.token, `/${created.network.id}`, 'PATCH', { openMembership: true })
    check('owner PATCH openMembership=true -> 200', r.status === 200)
    // Now the OUTSIDER cannot self-join (foreign agent not owned by them). Create one for them.
    const outsiderAp = await createAgentProfile(outsider.pubkey, 'agent-outsider-1')
    r = await rSend(outsider.token, `/${created.network.id}/members`, 'POST', { agentProfileId: outsiderAp })
    check('self-join on open -> 201', r.status === 201, await r.json())

    // 17. Member removal by the member-agent's owner ("leave") recomputes reputation.
    // The first seeded member (ownerAp1, score 4.0) leaves via the owner.
    r = await rDel(owner.token, `/${created.network.id}/members/${ownerAp1}`)
    check('owner removes member -> 200', r.status === 200)
    r = await rGet(owner.token, `/${created.network.id}`)
    const afterRemove = await r.json()
    check('memberCount back to 3', afterRemove?.network?.members?.length === 3, afterRemove?.network?.members?.length)
    check('reputationScore mean(5,3)=4.0', afterRemove?.network?.reputationScore === 4.0, afterRemove?.network?.reputationScore)

    // 18. Invalid role enum rejected.
    r = await rSend(owner.token, `/${created.network.id}/members/${ownerAp2}`, 'PATCH', { role: 'ADMIN' })
    check('invalid role enum -> 400 VALIDATION_ERROR', r.status === 400 && (await r.json()).error === 'VALIDATION_ERROR')
  } finally {
    await prisma.agentNetworkJoinRequest.deleteMany({ where: { networkId: { in: networkIds } } })
    await prisma.agentNetworkMember.deleteMany({ where: { networkId: { in: networkIds } } })
    await prisma.agentNetwork.deleteMany({ where: { id: { in: networkIds } } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: { in: [owner.pubkey, member.pubkey, outsider.pubkey] } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [owner.pubkey, member.pubkey, outsider.pubkey] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [owner.pubkey, member.pubkey, outsider.pubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
