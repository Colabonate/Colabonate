import { resolveLnAddressInvoice, type LnAddressInvoice } from '../lib/lnAddressInvoice.js'
import { readLnurlpDomain } from '../lib/lnAddressHandle.js'
import { isNwcLiquidityError, NwcClient } from './nwcClient.js'
import { isBetaMode } from './betaMode.js'

export type PlatformPaymentResolution =
  // `source` records which rail minted the invoice, so the fee reconcile tick
  // (ADR-394 FU-838) knows where to look up settlement.
  | { ok: true; rail: 'LN'; invoice: LnAddressInvoice; source: 'NWC' | 'LNURL' }
  | { ok: true; rail: 'DEMO' }
  | { ok: false; reason: 'PLATFORM_PAYMENT_NOT_CONFIGURED' }

// ADR-351: resolves an invoice for Colabonate's OWN Lightning Address.
// Distinct from resolveSellerInvoice() because the recipient here is fixed
// (Colabonate's own rail, not a per-seller lookup) and the platform's
// receiving side is not a User row with wallet preferences.
//
// Used for Workspace compute funding (mandatory initial funding, FU-376;
// voluntary recharges, FU-433), the hosted-canvas service fee (ADR-372), AI
// credit packs / MCP passes (ADR-384) — money that was never the seller's to
// begin with. See ADR-351.
//
// ADR-387 D4 — two rails, in this order:
//   1. PLATFORM_NWC_URI: mint on Colabonate's OWN self-custodial Alby Hub over
//      NWC. This is the production rail: no third party in the invoice path,
//      and it does not depend on an Alby account or an Alby-hosted Lightning
//      Address (the hub cannot serve a custom-domain LUD-16 document on its
//      own — verified 2026-09-21, see ADR-387 D3).
//   2. PLATFORM_LN_ADDRESS: the pre-existing external-LUD-16 rail, kept as a
//      fallback so the cutover is reversible and beta/dev keep working.
export async function resolvePlatformInvoice(amountSats: number, memo: string): Promise<PlatformPaymentResolution> {
  // ADR-372 D7.1: the platform receiving rail is Beta-aware — isBetaMode() is
  // checked BEFORE any rail, so on the closed Beta the whole platform-receiving
  // side (hosted-canvas fee, workspace funding + recharge) resolves to the DEMO
  // rail even when a rail is configured in the Surface .env.beta. The platform
  // setting is inert during Beta and takes effect the moment BETA_MODE is
  // removed — no .env.beta change needed. isBetaMode() carries ADR-197's own
  // hard NODE_ENV guard, so this never fires on a real mainnet deployment.
  if (isBetaMode()) {
    return { ok: true, rail: 'DEMO' }
  }

  const nwcUri = process.env.PLATFORM_NWC_URI?.trim()
  if (nwcUri) {
    const client = new NwcClient(nwcUri)
    try {
      const invoice = await client.makeInvoice(amountSats, memo)
      return { ok: true, rail: 'LN', invoice: { bolt11: invoice.bolt11, paymentHash: invoice.paymentHash }, source: 'NWC' }
    } catch (err) {
      // ADR-387 D4 — small-amount fallback. The hub's JIT LSP refuses amounts
      // below its minimum (2,501 sats for Alby's LSP) and reports
      // "LiquidityRequestFailed". Fall through to the external rail so those
      // amounts keep working. Any OTHER NWC error (relay down, hub down, wrong
      // secret) is a real outage and must fail loudly, never silently reroute
      // revenue to a third party.
      if (!isNwcLiquidityError(err)) throw err
      console.warn('[platformPayment] hub refused inbound liquidity — falling back to the external rail')
    } finally {
      client.close()
    }
  }

  const address = process.env.PLATFORM_LN_ADDRESS?.trim()
  if (address) {
    if (isOwnLnurlpAddress(address)) {
      // Guard against an infinite self-fetch: this endpoint serves
      // `pay@<LNURLP_DOMAIN>` itself, so resolving that address over HTTP would
      // call straight back into us. Only reachable when PLATFORM_NWC_URI is
      // missing but the address already points at our own endpoint — a
      // misconfiguration, so fail loudly in the log and report not-configured.
      console.error(
        '[platformPayment] PLATFORM_LN_ADDRESS points at our own lnurlp endpoint ' +
          `(${address}) but PLATFORM_NWC_URI is not set — refusing to self-fetch`,
      )
      return { ok: false, reason: 'PLATFORM_PAYMENT_NOT_CONFIGURED' }
    }
    return { ok: true, rail: 'LN', invoice: await resolveLnAddressInvoice(address, amountSats, memo), source: 'LNURL' }
  }

  return { ok: false, reason: 'PLATFORM_PAYMENT_NOT_CONFIGURED' }
}

/**
 * The local part of Colabonate's own public Lightning Address, served by this
 * app server's LNURL-pay router (ADR-387 D3). `pay` is in RESERVED_HANDLES, so
 * no user can ever hold it — see lib/lnAddressHandle.ts.
 */
export function platformLnHandle(): string {
  return (process.env.PLATFORM_LN_HANDLE ?? 'pay').trim().toLowerCase()
}

/** True when any platform receiving rail is configured (NWC preferred). */
export function isPlatformRailConfigured(): boolean {
  return Boolean(process.env.PLATFORM_NWC_URI?.trim() || process.env.PLATFORM_LN_ADDRESS?.trim())
}

function isOwnLnurlpAddress(address: string): boolean {
  const [handle, domain] = address.split('@')
  if (!handle || !domain) return false
  return (
    handle.trim().toLowerCase() === platformLnHandle() &&
    domain.trim().toLowerCase() === readLnurlpDomain().trim().toLowerCase()
  )
}
