// ADR-311 live smoke test: workspace lifecycle API (D2) — creation from a
// paid AGENT_SETUP ticket, buyer/seller read scoping, buyer completion with
// Offer.agentWorkspaceTTL retention window, and the Completed → Expired
// sweep. Two modes:
//
// - Default (server without canister backend): creation stays PENDING_DEPLOY,
//   the RUNNING flip is simulated via a direct DB write.
// - ICP_SMOKE=1 + ICP_WORKSPACE_CANISTER_ID (same value the server under test
//   runs with): creation must go PENDING_DEPLOY → RUNNING for real via
//   create_workspace + start_workspace (FU-432), the completion + expiry
//   relays (FU-435) must mirror COMPLETED/EXPIRED canister-side, and the
//   smoke verifies the canister status agrees with the server row at each
//   step. The lifecycle ticket uses a 2s-TTL offer because the canister-side
//   expire is time-gated and cannot be forced. Base expectations that a
//   configured backend changes (initial status, RUNNING filter, the
//   complete-while-pending guard) switch with the mode.
//
// FU-433 (cycle reload) runs in BOTH modes and needs the server under test
// started with BETA_MODE=true: recharges resolve against Colabonate's own
// platform wallet (ADR-351), which falls back to the simulated DEMO rail
// when PLATFORM_LN_ADDRESS is unset (ADR-197/ADR-255) — no seller wallet
// configuration is involved any more (see adr351-platform-funding-smoke.ts
// for the dedicated proof of that). ICP mode additionally drives a real
// SUSPENDED via record_cycle_usage and verifies the recharge → add_cycles
// relay incl. the apply_topup resume.
//
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr311-workspace-smoke.ts
//   ICP_SMOKE=1 ICP_WORKSPACE_CANISTER_ID=$(cd packages/icp-workspace-canister && icp canister status icp_workspace_canister --id-only) ... (same, against a canister-configured server)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha2'
import { runWorkspaceExpirySweep } from '../services/workspace-lifecycle.js'
import { getWorkspaceCanisterClient, WorkspaceCanisterError } from '../services/workspace-canister-client.js'

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
  const icpMode = process.env.ICP_SMOKE === '1' && Boolean(process.env.ICP_WORKSPACE_CANISTER_ID)
  // Real keypair for the buyer: the ICP-mode chat/tool flow (FU-434 Slice C)
  // is authorized by the buyer's BIP-340 signature, so the smoke must sign.
  const buyerSecretKey = generateSecretKey()
  const buyerPubkey = getPublicKey(buyerSecretKey)
  // Real keypair for the seller: the ICP-mode config injection (FU-353) does
  // the NIP-44 ECDH with the seller's actual key.
  const sellerSecretKey = generateSecretKey()
  const sellerPubkey = getPublicKey(sellerSecretKey)
  const strangerPubkey = randomBytes(32).toString('hex')
  // ADR-349 D1: a third-party invited as a read-scoped WorkspaceMember —
  // distinct from "stranger" (never invited) and "seller" (already has
  // ticket-seller read access without an invite). Real keypair (not just
  // random bytes) because FU-589's ICP-mode section has them sign
  // buyer-direct actions after registering as a full-parity signer.
  const collaboratorSecretKey = generateSecretKey()
  const collaboratorPubkey = getPublicKey(collaboratorSecretKey)
  const buyerToken = randomBytes(32).toString('hex')
  const sellerToken = randomBytes(32).toString('hex')
  const strangerToken = randomBytes(32).toString('hex')
  const collaboratorToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  const sellerUser = await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: strangerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: collaboratorPubkey, identityLevel: 2 } })
  // Kept for realism (a seller would normally have a payment rail for its
  // own ticket-price direct-pay) but no longer load-bearing for recharges —
  // those resolve against the platform's own wallet since ADR-351, not this.
  await prisma.wallet.create({ data: { userId: sellerUser.id, provider: 'DEMO', mode: 'NON_CUSTODIAL' } })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: sellerPubkey, k1: randomUUID(), token: sellerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: strangerPubkey, k1: randomUUID(), token: strangerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: collaboratorPubkey, k1: randomUUID(), token: collaboratorToken, expiresAt: new Date(Date.now() + 3600_000) } })

  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-311-agent', capabilities: ['research'], tools: [], isPublic: true },
  })
  // Custom TTL (3600s) so the completion test verifies the offer's value is used.
  const agentOffer = await prisma.offer.create({
    data: {
      title: 'ADR-311 Smoke Agent Offer', priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: sellerPubkey, agentProfileId: agentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
      agentWorkspaceTTL: 3600,
    },
  })
  const serviceOffer = await prisma.offer.create({
    data: { title: 'ADR-311 Smoke Service Offer', priceSats: 1000, categoryCode: 'services/other', offerType: 'SERVICE', status: 'ACTIVE', creatorPubkey: sellerPubkey },
  })

  // ICP mode: the lifecycle ticket runs on a 2s-TTL offer so the
  // completion → expiry relay can run honestly within the smoke's runtime —
  // the canister-side expire is time-gated and cannot be forced.
  const lifecycleOffer = icpMode
    ? await prisma.offer.create({
        data: {
          title: 'ADR-311 Smoke Agent Offer (short TTL)', priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
          creatorPubkey: sellerPubkey, agentProfileId: agentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
          agentWorkspaceTTL: 2,
        },
      })
    : agentOffer
  const lifecycleTtlSeconds = lifecycleOffer.agentWorkspaceTTL ?? 3600

  const paidAgentTicket = await prisma.ticket.create({
    data: { offerId: lifecycleOffer.id, offerType: 'AGENT_SETUP', buyerPubkey, sellerPubkey, status: 'PAID' },
  })
  const pendingAgentTicket = await prisma.ticket.create({
    data: { offerId: agentOffer.id, offerType: 'AGENT_SETUP', buyerPubkey, sellerPubkey, status: 'PENDING' },
  })
  const paidServiceTicket = await prisma.ticket.create({
    data: { offerId: serviceOffer.id, offerType: 'SERVICE', buyerPubkey, sellerPubkey, status: 'PAID' },
  })

  const buyerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }
  const sellerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerToken}` }
  const strangerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${strangerToken}` }
  const collaboratorHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${collaboratorToken}` }

  // FU-434 Slice C: canonical buyer-action signing, mirroring the canister's
  // sig.rs exactly — sha256 of the utf-8 message, then BIP-340. Timestamps
  // are nanoseconds and strictly increasing across the smoke's actions (the
  // canister-side replay guard requires monotonicity).
  let actionTimestamp = BigInt(Date.now()) * 1_000_000n
  function signBuyerAction(action: string, canisterWorkspaceId: string, params: string[]) {
    actionTimestamp += 1n
    const message = `colabonate-workspace-v1:${action}:${canisterWorkspaceId}:${actionTimestamp}${params.map((p) => `:${p}`).join('')}`
    const signature = schnorr.sign(sha256(new TextEncoder().encode(message)), buyerSecretKey)
    return { timestamp: actionTimestamp, signature }
  }
  function canisterErrorName(err: unknown): string {
    return err instanceof WorkspaceCanisterError ? Object.keys(err.canisterError)[0] ?? '?' : String(err)
  }

  let workspaceId = ''
  try {
    // ── Creation guards ────────────────────────────────────────────────
    let r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticketId: paidAgentTicket.id }),
    })
    check('create without auth -> 401', r.status === 401)

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: 'nonexistent' }),
    })
    check('create with unknown ticket -> 404', r.status === 404)

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: strangerHeaders, body: JSON.stringify({ ticketId: paidAgentTicket.id }),
    })
    check('create as non-buyer -> 403', r.status === 403)

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: paidServiceTicket.id }),
    })
    let body = await r.json()
    check('create from SERVICE ticket -> 400 NOT_AGENT_SETUP', r.status === 400 && body?.error === 'NOT_AGENT_SETUP', body)

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: pendingAgentTicket.id }),
    })
    body = await r.json()
    check('create from unpaid ticket -> 409 TICKET_NOT_PAID', r.status === 409 && body?.error === 'TICKET_NOT_PAID', body)

    // ── Happy path: paid AGENT_SETUP ticket ────────────────────────────
    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: paidAgentTicket.id }),
    })
    body = await r.json()
    check('create from paid agent ticket -> 201', r.status === 201, body)
    workspaceId = body?.workspace?.id
    let canisterWorkspaceId: string | undefined
    if (icpMode) {
      check(
        '[icp] deploy via canister -> RUNNING with canisterId + canisterWorkspaceId + activatedAt',
        body?.workspace?.status === 'RUNNING'
          && body?.workspace?.canisterId === process.env.ICP_WORKSPACE_CANISTER_ID
          && typeof body?.workspace?.canisterWorkspaceId === 'string'
          && body?.workspace?.activatedAt !== null,
        body?.workspace,
      )
      canisterWorkspaceId = body?.workspace?.canisterWorkspaceId as string | undefined
    } else {
      check('workspace starts PENDING_DEPLOY (no canister configured)', body?.workspace?.status === 'PENDING_DEPLOY', body?.workspace)
      check('workspace carries agentProfileId + null canisterId', body?.workspace?.agentProfileId === agentProfile.id && body?.workspace?.canisterId === null, body?.workspace)
    }

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: paidAgentTicket.id }),
    })
    body = await r.json()
    check('duplicate create -> 409 WORKSPACE_EXISTS', r.status === 409 && body?.error === 'WORKSPACE_EXISTS', body)

    // ── Read scoping ───────────────────────────────────────────────────
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: buyerHeaders })
    body = await r.json()
    check('GET /:id as buyer -> 200', r.status === 200)
    check('GET /:id as buyer -> viewerRole=buyer', body?.workspace?.viewerRole === 'buyer', body?.workspace)
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: sellerHeaders })
    body = await r.json()
    check('GET /:id as ticket seller -> 200', r.status === 200)
    // ADR-349 D1: never let the client infer isSeller from !isBuyer — an
    // invited collaborator (tested below) is neither, and the server must
    // say so explicitly.
    check('GET /:id as ticket seller -> viewerRole=seller', body?.workspace?.viewerRole === 'seller', body?.workspace)
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: strangerHeaders })
    check('GET /:id as stranger -> 403', r.status === 403)

    // ── Outputs (FU-447: minimal status-screen bridge, D5 get_outputs proxy) ─
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/outputs`, { headers: buyerHeaders })
    body = await r.json()
    check(
      icpMode ? '[icp] GET /:id/outputs as buyer -> 200 array' : 'GET /:id/outputs as buyer -> 200 empty (no canister)',
      r.status === 200 && Array.isArray(body?.outputs) && (icpMode || body.outputs.length === 0),
      body,
    )
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/outputs`, { headers: sellerHeaders })
    check('GET /:id/outputs as ticket seller -> 200', r.status === 200)
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/outputs`, { headers: strangerHeaders })
    check('GET /:id/outputs as stranger -> 403', r.status === 403)
    r = await fetch(`${BASE_URL}/api/workspaces/nonexistent-id/outputs`, { headers: buyerHeaders })
    check('GET /:id/outputs for missing workspace -> 404', r.status === 404)

    // ── ADR-349 D1: WorkspaceMember (server/DB-only slice) ──────────────
    // Before any invite: a collaborator is indistinguishable from a stranger.
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: collaboratorHeaders })
    check('GET /:id as not-yet-invited collaborator -> 403', r.status === 403)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members`, {
      method: 'POST', headers: strangerHeaders, body: JSON.stringify({ pubkey: collaboratorPubkey }),
    })
    check('POST /:id/members as non-buyer -> 403', r.status === 403)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ pubkey: 'not-a-pubkey' }),
    })
    check('POST /:id/members with malformed pubkey -> 400', r.status === 400)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ pubkey: randomBytes(32).toString('hex') }),
    })
    check('POST /:id/members for a pubkey with no User row -> 404 USER_NOT_FOUND', r.status === 404)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ pubkey: collaboratorPubkey }),
    })
    body = await r.json()
    check('POST /:id/members as buyer -> 201', r.status === 201 && body?.member?.pubkey === collaboratorPubkey, body)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ pubkey: collaboratorPubkey }),
    })
    check('duplicate invite -> 409 ALREADY_MEMBER', r.status === 409 && (await r.json())?.error === 'ALREADY_MEMBER')

    // Invite takes effect immediately for reads — no accept step (D1 scope).
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: collaboratorHeaders })
    body = await r.json()
    check('GET /:id as invited collaborator -> 200', r.status === 200)
    check(
      'GET /:id as invited collaborator -> viewerRole=collaborator (not misclassified as seller)',
      body?.workspace?.viewerRole === 'collaborator',
      body?.workspace,
    )
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/outputs`, { headers: collaboratorHeaders })
    check('GET /:id/outputs as invited collaborator -> 200', r.status === 200)
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/output-key`, { headers: collaboratorHeaders })
    check('GET /:id/output-key as invited collaborator is read-scoped (not 403)', r.status !== 403, { status: r.status })

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members`, { headers: strangerHeaders })
    check('GET /:id/members as stranger -> 403', r.status === 403)
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members`, { headers: collaboratorHeaders })
    body = await r.json()
    check(
      'GET /:id/members as collaborator -> 200 lists self',
      r.status === 200 && body?.members?.length === 1 && body.members[0]?.member?.pubkey === collaboratorPubkey,
      body,
    )

    // Collaborator write access is explicitly NOT part of this slice — chat
    // stays buyer-signed-only until FU-589 (canister multi-signer support).
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/complete`, { method: 'POST', headers: collaboratorHeaders })
    check('POST /:id/complete as collaborator (not the buyer) -> 403', r.status === 403)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members/${collaboratorPubkey}`, { method: 'DELETE', headers: strangerHeaders })
    check('DELETE /:id/members/:pubkey as non-buyer -> 403', r.status === 403)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members/${collaboratorPubkey}`, { method: 'DELETE', headers: buyerHeaders })
    check('DELETE /:id/members/:pubkey as buyer -> 204', r.status === 204)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members/${collaboratorPubkey}`, { method: 'DELETE', headers: buyerHeaders })
    check('DELETE /:id/members/:pubkey already removed -> 404', r.status === 404)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: collaboratorHeaders })
    check('GET /:id after removal -> 403 again', r.status === 403)

    r = await fetch(`${BASE_URL}/api/workspaces`, { headers: buyerHeaders })
    body = await r.json()
    check('GET / lists buyer workspace', r.status === 200 && body?.total === 1 && body?.workspaces?.[0]?.id === workspaceId, body)
    r = await fetch(`${BASE_URL}/api/workspaces?status=RUNNING`, { headers: buyerHeaders })
    body = await r.json()
    check(
      icpMode ? '[icp] GET /?status=RUNNING lists the deployed workspace' : 'GET /?status=RUNNING filters correctly',
      r.status === 200 && body?.total === (icpMode ? 1 : 0),
      body,
    )
    r = await fetch(`${BASE_URL}/api/workspaces?status=bogus`, { headers: buyerHeaders })
    check('GET /?status=bogus -> 400', r.status === 400)
    r = await fetch(`${BASE_URL}/api/workspaces`, { headers: strangerHeaders })
    body = await r.json()
    check('GET / as stranger -> empty', r.status === 200 && body?.total === 0, body)

    // Canister mirror check (FU-432): the replica-side state must agree with
    // the server row the deploy path just wrote.
    if (icpMode) {
      const client = await getWorkspaceCanisterClient()
      const status = client && canisterWorkspaceId ? await client.checkWorkspaceStatus(canisterWorkspaceId) : null
      check('[icp] canister status mirrors RUNNING', status?.state === 'RUNNING', status)

      // ── FU-434 Slice C: chat needs an injected config — honest error first ──
      {
        const { timestamp, signature } = signBuyerAction('post_message', canisterWorkspaceId as string, ['hello'])
        const err = await client!.postMessage(canisterWorkspaceId as string, 'hello', timestamp, signature).catch((e) => e)
        check(
          '[icp] chat before config inject -> ConfigNotInjected',
          err instanceof WorkspaceCanisterError && 'ConfigNotInjected' in err.canisterError,
          err,
        )
      }

      // ── FU-434 Slice B (FU-353): one-time encrypted config injection ──
      const outputPubkey = client ? await client.ensureOutputKey() : ''
      check('[icp] ensure_output_key returns x-only pubkey', /^[0-9a-f]{64}$/.test(outputPubkey), outputPubkey)

      const configJson = JSON.stringify({
        llm_provider: 'openai', llm_model: 'gpt-smoke', llm_api_key: 'smoke-key-not-real',
        llm_base_url: null, system_prompt: 'smoke',
        // Slice C tool allowlist: plain prefix = immediate, "!" = approval-gated.
        tools: ['https://api.openai.com/v1/', '!https://api.anthropic.com/'],
      })
      const conversationKey = nip44.v2.utils.getConversationKey(sellerSecretKey, outputPubkey)
      const ciphertext = nip44.v2.encrypt(configJson, conversationKey)

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/inject-config`, {
        method: 'POST', headers: strangerHeaders, body: JSON.stringify({ senderPubkey: strangerPubkey, ciphertext }),
      })
      check('[icp] inject config as stranger -> 403', r.status === 403)

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/inject-config`, {
        method: 'POST', headers: sellerHeaders, body: JSON.stringify({ senderPubkey: sellerPubkey, ciphertext }),
      })
      check('[icp] inject config as seller (agent owner) -> 200', r.status === 200, await r.clone().json().catch(() => null))

      const view = client && canisterWorkspaceId ? await client.getWorkspaceView(canisterWorkspaceId) : null
      check('[icp] canister view has_config=true (config itself redacted)', view?.hasConfig === true, view)

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/inject-config`, {
        method: 'POST', headers: sellerHeaders, body: JSON.stringify({ senderPubkey: sellerPubkey, ciphertext }),
      })
      body = await r.json()
      check('[icp] second inject -> 409 CONFIG_ALREADY_INJECTED', r.status === 409 && body?.error === 'CONFIG_ALREADY_INJECTED', body)

      // ── FU-434 Slice C: chat + tool executor (buyer-signed, canister-direct) ──
      // Cycle budget for real outcall booking (FU-433's paid flow is not
      // built yet — top up directly via the client).
      const toppedUp = await client!.addCycles(canisterWorkspaceId as string, 1_000_000_000_000n)
      check('[icp] add_cycles tops up budget for harness metering', toppedUp.cycleBudget === 1_000_000_000_000n, toppedUp)

      // Wrong signer: signed with the seller key, must not verify against buyer_pubkey.
      {
        actionTimestamp += 1n
        const message = `colabonate-workspace-v1:post_message:${canisterWorkspaceId}:${actionTimestamp}:forged`
        const forgedSig = schnorr.sign(sha256(new TextEncoder().encode(message)), sellerSecretKey)
        const err = await client!.postMessage(canisterWorkspaceId as string, 'forged', actionTimestamp, forgedSig).catch((e) => e)
        check(
          '[icp] chat signed by stranger key -> SignatureVerificationFailed',
          err instanceof WorkspaceCanisterError && 'SignatureVerificationFailed' in err.canisterError,
          err,
        )
      }

      // Replay guard: the same (timestamp, signature) twice -> second rejected.
      {
        const { timestamp, signature } = signBuyerAction('post_message', canisterWorkspaceId as string, ['replay me'])
        await client!.postMessage(canisterWorkspaceId as string, 'replay me', timestamp, signature).catch(() => null)
        const err = await client!.postMessage(canisterWorkspaceId as string, 'replay me', timestamp, signature).catch((e) => e)
        check(
          '[icp] replayed (timestamp, signature) -> ReplayRejected',
          err instanceof WorkspaceCanisterError && 'ReplayRejected' in err.canisterError,
          err,
        )
      }

      // ── FU-589: multi-signer — an invited collaborator gets full write
      // parity with the buyer, end to end through the real HTTP route (not
      // just the canister client directly), proving both halves: the server
      // gate widened to allow members, and the canister's authorized_signers
      // set actually includes them once registered. ──
      {
        // The mandatory initial-funding gate on POST /:id/messages applies
        // regardless of who's chatting — every earlier chat check in this
        // block called the canister client directly (bypassing the HTTP
        // route entirely), so this is the first time that gate is actually
        // exercised. Flip it PAID directly via Prisma rather than the real
        // confirm endpoint — the gate only checks `status`, and going
        // through confirm would credit cycleBudgetSats, which the later
        // voluntary-recharge assertions below assume starts at a clean 0.
        await prisma.workspaceRecharge.updateMany({
          where: { workspaceId, isMandatoryInitial: true },
          data: { status: 'PAID', paidAt: new Date() },
        })

        // D1's earlier test already invited-then-removed this identity —
        // re-invite for this write-parity test.
        r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members`, {
          method: 'POST', headers: buyerHeaders, body: JSON.stringify({ pubkey: collaboratorPubkey }),
        })
        check('[icp] FU-589: re-invite collaborator for write-parity test -> 201', r.status === 201, await r.clone().json().catch(() => null))

        // Mirrors signBuyerAction()'s canonical message construction exactly,
        // signed with the collaborator's own key instead of the buyer's.
        function signAsCollaborator(action: string, params: string[]) {
          actionTimestamp += 1n
          const message = `colabonate-workspace-v1:${action}:${canisterWorkspaceId}:${actionTimestamp}${params.map((p) => `:${p}`).join('')}`
          const signature = schnorr.sign(sha256(new TextEncoder().encode(message)), collaboratorSecretKey)
          return { timestamp: actionTimestamp, signature }
        }

        // Before registering a signer: the server-side gate lets the request
        // through (they ARE a member), but the canister has no
        // authorized_signers entry for them yet -> signature rejected.
        {
          const { timestamp, signature } = signAsCollaborator('post_message', ['not yet'])
          r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/messages`, {
            method: 'POST', headers: collaboratorHeaders,
            body: JSON.stringify({ content: 'not yet', timestamp: timestamp.toString(), signature: Buffer.from(signature).toString('hex') }),
          })
          body = await r.json().catch(() => null)
          check(
            '[icp] FU-589: collaborator chat before registering a signer -> 401 SIGNATURE_INVALID',
            r.status === 401 && body?.error === 'SIGNATURE_INVALID',
            body,
          )
        }

        r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members/me/signer`, {
          method: 'POST', headers: strangerHeaders, body: JSON.stringify({ signerPubkey: collaboratorPubkey }),
        })
        check('[icp] FU-589: register signer as a non-member -> 403', r.status === 403)

        r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members/me/signer`, {
          method: 'POST', headers: collaboratorHeaders, body: JSON.stringify({ signerPubkey: collaboratorPubkey }),
        })
        check('[icp] FU-589: register own signer -> 200', r.status === 200, await r.clone().json().catch(() => null))

        r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: collaboratorHeaders })
        body = await r.json()
        check(
          '[icp] FU-589: GET /:id reports the collaborator\'s registered viewerSignerPubkey',
          body?.workspace?.viewerSignerPubkey === collaboratorPubkey,
          body?.workspace,
        )

        // Same shape as the pre-registration attempt, now correctly
        // authorized end to end (server gate + canister signer set). The
        // actual LLM call still hits the smoke's fake API key — same honest
        // "reaches the provider boundary, doesn't fake success" outcome as
        // every other chat test in this file (201 real reply, or 502
        // LLM_PROVIDER_ERROR once the outcall reaches OpenAI and gets a real
        // 401). Either proves auth passed; a 401/403 would mean it didn't.
        {
          const { timestamp, signature } = signAsCollaborator('post_message', ['hello from collaborator'])
          r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/messages`, {
            method: 'POST', headers: collaboratorHeaders,
            body: JSON.stringify({ content: 'hello from collaborator', timestamp: timestamp.toString(), signature: Buffer.from(signature).toString('hex') }),
          })
          body = await r.json().catch(() => null)
          check(
            '[icp] FU-589: collaborator chat after registering reaches the LLM step (not 401/403)',
            r.status === 201 || r.status === 502,
            { status: r.status, body },
          )
        }

        // A never-invited stranger still can't even reach the canister —
        // full parity applies only to actually-authorized signers.
        actionTimestamp += 1n
        r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/messages`, {
          method: 'POST', headers: strangerHeaders,
          body: JSON.stringify({ content: 'x', timestamp: actionTimestamp.toString(), signature: '00'.repeat(64) }),
        })
        check('[icp] FU-589: stranger chat -> 403 (not buyer or member)', r.status === 403)

        // Relay-then-commit revocation: removing the collaborator must
        // actually revoke canister-side write access, not just the DB row.
        r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/members/${collaboratorPubkey}`, { method: 'DELETE', headers: buyerHeaders })
        check('[icp] FU-589: remove collaborator (with a registered signer) -> 204', r.status === 204)

        {
          const { timestamp, signature } = signAsCollaborator('post_message', ['should be rejected now'])
          const err = await client!.postMessage(canisterWorkspaceId as string, 'should be rejected now', timestamp, signature).catch((e) => e)
          check(
            "[icp] FU-589: canister rejects the removed collaborator's signature after DELETE",
            err instanceof WorkspaceCanisterError && 'SignatureVerificationFailed' in err.canisterError,
            err,
          )
        }
      }

      // Tool allowlist: unlisted and non-https URLs rejected before any outcall.
      {
        const { timestamp, signature } = signBuyerAction('call_tool', canisterWorkspaceId as string, ['https://evil.example.com/', ''])
        const err = await client!.callTool(canisterWorkspaceId as string, 'https://evil.example.com/', null, timestamp, signature).catch((e) => e)
        check(
          '[icp] call_tool unlisted URL -> ToolNotAllowed',
          err instanceof WorkspaceCanisterError && 'ToolNotAllowed' in err.canisterError,
          err,
        )
      }

      // Approval gate: "!"-marked tool parks, approve_unknown -> ApprovalNotFound,
      // approve parked id executes (outcall boundary probed below).
      let pendingApprovalId: bigint | null = null
      {
        const url = 'https://api.anthropic.com/v1/models'
        const { timestamp, signature } = signBuyerAction('call_tool', canisterWorkspaceId as string, [url, ''])
        const outcome = await client!.callTool(canisterWorkspaceId as string, url, null, timestamp, signature)
        const parked = 'pendingApprovalId' in outcome ? outcome.pendingApprovalId : null
        check('[icp] call_tool "!"-marked tool -> PendingApproval(0)', parked === 0n, outcome)
        pendingApprovalId = parked

        const approveTs = signBuyerAction('approve_tool_call', canisterWorkspaceId as string, ['99'])
        const err = await client!.approveToolCall(canisterWorkspaceId as string, 99n, approveTs.timestamp, approveTs.signature).catch((e) => e)
        check(
          '[icp] approve unknown approval id -> ApprovalNotFound',
          err instanceof WorkspaceCanisterError && 'ApprovalNotFound' in err.canisterError,
          err,
        )
      }

      // Outcall boundary probe (empirical, no fake success): the LLM chat turn
      // and the approved tool call both end in an HTTPS outcall. Three honest
      // outcomes:
      //  - Ok: the replica performed the outcall and the provider answered 2xx
      //    (won't happen with the smoke's fake key) -> reply output recorded,
      //    cycles booked.
      //  - ProviderError(401): the outcall REACHED the provider and was
      //    rejected (expected with 'smoke-key-not-real') -> proves the whole
      //    path (DNS/TLS/consensus/transform/parsing) end to end.
      //  - OutcallFailed: the local replica does not support canister HTTP
      //    outcalls -> known local limitation, stated plainly.
      // Either way the accepted user message must be recorded as a signed
      // output and a failed outcall must NOT book cycles.
      let outcallReachedProvider = false
      let outcallUnsupported = false
      let outcallSucceeded = false
      {
        const { timestamp, signature } = signBuyerAction('post_message', canisterWorkspaceId as string, ['hello agent'])
        const result = await client!.postMessage(canisterWorkspaceId as string, 'hello agent', timestamp, signature).catch((e) => e)
        if (result instanceof WorkspaceCanisterError) {
          outcallReachedProvider = 'ProviderError' in result.canisterError
          outcallUnsupported = 'OutcallFailed' in result.canisterError
          check(
            '[icp] chat outcall ends at provider boundary (401) or local-replica limitation — not a fake success',
            outcallReachedProvider || outcallUnsupported,
            result.canisterError,
          )
          console.log(`  NOTE [icp] chat outcall outcome: ${canisterErrorName(result)}`)
        } else {
          check('[icp] chat turn executed end-to-end (real outcall, real reply)', result.outputType === 'chat', result)
          outcallReachedProvider = true
          outcallSucceeded = true
        }

        const outputs = await client!.getOutputs(canisterWorkspaceId as string)
        const userMessages = outputs.filter((o) => o.outputType === 'chat' && o.metadata.includes('"role":"user"'))
        // 3 accepted user turns by this point: "replay me" (replay-guard
        // test), "hello from collaborator" (FU-589 write-parity test, signed
        // by the collaborator's own key), "hello agent" (this block).
        check(
          '[icp] accepted user messages recorded as signed chat outputs',
          userMessages.length === 3 && userMessages.every((o) => o.signature?.length === 64),
          outputs.map((o) => [o.outputType, o.metadata, o.signature?.length]),
        )

        if (pendingApprovalId !== null) {
          const { timestamp, signature } = signBuyerAction('approve_tool_call', canisterWorkspaceId as string, [pendingApprovalId.toString()])
          const toolResult = await client!.approveToolCall(canisterWorkspaceId as string, pendingApprovalId, timestamp, signature).catch((e) => e)
          if (toolResult instanceof WorkspaceCanisterError) {
            check(
              '[icp] approved tool call ends at outcall boundary (no fake success)',
              'ProviderError' in toolResult.canisterError || 'OutcallFailed' in toolResult.canisterError,
              toolResult.canisterError,
            )
          } else {
            check('[icp] approved tool call executed end-to-end', toolResult.outputType === 'tool', toolResult)
            outcallReachedProvider = true
            outcallSucceeded = true
          }
        }

        const settled = await client!.checkWorkspaceStatus(canisterWorkspaceId as string)
        if (outcallReachedProvider) {
          console.log('  NOTE [icp] HTTPS outcalls work on this replica — provider boundary reached (2xx booking only on real success)')
        } else if (outcallUnsupported) {
          console.log('  NOTE [icp] local replica rejects canister HTTPS outcalls (OutcallFailed) — booking path covered by cargo tests instead')
        }
        // Booking is honest in both directions: no 2xx -> nothing booked;
        // a real 2xx -> cycles_used must have grown by the outcall cost.
        check(
          '[icp] cycle booking matches outcall success (0 on failure, >0 on success)',
          outcallSucceeded ? settled.cyclesUsed > 0n : settled.cyclesUsed === 0n,
          settled,
        )

        // ADR-322 D5: every output the canister recorded (chat/tool turns
        // above) must carry a 32-byte chain hash, and recomputing the whole
        // chain from those stored outputs (via the canister's own
        // verify_audit_chain, not a client-side reimplementation) must say
        // it's intact.
        check(
          '[icp] every recorded output carries a 32-byte audit chain_hash',
          outputs.length > 0 && outputs.every((o) => o.chainHash?.length === 32),
          outputs.map((o) => o.chainHash?.length),
        )
        const chainIntact = await client!.verifyAuditChain(canisterWorkspaceId as string)
        check('[icp] verifyAuditChain confirms the untouched chain is intact', chainIntact === true, chainIntact)
      }

      // ── FU-433: paid cycle reload (recharge → confirm → add_cycles relay) ──
      // Drive the workspace into SUSPENDED for real (usage beyond the 1e12
      // harness top-up above), then reload twice through the API: an
      // under-overshoot top-up must stay SUSPENDED, an over-overshoot one
      // must resume to RUNNING (canister apply_topup semantics, mirrored
      // into the server row). A double confirm must not double-credit.
      const suspended = await client!.recordCycleUsage(canisterWorkspaceId as string, 1_100_000_000_000n)
      check('[icp] record_cycle_usage beyond budget -> SUSPENDED', suspended.state === 'SUSPENDED', suspended)

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ amountSats: 5000 }),
      })
      body = await r.json()
      check('[icp] recharge 5000 sats -> 201 PENDING (DEMO rail)', r.status === 201 && body?.recharge?.rail === 'DEMO' && body?.recharge?.status === 'PENDING', body)
      const firstRechargeId = body?.recharge?.id as string

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge/${firstRechargeId}/confirm`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({}),
      })
      body = await r.json()
      check(
        '[icp] confirm under-overshoot top-up -> credited, stays SUSPENDED (mirrored)',
        r.status === 200 && body?.recharge?.status === 'PAID' && body?.recharge?.relayedAt !== null
          && body?.workspace?.cycleBudgetSats === 5000 && body?.workspace?.status === 'SUSPENDED',
        body,
      )
      const afterTopup1 = await client!.checkWorkspaceStatus(canisterWorkspaceId as string)
      check(
        '[icp] canister budget 1.005e12, still SUSPENDED',
        afterTopup1.cycleBudget === 1_005_000_000_000n && afterTopup1.state === 'SUSPENDED',
        afterTopup1,
      )

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ amountSats: 100_000 }),
      })
      body = await r.json()
      check('[icp] recharge 100000 sats -> 201 PENDING', r.status === 201 && body?.recharge?.status === 'PENDING', body)
      const secondRechargeId = body?.recharge?.id as string

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge/${secondRechargeId}/confirm`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({}),
      })
      body = await r.json()
      check(
        '[icp] confirm over-overshoot top-up -> resumes RUNNING (apply_topup)',
        r.status === 200 && body?.workspace?.status === 'RUNNING' && body?.workspace?.cycleBudgetSats === 105_000,
        body,
      )
      const afterTopup2 = await client!.checkWorkspaceStatus(canisterWorkspaceId as string)
      check(
        '[icp] canister budget 1.105e12, RUNNING again',
        afterTopup2.cycleBudget === 1_105_000_000_000n && afterTopup2.state === 'RUNNING',
        afterTopup2,
      )

      // Idempotency: re-confirming a PAID recharge skips both the credit and
      // the relay (relayedAt) — neither side may move.
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge/${secondRechargeId}/confirm`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({}),
      })
      body = await r.json()
      const afterDoubleConfirm = await client!.checkWorkspaceStatus(canisterWorkspaceId as string)
      check(
        '[icp] double confirm -> no double credit (server 105000 sats / canister 1.105e12 cycles)',
        r.status === 200 && body?.workspace?.cycleBudgetSats === 105_000 && afterDoubleConfirm.cycleBudget === 1_105_000_000_000n,
        { body, afterDoubleConfirm },
      )
    } else {
      console.log('  SKIP [icp] canister deploy checks (set ICP_SMOKE=1 + ICP_WORKSPACE_CANISTER_ID to enable)')
    }

    // ── Completion ─────────────────────────────────────────────────────
    if (!icpMode) {
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/complete`, { method: 'POST', headers: buyerHeaders })
      body = await r.json()
      check('complete while PENDING_DEPLOY -> 409 INVALID_TRANSITION', r.status === 409 && body?.error === 'INVALID_TRANSITION', body)

      // ── FU-433 recharge guards (base mode) ──
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountSats: 1000 }),
      })
      check('recharge without auth -> 401', r.status === 401)

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge`, {
        method: 'POST', headers: strangerHeaders, body: JSON.stringify({ amountSats: 1000 }),
      })
      check('recharge as stranger -> 403', r.status === 403)

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ amountSats: 0 }),
      })
      body = await r.json()
      check('recharge amountSats=0 -> 400 VALIDATION_ERROR', r.status === 400 && body?.error === 'VALIDATION_ERROR', body)

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ amountSats: 1000 }),
      })
      body = await r.json()
      check('recharge while PENDING_DEPLOY -> 409 INVALID_TRANSITION', r.status === 409 && body?.error === 'INVALID_TRANSITION', body)

      // Simulate the canister deploy (in ICP mode the D5 client already
      // flipped the row to RUNNING for real).
      await prisma.workspace.update({ where: { id: workspaceId }, data: { status: 'RUNNING', canisterId: 'smoke-canister-id', activatedAt: new Date() } })

      // FU-433 server-only recharge: DEMO rail (server runs BETA_MODE=true)
      // credits cycleBudgetSats and honestly skips the relay — this workspace
      // has no canisterWorkspaceId. A double confirm must not double-credit.
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ amountSats: 7000 }),
      })
      body = await r.json()
      check('recharge (RUNNING, DEMO rail) -> 201 PENDING', r.status === 201 && body?.recharge?.rail === 'DEMO' && body?.recharge?.status === 'PENDING', body)
      const rechargeId = body?.recharge?.id as string

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge/${rechargeId}/confirm`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({}),
      })
      body = await r.json()
      check(
        'confirm DEMO recharge -> credited 7000 sats, stays RUNNING, no relay',
        r.status === 200 && body?.recharge?.status === 'PAID' && body?.workspace?.cycleBudgetSats === 7000
          && body?.workspace?.status === 'RUNNING' && body?.recharge?.relayedAt === null,
        body,
      )

      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge/${rechargeId}/confirm`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({}),
      })
      body = await r.json()
      check('double confirm -> no double credit', r.status === 200 && body?.workspace?.cycleBudgetSats === 7000, body)
    }

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/complete`, { method: 'POST', headers: sellerHeaders })
    check('complete as seller -> 403', r.status === 403)

    const beforeComplete = Date.now()
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/complete`, { method: 'POST', headers: buyerHeaders })
    body = await r.json()
    check('complete as buyer (RUNNING) -> 200 COMPLETED', r.status === 200 && body?.workspace?.status === 'COMPLETED', body)
    const expiresAt = new Date(body?.workspace?.expiresAt ?? 0).getTime()
    check(
      `expiresAt ≈ now + agentWorkspaceTTL (${lifecycleTtlSeconds}s)`,
      expiresAt >= beforeComplete + lifecycleTtlSeconds * 1000 && expiresAt <= Date.now() + lifecycleTtlSeconds * 1000 + 5000,
      body?.workspace?.expiresAt,
    )

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/complete`, { method: 'POST', headers: buyerHeaders })
    check('double complete -> 409', r.status === 409)

    // FU-435 relay checks: completion and expiry must mirror canister-side.
    let icpClient: Awaited<ReturnType<typeof getWorkspaceCanisterClient>> = null
    if (icpMode) {
      icpClient = await getWorkspaceCanisterClient()
      const status = icpClient && canisterWorkspaceId ? await icpClient.checkWorkspaceStatus(canisterWorkspaceId) : null
      check('[icp] canister status mirrors COMPLETED (complete relay)', status?.state === 'COMPLETED', status)
    }

    // ── Expiry sweep ───────────────────────────────────────────────────
    if (icpMode) {
      // The canister-side expire is time-gated — wait out the 2s TTL instead
      // of backdating expiresAt (which the canister would honestly reject).
      await new Promise((resolve) => setTimeout(resolve, (lifecycleTtlSeconds + 2) * 1000))
    } else {
      await prisma.workspace.update({ where: { id: workspaceId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    }
    const swept = await runWorkspaceExpirySweep(prisma)
    const after = await prisma.workspace.findUnique({ where: { id: workspaceId } })
    check('expiry sweep flips COMPLETED -> EXPIRED', swept >= 1 && after?.status === 'EXPIRED', { swept, status: after?.status })

    if (icpMode) {
      const status = icpClient && canisterWorkspaceId ? await icpClient.checkWorkspaceStatus(canisterWorkspaceId) : null
      check('[icp] canister status mirrors EXPIRED (sweep relay)', status?.state === 'EXPIRED', status)
    }

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/complete`, { method: 'POST', headers: buyerHeaders })
    check('complete after EXPIRED -> 409 (terminal)', r.status === 409)
  } finally {
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
