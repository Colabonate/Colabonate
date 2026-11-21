import type { Wallet } from '../contexts/WalletContext'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

export interface WebLNProvider {
  enable(): Promise<void>
  sendPayment(bolt11: string): Promise<{ preimage?: string; paymentHash?: string } | undefined>
}

export interface PaymentApiClient {
  post(url: string, body: unknown): Promise<{ json(): Promise<unknown> }>
}

export interface PaymentResult {
  paymentHash: string
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  feeSats?: number
  // ADR-351: the payment preimage, when the underlying rail exposes one —
  // needed to self-report proof of payment against a server-verified
  // paymentHash (e.g. POST /api/workspaces/:id/recharge/:rechargeId/confirm).
  // WebLN/NWC add it explicitly below; Alby OAuth and the custodial rail
  // already spread their full server response through untyped, so it flows
  // through automatically once callers can read it.
  preimage?: string
}

// ---------------------------------------------------------------------------
// Normal (settle-on-receipt) invoice payment — ADR-208 / ADR-228
// ---------------------------------------------------------------------------

/**
 * The payment hash when a rail only reports the preimage. Some WebLN providers
 * resolve `sendPayment()` with `{ preimage }` and no hash (or with nothing at
 * all), so the hash is derived locally — the same sha256 the server applies for
 * NWC (`routes/wallet.ts` → `crypto.createHash('sha256')`).
 */
function paymentHashFromPreimage(preimage: string): string {
  try {
    return bytesToHex(sha256(hexToBytes(preimage)))
  } catch {
    return ''
  }
}

export async function payNormalInvoice(
  wallet: Wallet | null,
  bolt11: string,
  api: PaymentApiClient,
  webln?: WebLNProvider,
): Promise<PaymentResult> {
  if (wallet?.mode === 'NON_CUSTODIAL' && wallet.provider === 'WEBLN') {
    if (!webln) throw new Error('No WebLN wallet available')
    await webln.enable()
    // The money has already left the wallet once sendPayment resolves, so a
    // missing/partial payload must never crash the caller (prod bug: an
    // extension resolving without a result threw on `result.paymentHash` and
    // masked a successful payment).
    const result = (await webln.sendPayment(bolt11)) ?? {}
    const preimage = result.preimage
    return {
      paymentHash: result.paymentHash ?? (preimage ? paymentHashFromPreimage(preimage) : ''),
      status: preimage ? 'SUCCESS' : 'PENDING',
      preimage,
    }
  }

  if (wallet?.mode === 'NON_CUSTODIAL' && wallet.provider === 'NWC') {
    const res = await api.post('/api/wallet/nwc/pay', { bolt11, escrow: false })
    const data = (await res.json().catch(() => ({}))) as { paymentHash?: string; status?: string; feesPaidSats?: number; preimage?: string }
    return {
      paymentHash: data.paymentHash ?? '',
      status: data.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING',
      feeSats: data.feesPaidSats,
      preimage: data.preimage,
    }
  }

  if (wallet?.mode === 'NON_CUSTODIAL' && wallet.provider === 'ALBY_OAUTH') {
    const res = await api.post('/api/wallet/alby/pay', { bolt11 })
    const data = (await res.json().catch(() => ({}))) as { paymentHash?: string; status?: string; feeSats?: number; preimage?: string }
    return {
      paymentHash: data.paymentHash ?? '',
      status: data.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING',
      feeSats: data.feeSats,
      preimage: data.preimage,
    }
  }

  const res = await api.post('/api/wallet/payments/send', { bolt11 })
  const data = (await res.json().catch(() => ({}))) as Partial<PaymentResult>
  return {
    paymentHash: data.paymentHash ?? '',
    status: data.status ?? 'PENDING',
    feeSats: data.feeSats,
    preimage: data.preimage,
  }
}

// ---------------------------------------------------------------------------
// Hold-invoice (3-phase escrow) dispatch-only payment — ADR-209
// ---------------------------------------------------------------------------

export async function dispatchHoldInvoice(
  wallet: Wallet | null,
  bolt11: string,
  api: PaymentApiClient,
  webln?: WebLNProvider,
): Promise<{ dispatched: boolean }> {
  // NWC: server-side dispatch (ADR-208 D5)
  if (wallet?.mode === 'NON_CUSTODIAL' && wallet.provider === 'NWC') {
    const res = await api.post('/api/wallet/nwc/pay', { bolt11, escrow: true })
    const data = await res.json() as { status?: string; message?: string }
    if (data.status === 'DISPATCHED') return { dispatched: true }
    throw new Error(data.message || 'NWC hold-invoice dispatch failed')
  }

  // WebLN: fire-and-forget after synchronous permission check (ADR-209 D2)
  if (wallet?.mode === 'NON_CUSTODIAL' && wallet.provider === 'WEBLN') {
    if (!webln) throw new Error('No WebLN wallet available')
    await webln.enable()
    webln.sendPayment(bolt11).catch((err: unknown) => {
      console.error('[payment-dispatch/WebLN] Hold-invoice dispatch failed:', err instanceof Error ? err.message : err)
    })
    return { dispatched: true }
  }

  // Custodial platform wallet: server-side fire-and-forget dispatch (ADR-209 FU-209-A)
  if (wallet?.mode === 'CUSTODIAL') {
    const res = await api.post('/api/wallet/payments/send', { bolt11, escrow: true })
    const data = await res.json() as { status?: string; error?: string }
    if (data.status === 'DISPATCHED') return { dispatched: true }
    throw new Error(data.error || 'Custodial hold-invoice dispatch failed')
  }

  throw new Error('Hold-invoice payments are not supported by this wallet yet — pay the invoice manually.')
}

// ---------------------------------------------------------------------------
// Helper: determine whether a wallet can pay a hold invoice programmatically
// ---------------------------------------------------------------------------

export function canDispatchHoldInvoice(wallet: Wallet | null): boolean {
  if (!wallet) return false
  if (wallet.mode === 'CUSTODIAL') return true
  return wallet.provider === 'NWC' || wallet.provider === 'WEBLN'
}
