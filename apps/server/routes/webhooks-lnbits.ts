import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import type { NostrRelayService } from '../services/nostr-relay.js'
import { confirmPaymentByHash } from '../services/paymentConfirmation.js'
import { storedInvoices } from './lightning.js'

interface LNBitsWebhookPayload {
  payment_hash: string
  pending: boolean
  amount: number
  memo?: string
  checking_id: string
  bolt11?: string
  preimage?: string
  expiry?: number
  time?: number
}

export function createLNBitsWebhookRouter(
  prisma: PrismaClient,
  payments: PaymentProvider,
  nostrService?: NostrRelayService,
) {
  // Fail closed in production: without a shared secret, this endpoint lets
  // anyone who learns/guesses a payment_hash (shown to the buyer in the
  // invoice/QR) POST a fake "paid" confirmation and mark a ticket/
  // cooperation/milestone PAID without any real payment. Mirrors the
  // createProvider() boot-time guard pattern in packages/payments.
  if (process.env.NODE_ENV === 'production' && !process.env.LNBITS_WEBHOOK_SECRET) {
    throw new Error('LNBITS_WEBHOOK_SECRET is required in production (refusing to start with an unauthenticated payment webhook).')
  }

  const router = Router()

  router.post('/lnbits', async (req: Request, res: Response) => {
    try {
      const webhookSecret = process.env.LNBITS_WEBHOOK_SECRET
      if (webhookSecret) {
        const headerSecret = req.headers['x-webhook-secret'] as string | undefined
          || req.headers['authorization']?.replace('Bearer ', '')
        if (headerSecret !== webhookSecret) {
          return res.status(403).json({ error: 'Invalid webhook secret' })
        }
      }

      const payload = req.body as LNBitsWebhookPayload
      const { payment_hash, pending, preimage } = payload

      if (!payment_hash) {
        return res.status(400).json({ error: 'Missing payment_hash' })
      }

      if (pending) {
        return res.json({ success: true, status: 'pending' })
      }

      console.log(`[LNBits Webhook] Payment confirmed: ${payment_hash}`)

      // ADR-241 D1: shared confirm path — same state machine as the lightning
      // poll and /api/beta/demo-pay (Tier-1 parity beta ≡ production).
      const updatedEntities = await confirmPaymentByHash(prisma, payment_hash, {
        preimage,
        nostrService,
        invoiceMap: storedInvoices,
      })

      if (updatedEntities.length === 0) {
        console.log(`[LNBits Webhook] No matching entity for payment_hash: ${payment_hash}`)
      }

      res.json({ success: true, updated: updatedEntities })
    } catch (error) {
      console.error('[LNBits Webhook] Error:', error)
      res.status(500).json({ error: 'Webhook processing failed' })
    }
  })

  router.get('/lnbits/health', async (_req: Request, res: Response) => {
    const providerType = process.env.PAYMENT_PROVIDER ?? 'lnbits'
    const hasAdminKey = !!process.env.LNBITS_ADMIN_KEY
    const hasInvoiceKey = !!process.env.LNBITS_INVOICE_KEY
    const isConfigured = providerType === 'lnbits' && hasAdminKey && hasInvoiceKey

    res.json({
      provider: providerType,
      configured: isConfigured,
      lnbitsUrl: process.env.LNBITS_URL || 'not set',
      webhookSecretSet: !!process.env.LNBITS_WEBHOOK_SECRET,
    })
  })

  return router
}
