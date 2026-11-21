/**
 * Nostr-Buyer → Ticket-Create Live Smoke Test
 *
 * Reproduces the user's reported failure: after Nostr login, placing
 * an order from a demo offer fails at POST /api/tickets.
 *
 * Captures the exact server response (status + body) so we can see
 * the real error reason, not just "Failed to create ticket".
 *
 * ADR-179 — three runs:
 *   Run 1: Nostr login, NO wallet bootstrap → expect 400 WALLET_REQUIRED
 *   Run 2: Nostr login + POST /api/wallet/create (simulating TabNostr bootstrap) → expect 200
 *   Run 3: Lightspark / NWC path — the 502 PAYMENT_UPSTREAM_ERROR surfaces
 *          the upstream error message intact (verified via unit test; live
 *          verification skipped when LNBits is healthy).
 *
 * Run: scripts/run-nostr-ticket-smoke.cmd
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

interface VerifyResponse { token: string; pubkey: string }

async function loginAsFreshNostrUser(): Promise<{ sk: Uint8Array; pubkey: string; token: string }> {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const cRes = await fetch(`${BASE}/api/auth/nostr/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedPubkey: pubkey }),
  })
  const challenge = await cRes.json() as { nonce: string }
  const event = finalizeEvent(
    { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['challenge', challenge.nonce]], content: '' },
    sk,
  )
  const vRes = await fetch(`${BASE}/api/auth/nostr/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  })
  const verify = await vRes.json() as VerifyResponse
  return { sk, pubkey, token: verify.token }
}

async function cleanupUser(pubkey: string): Promise<void> {
  await prisma.wallet.deleteMany({ where: { user: { pubkey } } }).catch(() => {})
  await prisma.session.deleteMany({ where: { pubkey } })
  await prisma.user.delete({ where: { pubkey } }).catch(() => {})
  const challenges = await prisma.nostrAuthChallenge.findMany({ where: { issuedFor: pubkey } })
  for (const c of challenges) await prisma.nostrAuthChallenge.delete({ where: { nonce: c.nonce } }).catch(() => {})
}

async function main() {
  console.log('Nostr-Buyer Ticket-Create Live Smoke Test')
  console.log('=========================================\n')

  // --- 1. Find a PUBLIC demo offer
  const offer = await prisma.offer.findFirst({
    where: { id: '7b1498d9-bdc6-44f5-acdc-638a9904f4aa' },
  }) ?? await prisma.offer.findFirst({
    where: { status: 'ACTIVE', visibility: 'PUBLIC' },
    orderBy: { createdAt: 'desc' },
  })
  if (!offer) {
    console.log('   ✗ No demo offer found; abort.')
    process.exit(1)
  }
  console.log(`   ✓ Using offer ${offer.id} "${offer.title}" (priceSats=${offer.priceSats}, lightningSubWalletAdminKey=${offer.lightningSubWalletAdminKey ? 'set' : 'NULL'})`)
  console.log(`     creatorPubkey=${offer.creatorPubkey.slice(0, 16)}…`)

  // ===========================================================
  // Run 1 — Nostr login, NO Wallet bootstrap → expect 400 WALLET_REQUIRED
  // ===========================================================
  console.log('\n--- Run 1: Nostr login, no Wallet → expect 400 WALLET_REQUIRED ---')
  const r1 = await loginAsFreshNostrUser()
  console.log(`   pubkey=${r1.pubkey.slice(0, 16)}…`)
  const r1Res = await fetch(`${BASE}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r1.token}` },
    body: JSON.stringify({ offerId: offer.id, visibility: 0 }),
  })
  const r1Body = await r1Res.json().catch(() => ({}))
  console.log(`   HTTP ${r1Res.status}  code=${r1Body.code}  body=${JSON.stringify(r1Body).slice(0, 200)}`)
  const r1Pass = r1Res.status === 400 && r1Body.code === 'WALLET_REQUIRED'
  console.log(`   ${r1Pass ? '✓' : '✗'} Run 1: ${r1Pass ? 'PASS' : 'FAIL — expected 400 WALLET_REQUIRED'}`)
  await cleanupUser(r1.pubkey)

  // ===========================================================
  // Run 2 — Nostr login + Wallet bootstrap (simulates TabNostr Fix B)
  //          → expect 200 OR 502 PAYMENT_UPSTREAM_ERROR (LNBits may be empty)
  // ===========================================================
  console.log('\n--- Run 2: Nostr login + Wallet bootstrap → expect 200 or 502 ---')
  const r2 = await loginAsFreshNostrUser()
  console.log(`   pubkey=${r2.pubkey.slice(0, 16)}…`)
  // Simulate TabNostr's auto-bootstrap call:
  // ADR-182 Fix A: /api/wallet now requires auth — send the Bearer token.
  const walletRes = await fetch(`${BASE}/api/wallet/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2.token}` },
    body: JSON.stringify({ pubkey: r2.pubkey }),
  })
  console.log(`   bootstrap wallet → HTTP ${walletRes.status}`)
  const r2Res = await fetch(`${BASE}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r2.token}` },
    body: JSON.stringify({
      offerId: offer.id,
      buyerPubkey: r2.pubkey,
      sellerPubkey: offer.creatorPubkey,
      deliveryAddress: 'Teststraße 1, 10115 Berlin, DE',
      deliveryTimeDays: offer.deliveryTimeDays ?? 7,
      deliveryCostSats: offer.deliveryCostSats ?? 0,
      deliveryNotes: 'Nostr-only buyer live-smoke test (post ADR-179 fix)',
      visibility: 0,
    }),
  })
  const r2Body = await r2Res.json().catch(() => ({}))
  console.log(`   HTTP ${r2Res.status}  code=${r2Body.code ?? '-'}  body=${JSON.stringify(r2Body).slice(0, 300)}`)
  // Pass criteria: 200 (full success) or 502 PAYMENT_UPSTREAM_ERROR (regtest LNBits
  // has no funds — Fix A correctly classifies this). 400 WALLET_REQUIRED is a fail.
  const r2Pass = r2Res.status === 200 || (r2Res.status === 502 && r2Body.code === 'PAYMENT_UPSTREAM_ERROR')
  console.log(`   ${r2Pass ? '✓' : '✗'} Run 2: ${r2Pass ? 'PASS' : 'FAIL — expected 200 or 502 PAYMENT_UPSTREAM_ERROR'}`)
  if (r2Res.ok && r2Body.ticket?.id) {
    await prisma.ticket.delete({ where: { id: r2Body.ticket.id } }).catch(() => {})
  }
  await cleanupUser(r2.pubkey)

  // --- Final report ---
  console.log('\n=========================================')
  if (r1Pass && r2Pass) {
    console.log('   ✓ All runs PASSED — ADR-179 fix verified on the live server.')
    process.exit(0)
  }
  console.log(`   ✗ Some runs FAILED. Run 1=${r1Pass ? 'OK' : 'FAIL'}  Run 2=${r2Pass ? 'OK' : 'FAIL'}`)
  process.exit(1)
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0) })
  .catch(async (err) => {
    console.error('\nSmoke test crashed:', err)
    await prisma.$disconnect()
    process.exit(1)
  })

