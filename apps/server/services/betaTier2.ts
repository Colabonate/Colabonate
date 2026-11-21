/**
 * ADR-197 Tier 2 — real lnd2 pay+settle during beta demo.
 *
 * When BETA_REAL_LND_SETTLE=on:
 *   1. Pay the bolt11 via the second LND node (lnd2, PAYER_LND_REST_URL).
 *   2. If it is a hold invoice (preimage stored in DB), poll the receiver LND for
 *      ACCEPTED, then settle. Regular invoices (cooperation fund-escrow) complete
 *      automatically — no settle step.
 *
 * Requires: PAYER_LND_REST_URL + PAYER_LND_MACAROON_HEX (lnd2 env).
 * The receiver LND client (lnd1) is built from the standard LND_REST_URL env.
 * NODE_EXTRA_CA_CERTS must point to the regtest self-signed cert.
 *
 * FU-197-A. Intentionally fails loudly on bad config so dev notices immediately.
 */

import type { PrismaClient } from '@prisma/client'
import { LndHoldClient } from '@col/payments'

export interface Tier2Result {
  realSettled: boolean
  note: string
}

// Streams lnd2 SendPaymentV2 NDJSON until IN_FLIGHT / SUCCEEDED / FAILED.
async function lnd2Pay(payerUrl: string, payerMac: string, bolt11: string): Promise<void> {
  const res = await fetch(`${payerUrl}/v2/router/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Grpc-Metadata-macaroon': payerMac },
    body: JSON.stringify({ payment_request: bolt11, fee_limit_sat: '10000', timeout_seconds: 60 }),
  })
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '')
    throw new Error(`lnd2 SendPaymentV2 HTTP ${res.status}: ${txt}`)
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let held = false
  let payErr: string | null = null
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline && !held && !payErr) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
      if (!line) continue
      try {
        const obj = JSON.parse(line)
        if (obj.error) { payErr = obj.error.message || JSON.stringify(obj.error); break }
        const st = obj.result?.status
        if (st === 'IN_FLIGHT' || st === 'SUCCEEDED') held = true
        if (st === 'FAILED') { payErr = obj.result?.failure_reason || 'FAILED'; break }
      } catch { /* partial NDJSON line */ }
    }
  }
  try { reader.cancel() } catch { /* stream abandoned */ }
  if (payErr) throw new Error(`lnd2 payment failed: ${payErr}`)
}

// Returns the preimage hex for a given paymentHash, or null for regular invoices.
async function findPreimage(prisma: PrismaClient, paymentHash: string): Promise<string | null> {
  const ticket = await prisma.ticket.findFirst({ where: { paymentHash } })
  if (ticket?.preimage) return ticket.preimage

  const t1 = await prisma.ticket.findFirst({ where: { escrowPhase1Hash: paymentHash } })
  if (t1?.escrowPhase1Preimage) return t1.escrowPhase1Preimage

  const t2 = await prisma.ticket.findFirst({ where: { escrowPhase2Hash: paymentHash } })
  if (t2?.escrowPhase2Preimage) return t2.escrowPhase2Preimage

  const t3 = await prisma.ticket.findFirst({ where: { escrowPhase3Hash: paymentHash } })
  if (t3?.escrowPhase3Preimage) return t3.escrowPhase3Preimage

  // Cooperation / milestone use regular invoices — no preimage stored.
  return null
}

// Poll receiver LND for the target state (max 20 × 500 ms).
async function pollHoldState(client: LndHoldClient, paymentHash: string, want: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500))
    const { state } = await client.getHoldState(paymentHash)
    if (state === want || state === 'SETTLED') return state
  }
  return (await client.getHoldState(paymentHash)).state
}

export async function tier2PayAndSettle(
  bolt11: string,
  paymentHash: string,
  prisma: PrismaClient,
): Promise<Tier2Result> {
  const payerUrl = process.env.PAYER_LND_REST_URL
  const payerMac = process.env.PAYER_LND_MACAROON_HEX
  if (!payerUrl || !payerMac) {
    return { realSettled: false, note: 'PAYER_LND_REST_URL / PAYER_LND_MACAROON_HEX not set — skip Tier 2' }
  }

  // 1. Pay via lnd2
  await lnd2Pay(payerUrl, payerMac, bolt11)
  console.log(`[Beta/Tier2] lnd2 payment issued for ${paymentHash}`)

  // 2. Find preimage (hold) or short-circuit (regular)
  const preimage = await findPreimage(prisma, paymentHash)
  if (!preimage) {
    // Regular invoice: payment completes on lnd1 without a settle call.
    return { realSettled: true, note: 'lnd2 paid (regular invoice — no settle step)' }
  }

  // 3. Poll receiver LND for ACCEPTED
  const receiverClient = LndHoldClient.fromEnv(process.env as Record<string, string | undefined>)
  if (!receiverClient) {
    return { realSettled: false, note: 'Receiver LND client not configured (LND_REST_URL missing)' }
  }

  const state = await pollHoldState(receiverClient, paymentHash, 'ACCEPTED')
  if (state !== 'ACCEPTED' && state !== 'SETTLED') {
    throw new Error(`Hold invoice did not reach ACCEPTED within timeout (state: ${state})`)
  }
  if (state === 'SETTLED') {
    return { realSettled: true, note: 'already settled on receiver LND' }
  }

  // 4. Settle
  await receiverClient.settleHoldInvoice(preimage)
  console.log(`[Beta/Tier2] Settled hold invoice ${paymentHash} on receiver LND`)
  return { realSettled: true, note: 'lnd2 paid + hold settled via receiver LND' }
}
