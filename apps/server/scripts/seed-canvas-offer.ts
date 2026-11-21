/**
 * ADR-342 / ADR-353 local-seed: deterministic AGENT_SETUP fixtures so a
 * developer can hit the wizard + ticket canvases end-to-end in the local
 * environment without going through the full PAID ticketing flow.
 *
 * What it creates (and what each tests):
 *   1. Seed Canvas Agent (AgentProfile) owned by a seller user.
 *   2. Offer A — doop-local pointing at http://localhost:4400 (your doop
 *      Docker stack already responds `{"ok":true}` at /healthz). ACTIVE.
 *   3. Offer B — doop-hosted (publishable once the bridge env is set).
 *      DRAFT so a server re-AUDIT doesn't reject it on missing bridge env.
 *   4. PAID Ticket for Offer A + Workspace with canvasProvider snapshot =
 *      'doop-local', canvasId = 'seed-local-canvas-001',
 *      canvasProvisioningStatus = 'ready', canvasBuyerAccess = 'edit'
 *      — bypasses the outbox worker (writes the workspace directly) so the
 *      TicketDetailView canvas card lands in the "ready" state for testing.
 *
 * Idempotent: re-running wipes the deterministic fixture rows and re-creates
 * them. Safe to run any number of times; never touches data outside the
 * prefixed IDs (see PREFIXES below).
 *
 * Usage:
 *   cd WORKSPACE_PATH_REDACTED\Colabonate-App
 *   $env:DATABASE_URL='postgresql://colabonate:dev@127.0.0.1:5434/colabonate?schema=public'
 *   npx pnpm --filter server exec tsx ./scripts/seed-canvas-offer.ts
 *
 * After it prints the summary, log into the dev app at
 * http://localhost:5173 and in the DevTools console:
 *   localStorage.setItem('authToken', '<printed token>')
 *   localStorage.setItem('pubkey',    '<printed pubkey>')
 * then reload. The relevant URLs are printed at the end.
 */
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// All deterministic markers. Stable IDs (where possible) make the
// wipe-then-recreate idempotent strategy cheap and obvious.
const PREFIX = 'seed-canvas-'
const SELLER_PUBKEY = `${PREFIX}seller-${'a'.repeat(60 - PREFIX.length - 'seller-'.length)}`.slice(0, 64)
const BUYER_PUBKEY  = `${PREFIX}buyer-${'b'.repeat(60 - PREFIX.length - 'buyer-'.length)}`.slice(0, 64)
// Identity-level 2 = e-mail-verified magic-link; same level the real auth path
// produces once a user confirms their account (admitted to non-admin routes).
const IDENTITY_LEVEL = 2
const TOKEN_SELLER = randomBytes(32).toString('hex')
const TOKEN_BUYER  = randomBytes(32).toString('hex')
const TOKEN_EXPIRY = new Date(Date.now() + 30 * 24 * 3600_000) // 30d

const AGENT_NAME = 'Seed Canvas Agent (ADR-342/353 local)'

// StandardCategory must exist — 'services/design/uiux' is seeded by
// prisma/seed.ts (level 3, offerType SERVICE). No FK so any string works,
// but matching the seeded set keeps the wizard's category dropdown honest.
const CATEGORY_CODE = 'services/design/uiux'

const CANVAS_LOCAL_URL = 'http://localhost:4400'
const CANVAS_LOCAL_PROBE_STATUS = 'ok'
const CANVAS_LOCAL_PROBE_AT = new Date().toISOString()

function profileMarker(pubkey: string) {
  return { ownerPubkey: pubkey, name: AGENT_NAME }
}

async function wipeFixtures() {
  // Order: ticket → workspace → offer → agentProfile → sessions → users.
  // Use the prefixed pubkeys + agentProfile composite key.
  const oldProfiles = await prisma.agentProfile.findMany({
    where: { name: AGENT_NAME },
    select: { id: true, ownerPubkey: true },
  })
  if (oldProfiles.length > 0) {
    const profileIds = oldProfiles.map((p) => p.id)
    const oldOffers = await prisma.offer.findMany({
      where: { agentProfileId: { in: profileIds } },
      select: { id: true },
    })
    const offerIds = oldOffers.map((o) => o.id)
    const oldTickets = await prisma.ticket.findMany({
      where: { offerId: { in: offerIds } },
      select: { id: true },
    })
    const ticketIds = oldTickets.map((t) => t.id)

    await prisma.outboxEvent.deleteMany({
      where: { aggregateId: { in: [...profileIds, ...offerIds, ...ticketIds] } },
    })
    await prisma.workspace.deleteMany({ where: { ticketId: { in: ticketIds } } })
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
    await prisma.offer.deleteMany({ where: { id: { in: offerIds } } })
    await prisma.agentProfile.deleteMany({ where: { id: { in: profileIds } } })
  }

  // Catch any orphan seeded rows from a previous run (e.g. offers created
  // without agentProfile — shouldn't happen, but be defensive).
  const sellerSessions = await prisma.session.findMany({ where: { pubkey: SELLER_PUBKEY }, select: { id: true } })
  const buyerSessions  = await prisma.session.findMany({ where: { pubkey: BUYER_PUBKEY  }, select: { id: true } })
  const sessionIds = [...sellerSessions, ...buyerSessions].map((s) => s.id)
  if (sessionIds.length > 0) {
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } })
  }
  await prisma.user.deleteMany({ where: { pubkey: { in: [SELLER_PUBKEY, BUYER_PUBKEY] } } })
}

async function createUsersAndSessions() {
  await prisma.user.createMany({
    data: [
      { pubkey: SELLER_PUBKEY, identityLevel: IDENTITY_LEVEL, lnAddress: 'seed-seller@canvas.local' },
      { pubkey: BUYER_PUBKEY,  identityLevel: IDENTITY_LEVEL, lnAddress: 'seed-buyer@canvas.local' },
    ],
  })

  // Each user gets exactly one fresh session; the unique `token` index
  // makes upsert trivial.
  await prisma.session.create({
    data: { pubkey: SELLER_PUBKEY, k1: randomBytes(32).toString('hex'), token: TOKEN_SELLER, expiresAt: TOKEN_EXPIRY },
  })
  await prisma.session.create({
    data: { pubkey: BUYER_PUBKEY,  k1: randomBytes(32).toString('hex'), token: TOKEN_BUYER,  expiresAt: TOKEN_EXPIRY },
  })
}

async function createAgentProfile() {
  return prisma.agentProfile.create({
    data: {
      ownerPubkey: SELLER_PUBKEY,
      name: AGENT_NAME,
      description:
        'Local-test agent profile created by seed-canvas-offer.ts. ' +
        'Used to exercise the canvas sections of the agent-setup wizard and the ' +
        'TicketDetailView collaboration card without going through the full PAID ticketing flow.',
      capabilities: ['design', 'research'],
      tools: [{ name: 'doop-canvas', description: 'Persistent collaboration surface' }],
      isPublic: true,
    },
  })
}

async function createOffers(profileId: string) {
  const sealedBlob = Buffer.from('seed-fake-nip44-ciphertext-for-local-only').toString('base64')
  const baseOffer = {
    priceSats: 1500,
    categoryCode: CATEGORY_CODE,
    offerType: 'AGENT_SETUP' as const,
    agentConfigSealed: sealedBlob,
    agentBillingModel: 'PER_HOUR' as const,
    agentWorkspaceTTL: 7 * 86400,
    estimatedWorkspaceHours: 4,
    agentProfile: { connect: { id: profileId } },
    creator: { connect: { pubkey: SELLER_PUBKEY } },
  }

  // ── Offer A — doop-local, ACTIVE, probe cached 'ok' against :4400. ──
  const offerLocal = await prisma.offer.create({
    data: {
      ...baseOffer,
      title: '[seed] Local doop canvas (localhost:4400)',
      description:
        '**Local seed offer** — collaboration canvas points at the doop instance ' +
        'already running at http://localhost:4400. The async health probe cached ' +
        '`ok` so the publish gate lets it through without going through the ' +
        'two-phase save flow. Use this to test the doop-local card + external link in ' +
        'the ticket.',
      status: 'ACTIVE',
      publishedAt: new Date(),
      agentConfigMeta: {
        capabilities: ['design', 'research'],
        canvas: {
          provider: 'doop-local',
          instanceUrl: CANVAS_LOCAL_URL,
          buyerAccess: 'edit',
          probeStatus: CANVAS_LOCAL_PROBE_STATUS,
          probeAt: CANVAS_LOCAL_PROBE_AT,
        },
      },
    },
  })

  // ── Offer B — doop-hosted, DRAFT so a server audit (without DOOP_SERVICE_*
  //   env) doesn't reject the row. Edit + ACTIVE-flow it once the bridge is set.
  const offerHosted = await prisma.offer.create({
    data: {
      ...baseOffer,
      title: '[seed] Colabonate-hosted doop canvas',
      description:
        '**Local seed offer** — uses the hosted bridge. Stays DRAFT so the ' +
        'page does not 400 on the publish gate while `DOOP_SERVICE_URL`/`TOKEN` are ' +
        'unset on your dev server. Edit + ACTIVE it (or run the smoke Tier 3) once the ' +
        'bridge env is configured.',
      status: 'DRAFT',
      agentConfigMeta: {
        capabilities: ['design', 'research'],
        canvas: {
          provider: 'doop-hosted',
          buyerAccess: 'edit',
        },
      },
    },
  })

  return { offerLocal, offerHosted }
}

async function createHostedTicketAndWorkspace(profileId: string, offerHostedId: string, opts: { provisioningStatus: 'pending' | 'ready' | 'failed'; canvasId: string | null; buyerAccess: 'edit' | 'none' }) {
  // ADR-342 D3 (Phase B) exercises the TicketDetailView hosted-card render
  // path. The card reads `workspaceCanvas` from /api/tickets/:id (server
  // shape at index.ts:2087-2116) and flips state by canvasProvisioningStatus.
  // We write the workspace directly so the user can iterate on the hosted
  // card without setting DOOP_SERVICE_URL/TOKEN.
  const ticket = await prisma.ticket.create({
    data: {
      status: 'PAID',
      offerType: 'AGENT_SETUP',
      amountSats: 1500,
      escrowStatus: 'ACTIVE',
      escrowEnabled: true,
      agentBillingModel: 'PER_HOUR',
      visibility: 'PUBLIC',
      disputeMode: 'PUBLIC',
      paymentHash: `seed-payment-hash-hosted-${opts.provisioningStatus}`,
      buyer: { connect: { pubkey: BUYER_PUBKEY } },
      seller: { connect: { pubkey: SELLER_PUBKEY } },
      offer: { connect: { id: offerHostedId } },
    },
  })
  const workspace = await prisma.workspace.create({
    data: {
      status: 'PENDING_DEPLOY',
      canvasProvider: 'doop-hosted',
      canvasId: opts.canvasId,
      canvasProvisioningStatus: opts.provisioningStatus,
      canvasBuyerAccess: opts.buyerAccess,
      agentProfile: { connect: { id: profileId } },
      buyer: { connect: { pubkey: BUYER_PUBKEY } },
      offer: { connect: { id: offerHostedId } },
      ticket: { connect: { id: ticket.id } },
    },
  })
  return { ticket, workspace }
}

async function createPaidTicketAndWorkspace(profileId: string, offerLocalId: string) {
  // A paid ticket mirrors what POST /api/workspaces would produce (D3/A2),
  // minus the outbox worker hop — we write the workspace directly so the
  // TicketDetailView canvas card lands in `ready` for testing without
  // requiring a live doop provisioning round trip.
  const ticket = await prisma.ticket.create({
    data: {
      status: 'PAID',
      offerType: 'AGENT_SETUP',
      amountSats: 1500,
      escrowStatus: 'ACTIVE',
      escrowEnabled: true,
      agentBillingModel: 'PER_HOUR',
      visibility: 'PUBLIC',
      disputeMode: 'PUBLIC',
      paymentHash: 'seed-payment-hash-local-canvas',
      // ADR-312 D6: snapshot of Offer.agentBillingModel — already mirrored above.
      buyer: { connect: { pubkey: BUYER_PUBKEY } },
      seller: { connect: { pubkey: SELLER_PUBKEY } },
      offer: { connect: { id: offerLocalId } },
    },
  })

  const workspace = await prisma.workspace.create({
    data: {
      status: 'PENDING_DEPLOY', // canister status — orthogonal to canvas
      // ADR-342 D3/A2: canvas columns pre-populated to the "ready" state so the
      // ticket card opens the canvas without going through provisioning.
      canvasProvider: 'doop-local',
      canvasId: 'seed-local-canvas-001',
      canvasProvisioningStatus: 'ready',
      canvasBuyerAccess: 'edit',
      agentProfile: { connect: { id: profileId } },
      buyer: { connect: { pubkey: BUYER_PUBKEY } },
      offer: { connect: { id: offerLocalId } },
      ticket: { connect: { id: ticket.id } },
    },
  })

  return { ticket, workspace }
}

async function main() {
  console.log('▸ wiping previous fixtures…')
  await wipeFixtures()
  console.log('▸ creating users + sessions…')
  await createUsersAndSessions()
  console.log('▸ creating agent profile…')
  const profile = await createAgentProfile()
  console.log('▸ creating offers (doop-local ACTIVE, doop-hosted DRAFT)…')
  const { offerLocal, offerHosted } = await createOffers(profile.id)
  console.log('▸ creating paid ticket + ready workspace for the doop-local offer…')
  const { ticket, workspace } = await createPaidTicketAndWorkspace(profile.id, offerLocal.id)
  console.log('▸ creating hosted-card fixtures (pending / failed / buyerAccess=none)…')
  const hostedPending  = await createHostedTicketAndWorkspace(profile.id, offerHosted.id, { provisioningStatus: 'pending',  canvasId: null,          buyerAccess: 'edit' })
  const hostedFailed   = await createHostedTicketAndWorkspace(profile.id, offerHosted.id, { provisioningStatus: 'failed',   canvasId: null,          buyerAccess: 'edit' })
  const hostedReady    = await createHostedTicketAndWorkspace(profile.id, offerHosted.id, { provisioningStatus: 'ready',    canvasId: 'seed-hosted-canvas-001', buyerAccess: 'edit' })
  const hostedPrivate  = await createHostedTicketAndWorkspace(profile.id, offerHosted.id, { provisioningStatus: 'ready',    canvasId: 'seed-hosted-canvas-002', buyerAccess: 'none' })

  const divider = '═'.repeat(72)
  const print = (...args: unknown[]) => console.log(...args)
  // Persist IDs/tokens so the operator can re-read them later without
  // re-running the seed (re-runs wipe the fixtures and issue new tokens).
  // Resolve the repo root from the script's own location (works whether the
// operator runs from `apps/server` or the repo root).
const __dirname_ = dirname(fileURLToPath(import.meta.url))
const outPath = process.env.SEED_OUT_PATH
  ?? resolve(__dirname_, '../../..', 'seed-canvas-offer.json')
  writeFileSync(outPath, JSON.stringify({
    sellerPubkey: SELLER_PUBKEY,
    buyerPubkey: BUYER_PUBKEY,
    sellerToken: TOKEN_SELLER,
    buyerToken: TOKEN_BUYER,
    profileId: profile.id,
    offerLocalId: offerLocal.id,
    offerHostedId: offerHosted.id,
    ticketLocalId: ticket.id,
    workspaceLocalId: workspace.id,
    hostedPendingTicketId: hostedPending.ticket.id,
    hostedFailedTicketId: hostedFailed.ticket.id,
    hostedReadyTicketId: hostedReady.ticket.id,
    hostedPrivateTicketId: hostedPrivate.ticket.id,
  }, null, 2) + '\n')
  print()
  print(`  (ids + tokens persisted to ${outPath})`)
  print(divider)
  print('  LOCAL CANVAS SEED — pasted into DevTools at http://localhost:5173:')
  print(divider)
  print(`localStorage.setItem('authToken', '${TOKEN_SELLER}')  // seller view`)
  print(`localStorage.setItem('pubkey',    '${SELLER_PUBKEY}')  // seller identity`)
  print()
  print(`localStorage.setItem('authToken', '${TOKEN_BUYER}')   // buyer view (paste on top of seller)`)
  print(`localStorage.setItem('pubkey',    '${BUYER_PUBKEY}')   // buyer identity`)
  print(divider)
  print('  Resources to open:')
  print(divider)
  print(`  Agent profile (seller view, edit button):`)
  print(`    http://localhost:5173/agents/${profile.id}`)
  print(`  AGENT_SETUP offer — doop-local (ACTIVE, ready to view):`)
  print(`    http://localhost:5173/agents/${profile.id}/offers/${offerLocal.id}/edit`)
  print(`  AGENT_SETUP offer — doop-hosted (DRAFT, edit + ACTIVE once bridge env is set):`)
  print(`    http://localhost:5173/agents/${profile.id}/offers/${offerHosted.id}/edit`)
  print(`  Ticket (PAID, seller view — collaborator canvas card on the right):`)
  print(`    http://localhost:5173/tickets/${ticket.id}`)
  print(`  Workspace:`)
  print(`    http://localhost:5173/workspaces/${workspace.id}`)
  print()
  print(`  Hosted-card render variants (TicketDetailView workspaceCanvas states):`)
  print(`    pending    (Canvas wird vorbereitet… — disabled button):`)
  print(`      http://localhost:5173/tickets/${hostedPending.ticket.id}`)
  print(`    failed     (Retry canvas — explicit retry button):`)
  print(`      http://localhost:5173/tickets/${hostedFailed.ticket.id}`)
  print(`    ready      (Open Canvas — opens new tab to doop-hosted bridge):`)
  print(`      http://localhost:5173/tickets/${hostedReady.ticket.id}`)
  print(`    ready + buyerAccess='none' (neutral "canvas is private" — buyer only):`)
  print(`      http://localhost:5173/tickets/${hostedPrivate.ticket.id}`)
  print()
  print(`  Tip: the four hosted tickets use the doop-hosted offer DRAFT, so server-side`)
  print(`  audit won't reject them. Switch to buyer-view (see DevTools block above) to see`)
  print(`  the buyerAccess='none' branch (neutral text instead of a button).`)
  print(divider)
  print('  To exercise the hosted bridge path, restart the server with:')
  print(`    $env:DOOP_SERVICE_URL='http://localhost:4400'`)
  print(`    $env:DOOP_SERVICE_TOKEN='<your doop service token>'`)
  print('  then edit Offer B (above URL) and Publish — the wizard label flips to')
  print('  "Colabonate-hosted canvas", the gate opens, and ticket creation against')
  print('  Offer B drives a real outbox-driven provisioning cycle.')
  print(divider)
}

main()
  .catch((err) => {
    console.error('seed-canvas-offer failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())