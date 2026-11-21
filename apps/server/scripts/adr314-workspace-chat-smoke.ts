// ADR-314 (minimal chat slice) live smoke test: `signerPubkey` at workspace
// creation (Workspace.canisterBuyerPubkey) and `POST /api/workspaces/:id/messages`
// (the buyer-signed relay to the canister's post_message, FU-434 Slice C).
//
// Two modes, same convention as adr311-workspace-smoke.ts:
// - Default (no canister backend): the signerPubkey plumbing (defaulting,
//   explicit override, validation, WORKSPACE_EXISTS stability) is fully
//   testable server-side; the /:id/messages guard chain hits
//   WORKSPACE_NOT_RUNNING before ever reaching the canister (base-mode
//   workspaces never leave PENDING_DEPLOY).
// - ICP_SMOKE=1 + ICP_WORKSPACE_CANISTER_ID: a real signed chat round trip
//   against the local replica — CONFIG_NOT_INJECTED before injection,
//   SIGNATURE_INVALID for a wrong-key signature, a real post_message send
//   (outcome probed honestly: 201 real success or 502 provider-boundary
//   failure, not asserted to one fixed outcome — no real LLM key is
//   configured), REPLAY_REJECTED for a resent (timestamp, signature) pair,
//   and that the sent user message shows up via GET /:id/outputs regardless
//   of whether the LLM reply succeeded (the canister records the user turn
//   before attempting the outcall).
//
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr314-workspace-chat-smoke.ts
//   ICP_SMOKE=1 ICP_WORKSPACE_CANISTER_ID=$(cd packages/icp-workspace-canister && icp canister status icp_workspace_canister --id-only) ... (same, against a canister-configured server)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha2'
import { getWorkspaceCanisterClient } from '../services/workspace-canister-client.js'

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

  // "Login" keypair — what auth sessions use (mirrors a NIP-07/bunker pubkey
  // that CANNOT sign raw canister messages, hence the separate device key).
  const buyerSecretKey = generateSecretKey()
  const buyerPubkey = getPublicKey(buyerSecretKey)
  // "Device" keypair — the burner-equivalent key that DOES sign chat actions.
  const deviceSecretKey = generateSecretKey()
  const devicePubkey = getPublicKey(deviceSecretKey)
  const wrongSecretKey = generateSecretKey()

  const sellerSecretKey = generateSecretKey()
  const sellerPubkey = getPublicKey(sellerSecretKey)
  const strangerPubkey = randomBytes(32).toString('hex')
  const buyerToken = randomBytes(32).toString('hex')
  const sellerToken = randomBytes(32).toString('hex')
  const strangerToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: strangerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: sellerPubkey, k1: randomUUID(), token: sellerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: strangerPubkey, k1: randomUUID(), token: strangerToken, expiresAt: new Date(Date.now() + 3600_000) } })

  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-314-agent', capabilities: ['research'], tools: [], isPublic: true },
  })
  async function makeAgentOffer(title: string) {
    return prisma.offer.create({
      data: {
        title, priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
        creatorPubkey: sellerPubkey, agentProfileId: agentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
        agentWorkspaceTTL: 3600,
      },
    })
  }
  async function makeTicket(offerId: string, status: 'PAID' | 'PENDING' = 'PAID') {
    return prisma.ticket.create({ data: { offerId, offerType: 'AGENT_SETUP', buyerPubkey, sellerPubkey, status } })
  }

  const buyerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }
  const sellerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerToken}` }
  const strangerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${strangerToken}` }

  // Mirrors packages/icp-workspace-canister/src/sig.rs exactly.
  let actionTimestamp = BigInt(Date.now()) * 1_000_000n
  function signAction(action: string, canisterWorkspaceId: string, secretKey: Uint8Array, params: string[]) {
    actionTimestamp += 1n
    const message = `colabonate-workspace-v1:${action}:${canisterWorkspaceId}:${actionTimestamp}${params.map((p) => `:${p}`).join('')}`
    const signature = schnorr.sign(sha256(new TextEncoder().encode(message)), secretKey)
    return { timestamp: actionTimestamp.toString(), signature: Buffer.from(signature).toString('hex') }
  }

  try {
    // ── A: default signerPubkey (falls back to callerPubkey/buyerPubkey) ──
    const offerA = await makeAgentOffer('ADR-314 Smoke Offer A')
    const ticketA = await makeTicket(offerA.id)
    let r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: ticketA.id }),
    })
    let body = await r.json()
    check('create without signerPubkey -> canisterBuyerPubkey defaults to buyerPubkey', r.status === 201 && body?.workspace?.canisterBuyerPubkey === buyerPubkey, body?.workspace)

    // WORKSPACE_EXISTS must not let a second call rotate the signer.
    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: ticketA.id, signerPubkey: devicePubkey }),
    })
    body = await r.json()
    check('duplicate create with a different signerPubkey -> 409, original signer unchanged', r.status === 409 && body?.workspace?.canisterBuyerPubkey === buyerPubkey, body?.workspace)

    // ── B: explicit signerPubkey (the realistic device-key flow) ──
    const offerB = await makeAgentOffer('ADR-314 Smoke Offer B')
    const ticketB = await makeTicket(offerB.id)

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: ticketB.id, signerPubkey: 'not-hex' }),
    })
    body = await r.json()
    check('create with malformed signerPubkey -> 400', r.status === 400 && body?.error === 'VALIDATION_ERROR', body)

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: ticketB.id, signerPubkey: devicePubkey }),
    })
    body = await r.json()
    check('create with explicit signerPubkey -> canisterBuyerPubkey === signerPubkey', r.status === 201 && body?.workspace?.canisterBuyerPubkey === devicePubkey, body?.workspace)
    const workspaceBId = body?.workspace?.id as string
    const canisterWorkspaceId = body?.workspace?.canisterWorkspaceId as string | undefined

    // ── /:id/messages guard chain (both modes) ──
    const wellFormed = signAction('post_message', canisterWorkspaceId ?? 'n/a', deviceSecretKey, ['hi'])

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'hi', ...wellFormed }),
    })
    check('send without auth -> 401', r.status === 401)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
      method: 'POST', headers: strangerHeaders, body: JSON.stringify({ content: 'hi', ...wellFormed }),
    })
    check('send as stranger -> 403', r.status === 403)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
      method: 'POST', headers: sellerHeaders, body: JSON.stringify({ content: 'hi', ...wellFormed }),
    })
    check('send as ticket seller (not buyer) -> 403', r.status === 403)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: '', ...wellFormed }),
    })
    body = await r.json()
    check('send empty content -> 400 VALIDATION_ERROR', r.status === 400 && body?.error === 'VALIDATION_ERROR', body)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'a'.repeat(4001), ...wellFormed }),
    })
    body = await r.json()
    check('send oversized content -> 400 VALIDATION_ERROR', r.status === 400 && body?.error === 'VALIDATION_ERROR', body)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'hi', timestamp: 'not-a-number', signature: wellFormed.signature }),
    })
    body = await r.json()
    check('send malformed timestamp -> 400 VALIDATION_ERROR', r.status === 400 && body?.error === 'VALIDATION_ERROR', body)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'hi', timestamp: wellFormed.timestamp, signature: 'zz' }),
    })
    body = await r.json()
    check('send malformed signature -> 400 VALIDATION_ERROR', r.status === 400 && body?.error === 'VALIDATION_ERROR', body)

    r = await fetch(`${BASE_URL}/api/workspaces/nonexistent-id/messages`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'hi', ...wellFormed }),
    })
    check('send to missing workspace -> 404', r.status === 404)

    if (!icpMode) {
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'hi', ...wellFormed }),
      })
      body = await r.json()
      check('send while PENDING_DEPLOY (no canister) -> 409 WORKSPACE_NOT_RUNNING', r.status === 409 && body?.error === 'WORKSPACE_NOT_RUNNING', body)
      console.log('  SKIP [icp] real chat round trip (set ICP_SMOKE=1 + ICP_WORKSPACE_CANISTER_ID to enable)')
    } else {
      check('[icp] workspace B deployed RUNNING with a canisterWorkspaceId', Boolean(canisterWorkspaceId), { canisterWorkspaceId })

      // CONFIG_NOT_INJECTED: before the seller injects, a well-formed signed
      // send must fail honestly, not silently no-op.
      const beforeInject = signAction('post_message', canisterWorkspaceId as string, deviceSecretKey, ['too early'])
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'too early', ...beforeInject }),
      })
      body = await r.json()
      check('[icp] send before config injected -> 409 CONFIG_NOT_INJECTED', r.status === 409 && body?.error === 'CONFIG_NOT_INJECTED', body)

      // ── Inject config (seller), mirrors adr311 smoke's FU-353 flow ──
      const client = await getWorkspaceCanisterClient()
      const outputPubkey = client ? await client.ensureOutputKey() : ''
      const configJson = JSON.stringify({
        llm_provider: 'openai', llm_model: 'gpt-smoke', llm_api_key: 'smoke-key-not-real',
        llm_base_url: null, system_prompt: 'smoke', tools: [],
      })
      const conversationKey = nip44.v2.utils.getConversationKey(sellerSecretKey, outputPubkey)
      const ciphertext = nip44.v2.encrypt(configJson, conversationKey)
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/inject-config`, {
        method: 'POST', headers: sellerHeaders, body: JSON.stringify({ senderPubkey: sellerPubkey, ciphertext }),
      })
      check('[icp] inject config as seller -> 200', r.status === 200, await r.clone().json().catch(() => null))

      // Cycle budget for the outcall attempt below (FU-433's paid flow tops
      // up via recharge; the smoke goes direct like adr311's does).
      await client!.addCycles(canisterWorkspaceId as string, 1_000_000_000_000n)

      // SIGNATURE_INVALID: well-formed shape, wrong key.
      const wrongKeySigned = signAction('post_message', canisterWorkspaceId as string, wrongSecretKey, ['forged'])
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'forged', ...wrongKeySigned }),
      })
      body = await r.json()
      check('[icp] send signed by the wrong key -> 401 SIGNATURE_INVALID', r.status === 401 && body?.error === 'SIGNATURE_INVALID', body)

      // Real send — honest outcome probe, no fake success (mirrors adr311).
      const realSend = signAction('post_message', canisterWorkspaceId as string, deviceSecretKey, ['hello agent'])
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'hello agent', ...realSend }),
      })
      body = await r.json()
      const sendOk = r.status === 201 && body?.output?.outputType === 'chat'
      const sendProviderBoundary = r.status === 502 && body?.error === 'LLM_PROVIDER_ERROR'
      check('[icp] real send -> 201 (real reply) or 502 (provider boundary) — not a fake success', sendOk || sendProviderBoundary, body)
      console.log(`  NOTE [icp] chat send outcome: ${r.status} ${body?.error ?? 'OK'}`)

      // REPLAY_REJECTED: resending the identical signed payload.
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/messages`, {
        method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'hello agent', ...realSend }),
      })
      body = await r.json()
      check('[icp] resending the identical (timestamp, signature) -> 409 REPLAY_REJECTED', r.status === 409 && body?.error === 'REPLAY_REJECTED', body)

      // The user turn must be recorded regardless of whether the LLM reply
      // succeeded (the canister records it before attempting the outcall).
      r = await fetch(`${BASE_URL}/api/workspaces/${workspaceBId}/outputs`, { headers: buyerHeaders })
      body = await r.json()
      const userChatOutputs = (body?.outputs ?? []).filter((o: { outputType: string; metadata: string }) =>
        o.outputType === 'chat' && o.metadata.includes('"role":"user"') && o.metadata.includes('hello agent'))
      check('[icp] sent user message recorded in GET /:id/outputs', userChatOutputs.length === 1, body?.outputs)
    }
  } finally {
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
