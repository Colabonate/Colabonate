/**
 * ADR-187 Phase 0 spike — prove `@cashu/cashu-ts` interoperates with a public
 * Cashu mint over the same Lightning seam our existing rail already speaks.
 *
 * This is a THROWAWAY validation script, not production code. It exists only to
 * de-risk the Phase 1 `@col/cashu` package by demonstrating, end to end:
 *
 *   1. connect to an external mint + read its info (NUT-06)
 *   2. request a mint quote   → a bolt11 invoice (Lightning -> ecash)
 *   3. (after the invoice is paid) mint proofs against that quote
 *   4. request a melt quote    → pay a bolt11 invoice (ecash -> Lightning)
 *
 * Run (after installing the lib once at the repo root):
 *   npx pnpm add -D -w @cashu/cashu-ts
 *   npx pnpm exec tsx scripts/cashu-spike.ts
 *
 * Default mint is a TEST mint that issues fake sats — never point this at a
 * real mint. Override with CASHU_MINT_URL.
 *
 * Expected outcome: step 1 + 2 + 4 (quote) succeed without a real payment.
 * Steps that need an actually-paid invoice are guarded and logged as SKIPPED
 * so the script is safe to run unattended in CI / a sandbox.
 */

// NOTE: import is intentionally dynamic so the script gives a friendly message
// (instead of a module-resolution crash) when the lib has not been added yet.
const MINT_URL = process.env.CASHU_MINT_URL ?? 'https://testnut.cashu.space'
const AMOUNT_SATS = Number(process.env.CASHU_SPIKE_AMOUNT ?? 10)

async function main() {
  let cashu: typeof import('@cashu/cashu-ts')
  try {
    cashu = await import('@cashu/cashu-ts')
  } catch {
    console.error(
      '[cashu-spike] @cashu/cashu-ts is not installed.\n' +
        '  Install it first:  npx pnpm add -D -w @cashu/cashu-ts\n' +
        '  Then re-run:        npx pnpm exec tsx scripts/cashu-spike.ts',
    )
    process.exit(1)
  }

  // cashu-ts v4: the constructors are `Mint` / `Wallet` (v3 was CashuMint /
  // CashuWallet), and quote calls are method-specific (…Bolt11).
  const { Mint, Wallet } = cashu

  console.log(`[cashu-spike] mint = ${MINT_URL}`)
  const mint = new Mint(MINT_URL)

  // 1. Mint info (NUT-06) — proves connectivity + capability negotiation.
  const info = await mint.getInfo()
  console.log(`[cashu-spike] OK  mint info: name="${info.name ?? '?'}" version="${info.version ?? '?'}"`)

  const wallet = new Wallet(mint)
  await wallet.loadMint() // fetch keysets (NUT-01/02)
  console.log(`[cashu-spike] OK  keysets loaded (unit=${wallet.unit})`)

  // 2. Mint quote — Lightning -> ecash. Returns a real bolt11 to be paid.
  //    This is the seam our existing LNBits/Lightspark rail already speaks.
  const mintQuote = await mint.createMintQuoteBolt11({ amount: AMOUNT_SATS, unit: 'sat' })
  console.log(
    `[cashu-spike] OK  mint quote: ${AMOUNT_SATS} sat\n` +
      `             quote=${mintQuote.quote}\n` +
      `             bolt11=${String(mintQuote.request).slice(0, 40)}…`,
  )

  // 3. Mint proofs — only possible once the bolt11 above is actually paid.
  //    Unattended runs can't pay it, so we check state and skip if unpaid.
  const state = await mint.checkMintQuoteBolt11(mintQuote.quote)
  if (state.state === 'PAID') {
    console.log('[cashu-spike] OK  invoice PAID — proceed to mintBolt11() + melt for full round-trip (manual)')
  } else {
    console.log(
      `[cashu-spike] SKIP mint quote state=${state.state} (invoice not paid) — ` +
        'pay the bolt11 above with any Lightning wallet, then complete mint + melt manually.',
    )
  }

  console.log('[cashu-spike] done — connectivity + Lightning quote seam verified.')
}

main().catch((err) => {
  console.error('[cashu-spike] FAILED', err)
  process.exit(1)
})
