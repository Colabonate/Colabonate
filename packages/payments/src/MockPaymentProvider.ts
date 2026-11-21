import { randomBytes } from 'crypto'
import type { PaymentProvider, Invoice, PaymentResult, WalletBalance, Transaction } from './PaymentProvider.js'

export interface MockPaymentConfig {
  simulateNetworkError?: boolean
  simulateTimeout?: boolean
  failSettleOnHash?: string
  failCancelOnHash?: string
}

type InvoiceStatus = 'PENDING' | 'SETTLED' | 'CANCELLED' | 'PAID'

interface MockInvoiceState {
  bolt11: string
  paymentHash: string
  amountSats: number
  memo: string
  isHold: boolean
  preimageHash?: string
  preimage?: string
  status: InvoiceStatus
  expiresAt: Date
  createdAt: Date
  webhookUrl?: string
}

export class MockPaymentProvider implements PaymentProvider {
  private invoices = new Map<string, MockInvoiceState>()
  private bolt11Index = new Map<string, string>()
  private preimageHashIndex = new Map<string, string>()
  private balanceSats = 0
  private config: MockPaymentConfig
  private invoiceCounter = 0
  private walletCounter = 0

  constructor(config: MockPaymentConfig = {}) {
    this.config = config
  }

  async createInvoice(amountSats: number, memo: string = '', webhookUrl?: string): Promise<Invoice> {
    this.checkNetworkError()

    const paymentHash = randomBytes(32).toString('hex')
    const bolt11 = this.generateBolt11(amountSats, paymentHash)

    const state: MockInvoiceState = {
      bolt11,
      paymentHash,
      amountSats,
      memo,
      isHold: false,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      webhookUrl,
    }

    this.invoices.set(paymentHash, state)
    this.bolt11Index.set(bolt11, paymentHash)

    return {
      bolt11,
      paymentHash,
      amountSats,
      expiresAt: state.expiresAt,
    }
  }

  async createHoldInvoice(amountSats: number, preimageHash: string, memo: string): Promise<Invoice> {
    this.checkNetworkError()

    const paymentHash = randomBytes(32).toString('hex')
    const preimage = randomBytes(32).toString('hex')
    const bolt11 = this.generateBolt11(amountSats, paymentHash)

    const state: MockInvoiceState = {
      bolt11,
      paymentHash,
      amountSats,
      memo,
      isHold: true,
      preimageHash,
      preimage,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
    }

    this.invoices.set(paymentHash, state)
    this.bolt11Index.set(bolt11, paymentHash)
    this.preimageHashIndex.set(preimageHash, paymentHash)

    return {
      bolt11,
      paymentHash,
      amountSats,
      expiresAt: state.expiresAt,
    }
  }

  async settleHoldInvoice(preimageHash: string): Promise<void> {
    this.checkNetworkError()

    const paymentHash = this.preimageHashIndex.get(preimageHash)
    if (!paymentHash) {
      throw new Error(`No hold invoice found for preimage hash: ${preimageHash}`)
    }

    const invoice = this.invoices.get(paymentHash)
    if (!invoice) throw new Error(`Invoice not found: ${paymentHash}`)

    if (!invoice.isHold) throw new Error('Not a hold invoice')
    if (invoice.status === 'SETTLED') throw new Error('Hold invoice already settled')
    if (invoice.status === 'CANCELLED') throw new Error('Hold invoice already cancelled')

    if (this.config.failSettleOnHash === paymentHash || this.config.failSettleOnHash === preimageHash) {
      throw new Error('Simulated settle failure')
    }

    invoice.status = 'SETTLED'
    this.balanceSats += invoice.amountSats
  }

  async settleHoldInvoiceByHash(paymentHash: string, _preimage: string): Promise<void> {
    const invoice = this.invoices.get(paymentHash)
    if (!invoice) throw new Error(`Invoice not found: ${paymentHash}`)
    if (!invoice.isHold) throw new Error('Not a hold invoice')
    if (invoice.status === 'SETTLED') throw new Error('Hold invoice already settled')
    if (invoice.status === 'CANCELLED') throw new Error('Hold invoice already cancelled')
    invoice.status = 'SETTLED'
    this.balanceSats += invoice.amountSats
  }

  async cancelHoldInvoice(paymentHash: string): Promise<void> {
    this.checkNetworkError()

    const invoice = this.invoices.get(paymentHash)
    if (!invoice) throw new Error(`Invoice not found: ${paymentHash}`)

    if (!invoice.isHold) throw new Error('Not a hold invoice')
    if (invoice.status === 'CANCELLED') throw new Error('Hold invoice already cancelled')
    if (invoice.status === 'SETTLED') throw new Error('Hold invoice already settled')

    if (this.config.failCancelOnHash === paymentHash) {
      throw new Error('Simulated cancel failure')
    }

    invoice.status = 'CANCELLED'
  }

  async payInvoice(bolt11: string): Promise<PaymentResult> {
    this.checkNetworkError()

    const paymentHash = this.bolt11Index.get(bolt11)
    if (!paymentHash) {
      return { paymentHash: '', status: 'FAILED' }
    }

    const invoice = this.invoices.get(paymentHash)
    if (!invoice) {
      return { paymentHash: '', status: 'FAILED' }
    }

    if (invoice.status === 'PAID') {
      return { paymentHash: invoice.paymentHash, status: 'FAILED' }
    }

    if (invoice.isHold) {
      return { paymentHash: invoice.paymentHash, status: 'PENDING' }
    }

    invoice.status = 'PAID'
    this.balanceSats += invoice.amountSats

    return {
      paymentHash: invoice.paymentHash,
      status: 'SUCCESS',
      feeSats: 0,
    }
  }

  async getPaymentStatus(paymentHash: string): Promise<PaymentResult> {
    this.checkNetworkError()

    const invoice = this.invoices.get(paymentHash)
    if (!invoice) {
      return { paymentHash, status: 'FAILED' }
    }

    if (this.config.simulateTimeout && invoice.status === 'PENDING') {
      return { paymentHash, status: 'PENDING' }
    }

    const status: PaymentResult['status'] =
      invoice.status === 'PAID' || invoice.status === 'SETTLED' ? 'SUCCESS' :
      invoice.status === 'CANCELLED' ? 'FAILED' :
      'PENDING'

    return {
      paymentHash: invoice.paymentHash,
      status,
      feeSats: 0,
    }
  }

  async getBalance(): Promise<WalletBalance> {
    this.checkNetworkError()
    return {
      confirmedSats: this.balanceSats,
      unconfirmedSats: 0,
      pendingSats: 0,
    }
  }

  async getTransactions(limit: number, offset: number): Promise<Transaction[]> {
    this.checkNetworkError()

    const all = Array.from(this.invoices.values())
      .filter(inv => inv.status === 'PAID' || inv.status === 'SETTLED')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return all.slice(offset, offset + limit).map(inv => ({
      id: inv.paymentHash,
      paymentHash: inv.paymentHash,
      amountSats: inv.amountSats,
      type: 'INCOMING' as const,
      status: 'COMPLETED' as const,
      memo: inv.memo || undefined,
      createdAt: inv.createdAt,
    }))
  }

  async createWallet(userId: string): Promise<{ walletId: string; accountId?: string }> {
    this.checkNetworkError()
    this.walletCounter++
    return {
      walletId: `mock-wallet-${this.walletCounter}`,
      accountId: `mock-account-${userId}`,
    }
  }

  getInvoiceState(paymentHash: string): MockInvoiceState | undefined {
    return this.invoices.get(paymentHash)
  }

  getInvoiceByBolt11(bolt11: string): MockInvoiceState | undefined {
    const hash = this.bolt11Index.get(bolt11)
    return hash ? this.invoices.get(hash) : undefined
  }

  reset(): void {
    this.invoices.clear()
    this.bolt11Index.clear()
    this.preimageHashIndex.clear()
    this.balanceSats = 0
    this.invoiceCounter = 0
    this.walletCounter = 0
  }

  static generatePaymentHash(): string {
    return randomBytes(32).toString('hex')
  }

  private generateBolt11(amountSats: number, hash: string): string {
    this.invoiceCounter++
    return `lnbc${amountSats}mock${this.invoiceCounter}_${hash.slice(0, 20)}`
  }

  private checkNetworkError(): void {
    if (this.config.simulateNetworkError) {
      throw new Error('Simulated network error')
    }
  }
}
