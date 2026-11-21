// ADR-321 (D1/D2/D3/D6/D7 slice) live smoke test: embedding-based workspace
// context indexing + RAG retrieval, and the `search_context` introspection
// entry point. D4 (chat protocol) and D5 (API-key routing) are out of scope
// here — D4 was already satisfied by ADR-311/FU-434 before this ADR even
// started (see this ADR's header), D5 is tracked separately as FU-454.
//
// Canister-only feature: `post_message`'s RAG retrieval + indexing, and the
// new `search_context` method, are entirely internal to
// packages/icp-workspace-canister — no new server route exists (there's no
// buyer-facing UI consumer yet, see the ADR's Implementation Record). That
// means, unlike every other adrNNN-*-smoke.ts in this family, there is
// nothing new to test in base (no-canister) mode — this smoke is ICP-mode
// only, run against a canister-configured server.
//
// What's verified against the real local replica (honest, no fake success):
// - search_context requires an injected config (ConfigNotInjected).
// - an `anthropic`-provider workspace degrades to an empty result
//   deterministically (no native embedding endpoint — build_embedding_request
//   fails locally, before any outcall; no network flakiness in this check).
// - an `openai`-provider workspace with a fake key degrades to an empty
//   result over a REAL failed outcall (network-dependent — the local dfx
//   replica reaches the real internet and gets a clean 401, same empirical
//   finding as FU-434/FU-434-Slice-C's smokes).
// - `post_message` on that same fake-key workspace still returns an honest
//   outcome (success or provider-boundary error) — a regression guard that
//   the new retrieval/indexing steps don't break or hang the existing chat
//   flow — and the user turn is still recorded in outputs regardless.
// - nothing gets indexed when embedding never succeeds (no fabricated
//   chunks): `search_context` after that failed post_message is still empty.
//
// A full real-RAG round trip (a workspace whose retrieved context visibly
// changes the LLM's reply) needs a real embeddings-capable API key — not
// verified here, same class of honest gap as every LLM-touching smoke in
// this session's history (adr311/adr314's own "no real key configured").
//
// Run with:
//   icp network running locally (ADR-346), server started with ICP_WORKSPACE_CANISTER_ID set.
//   ICP_SMOKE=1 ICP_WORKSPACE_CANISTER_ID=$(cd packages/icp-workspace-canister && icp canister status icp_workspace_canister --id-only) \
//     DATABASE_URL=... BASE_URL=http://localhost:4099 npx tsx apps/server/scripts/adr321-context-indexing-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha2'
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
  if (!icpMode) {
    console.log('  SKIP entire smoke — ADR-321 D1-D3/D6/D7 is canister-only, no server route to test in base mode.')
    console.log('  Set ICP_SMOKE=1 + ICP_WORKSPACE_CANISTER_ID to run it.')
    process.exit(0)
  }

  const buyerSecretKey = generateSecretKey()
  const buyerPubkey = getPublicKey(buyerSecretKey)
  const deviceSecretKey = generateSecretKey()
  const devicePubkey = getPublicKey(deviceSecretKey)
  const sellerSecretKey = generateSecretKey()
  const sellerPubkey = getPublicKey(sellerSecretKey)
  const buyerToken = randomBytes(32).toString('hex')
  const sellerToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: sellerPubkey, k1: randomUUID(), token: sellerToken, expiresAt: new Date(Date.now() + 3600_000) } })

  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-321-agent', capabilities: ['research'], tools: [], isPublic: true },
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
  async function makeTicket(offerId: string) {
    return prisma.ticket.create({ data: { offerId, offerType: 'AGENT_SETUP', buyerPubkey, sellerPubkey, status: 'PAID' } })
  }
  const buyerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }
  const sellerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerToken}` }

  async function deployWorkspace(title: string): Promise<{ workspaceId: string; canisterWorkspaceId: string }> {
    const offer = await makeAgentOffer(title)
    const ticket = await makeTicket(offer.id)
    const r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: ticket.id, signerPubkey: devicePubkey }),
    })
    const body = await r.json()
    if (r.status !== 201 || !body?.workspace?.canisterWorkspaceId) {
      throw new Error(`workspace deploy failed for "${title}": ${r.status} ${JSON.stringify(body)}`)
    }
    return { workspaceId: body.workspace.id as string, canisterWorkspaceId: body.workspace.canisterWorkspaceId as string }
  }

  async function injectConfig(workspaceId: string, outputPubkey: string, configJson: string) {
    const conversationKey = nip44.v2.utils.getConversationKey(sellerSecretKey, outputPubkey)
    const ciphertext = nip44.v2.encrypt(configJson, conversationKey)
    const r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/inject-config`, {
      method: 'POST', headers: sellerHeaders, body: JSON.stringify({ senderPubkey: sellerPubkey, ciphertext }),
    })
    return r.status
  }

  let actionTimestamp = BigInt(Date.now()) * 1_000_000n
  function signAction(action: string, canisterWorkspaceId: string, secretKey: Uint8Array, params: string[]) {
    actionTimestamp += 1n
    const message = `colabonate-workspace-v1:${action}:${canisterWorkspaceId}:${actionTimestamp}${params.map((p) => `:${p}`).join('')}`
    const signature = schnorr.sign(sha256(new TextEncoder().encode(message)), secretKey)
    return { timestamp: actionTimestamp.toString(), signature: Buffer.from(signature).toString('hex') }
  }

  try {
    const client = await getWorkspaceCanisterClient()
    if (!client) throw new Error('ICP_WORKSPACE_CANISTER_ID set but getWorkspaceCanisterClient() returned null')
    const outputPubkey = await client.ensureOutputKey()

    // ── A: search_context before config injection ──
    const wsA = await deployWorkspace('ADR-321 Smoke Workspace A (pre-config)')
    let threw: unknown = null
    try {
      await client.searchContext(wsA.canisterWorkspaceId, 'anything', 5)
    } catch (e) { threw = e }
    check(
      '[icp] search_context before config injected -> ConfigNotInjected',
      threw instanceof WorkspaceCanisterError && /ConfigNotInjected/.test(threw.message),
      threw,
    )

    // ── B: anthropic provider — deterministic, no network (no embedding endpoint) ──
    const wsB = await deployWorkspace('ADR-321 Smoke Workspace B (anthropic)')
    const anthropicConfig = JSON.stringify({
      llm_provider: 'anthropic', llm_model: 'claude-smoke', llm_api_key: 'smoke-key-not-real',
      llm_base_url: null, system_prompt: 'smoke', tools: [],
    })
    check('[icp] inject anthropic config -> 200', (await injectConfig(wsB.workspaceId, outputPubkey, anthropicConfig)) === 200)
    const anthropicResults = await client.searchContext(wsB.canisterWorkspaceId, 'anything', 5)
    check('[icp] search_context on anthropic-provider workspace -> [] (no embedding endpoint, no network needed)', anthropicResults.length === 0, anthropicResults)

    // ── C/D/E: openai provider with a fake key — real network 401, graceful degrade ──
    const wsC = await deployWorkspace('ADR-321 Smoke Workspace C (openai fake key)')
    const openaiConfig = JSON.stringify({
      llm_provider: 'openai', llm_model: 'gpt-smoke', llm_api_key: 'smoke-key-not-real',
      llm_base_url: null, system_prompt: 'smoke', tools: [],
    })
    check('[icp] inject openai config -> 200', (await injectConfig(wsC.workspaceId, outputPubkey, openaiConfig)) === 200)
    await client.addCycles(wsC.canisterWorkspaceId, 1_000_000_000_000n)

    const openaiResultsBeforeChat = await client.searchContext(wsC.canisterWorkspaceId, 'anything', 5)
    check('[icp] search_context on openai-fake-key workspace before any chat -> [] (real 401, gracefully swallowed)', openaiResultsBeforeChat.length === 0, openaiResultsBeforeChat)

    const realSend = signAction('post_message', wsC.canisterWorkspaceId, deviceSecretKey, ['hello agent, remember this fact'])
    const sendResp = await fetch(`${BASE_URL}/api/workspaces/${wsC.workspaceId}/messages`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ content: 'hello agent, remember this fact', ...realSend }),
    })
    const sendBody = await sendResp.json()
    const sendOk = sendResp.status === 201 && sendBody?.output?.outputType === 'chat'
    const sendProviderBoundary = sendResp.status === 502 && sendBody?.error === 'LLM_PROVIDER_ERROR'
    check('[icp] post_message with RAG+indexing wiring still returns an honest outcome (201 or 502), not a hang/crash', sendOk || sendProviderBoundary, sendBody)
    console.log(`  NOTE [icp] chat send outcome: ${sendResp.status} ${sendBody?.error ?? 'OK'}`)

    const outputsResp = await fetch(`${BASE_URL}/api/workspaces/${wsC.workspaceId}/outputs`, { headers: buyerHeaders })
    const outputsBody = await outputsResp.json()
    const userChatOutputs = (outputsBody?.outputs ?? []).filter((o: { outputType: string; metadata: string }) =>
      o.outputType === 'chat' && o.metadata.includes('"role":"user"') && o.metadata.includes('remember this fact'))
    check('[icp] user turn still recorded in outputs regardless of embed/LLM outcome (D7 unaffected)', userChatOutputs.length === 1, outputsBody?.outputs)

    const openaiResultsAfterChat = await client.searchContext(wsC.canisterWorkspaceId, 'remember this fact', 5)
    check('[icp] search_context after a failed embed/chat still -> [] (nothing fabricated, D1 indexing genuinely no-opped)', openaiResultsAfterChat.length === 0, openaiResultsAfterChat)
  } finally {
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
