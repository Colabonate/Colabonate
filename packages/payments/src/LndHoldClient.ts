import { readFileSync } from 'fs'

/**
 * ADR-193 — LND-native hold-invoice client.
 *
 * Routes the four hold operations directly to LND's `invoicesrpc` REST surface,
 * replacing the (non-existent) LNBits `holdinvoice` extension. Auth is via the
 * LND admin macaroon (hex) sent on the `Grpc-Metadata-macaroon` header. The TLS
 * trust for the self-signed regtest cert is handled out-of-band by the caller
 * (e.g. `NODE_EXTRA_CA_CERTS=/lnd-certs/tls.cert` in the compose stack); no new
 * dependency (undici Agent) is introduced — plain global `fetch` is used.
 *
 * Endpoints (REST, base64-encoded byte fields):
 *   createHoldInvoice → POST {lnd}/v2/invoices/hodl    { memo, hash, value }
 *   settleHoldInvoice → POST {lnd}/v2/invoices/settle   { preimage }
 *   cancelHoldInvoice → POST {lnd}/v2/invoices/cancel   { payment_hash }
 *   getHoldState      → GET  {lnd}/v2/invoices/lookup?payment_hash=<b64url>
 *
 * LND holds are keyed by the payment_hash we supply at creation, so the
 * provider's in-memory `holdIndex` (preimageHash→payment_hash) is unnecessary.
 */
export type LndHoldState = 'OPEN' | 'ACCEPTED' | 'SETTLED' | 'CANCELED'

export interface LndHoldClientConfig {
  restUrl: string
  macaroonHex: string
}

function hexToBytes(hex: string): Buffer {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const buf = Buffer.from(clean, 'hex')
  if (buf.length !== 32) {
    throw new Error(`Expected 32-byte value, got ${buf.length} bytes from hex input`)
  }
  return buf
}

function bytesToBase64(buf: Buffer): string {
  return buf.toString('base64')
}

function base64ToHex(b64: string): string {
  return Buffer.from(b64, 'base64').toString('hex')
}

export class LndHoldClient {
  private readonly restUrl: string
  private readonly macaroonHex: string

  constructor(config: LndHoldClientConfig) {
    this.restUrl = config.restUrl.replace(/\/+$/, '')
    this.macaroonHex = config.macaroonHex.trim()
  }

  /**
   * Build a client from process env. Returns null when LND hold is not
   * configured (so non-LND deployments and dev mocks are unaffected).
   * Throws if REST URL is set but the macaroon is missing.
   */
  static fromEnv(env: Record<string, string | undefined>): LndHoldClient | null {
    const restUrl = env.LND_REST_URL
    if (!restUrl) return null

    let macaroonHex = env.LND_MACAROON_HEX
    if (!macaroonHex) {
      const path = env.LND_MACAROON_PATH
      if (!path) {
        throw new Error(
          'LND_REST_URL is set but no macaroon provided — set LND_MACAROON_HEX or LND_MACAROON_PATH (ADR-193).',
        )
      }
      macaroonHex = readFileSync(path).toString('hex')
    }

    return new LndHoldClient({ restUrl, macaroonHex })
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Grpc-Metadata-macaroon': this.macaroonHex,
    }
  }

  private async lndFetch(path: string, init: RequestInit, op: string): Promise<Response> {
    const res = await fetch(`${this.restUrl}${path}`, init)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`LND ${op} error: ${res.status} - ${body}`)
    }
    return res
  }

  /**
   * Create a hold (hodl) invoice keyed by the supplied payment hash
   * (SHA-256 of the preimage). Returns the BOLT11 + the same payment hash.
   */
  async createHoldInvoice(
    amountSats: number,
    paymentHashHex: string,
    memo: string,
  ): Promise<{ bolt11: string; paymentHash: string }> {
    const body = JSON.stringify({
      memo,
      hash: bytesToBase64(hexToBytes(paymentHashHex)),
      value: String(amountSats),
    })
    const res = await this.lndFetch('/v2/invoices/hodl', {
      method: 'POST',
      headers: this.headers(),
      body,
    }, 'addholdinvoice')
    const data = (await res.json()) as { payment_request: string }
    return {
      bolt11: data.payment_request,
      paymentHash: paymentHashHex,
    }
  }

  /** Settle a held HTLC by releasing its preimage. LND keys settle by preimage. */
  async settleHoldInvoice(preimageHex: string): Promise<void> {
    const body = JSON.stringify({ preimage: bytesToBase64(hexToBytes(preimageHex)) })
    await this.lndFetch('/v2/invoices/settle', {
      method: 'POST',
      headers: this.headers(),
      body,
    }, 'settle')
  }

  /** Cancel a held (or not-yet-accepted) invoice by its payment hash. */
  async cancelHoldInvoice(paymentHashHex: string): Promise<void> {
    const body = JSON.stringify({ payment_hash: bytesToBase64(hexToBytes(paymentHashHex)) })
    await this.lndFetch('/v2/invoices/cancel', {
      method: 'POST',
      headers: this.headers(),
      body,
    }, 'cancel')
  }

  /** Look up a hold invoice's LND state + optional preimage. */
  async getHoldState(paymentHashHex: string): Promise<{ state: LndHoldState; preimage?: string }> {
    const hashB64 = bytesToBase64(hexToBytes(paymentHashHex))
    const res = await this.lndFetch(
      `/v2/invoices/lookup?payment_hash=${encodeURIComponent(hashB64)}`,
      { headers: this.headers() },
      'lookup',
    )
    const data = (await res.json()) as { state: LndHoldState; r_preimage?: string }
    return {
      state: data.state,
      preimage: data.r_preimage ? base64ToHex(data.r_preimage) : undefined,
    }
  }
}

// Exported for tests + re-use by LNBitsProvider state mapping.
export const LND_STATE_TO_HOLD: Record<LndHoldState, 'pending' | 'paid' | 'settled' | 'cancelled'> = {
  OPEN: 'pending',
  ACCEPTED: 'paid',
  SETTLED: 'settled',
  CANCELED: 'cancelled',
}
