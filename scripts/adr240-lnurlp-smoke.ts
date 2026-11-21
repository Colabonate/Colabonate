// ADR-240 D1 — live smoke test for a deployed self-serve Lightning Address.
// Verifies the LUD-06 wire contract against a real host and (optionally)
// requests a real invoice from the owner's rail.
//
//   # metadata only (safe, no invoice created)
//   BASE_URL=https://colabonate.app HANDLE=alice npx tsx scripts/adr240-lnurlp-smoke.ts
//
//   # also mint a real 21-sat invoice on the owner's rail
//   BASE_URL=https://colabonate.app HANDLE=alice AMOUNT_MSAT=21000 npx tsx scripts/adr240-lnurlp-smoke.ts
import { Buffer } from 'node:buffer'

const base = (process.env.BASE_URL || 'http://localhost:4001').replace(/\/+$/, '')
const handle = (process.env.HANDLE || '').trim().toLowerCase()
const amountMsat = process.env.AMOUNT_MSAT ? Number(process.env.AMOUNT_MSAT) : null

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

// bolt11 human-readable part: lnbc<amount><multiplier>1… — mirrors the decoder
// in apps/colabonate-app/src/routes/home/WalletSend.tsx.
const BOLT11_MULTIPLIER_TO_SATS: Record<string, number> = { m: 100_000, u: 100, n: 0.1, p: 0.0001 }
function decodeBolt11AmountSats(invoice: string): number | null {
  const match = invoice.match(/^ln(?:bc|tb|bcrt)(\d+)([munp])?1/i)
  if (!match) return null
  const digits = Number(match[1])
  const multiplier = match[2]?.toLowerCase()
  if (!multiplier) return digits * 100_000_000
  return Math.round(digits * BOLT11_MULTIPLIER_TO_SATS[multiplier])
}

async function main() {
  if (!handle) {
    console.error('HANDLE is required, e.g. HANDLE=alice npx tsx scripts/adr240-lnurlp-smoke.ts')
    process.exit(1)
  }
  console.log(`LNURL-pay smoke: ${handle} @ ${base}`)

  const metaRes = await fetch(`${base}/.well-known/lnurlp/${handle}`, { headers: { accept: 'application/json' } })
  check('metadata returns 200', metaRes.status === 200, metaRes.status)
  if (metaRes.status !== 200) {
    console.log('  body:', await metaRes.text().catch(() => ''))
    return finish()
  }
  check('Cache-Control: no-store', (metaRes.headers.get('cache-control') || '').includes('no-store'))
  const doc = (await metaRes.json()) as Record<string, unknown>
  check('tag is payRequest', doc.tag === 'payRequest', doc.tag)
  check('callback is absolute + on this host', typeof doc.callback === 'string' && String(doc.callback).startsWith(`${base}/.well-known/lnurlp/`), doc.callback)
  check('minSendable is a number', typeof doc.minSendable === 'number', doc.minSendable)
  check('maxSendable > minSendable', Number(doc.maxSendable) > Number(doc.minSendable), doc.maxSendable)
  check('metadata is a JSON array with text/identifier', (() => {
    try {
      const parsed = JSON.parse(String(doc.metadata)) as string[][]
      return Array.isArray(parsed) && parsed.some(entry => entry[0] === 'text/identifier')
    } catch { return false }
  })(), doc.metadata)

  if (amountMsat === null) {
    console.log('\n(Set AMOUNT_MSAT=21000 to also request a real invoice on the owner\'s rail.)')
    return finish()
  }

  const cbRes = await fetch(`${String(doc.callback)}?amount=${amountMsat}`, { headers: { accept: 'application/json' } })
  check('callback returns 200', cbRes.status === 200, cbRes.status)
  const body = (await cbRes.json().catch(() => ({}))) as Record<string, unknown>
  if (cbRes.status !== 200) {
    console.log('  callback body:', body)
  } else {
    const pr = String(body.pr || '')
    check('callback returns a bolt11 (pr)', /^lnbc/i.test(pr), pr.slice(0, 24))
    // Amount-agnostic: decode the bolt11 human-readable part and compare with
    // the requested msat (the previous check hardcoded the 21-sat prefix).
    const invoiceSats = decodeBolt11AmountSats(pr)
    const requestedSats = Math.floor(amountMsat / 1000)
    check(
      'invoice carries the requested amount',
      invoiceSats === requestedSats,
      `invoice=${invoiceSats ?? '?'} sats, requested=${requestedSats} sats`,
    )
    console.log(`  invoice: ${pr.slice(0, 60)}…`)
  }

  // Optional: verify a preimage the operator already has, proving settlement.
  const preimage = process.env.PREIMAGE
  if (preimage) {
    const hash = await sha256Hex(preimage)
    check('provided preimage is 64 hex chars', /^[0-9a-f]{64}$/i.test(preimage), preimage.length)
    console.log(`  sha256(preimage) = ${hash} — compare against the invoice's payment hash`)
  }

  return finish()
}

async function sha256Hex(hex: string): Promise<string> {
  const bytes = Buffer.from(hex, 'hex')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Buffer.from(digest).toString('hex')
}

function finish() {
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
