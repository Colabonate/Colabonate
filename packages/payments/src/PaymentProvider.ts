export interface Invoice {
  bolt11: string
  paymentHash: string
  amountSats: number
  expiresAt: Date
}

export interface PaymentResult {
  paymentHash: string
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  feeSats?: number
  /**
   * ADR-253: the payment preimage, when the rail exposes one (NWC, WebLN,
   * Alby OAuth). It is the buyer-side proof needed to self-confirm a
   * direct-pay ticket whose invoice the platform never held
   * (`POST /api/tickets/:id/confirm-direct-payment`).
   */
  preimage?: string
}

export interface WalletBalance {
  confirmedSats: number
  unconfirmedSats: number
  pendingSats: number
}

export interface Transaction {
  id: string
  paymentHash: string
  amountSats: number
  type: 'INCOMING' | 'OUTGOING'
  status: 'COMPLETED' | 'PENDING' | 'FAILED'
  memo?: string
  createdAt: Date
}

export interface PaymentProvider {
  createInvoice(amountSats: number, memo: string, webhookUrl?: string): Promise<Invoice>
  createHoldInvoice(amountSats: number, preimageHash: string, memo: string): Promise<Invoice>
  settleHoldInvoice(preimage: string): Promise<void>
  /** FU-02: settle by known paymentHash without holdIndex lookup (for sub-wallet providers). */
  settleHoldInvoiceByHash?(paymentHash: string, preimage: string): Promise<void>
  cancelHoldInvoice(paymentHash: string): Promise<void>
  /**
   * ADR-209: look up an LND-native hold invoice's state (ADR-193). Optional —
   * only providers backed by an LndHoldClient implement it. 'paid' means
   * ACCEPTED (buyer's HTLC locked, funds reserved), 'settled' means released.
   */
  getHoldState?(paymentHash: string): Promise<{ status: 'pending' | 'paid' | 'settled' | 'cancelled'; preimage?: string }>

  payInvoice(bolt11: string): Promise<PaymentResult>
  getPaymentStatus(paymentHash: string): Promise<PaymentResult>

  getBalance(): Promise<WalletBalance>
  getTransactions(limit: number, offset: number): Promise<Transaction[]>

  createWallet?(userId: string): Promise<{ walletId: string; accountId?: string }>

  /**
   * PROB-003 B-α: create an isolated sub-wallet for a private trade.
   * Returns the sub-wallet id (LNBits walletId) so the caller can record
   * it in Offer.lightningSubWalletId / Ticket.escrowSubWalletId /
   * Cooperation.escrowSubWalletId. May return null if the provider does
   * not support sub-wallets (e.g. WebLN-only providers).
   */
  createSubWallet?(label: string): Promise<{ walletId: string; adminkey: string; readonlyKey: string } | null>
}
