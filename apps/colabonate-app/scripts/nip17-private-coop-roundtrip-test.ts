/**
 * NIP-17 Private-Cooperation Round-Trip Test (ADR-157 / Plan Phase 3.2–3.4)
 *
 * Verifies that the PRIVATE cooperation payloads produced by
 * `lib/nostr-ticket.ts` (sendPrivateCooperationProposal / sendPrivateMilestone)
 * survive the full NIP-17 path end-to-end:
 *   rumor (Kind 14, NIP-44 encrypted JSON) → seal → gift wrap → unwrap →
 *   decrypt → JSON.parse, with the NIP-C tag set intact.
 *
 * Covers:
 *   1. Cooperation proposal: initiator → partner, payload + nip_c 30414 tags
 *   2. Cooperation acceptance: partner → initiator
 *   3. Milestone (Phase 3.3): t=colabonate-milestone marker + nip_c 30415 tags
 *   4. Multi-party (Phase 3.4): a milestone addressed to a SPECIFIC
 *      per-milestone partner is decryptable ONLY by that partner — a
 *      different partner cannot read it.
 *
 * Mirrors nip17-roundtrip-test.ts (inline gift-wrap with nostr-tools, no
 * browser deps). The inline payload shape is the contract that
 * sendPrivateCooperationProposal / sendPrivateMilestone emit.
 *
 * Run with:  npx tsx apps/colabonate-app/scripts/nip17-private-coop-roundtrip-test.ts
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import * as nip59 from 'nostr-tools/nip59'

let count = 0
function assertTrue(cond: boolean, label: string) {
  count++
  if (!cond) throw new Error(`✗ ${label}`)
  console.log(`✓ ${label}`)
}
function assertEqual<T>(actual: T, expected: T, label: string) {
  count++
  if (actual !== expected) throw new Error(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  console.log(`✓ ${label}`)
}

// ── Inline payload builders (contract mirror of lib/nostr-ticket.ts) ─────────

function buildCooperationProposalTags(p: {
  cooperationId: string; type: 'proposal' | 'acceptance'; initiatorPubkey: string;
  partnerPubkey: string; title: string; budgetSats: number; status: string;
}): string[][] {
  return [
    ['d', p.cooperationId],
    ['type', p.type],
    ['cooperation', p.cooperationId],
    ['initiator', p.initiatorPubkey],
    ['partner', p.partnerPubkey],
    ['p', p.type === 'proposal' ? p.partnerPubkey : p.initiatorPubkey],
    ['title', p.title],
    ['budget', p.budgetSats.toString(), 'sats'],
    ['status', p.status],
    ['ticket_type', 'cooperation'],
  ]
}

function buildMilestoneTags(p: {
  cooperationId: string; milestoneId: string; milestoneIndex: number;
  initiatorPubkey: string; partnerPubkey: string; title: string; status: string; amountSats: number;
}): string[][] {
  return [
    ['d', `${p.cooperationId}-${p.milestoneIndex}`],
    ['cooperation', p.cooperationId],
    ['milestone', p.milestoneId],
    ['milestone_index', p.milestoneIndex.toString()],
    ['initiator', p.initiatorPubkey],
    ['partner', p.partnerPubkey],
    ['p', p.status === 'COMPLETED' ? p.initiatorPubkey : p.partnerPubkey],
    ['title', p.title],
    ['status', p.status],
    ['amount', p.amountSats.toString(), 'sats'],
  ]
}

// ── NIP-17 gift-wrap helpers (inline, like nip17-roundtrip-test.ts) ──────────

function giftWrapTo(senderSk: Uint8Array, recipientPub: string, payload: string, tags: string[][]): ReturnType<typeof nip59.createWrap> {
  const senderPub = getPublicKey(senderSk)
  const convKey = nip44.getConversationKey(senderSk, recipientPub)
  const encrypted = nip44.v2.encrypt(payload, convKey)
  const rumor = nip59.createRumor(
    { kind: 14, pubkey: senderPub, created_at: Math.floor(Date.now() / 1000), tags, content: encrypted },
    senderSk,
  )
  const seal = nip59.createSeal(rumor, senderSk, recipientPub)
  return nip59.createWrap(seal, recipientPub)
}

/** Unwrap + decrypt on the recipient side. Returns the JSON payload object. */
function unwrapAs(recipientSk: Uint8Array, giftWrap: { id: string; kind: number; tags: string[][]; content: string; pubkey: string; created_at: number; sig: string }) {
  const rumor = nip59.unwrapEvent(giftWrap as never, recipientSk)
  const convKey = nip44.getConversationKey(recipientSk, rumor.pubkey)
  const decrypted = nip44.v2.decrypt(rumor.content, convKey)
  return JSON.parse(decrypted)
}

async function main() {
  console.log('=== NIP-17 Private-Cooperation Round-Trip Test ===\n')

  const initiatorSk = generateSecretKey(); const initiator = getPublicKey(initiatorSk)
  const p1Sk = generateSecretKey(); const partner1 = getPublicKey(p1Sk)
  const p2Sk = generateSecretKey(); const partner2 = getPublicKey(p2Sk)
  const p3Sk = generateSecretKey(); const partner3 = getPublicKey(p3Sk)
  const coopId = 'coop-rt-1'
  console.log(`Initiator: ${initiator.slice(0, 12)}…  P1: ${partner1.slice(0, 12)}…  P2: ${partner2.slice(0, 12)}…  P3: ${partner3.slice(0, 12)}…\n`)

  // ── 1. Cooperation proposal: initiator → partner1 ──────────────────────────
  console.log('1) Cooperation proposal (initiator → partner1)…')
  {
    const tags = buildCooperationProposalTags({ cooperationId: coopId, type: 'proposal', initiatorPubkey: initiator, partnerPubkey: partner1, title: 'Logo Redesign', budgetSats: 50000, status: 'OPEN' })
    const payload = JSON.stringify({ type: 'cooperation_proposal', subType: 'proposal', cooperationId: coopId, title: 'Logo Redesign', budgetSats: 50000, initiatorPubkey: initiator, partnerPubkey: partner1, nip_c: { kind: 30414, tags, content: '' }, timestamp: 1 })
    const gw = giftWrapTo(initiatorSk, partner1, payload, [['p', partner1], ['ticket_id', coopId]])
    const got = unwrapAs(p1Sk, gw as never)
    assertEqual(got.type, 'cooperation_proposal', 'partner1 decrypts proposal payload')
    assertEqual(got.cooperationId, coopId, 'proposal cooperationId intact')
    assertEqual(got.nip_c.kind, 30414, 'nip_c kind = 30414')
    assertTrue(got.nip_c.tags.some((t: string[]) => t[0] === 'type' && t[1] === 'proposal'), 'nip_c type=proposal tag intact')
    assertTrue(got.nip_c.tags.some((t: string[]) => t[0] === 'partner' && t[1] === partner1), 'nip_c partner tag = partner1')
  }
  console.log()

  // ── 2. Cooperation acceptance: partner1 → initiator ────────────────────────
  console.log('2) Cooperation acceptance (partner1 → initiator)…')
  {
    const tags = buildCooperationProposalTags({ cooperationId: coopId, type: 'acceptance', initiatorPubkey: initiator, partnerPubkey: partner1, title: 'Logo Redesign', budgetSats: 50000, status: 'ACCEPTED' })
    const payload = JSON.stringify({ type: 'cooperation_proposal', subType: 'acceptance', cooperationId: coopId, nip_c: { kind: 30414, tags, content: '' } })
    const gw = giftWrapTo(p1Sk, initiator, payload, [['p', initiator], ['ticket_id', coopId]])
    const got = unwrapAs(initiatorSk, gw as never)
    assertEqual(got.subType, 'acceptance', 'initiator decrypts acceptance payload')
    assertTrue(got.nip_c.tags.some((t: string[]) => t[0] === 'p' && t[1] === initiator), 'acceptance p-tag points to initiator')
  }
  console.log()

  // ── 3. Milestone (3.3): initiator → partner1 (release), t=colabonate-milestone
  console.log('3) Milestone release (initiator → partner1, t=colabonate-milestone)…')
  {
    const tags = buildMilestoneTags({ cooperationId: coopId, milestoneId: 'ms-1', milestoneIndex: 1, initiatorPubkey: initiator, partnerPubkey: partner1, title: 'Phase 1', status: 'ACCEPTED', amountSats: 25000 })
    const payload = JSON.stringify({ type: 'milestone', t: 'colabonate-milestone', cooperationId: coopId, milestoneId: 'ms-1', milestoneIndex: 1, status: 'ACCEPTED', amountSats: 25000, released: true, nip_c: { kind: 30415, tags, content: '' } })
    const gw = giftWrapTo(initiatorSk, partner1, payload, [['p', partner1], ['ticket_id', coopId]])
    const got = unwrapAs(p1Sk, gw as never)
    assertEqual(got.t, 'colabonate-milestone', 'milestone carries t=colabonate-milestone marker')
    assertEqual(got.nip_c.kind, 30415, 'nip_c kind = 30415')
    assertEqual(got.milestoneIndex, 1, 'milestone index intact')
  }
  console.log()

  // ── 4. Multi-party (3.4): milestone #2 assigned to partner2 ─────────────────
  console.log('4) Multi-party: milestone #2 → partner2 (NOT partner1/partner3)…')
  {
    const tags = buildMilestoneTags({ cooperationId: coopId, milestoneId: 'ms-2', milestoneIndex: 2, initiatorPubkey: initiator, partnerPubkey: partner2, title: 'Phase 2', status: 'ACCEPTED', amountSats: 25000 })
    const payload = JSON.stringify({ type: 'milestone', t: 'colabonate-milestone', cooperationId: coopId, milestoneId: 'ms-2', milestoneIndex: 2, status: 'ACCEPTED', amountSats: 25000, released: true, nip_c: { kind: 30415, tags, content: '' } })
    const gw = giftWrapTo(initiatorSk, partner2, payload, [['p', partner2], ['ticket_id', coopId]])

    // partner2 (the milestone's assigned partner) CAN read it
    const got = unwrapAs(p2Sk, gw as never)
    assertTrue(got.nip_c.tags.some((t: string[]) => t[0] === 'partner' && t[1] === partner2), 'milestone#2 nip_c partner = partner2')
    assertEqual(got.milestoneId, 'ms-2', 'partner2 reads milestone#2 payload')

    // partner3 (a different partner) CANNOT read it — unwrap must fail
    let p3Failed = false
    try { unwrapAs(p3Sk, gw as never) } catch { p3Failed = true }
    assertTrue(p3Failed, 'partner3 CANNOT decrypt milestone#2 (addressed to partner2 only)')

    // partner1 likewise cannot read partner2's milestone
    let p1Failed = false
    try { unwrapAs(p1Sk, gw as never) } catch { p1Failed = true }
    assertTrue(p1Failed, 'partner1 CANNOT decrypt milestone#2 (per-milestone isolation)')
  }
  console.log()

  console.log(`\n✅ All ${count} private-cooperation round-trip assertions passed.`)
}

main().catch(err => {
  console.error('\n❌ Private-cooperation round-trip test failed:', err)
  process.exitCode = 1
})
