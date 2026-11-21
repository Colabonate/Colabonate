import { useCallback } from 'react'
import { apiCall } from '../lib/api'
import { useWallet } from '../contexts/WalletContext'
import { useBetaMode } from './useBetaMode'
import { canDispatchHoldInvoice } from '../lib/payment-dispatch'

export type PaymentMode = 'DEMO' | 'NWC' | 'ALBY_OAUTH' | 'WEBLN' | 'MANUAL'

export interface PayInvoiceParams {
  invoice: string
  paymentHash: string
  /** ADR-184 hold invoice (3-phase escrow). When true, the payment is
   *  dispatched without waiting for settlement; the caller must poll for
   *  confirmation (pollUntilPaid). */
  escrow?: boolean
}

export interface PayInvoiceResult {
  ok: boolean
  mode: PaymentMode
  // ADR-372: preimage when the underlying rail exposes one (WebLN/NWC) — needed
  // to self-confirm a non-platform invoice (e.g. the hosted-canvas fee invoice
  // against PLATFORM_LN_ADDRESS) that has no server-side poll endpoint.
  preimage?: string
  error?: string
}

export interface PollPaidOptions {
  maxAttempts?: number
  intervalMs?: number
}

// ADR-241 D4: single client-side pay branch — replaces the 3 near-identical
// isBeta/NWC/WebLN inline blocks (CoopDetail fund-escrow, CoopDetail milestone
// release, TicketDetailView release-payment) and is the branch ticket funding
// (F1-F3) never had. Canonical order: isBeta demo-pay → NWC/ALBY_OAUTH
// (server-side, ADR-208/228 — closes the G6 gap where ALBY_OAUTH fell through
// to the WebLN branch) → WebLN extension inline → MANUAL (caller shows QR/copy).
//
// ADR-209: hold invoices are routed to WalletContext.payHoldInvoice() which
// performs a dispatch-only payment and returns immediately. Normal invoices
// still go through WalletContext.sendPayment().
export function usePayment() {
  const { wallet, sendPayment, payHoldInvoice } = useWallet()
  const { isBeta } = useBetaMode()

  const payInvoice = useCallback(async ({ invoice, paymentHash, escrow }: PayInvoiceParams): Promise<PayInvoiceResult> => {
    if (isBeta) {
      try {
        const res = await apiCall('/api/beta/demo-pay', {
          method: 'POST',
          body: JSON.stringify({ paymentHash }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          return { ok: false, mode: 'DEMO', error: data.error || 'Demo payment failed' }
        }
        return { ok: true, mode: 'DEMO' }
      } catch (err: any) {
        return { ok: false, mode: 'DEMO', error: err?.message || 'Demo payment failed' }
      }
    }

    // Hold invoice path (ADR-184 / ADR-209): NWC, WebLN, and the custodial
    // platform wallet can dispatch these programmatically. Alby OAuth has no
    // hold-invoice capability and is routed to MANUAL so the caller can show
    // the QR/copy fallback.
    if (escrow) {
      if (!canDispatchHoldInvoice(wallet)) {
        return {
          ok: false,
          mode: 'MANUAL',
          error: 'Escrow payments can only be auto-paid with a connected platform, NWC, or WebLN wallet right now — pay the invoice manually.',
        }
      }
      try {
        await payHoldInvoice(invoice)
        return { ok: true, mode: wallet!.provider as PaymentMode }
      } catch (err: any) {
        return { ok: false, mode: wallet!.provider as PaymentMode, error: `Payment dispatch failed: ${err?.message || 'Unknown error'}` }
      }
    }

    // Normal (settle-on-receipt) invoice path.
    if (wallet?.mode === 'NON_CUSTODIAL' && (wallet.provider === 'NWC' || wallet.provider === 'ALBY_OAUTH')) {
      try {
        const result = await sendPayment(invoice)
        return { ok: true, mode: wallet.provider, preimage: result.preimage }
      } catch (err: any) {
        return { ok: false, mode: wallet.provider, error: `Payment failed: ${err?.message || 'Unknown error'}` }
      }
    }

    if (typeof window !== 'undefined' && window.webln) {
      try {
        await window.webln.enable()
        const sent = await window.webln.sendPayment(invoice)
        return { ok: true, mode: 'WEBLN', preimage: sent?.preimage }
      } catch (err: any) {
        if (err?.message?.includes('User rejected') || err?.code === 'USER_REJECTED') {
          return { ok: false, mode: 'WEBLN', error: 'Payment rejected by wallet.' }
        }
        if (err?.message?.includes('Could not pay')) {
          return { ok: false, mode: 'WEBLN', error: 'Payment failed — insufficient balance or routing error.' }
        }
        return { ok: false, mode: 'WEBLN', error: `Payment failed: ${err?.message || 'Unknown error'}` }
      }
    }

    return {
      ok: false,
      mode: 'MANUAL',
      error: 'No Lightning wallet found. Please install Alby or another WebLN-compatible wallet.',
    }
  }, [isBeta, wallet, sendPayment, payHoldInvoice])

  const pollUntilPaid = useCallback(async (
    paymentHash: string,
    { maxAttempts = 20, intervalMs = 1500 }: PollPaidOptions = {},
  ): Promise<boolean> => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, intervalMs))
      const res = await apiCall(`/api/lightning/invoice/${paymentHash}`)
      if (res.ok) {
        const data = await res.json()
        if (data.paid) return true
      }
    }
    return false
  }, [])

  return { payInvoice, pollUntilPaid, isBeta, wallet }
}
