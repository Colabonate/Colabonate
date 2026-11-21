import { SERVER_BASE_URL } from '../fixtures/test-fixtures.js'

export class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = SERVER_BASE_URL) {
    this.baseUrl = baseUrl
  }

  async post(path: string, body: Record<string, unknown>, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    return res.json()
  }

  async patch(path: string, body: Record<string, unknown>, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })
    return res.json()
  }

  async get(path: string, token?: string) {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${this.baseUrl}${path}`, { headers })
    return res.json()
  }

  async demoLogin(pubkey: string): Promise<{ pubkey: string; token: string }> {
    return this.post('/api/auth/demo', { pubkey })
  }

  async createOffer(sellerPubkey: string, data: Record<string, unknown> = {}, token?: string) {
    return this.post('/api/offers', {
      sellerPubkey,
      title: 'Test Offer',
      description: 'E2E test offer',
      priceSats: 10000,
      offerType: 'SERVICE',
      ...data,
    }, token)
  }

  async createTicket(buyerPubkey: string, offerId: string, token?: string) {
    return this.post('/api/tickets', {
      buyerPubkey,
      offerId,
      amountSats: 10000,
    }, token)
  }

  async acceptTicket(ticketId: string, sellerToken: string) {
    // PATCH /api/tickets/:id requires auth; the acting party (seller) must be a participant.
    return this.patch(`/api/tickets/${ticketId}`, {
      status: 'ACCEPTED',
    }, sellerToken)
  }

  async fundEscrowPhase(ticketId: string, callerPubkey: string, phase: number, token?: string) {
    return this.post(`/api/tickets/${ticketId}/escrow/phase${phase}`, {
      callerPubkey,
    }, token)
  }

  async releaseEscrow(ticketId: string, callerPubkey: string, token?: string) {
    return this.post(`/api/tickets/${ticketId}/escrow/release`, {
      callerPubkey,
    }, token)
  }

  async cancelEscrow(ticketId: string, callerPubkey: string, token?: string) {
    return this.post(`/api/tickets/${ticketId}/escrow/cancel`, {
      callerPubkey,
    }, token)
  }

  async createInvoice(amountSats: number, description: string = '') {
    return this.post('/api/lightning/invoice', { amountSats, description })
  }

  async triggerWebhook(paymentHash: string) {
    return this.post('/api/lightning/webhook', { payment_hash: paymentHash })
  }

  async getInvoiceStatus(paymentHash: string) {
    return this.get(`/api/lightning/invoice/${paymentHash}`)
  }

  async createWallet(pubkey: string, token?: string) {
    return this.post('/api/wallet/create', { pubkey }, token)
  }

  async sendPayment(bolt11: string, pubkey: string, token?: string) {
    return this.post('/api/wallet/payments/send', { bolt11, pubkey }, token)
  }

  async getWalletBalance(pubkey: string, token?: string) {
    return this.get(`/api/wallet?pubkey=${pubkey}`, token)
  }

  async getTransactions(pubkey: string, token?: string) {
    return this.get(`/api/wallet/transactions?pubkey=${pubkey}`, token)
  }

  async openDispute(ticketId: string, callerPubkey: string, reason: string, token?: string) {
    return this.post(`/api/tickets/${ticketId}/dispute`, {
      callerPubkey,
      reason,
    }, token)
  }
}
