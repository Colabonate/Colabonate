import type { CreateRemoteOrderResponse, RemoteInvoiceResponse, RemoteOrderView } from './remote-orders-api'
import type { ZapTemplate } from './zap-request'

/**
 * ADR-417: pure orchestration of a remote-offer purchase. All I/O is injected
 * so the flow can be unit-tested without React, the network or a wallet.
 */
export interface PayFlowDeps {
  createOrder(offerId: string, quantity: number): Promise<CreateRemoteOrderResponse>
  signZap(template: ZapTemplate): Promise<unknown>
  requestInvoice(orderId: string, zapRequest?: unknown): Promise<RemoteInvoiceResponse>
  payInvoice(p: { invoice: string; paymentHash: string }): Promise<{ ok: boolean; mode: string; preimage?: string; error?: string }>
  confirm(orderId: string, preimage: string): Promise<{ order: RemoteOrderView }>
  /** Maps any thrown value to a user-facing text. */
  errorMessage(err: unknown): string
}

export type PayFlowStage = 'order' | 'sign' | 'invoice' | 'pay' | 'confirm'

export type PayFlowResult =
  | { kind: 'paid'; order: RemoteOrderView }
  | {
      kind: 'manual'
      order: RemoteOrderView
      bolt11: string
      paymentHash: string
      reason: 'wallet-unavailable' | 'wallet-failed' | 'no-preimage'
      detail?: string
    }
  | { kind: 'error'; stage: PayFlowStage; message: string; order?: RemoteOrderView }

export async function runRemotePayment(
  deps: PayFlowDeps,
  input: { offerId: string; quantity?: number },
): Promise<PayFlowResult> {
  // 1. Create the order.
  let created: CreateRemoteOrderResponse
  try {
    created = await deps.createOrder(input.offerId, input.quantity ?? 1)
  } catch (err) {
    return { kind: 'error', stage: 'order', message: deps.errorMessage(err) }
  }

  let order: RemoteOrderView = created.order

  // 2. Sign the NIP-57 zap request when the server handed out a template.
  let zap: unknown = undefined
  if (created.zapRequestTemplate) {
    try {
      zap = await deps.signZap(created.zapRequestTemplate)
    } catch (err) {
      return { kind: 'error', stage: 'sign', message: deps.errorMessage(err), order }
    }
  }

  // 3. Request the invoice (zap request attached only when signed).
  let invoice: RemoteInvoiceResponse
  try {
    invoice = zap === undefined
      ? await deps.requestInvoice(order.id)
      : await deps.requestInvoice(order.id, zap)
  } catch (err) {
    return { kind: 'error', stage: 'invoice', message: deps.errorMessage(err), order }
  }
  order = invoice.order

  // 4. Pay the invoice through the wallet. A throw counts as MANUAL.
  let pay: { ok: boolean; mode: string; preimage?: string; error?: string }
  try {
    pay = await deps.payInvoice({ invoice: invoice.bolt11, paymentHash: invoice.paymentHash })
  } catch {
    pay = { ok: false, mode: 'MANUAL' }
  }

  const manual = (reason: 'wallet-unavailable' | 'wallet-failed' | 'no-preimage', detail?: string): PayFlowResult => ({
    kind: 'manual',
    order,
    bolt11: invoice.bolt11,
    paymentHash: invoice.paymentHash,
    reason,
    ...(detail !== undefined ? { detail } : {}),
  })

  if (pay.ok && pay.preimage) {
    // 5. Confirm the payment with the preimage.
    try {
      const confirmed = await deps.confirm(order.id, pay.preimage)
      return { kind: 'paid', order: confirmed.order }
    } catch (err) {
      return { kind: 'error', stage: 'confirm', message: deps.errorMessage(err), order }
    }
  }
  if (pay.ok) {
    // The wallet may have paid; the UI waits for server-side detection.
    return manual('no-preimage')
  }
  if (pay.mode === 'MANUAL') {
    return manual('wallet-unavailable')
  }
  return manual('wallet-failed', pay.error)
}
