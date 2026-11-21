import { Router, type Request, type Response } from 'express'
import { rejectIfAboveLaunchCap } from '../lib/launch-tx-cap.js'
import type { PaymentProvider } from '@col/payments'
import type { PrismaClient } from '@prisma/client'
import { confirmPaymentByHash } from '../services/paymentConfirmation.js'

export interface StoredInvoice {
  paymentHash: string
  invoice: string
  amountSats: number
  status: 'PENDING' | 'PAID'
  createdAt: number
  description?: string
  /** ADR-209: true for LND-native hold invoices (ADR-193). LNBits never sees
   *  these (they are created directly on LND), so the poll route must confirm
   *  them via getHoldState instead of getPaymentStatus. */
  isHold?: boolean
}

const storedInvoices = new Map<string, StoredInvoice>()

export { storedInvoices }

// SECURITY (pentest G3, FU-710): storedInvoices is restart-lossy and gets an
// entry on every unauthenticated POST /invoice call — with no bound, a
// distributed flood (rate limits are per-IP) grows it without limit until the
// process OOMs (single-instance deploy per ADR-252 D4). TTL matches how long
// an unpaid invoice stays useful; the size cap is a hard backstop even if the
// TTL sweep hasn't run recently.
const INVOICE_TTL_MS = Number(process.env.STORED_INVOICE_TTL_MS ?? 30 * 60_000)
const MAX_STORED_INVOICES = Number(process.env.STORED_INVOICE_MAX_ENTRIES ?? 10_000)

/** Removes entries older than INVOICE_TTL_MS. Returns the number removed.
 *  Exported so index.ts can also run it as a periodic server tick. */
export function sweepExpiredInvoices(now: number = Date.now()): number {
  let removed = 0
  for (const [hash, invoice] of storedInvoices) {
    if (now - invoice.createdAt > INVOICE_TTL_MS) {
      storedInvoices.delete(hash)
      removed++
    }
  }
  return removed
}

function evictOldestIfOverCapacity() {
  // Map preserves insertion order — the first key is the oldest entry.
  while (storedInvoices.size > MAX_STORED_INVOICES) {
    const oldest = storedInvoices.keys().next().value
    if (oldest === undefined) break
    storedInvoices.delete(oldest)
  }
}

export function registerInvoice(paymentHash: string, invoice: string, amountSats: number, description: string, isHold = false) {
  sweepExpiredInvoices()
  storedInvoices.set(paymentHash, {
    paymentHash,
    invoice,
    amountSats,
    status: 'PENDING',
    createdAt: Date.now(),
    description,
    isHold,
  })
  evictOldestIfOverCapacity()
}

export function createLightningRouter(payments: PaymentProvider, prisma?: PrismaClient) {
  const router = Router()

  router.post('/invoice', async (req: Request, res: Response) => {
    try {
      const { amountSats, description, webhookUrl } = req.body

      if (!amountSats || amountSats <= 0) {
        return res.status(400).json({ error: 'Invalid amountSats' })
      }
      // ADR-252 D2 / FU-655: launch-phase per-transaction cap.
      if (rejectIfAboveLaunchCap(res, Number(amountSats))) return

      const result = await payments.createInvoice(amountSats, description || '', webhookUrl)
      const paymentHash = result.paymentHash
      const invoice = result.bolt11

      registerInvoice(paymentHash, invoice, amountSats, description || '')

      console.log(`[Lightning] Created invoice for ${amountSats} sats: ${paymentHash}`)

      res.json({
        success: true,
        paymentHash,
        invoice,
        amountSats,
        description: description || '',
      })
    } catch (error) {
      console.error('Failed to create invoice:', error)
      res.status(500).json({ error: 'Failed to create invoice' })
    }
  })

  router.get('/invoice/:paymentHash', async (req: Request, res: Response) => {
    try {
      const { paymentHash } = req.params
      const hash = Array.isArray(paymentHash) ? paymentHash[0] : paymentHash
      const stored = storedInvoices.get(hash)

      if (!stored) {
        return res.status(404).json({ error: 'Invoice not found' })
      }

      let paid = stored.status === 'PAID'
      let status = stored.status

      if (stored.status === 'PENDING') {
        try {
          let confirmed = false
          let preimage: string | null = null
          let holdChecked = false

          // ADR-209: hold invoices are created directly on LND (ADR-193) —
          // LNBits has no record of them, so getPaymentStatus can never
          // confirm them. ACCEPTED already means the buyer's HTLC is locked
          // (funds reserved), which is what the escrow state machine expects.
          if (stored.isHold && payments.getHoldState) {
            try {
              const hold = await payments.getHoldState(hash)
              holdChecked = true
              if (hold.status === 'paid' || hold.status === 'settled') {
                confirmed = true
                preimage = hold.preimage ?? null
              }
            } catch {
              // Hold client not configured (dev degrade, ADR-193) — fall
              // through to the LNBits lookup below.
            }
          }

          if (!confirmed && !holdChecked) {
            const result = await payments.getPaymentStatus(hash)
            confirmed = result.status === 'SUCCESS'
          }

          if (confirmed) {
            paid = true
            status = 'PAID'
            console.log(`[Lightning] Payment confirmed for: ${hash}`)
            if (prisma) {
              await confirmPaymentByHash(prisma, hash, { invoiceMap: storedInvoices, preimage })
            } else {
              stored.status = 'PAID'
              storedInvoices.set(hash, stored)
            }
          }
        } catch (e) {
          console.error('[Lightning] Failed to check payment status:', e)
        }
      }

      res.json({
        success: true,
        paymentHash: stored.paymentHash,
        invoice: stored.invoice,
        amountSats: stored.amountSats,
        status,
        paid,
        createdAt: stored.createdAt,
      })
    } catch (error) {
      console.error('Failed to fetch invoice status:', error)
      res.status(500).json({ error: 'Failed to fetch invoice status' })
    }
  })

  router.post('/webhook', async (req: Request, res: Response) => {
    try {
      const { payment_hash, pending } = req.body

      if (!payment_hash) {
        return res.status(400).json({ error: 'Missing payment_hash' })
      }

      if (pending) {
        return res.json({ success: true, status: 'pending' })
      }

      console.log(`[Lightning Webhook] Payment received for: ${payment_hash}`)

      let updated: string[] = []
      if (prisma) {
        updated = await confirmPaymentByHash(prisma, payment_hash, { invoiceMap: storedInvoices })
      } else {
        const stored = storedInvoices.get(payment_hash)
        if (stored) { stored.status = 'PAID'; storedInvoices.set(payment_hash, stored) }
      }

      res.json({ success: true, updated })
    } catch (error) {
      console.error('Failed to process webhook:', error)
      res.status(500).json({ error: 'Failed to process webhook' })
    }
  })

  return router
}
