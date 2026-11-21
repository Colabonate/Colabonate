import { randomBytes } from 'crypto'
import type { PaymentProvider, Invoice, PaymentResult, WalletBalance, Transaction } from './PaymentProvider.js'
import { LndHoldClient, LND_STATE_TO_HOLD, type LndHoldState } from './LndHoldClient.js'

interface LNBitsInvoiceResponse {
  payment_hash: string
  payment_request: string
  checking_id: string
}

interface LNBitsPaymentStatusResponse {
  paid: boolean
  pending: boolean
  fee_msat: number
  amount: number
  memo: string
  hash: string
  preimage: string | null
  expiry: number
}

export interface HoldState {
  status: 'pending' | 'paid' | 'settled' | 'cancelled'
  preimage?: string
}

export class LNBitsProvider implements PaymentProvider {
  private invoiceReadKey: string
  private adminKey: string
  private baseUrl: string
  private isMock: boolean
  /**
   * ADR-193 — LND-native hold client. Null when hold invoices are disabled
   * (mock mode, or dev without LND configured). Required in production.
   */
  private holdClient: LndHoldClient | null

  // Emit the no-LND warning only once per process to avoid log spam
  private static holdClientWarnEmitted = false

  constructor(
    adminKey: string,
    invoiceReadKey: string,
    baseUrl: string = 'https://demo.lnbits.com',
    isMock: boolean = false,
    holdClient: LndHoldClient | null = null,
  ) {
    this.adminKey = adminKey
    this.invoiceReadKey = invoiceReadKey
    this.baseUrl = baseUrl
    this.isMock = isMock
    this.holdClient = holdClient
  }

  async createInvoice(amountSats: number, memo: string = '', webhookUrl?: string): Promise<Invoice> {
    if (this.isMock) {
      return this.createMockInvoice(amountSats, memo)
    }

    // LNBits/LND's `expiry` field is a duration in seconds from now, not an
    // absolute Unix timestamp (LND rejects anything over 1 year = 31536000s —
    // an absolute `now + 3600` timestamp is ~56 years and always gets rejected).
    const expiry = 3600

    const payload: Record<string, unknown> = {
      out: false,
      amount: amountSats,
      memo,
      expiry,
    }

    if (webhookUrl) {
      payload.webhook = webhookUrl
      payload.extra = { webhook: webhookUrl }
    }

    const response = await fetch(`${this.baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.invoiceReadKey,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`LNBits API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as LNBitsInvoiceResponse

    return {
      bolt11: data.payment_request,
      paymentHash: data.payment_hash,
      amountSats,
      expiresAt: new Date(Date.now() + 3600 * 1000),
    }
  }

  async createHoldInvoice(amountSats: number, preimageHash: string, memo: string): Promise<Invoice> {
    if (this.isMock) {
      return this.createMockInvoice(amountSats, memo, preimageHash)
    }

    if (!this.holdClient) {
      if (!LNBitsProvider.holdClientWarnEmitted) {
        console.warn(
          '[LNBits] LND hold client is not configured — falling back to standard invoice. ' +
          'Hold semantics (HTLC, settle, cancel) are disabled. This is unsafe for production escrow (ADR-193).',
        )
        LNBitsProvider.holdClientWarnEmitted = true
      }
      return this.createInvoice(amountSats, `[HOLD] ${memo}`)
    }

    const { bolt11, paymentHash } = await this.holdClient.createHoldInvoice(amountSats, preimageHash, memo)

    return {
      bolt11,
      paymentHash,
      amountSats,
      expiresAt: new Date(Date.now() + 86400 * 1000),
    }
  }

  async settleHoldInvoice(preimage: string): Promise<void> {
    if (this.isMock) {
      console.log(`[LNBits Mock] settleHoldInvoice: ${preimage.slice(0, 16)}...`)
      return
    }

    if (!this.holdClient) {
      throw new Error('LND hold client is not configured — cannot settle hold invoice (ADR-193).')
    }

    // LND settle keys by preimage directly; no holdIndex lookup required.
    await this.holdClient.settleHoldInvoice(preimage)
  }

  /**
   * FU-02: settle by known paymentHash without an index lookup.
   * With LND, settlement is preimage-based regardless of which sub-wallet
   * created the hold (single LND node, single macaroon), so this forwards
   * straight to the preimage settle. The `paymentHash` is accepted for
   * interface parity but unused by LND.
   */
  async settleHoldInvoiceByHash(_paymentHash: string, preimage: string): Promise<void> {
    if (this.isMock) {
      console.log(`[LNBits Mock] settleHoldInvoiceByHash: ${_paymentHash.slice(0, 16)}...`)
      return
    }
    if (!this.holdClient) {
      throw new Error('LND hold client is not configured — cannot settle hold invoice (ADR-193).')
    }
    await this.holdClient.settleHoldInvoice(preimage)
  }

  /**
   * FU-02: returns a new LNBitsProvider scoped to a sub-wallet's adminKey.
   * Same base URLs as this provider; only the key changes.
   */
  createSubWalletProvider(subWalletAdminKey: string): LNBitsProvider {
    // The LND hold client is shared: a single LND node backs every sub-wallet,
    // so the same macaroon/cert settles holds regardless of which LNBits
    // sub-wallet created them.
    return new LNBitsProvider(
      subWalletAdminKey,
      subWalletAdminKey,
      this.baseUrl,
      this.isMock,
      this.holdClient,
    )
  }

  async cancelHoldInvoice(paymentHash: string): Promise<void> {
    if (this.isMock) {
      console.log(`[LNBits Mock] cancelHoldInvoice: ${paymentHash.slice(0, 16)}...`)
      return
    }

    if (!this.holdClient) {
      throw new Error('LND hold client is not configured — cannot cancel hold invoice (ADR-193).')
    }

    await this.holdClient.cancelHoldInvoice(paymentHash)
  }

  async getHoldState(paymentHash: string): Promise<HoldState> {
    if (this.isMock) {
      return { status: 'pending' }
    }

    if (!this.holdClient) {
      throw new Error('LND hold client is not configured — cannot get hold state (ADR-193).')
    }

    const { state, preimage } = await this.holdClient.getHoldState(paymentHash)

    return {
      status: LND_STATE_TO_HOLD[state as LndHoldState] ?? 'pending',
      preimage,
    }
  }

  async payInvoice(bolt11: string): Promise<PaymentResult> {
    if (this.isMock) {
      return {
        paymentHash: LNBitsProvider.generatePaymentHash(),
        status: 'SUCCESS',
        feeSats: 0,
      }
    }

    const response = await fetch(`${this.baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.adminKey,
      },
      body: JSON.stringify({ out: true, bolt11 }),
    })

    if (!response.ok) {
      return {
        paymentHash: '',
        status: 'FAILED',
      }
    }

    const data = await response.json() as { payment_hash: string }

    return {
      paymentHash: data.payment_hash,
      status: 'PENDING',
    }
  }

  async getPaymentStatus(paymentHash: string): Promise<PaymentResult> {
    if (this.isMock) {
      return {
        paymentHash,
        status: 'SUCCESS',
        feeSats: 0,
      }
    }

    const response = await fetch(`${this.baseUrl}/api/v1/payments/${paymentHash}`, {
      headers: { 'X-Api-Key': this.invoiceReadKey },
    })

    if (!response.ok) {
      return { paymentHash, status: 'FAILED' }
    }

    const data = await response.json() as LNBitsPaymentStatusResponse

    return {
      paymentHash: data.hash,
      status: data.paid ? 'SUCCESS' : data.pending ? 'PENDING' : 'FAILED',
      feeSats: data.fee_msat ? Math.round(data.fee_msat / 1000) : undefined,
    }
  }

  async getBalance(): Promise<WalletBalance> {
    if (this.isMock) {
      return { confirmedSats: 0, unconfirmedSats: 0, pendingSats: 0 }
    }

    const response = await fetch(`${this.baseUrl}/api/v1/wallet`, {
      headers: { 'X-Api-Key': this.invoiceReadKey },
    })

    if (!response.ok) {
      throw new Error(`LNBits balance error: ${response.status}`)
    }

    const data = await response.json() as { balance: number }

    return {
      confirmedSats: Math.round(data.balance / 1000),
      unconfirmedSats: 0,
      pendingSats: 0,
    }
  }

  async getTransactions(limit: number, offset: number): Promise<Transaction[]> {
    if (this.isMock) {
      return []
    }

    const response = await fetch(`${this.baseUrl}/api/v1/payments?limit=${limit}&offset=${offset}`, {
      headers: { 'X-Api-Key': this.invoiceReadKey },
    })

    if (!response.ok) {
      throw new Error(`LNBits transactions error: ${response.status}`)
    }

    const data = await response.json() as Array<{
      payment_hash: string
      amount: number
      pending: boolean
      memo: string
      time: number
    }>

    return data.map(t => ({
      id: t.payment_hash,
      paymentHash: t.payment_hash,
      amountSats: Math.abs(Math.round(t.amount / 1000)),
      type: t.amount > 0 ? 'INCOMING' as const : 'OUTGOING' as const,
      status: t.pending ? 'PENDING' as const : 'COMPLETED' as const,
      memo: t.memo || undefined,
      createdAt: new Date(t.time * 1000),
    }))
  }

  static generatePaymentHash(): string {
    return randomBytes(32).toString('hex')
  }

  /**
   * PROB-003 B-α: create an isolated LNBits sub-wallet for a private trade.
   * Uses the LNBits `/api/v1/wallets` endpoint with the admin key.
   * Returns the sub-wallet id (LNBits `id` field) plus the freshly-issued
   * adminkey + readonlyKey. The caller MUST store the adminkey in a
   * secret manager (not in the trade row) for subsequent operations.
   *
   * If the provider is in mock mode (isMock=true), returns a deterministic
   * placeholder so dev flows work without a real LNBits.
   */
  async createSubWallet(label: string): Promise<{ walletId: string; adminkey: string; readonlyKey: string } | null> {
    if (this.isMock) {
      const walletId = `mock-subwallet-${label.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 32)}`
      return {
        walletId,
        adminkey: `mock-adminkey-${randomBytes(16).toString('hex')}`,
        readonlyKey: `mock-readonly-${randomBytes(16).toString('hex')}`,
      }
    }
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/wallets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.adminKey,
        },
        body: JSON.stringify({ name: label }),
      })
      if (!response.ok) {
        const errBody = await response.text()
        throw new Error(`LNBits createSubWallet error: ${response.status} - ${errBody}`)
      }
      const data = await response.json() as {
        id: string
        adminkey: string
        inkey: string
      }
      return {
        walletId: data.id,
        adminkey: data.adminkey,
        readonlyKey: data.inkey,  // LNBits calls the invoice-read key "inkey"
      }
    } catch (err) {
      console.error('[LNBits] createSubWallet failed:', (err as Error).message)
      return null
    }
  }

  private createMockInvoice(amountSats: number, memo: string, paymentHash?: string): Invoice {
    const hash = paymentHash || LNBitsProvider.generatePaymentHash()
    const amountHex = (amountSats * 1000).toString(16).padStart(8, '0')
    const bolt11 = `lnbc${amountHex}mock_${memo.replace(/\s+/g, '_').slice(0, 20)}_${hash.slice(0, 20)}`

    return {
      bolt11,
      paymentHash: hash,
      amountSats,
      expiresAt: new Date(Date.now() + 3600 * 1000),
    }
  }
}
