import type { PrismaClient } from '@prisma/client'
import { NwcClient } from './nwcClient.js'
import { decrypt } from '../lib/secretbox.js'
import { isNwcCoolingDown, markNwcFailure, clearNwcCooldown } from '../lib/nwc-cooldown.js'
import { isBetaMode } from './betaMode.js'
import { createAlbyOauthProviderForUser } from './albyOauthProvider.js'
import { resolveLnAddressInvoice } from '../lib/lnAddressInvoice.js'
import { assertSellerInvoiceAmount } from '../lib/invoice-amount.js'

export interface ResolvedSellerInvoice {
  bolt11: string
  paymentHash: string
  /**
   * ADR-399 D1: which of the seller's rails minted the invoice. Decides how
   * the server can later check settlement (LUD-21 verify / NIP-47
   * lookup_invoice / Alby invoice API).
   */
  source: 'LNURL' | 'NWC' | 'ALBY_OAUTH'
  /** LUD-21 verify URL (LNURL source only, when the provider returns one). */
  verifyUrl?: string
}

export interface ResolvedSellerCashu {
  pubkey: string
  mintUrl: string
}

export interface ResolvedSellerDemo {
  walletId: string
}

export type SellerPaymentResolution =
  | { ok: true; rail: 'LN'; invoice: ResolvedSellerInvoice }
  | { ok: true; rail: 'CASHU'; cashu: ResolvedSellerCashu }
  | { ok: true; rail: 'DEMO'; demo: ResolvedSellerDemo }
  | { ok: false; reason: 'SELLER_UNCONFIGURED' }

/**
 * True only for a Lightning Address that can actually be resolved (LUD-16).
 * Synthetic placeholders have no endpoint behind them and MUST never count as
 * a configured rail:
 *   - `<pubkey8>@demo.local`     — auth-session demo login
 *   - `<evm8>@metamask.local`    — auth-metamask signup (FU-754)
 * `hasSellerPaymentMethodConfigured()` (publish gate) and `resolveSellerInvoice()`
 * (checkout) MUST agree on this predicate — previously the gate accepted ANY
 * non-empty `lnAddress`, so a MetaMask seller could publish a listing that every
 * buyer checkout failed to pay (502 upstream).
 */
export function isRoutableLnAddress(address: string | null | undefined): boolean {
  if (!address) return false
  const value = address.trim().toLowerCase()
  const at = value.lastIndexOf('@')
  if (at <= 0 || at === value.length - 1) return false
  if (value.endsWith('.local') || value.endsWith('.invalid')) return false
  return true
}

async function resolveViaNwc(
  sellerPubkey: string,
  connectionUriEnc: string,
  amountSats: number,
  memo: string,
): Promise<ResolvedSellerInvoice> {
  // Every existing NWC call site (apps/server/routes/wallet.ts) decrypts and
  // acts on the AUTHENTICATED CALLER's own wallet. This is the first place
  // that decrypts a DIFFERENT user's (the seller's) wallet — safe here only
  // because: (a) the decryption key (NWC_SECRET_KEY) is a server-held secret,
  // never derived from either party's credentials; (b) `sellerPubkey` comes
  // from the trusted Offer record, not a client-supplied parameter (no IDOR:
  // the buyer never chooses whose wallet gets decrypted); (c) the decrypted
  // URI is used in-memory for one make_invoice call and never returned to
  // any client.
  const uri = decrypt(connectionUriEnc)
  const client = new NwcClient(uri)
  try {
    const inv = await client.makeInvoice(amountSats, memo)
    clearNwcCooldown(sellerPubkey)
    return { bolt11: inv.bolt11, paymentHash: inv.paymentHash, source: 'NWC' }
  } catch (err) {
    markNwcFailure(sellerPubkey)
    throw err
  } finally {
    client.close()
  }
}

// ADR-298 D2: Alby OAuth wallet-connect rail. `createAlbyOauthProviderForUser`
// already handles decrypt + auto-refresh (see albyOauthProvider.ts) — reused
// unmodified, same as resolveViaNwc reuses NwcClient.
async function resolveViaAlbyOauth(prisma: PrismaClient, sellerId: string, amountSats: number, memo: string): Promise<ResolvedSellerInvoice> {
  const provider = await createAlbyOauthProviderForUser(prisma, sellerId)
  const invoice = await provider.createInvoice(amountSats, memo)
  return { bolt11: invoice.bolt11, paymentHash: invoice.paymentHash, source: 'ALBY_OAUTH' }
}

// ADR-253 Stufe 1 (FU-253-A), extended by ADR-298 D2: resolves a non-escrow
// ticket's payment rail against the SELLER's OWN wallet — Lightning address
// (LUD-16/LNURL-pay) preferred, NWC make_invoice next, Alby OAuth next, Cashu
// P2PK as a last resort — instead of the platform's custodial LN backend.
// The platform never touches the funds; the buyer pays the seller directly.
// Unlike LN/NWC/Alby OAuth, the Cashu case does not produce an invoice at
// all — the token itself can only be minted/locked by the BUYER's own client
// (see resolveViaCashu below) — this function just resolves WHERE to lock it.
//
// Upstream/network failures (address unreachable, invalid LNURL response,
// NWC wallet offline, decrypt failure) are intentionally left to throw — the
// caller (tickets.ts) already classifies thrown payment errors as a 502
// upstream error, identical to the previous custodial-provider failure path.
// The Cashu branch has no network call to fail — it's a plain DB read.
export async function resolveSellerInvoice(
  prisma: PrismaClient,
  sellerPubkey: string,
  amountSats: number,
  memo: string,
): Promise<SellerPaymentResolution> {
  const seller = await prisma.user.findUnique({
    where: { pubkey: sellerPubkey },
    select: {
      id: true,
      lnAddress: true,
      wallets: {
        where: { provider: { in: ['NWC', 'ALBY_OAUTH', 'CASHU', 'DEMO'] } },
        select: { provider: true, nwcConnectionUriEnc: true, cashuReceivePubkey: true, cashuReceiveMintUrl: true, id: true, status: true },
      },
    },
  })
  if (!seller) {
    return { ok: false, reason: 'SELLER_UNCONFIGURED' }
  }

  // Synthetic non-routable addresses (`@demo.local` from auth-session,
  // `@metamask.local` from auth-metamask) have no LUD-16 endpoint — treating
  // them as configured made sellers permanently un-buyable (every ticket
  // create died on an ENOTFOUND fetch → 502 PAYMENT_UPSTREAM_ERROR) and
  // shadowed the real rails / the ADR-255 D1 DEMO fallback. Skip them and let
  // the real rails below decide.
  const resolvableLnAddress = isRoutableLnAddress(seller.lnAddress) ? seller.lnAddress : null
  if (resolvableLnAddress) {
    const lnurl = await resolveLnAddressInvoice(resolvableLnAddress, amountSats, memo)
    assertSellerInvoiceAmount(lnurl.bolt11, amountSats)
    const invoice: ResolvedSellerInvoice = { ...lnurl, source: 'LNURL' }
    return { ok: true, rail: 'LN', invoice }
  }

  const nwcUriEnc = seller.wallets.find(w => w.provider === 'NWC')?.nwcConnectionUriEnc
  const albyOauthWallet = seller.wallets.find(w => w.provider === 'ALBY_OAUTH' && w.status === 'ACTIVE')
  const cashuWallet = seller.wallets.find(w => w.provider === 'CASHU')
  const cashuConfigured = Boolean(cashuWallet?.cashuReceivePubkey && cashuWallet.cashuReceiveMintUrl)

  if (nwcUriEnc) {
    // ADR-253: skip a fresh 30s-timeout attempt against a wallet that just
    // failed — fall through to Alby OAuth/Cashu if the seller also has one of
    // those configured, otherwise surface a clear "temporarily unavailable"
    // error rather than paying the full timeout again on every retry.
    if (isNwcCoolingDown(sellerPubkey)) {
      if (!albyOauthWallet && !cashuConfigured) {
        throw new Error('Seller NWC wallet is temporarily unavailable after a recent failure — try again shortly.')
      }
    } else {
      const invoice = await resolveViaNwc(sellerPubkey, nwcUriEnc, amountSats, memo)
      assertSellerInvoiceAmount(invoice.bolt11, amountSats)
      return { ok: true, rail: 'LN', invoice }
    }
  }

  if (albyOauthWallet) {
    const invoice = await resolveViaAlbyOauth(prisma, seller.id, amountSats, memo)
    assertSellerInvoiceAmount(invoice.bolt11, amountSats)
    return { ok: true, rail: 'LN', invoice }
  }

  if (cashuWallet?.cashuReceivePubkey && cashuWallet.cashuReceiveMintUrl) {
    return {
      ok: true,
      rail: 'CASHU',
      cashu: { pubkey: cashuWallet.cashuReceivePubkey, mintUrl: cashuWallet.cashuReceiveMintUrl },
    }
  }

  // ADR-255 D1: Beta-only fallback of last resort. A Wallet{provider: DEMO}
  // is a simulated ledger (ADR-197) — never a real receiving rail, so this
  // must never fire in production. isBetaMode() carries ADR-197's own hard
  // guard (NODE_ENV=production requires an explicit BETA_MODE_ALLOW_PRODUCTION
  // opt-in too), so no new guard is introduced here. Real rails above are
  // always tried first, in Beta too — a tester who configures a real
  // lnAddress/NWC/Cashu still exercises the real path.
  const demoWallet = seller.wallets.find(w => w.provider === 'DEMO' && w.status === 'ACTIVE')
  if (isBetaMode() && demoWallet) {
    return { ok: true, rail: 'DEMO', demo: { walletId: demoWallet.id } }
  }

  return { ok: false, reason: 'SELLER_UNCONFIGURED' }
}

// Cheap existence check (no decrypt, no network call) for publish-time
// validation — lets catalog/offer routes reject publishing a non-escrow
// listing before a buyer ever hits SELLER_UNCONFIGURED at checkout.
export async function hasSellerPaymentMethodConfigured(prisma: PrismaClient, sellerPubkey: string): Promise<boolean> {
  const seller = await prisma.user.findUnique({
    where: { pubkey: sellerPubkey },
    select: {
      lnAddress: true,
      wallets: {
        where: { provider: { in: ['NWC', 'ALBY_OAUTH', 'CASHU', 'DEMO'] } },
        select: { provider: true, cashuReceivePubkey: true, cashuReceiveMintUrl: true, status: true },
      },
    },
  })
  if (isRoutableLnAddress(seller?.lnAddress)) return true
  const hasRealRail = seller?.wallets.some(
    w =>
      w.provider === 'NWC' ||
      (w.provider === 'ALBY_OAUTH' && w.status === 'ACTIVE') ||
      (w.provider === 'CASHU' && w.cashuReceivePubkey && w.cashuReceiveMintUrl),
  ) ?? false
  if (hasRealRail) return true
  // ADR-255 D1: Beta-only fallback, mirrors resolveSellerInvoice() above.
  if (isBetaMode()) {
    return seller?.wallets.some(w => w.provider === 'DEMO' && w.status === 'ACTIVE') ?? false
  }
  return false
}
