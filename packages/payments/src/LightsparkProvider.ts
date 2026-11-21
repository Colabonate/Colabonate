import type { PaymentProvider, Invoice, PaymentResult, WalletBalance, Transaction } from './PaymentProvider.js'

export class LightsparkProvider implements PaymentProvider {
  private apiKey: string
  private apiSecret: string
  private baseUrl: string

  constructor(apiKey: string, apiSecret: string, baseUrl: string = 'https://api.lightspark.com') {
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.baseUrl = baseUrl
  }

  async createInvoice(amountSats: number, memo: string, _webhookUrl?: string): Promise<Invoice> {
    throw new Error('LightsparkProvider.createInvoice not yet implemented')
  }

  async createHoldInvoice(_amountSats: number, _preimageHash: string, _memo: string): Promise<Invoice> {
    throw new Error('LightsparkProvider.createHoldInvoice not yet implemented')
  }

  async settleHoldInvoice(_preimage: string): Promise<void> {
    throw new Error('LightsparkProvider.settleHoldInvoice not yet implemented')
  }

  async cancelHoldInvoice(_paymentHash: string): Promise<void> {
    throw new Error('LightsparkProvider.cancelHoldInvoice not yet implemented')
  }

  async payInvoice(_bolt11: string): Promise<PaymentResult> {
    throw new Error('LightsparkProvider.payInvoice not yet implemented')
  }

  async getPaymentStatus(_paymentHash: string): Promise<PaymentResult> {
    throw new Error('LightsparkProvider.getPaymentStatus not yet implemented')
  }

  async getBalance(): Promise<WalletBalance> {
    throw new Error('LightsparkProvider.getBalance not yet implemented')
  }

  async getTransactions(_limit: number, _offset: number): Promise<Transaction[]> {
    throw new Error('LightsparkProvider.getTransactions not yet implemented')
  }

  async createWallet(_userId: string): Promise<{ walletId: string; accountId: string }> {
    throw new Error('LightsparkProvider.createWallet not yet implemented')
  }
}
