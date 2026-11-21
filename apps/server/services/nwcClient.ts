/**
 * NwcClient — thin per-user wrapper over @getalby/sdk's NWCClient (ADR-208 §D4).
 *
 * NWC is the user's *spending wallet* (a peer of WalletProvider.WEBLN), NOT a
 * platform PaymentProvider. Construct one instance per operation from a user's
 * decrypted `nostr+walletconnect://` URI, call a method, then `close()` to
 * release relay subscriptions. Never hold a singleton (D4 invariant).
 *
 * The @getalby/sdk encapsulates the NIP-47 envelope (kind 23194/23195),
 * capability discovery (kind 13194), and NIP-44/NIP-04 encryption negotiation.
 *
 * Hold-invoice caveat (correctness): paying a platform *hold* invoice via
 * pay_invoice puts the payer's HTLC into ACCEPTED (held) state; the NIP-47
 * response does NOT return until the invoice is later settled or cancelled.
 * Callers paying escrow hold invoices must therefore NOT await the
 * `payInvoice` promise on the HTTP request path — dispatch it and confirm
 * the held state through the existing hold-invoice polling (ADR-193).
 */
import { NWCClient, type NewNWCClientOptions, type Nip47GetInfoResponse } from '@getalby/sdk'

const DEFAULT_TIMEOUT_MS = Number(process.env.NWC_REQUEST_TIMEOUT_MS ?? 30000)

export interface NwcInfo {
  alias: string
  pubkey: string
  network: string
  methods: string[]
  lud16?: string
}

export interface NwcBalance {
  balanceSats: number
}

export interface NwcInvoice {
  bolt11: string
  paymentHash: string
}

export interface NwcPaymentResult {
  preimage: string
  feesPaidSats: number
}

export interface NwcInvoiceStatus {
  paid: boolean
  preimage?: string
  state: string
}

/** Parsed components of a `nostr+walletconnect://` URI. */
export interface ParsedNwcUri {
  walletPubkey: string
  secret: string
  relayUrls: string[]
  lud16?: string
}

const NWC_SCHEME = 'nostr+walletconnect://'

/** Strictly parse a nostr+walletconnect URI. Throws on malformed input. */
export function parseNwcUri(uri: string): ParsedNwcUri {
  if (typeof uri !== 'string' || !uri.startsWith(NWC_SCHEME)) {
    throw new Error('Invalid NWC URI: must start with nostr+walletconnect://')
  }
  // Delegating to the SDK parser is safest (handles secret/relay/lud16 quirks).
  const parsed = NWCClient.parseWalletConnectUrl(uri, true)
  if (!parsed.walletPubkey || !parsed.secret) {
    throw new Error('Invalid NWC URI: missing wallet pubkey or secret')
  }
  if (!parsed.relayUrls || parsed.relayUrls.length === 0) {
    throw new Error('Invalid NWC URI: no relays specified')
  }
  return {
    walletPubkey: parsed.walletPubkey,
    secret: parsed.secret,
    relayUrls: parsed.relayUrls,
    lud16: parsed.lud16,
  }
}

export class NwcClient {
  private readonly client: NWCClient
  private readonly timeoutMs: number

  constructor(connectionUri: string, opts?: { timeoutMs?: number }) {
    const options: NewNWCClientOptions = {
      nostrWalletConnectUrl: connectionUri,
      requireSecret: true,
    }
    this.client = new NWCClient(options)
    // @getalby/sdk v8 hardcodes its own reply timeouts per method (10s for
    // get_info/get_balance, 60s for pay_invoice) and exposes no way to
    // override them. Race against our own timeout so NWC_REQUEST_TIMEOUT_MS
    // is honored for the bounded, quick calls — verified against a live NIP-47
    // wallet in scripts/nwc-mock-wallet-smoke-test.ts (the wallet stays
    // silent and the call rejects instead of hanging).
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  private withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`NWC ${label} timed out after ${this.timeoutMs}ms`)), this.timeoutMs)
      p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
    })
  }

  /** Wallet info + supported methods — proves reachability at connect time. */
  async getInfo(): Promise<NwcInfo> {
    const info: Nip47GetInfoResponse = await this.withTimeout(this.client.getInfo(), 'getInfo')
    return {
      alias: info.alias,
      pubkey: info.pubkey,
      network: info.network,
      methods: info.methods,
      lud16: info.lud16,
    }
  }

  /** Balance in whole sats (NIP-47 reports msat). */
  async getBalance(): Promise<NwcBalance> {
    const res = await this.withTimeout(this.client.getBalance(), 'getBalance')
    return { balanceSats: Math.round(res.balance / 1000) }
  }

  async makeInvoice(amountSats: number, description: string): Promise<NwcInvoice> {
    const tx = await this.withTimeout(this.client.makeInvoice({ amount: amountSats * 1000, description }), 'makeInvoice')
    return { bolt11: tx.invoice, paymentHash: tx.payment_hash }
  }

  async lookupInvoice(paymentHash: string): Promise<NwcInvoiceStatus> {
    const tx = await this.withTimeout(this.client.lookupInvoice({ payment_hash: paymentHash }), 'lookupInvoice')
    return {
      paid: tx.state === 'settled',
      preimage: tx.preimage || undefined,
      state: tx.state,
    }
  }

  /**
   * Pay a normal (settle-on-receipt) invoice. Returns once settled.
   *
   * Deliberately NOT wrapped in withTimeout() (unlike the other methods): a
   * hold-invoice payment must be allowed to sit unresolved until settle/cancel
   * (potentially far longer than NWC_REQUEST_TIMEOUT_MS), and escrow callers
   * already don't await this promise (see D5/wallet.ts). For a normal invoice
   * on a blocking HTTP path, the SDK's own ~60s reply timeout applies.
   *
   * WARNING: do NOT call this for platform *hold* invoices on a blocking HTTP
   * path — the promise resolves only after settle/cancel. For escrow, dispatch
   * without awaiting and confirm via hold-invoice polling (ADR-193).
   */
  async payInvoice(bolt11: string): Promise<NwcPaymentResult> {
    const res = await this.client.payInvoice({ invoice: bolt11 })
    return { preimage: res.preimage, feesPaidSats: Math.round(res.fees_paid / 1000) }
  }

  /** Release relay subscriptions. Always call when done with an instance. */
  close(): void {
    this.client.close()
  }
}

/**
 * True when the hub refused to mint an invoice because it lacks inbound
 * liquidity. Alby Hub reports this as its own NIP-47 extension code
 * `LiquidityRequestFailed` (e.g. an amount below the JIT/LSPS2 LSP minimum of
 * 2,501 sats). Deliberately narrow: it must NOT match a real outage (relay
 * down, wrong secret, hub stopped) so the platform rail can fall back to the
 * external address for exactly the "amount too small" case and fail loudly
 * for everything else (ADR-387 D4).
 */
export function isNwcLiquidityError(err: unknown): boolean {
  return err instanceof Error && /LiquidityRequestFailed/i.test(err.message)
}

/**
 * True when the wallet refused a call because the NWC connection lacks the
 * required scope (NIP-47 error code `RESTRICTED`; Alby Hub's message is e.g.
 * "This app does not have the required scope: lookup_invoice"). Unlike a
 * liquidity error or an outage this is a *configuration* defect that no retry
 * can heal — callers use this to log one loud, actionable error instead of
 * treating the call as transient (2026-09-30 Alby finding: the platform
 * receive-only connection was created with `make_invoice` only, so ADR-394
 * FU-838 fee settlement could never verify via `lookup_invoice`).
 */
export function isNwcRestrictedError(err: unknown): boolean {
  return err instanceof Error && /RESTRICTED|\bscope\b/i.test(err.message)
}

export { DEFAULT_TIMEOUT_MS }
