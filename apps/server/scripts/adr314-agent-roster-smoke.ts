// ADR-314 D10 (Agent Roster) live smoke test, closes FU-436. Exercises
// GET /api/agent-profiles/roster (owned + booked lists, dedupe-by-most-
// recent-ticket, workspace pairing, presence fallback) and the ADR-305 D6
// persona-pack-ref format validation added alongside it on POST/PATCH
// /api/offers.
//
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr314-agent-roster-smoke.ts
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
  const buyerToken = randomBytes(32).toString('hex')
  const sellerToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: sellerPubkey, k1: randomUUID(), token: sellerToken, expiresAt: new Date(Date.now() + 3600_000) } })

  function authHeaders(token: string) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  }

  // ── Unauthenticated ──────────────────────────────────────────────────────
  const unauthRes = await fetch(`${BASE_URL}/api/agent-profiles/roster`)
  check('GET /roster without auth -> 401', unauthRes.status === 401, unauthRes.status)

  // ── Empty roster (no profiles, no bookings) ─────────────────────────────
  const emptyRes = await fetch(`${BASE_URL}/api/agent-profiles/roster`, { headers: authHeaders(buyerToken) })
  const emptyData = await emptyRes.json() as { owned: unknown[]; booked: unknown[] }
  check('empty roster -> 200 with empty owned+booked', emptyRes.status === 200 && emptyData.owned.length === 0 && emptyData.booked.length === 0, emptyData)

  // ── Owned agent profile appears in `owned` ──────────────────────────────
  const ownedProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: buyerPubkey, name: 'smoke-roster-owned', capabilities: ['research'], tools: [], isPublic: true },
  })
  const ownedRes = await fetch(`${BASE_URL}/api/agent-profiles/roster`, { headers: authHeaders(buyerToken) })
  const ownedData = await ownedRes.json() as { owned: { id: string }[] }
  check('owned agent profile appears in owned[]', ownedData.owned.some(p => p.id === ownedProfile.id), ownedData.owned)

  // ── Booked agent (seller's agent, buyer's ticket) appears in `booked` ───
  const sellerAgentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-roster-booked', capabilities: ['writing'], tools: [], isPublic: true },
  })
  const offer = await prisma.offer.create({
    data: {
      title: 'smoke-roster-offer', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: sellerPubkey, agentProfileId: sellerAgentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['writing'] },
    },
  })
  const ticket = await prisma.ticket.create({
    data: { offerId: offer.id, buyerPubkey, sellerPubkey, offerType: 'AGENT_SETUP', status: 'PAID', ticketType: 'SMART_ORDER' },
  })

  const bookedNoWsRes = await fetch(`${BASE_URL}/api/agent-profiles/roster`, { headers: authHeaders(buyerToken) })
  const bookedNoWsData = await bookedNoWsRes.json() as { booked: { agentProfile: { id: string }; ticket: { id: string }; workspace: unknown; lastActiveAt: string }[] }
  const bookedEntry1 = bookedNoWsData.booked.find(b => b.agentProfile.id === sellerAgentProfile.id)
  check('booked agent appears with no workspace yet', Boolean(bookedEntry1) && bookedEntry1?.workspace === null, bookedEntry1)
  check('booked entry ticket id matches', bookedEntry1?.ticket.id === ticket.id, bookedEntry1?.ticket)
  check('booked entry lastActiveAt falls back to ticket.updatedAt', Boolean(bookedEntry1?.lastActiveAt), bookedEntry1?.lastActiveAt)

  // ── Once a Workspace exists for that ticket, roster surfaces it ────────
  const workspace = await prisma.workspace.create({
    data: { ticketId: ticket.id, offerId: offer.id, agentProfileId: sellerAgentProfile.id, buyerPubkey, status: 'RUNNING' },
  })
  const bookedWithWsRes = await fetch(`${BASE_URL}/api/agent-profiles/roster`, { headers: authHeaders(buyerToken) })
  const bookedWithWsData = await bookedWithWsRes.json() as { booked: { agentProfile: { id: string }; workspace: { id: string; status: string } | null }[] }
  const bookedEntry2 = bookedWithWsData.booked.find(b => b.agentProfile.id === sellerAgentProfile.id)
  check('booked entry now carries the workspace', bookedEntry2?.workspace?.id === workspace.id && bookedEntry2?.workspace?.status === 'RUNNING', bookedEntry2)

  // ── Second (older) ticket for the same agent does not duplicate booked[] ─
  const olderTicket = await prisma.ticket.create({
    data: { offerId: offer.id, buyerPubkey, sellerPubkey, offerType: 'AGENT_SETUP', status: 'COMPLETED', ticketType: 'SMART_ORDER' },
  })
  await prisma.ticket.update({ where: { id: olderTicket.id }, data: { updatedAt: new Date(Date.now() - 86_400_000) } })
  const dedupeRes = await fetch(`${BASE_URL}/api/agent-profiles/roster`, { headers: authHeaders(buyerToken) })
  const dedupeData = await dedupeRes.json() as { booked: { agentProfile: { id: string } }[] }
  const matches = dedupeData.booked.filter(b => b.agentProfile.id === sellerAgentProfile.id)
  check('same agent booked twice dedupes to one roster entry', matches.length === 1, matches)

  // ── Seller's own roster shows their profile as owned, not booked ───────
  const sellerRosterRes = await fetch(`${BASE_URL}/api/agent-profiles/roster`, { headers: authHeaders(sellerToken) })
  const sellerRosterData = await sellerRosterRes.json() as { owned: { id: string }[]; booked: unknown[] }
  check('seller sees their agent in owned[]', sellerRosterData.owned.some(p => p.id === sellerAgentProfile.id), sellerRosterData.owned)
  check('seller has no bookings of their own agent', sellerRosterData.booked.length === 0, sellerRosterData.booked)

  // ── ADR-305 D6 persona-pack-ref format validation ───────────────────────
  async function createAgentOffer(body: Record<string, unknown>) {
    return fetch(`${BASE_URL}/api/offers`, {
      method: 'POST',
      headers: authHeaders(sellerToken),
      body: JSON.stringify({
        title: 'smoke-persona-offer', priceSats: 500, categoryCode: 'services/other', offerType: 'AGENT_SETUP',
        agentProfileId: sellerAgentProfile.id, agentConfigMeta: { capabilities: ['writing'] },
        ...body,
      }),
    })
  }

  const badHashRes = await createAgentOffer({ personaPackRef: 'nostr:abcd', personaPackHash: 'not-a-hash' })
  check('invalid personaPackHash -> 400', badHashRes.status === 400, await badHashRes.clone().json())

  const hashWithoutRefRes = await createAgentOffer({ personaPackHash: 'a'.repeat(64) })
  check('personaPackHash without personaPackRef -> 400', hashWithoutRefRes.status === 400, await hashWithoutRefRes.clone().json())

  const badVersionRes = await createAgentOffer({ personaPackRef: 'nostr:abcd', personaPackVersion: 'not-semver' })
  check('invalid personaPackVersion -> 400', badVersionRes.status === 400, await badVersionRes.clone().json())

  const goodPersonaRes = await createAgentOffer({
    personaPackRef: 'nostr:abcd1234', personaPackVersion: '1.2.0', personaPackHash: 'a'.repeat(64), personaId: 'reviewer',
  })
  const goodPersonaData = await goodPersonaRes.json() as { offer?: { id: string; personaPackRef: string | null } }
  check('valid persona-pack-ref fields -> 200, persisted', goodPersonaRes.status === 200 && goodPersonaData.offer?.personaPackRef === 'nostr:abcd1234', goodPersonaData)

  if (goodPersonaData.offer?.id) {
    const patchBadRes = await fetch(`${BASE_URL}/api/offers/${goodPersonaData.offer.id}`, {
      method: 'PATCH', headers: authHeaders(sellerToken), body: JSON.stringify({ personaPackHash: 'zz' }),
    })
    check('PATCH invalid personaPackHash -> 400', patchBadRes.status === 400, await patchBadRes.clone().json())
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  await prisma.workspace.deleteMany({ where: { buyerPubkey } })
  await prisma.ticket.deleteMany({ where: { buyerPubkey } })
  await prisma.offer.deleteMany({ where: { creatorPubkey: sellerPubkey } })
  await prisma.agentProfile.deleteMany({ where: { ownerPubkey: { in: [buyerPubkey, sellerPubkey] } } })
  await prisma.session.deleteMany({ where: { pubkey: { in: [buyerPubkey, sellerPubkey] } } })
  await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, sellerPubkey] } } })

  console.log(`\n${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async err => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
