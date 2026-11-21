import { describe, it, expect, beforeEach } from 'vitest'
import { MockPaymentProvider } from './MockPaymentProvider.js'

describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider

  beforeEach(() => {
    provider = new MockPaymentProvider()
  })

  describe('createInvoice', () => {
    it('M1: returns bolt11 starting with lnbc, status PENDING', async () => {
      const invoice = await provider.createInvoice(1000, 'test memo')

      expect(invoice.bolt11).toMatch(/^lnbc/)
      expect(invoice.amountSats).toBe(1000)
      expect(invoice.paymentHash).toBeDefined()
      expect(invoice.expiresAt).toBeInstanceOf(Date)

      const state = provider.getInvoiceState(invoice.paymentHash)
      expect(state?.status).toBe('PENDING')
      expect(state?.isHold).toBe(false)
    })
  })

  describe('createHoldInvoice', () => {
    it('M2: returns invoice with status PENDING, cannot be paid via payInvoice', async () => {
      const invoice = await provider.createHoldInvoice(2000, 'preimage-hash-abc', 'hold memo')

      expect(invoice.bolt11).toMatch(/^lnbc/)
      expect(invoice.amountSats).toBe(2000)

      const state = provider.getInvoiceState(invoice.paymentHash)
      expect(state?.status).toBe('PENDING')
      expect(state?.isHold).toBe(true)

      const result = await provider.payInvoice(invoice.bolt11)
      expect(result.status).toBe('PENDING')
      expect(state?.status).toBe('PENDING')
    })
  })

  describe('payInvoice', () => {
    it('M3: matching bolt11 → PAID, balance +amount', async () => {
      const invoice = await provider.createInvoice(1000, 'pay test')

      const result = await provider.payInvoice(invoice.bolt11)

      expect(result.status).toBe('SUCCESS')
      expect(result.paymentHash).toBe(invoice.paymentHash)
      expect(result.feeSats).toBe(0)

      const state = provider.getInvoiceState(invoice.paymentHash)
      expect(state?.status).toBe('PAID')

      const balance = await provider.getBalance()
      expect(balance.confirmedSats).toBe(1000)
    })

    it('M4: already paid → FAILED', async () => {
      const invoice = await provider.createInvoice(500, 'double pay')
      await provider.payInvoice(invoice.bolt11)

      const result = await provider.payInvoice(invoice.bolt11)
      expect(result.status).toBe('FAILED')
    })

    it('M5: unknown bolt11 → FAILED', async () => {
      const result = await provider.payInvoice('lnbc_unknown_invoice')
      expect(result.status).toBe('FAILED')
    })
  })

  describe('settleHoldInvoice', () => {
    it('M6: valid preimage hash → SETTLED, balance +amount', async () => {
      const invoice = await provider.createHoldInvoice(3000, 'pre-hash-1', 'settle test')

      const state = provider.getInvoiceState(invoice.paymentHash)
      expect(state?.preimageHash).toBe('pre-hash-1')

      await provider.settleHoldInvoice('pre-hash-1')

      const updated = provider.getInvoiceState(invoice.paymentHash)
      expect(updated?.status).toBe('SETTLED')

      const balance = await provider.getBalance()
      expect(balance.confirmedSats).toBe(3000)
    })

    it('M7: already settled → throws', async () => {
      const invoice = await provider.createHoldInvoice(1000, 'pre-hash-2', 'double settle')
      await provider.settleHoldInvoice('pre-hash-2')

      await expect(provider.settleHoldInvoice('pre-hash-2'))
        .rejects.toThrow('already settled')
    })

    it('M8: cancelled invoice → throws', async () => {
      const invoice = await provider.createHoldInvoice(1000, 'pre-hash-3', 'settle cancelled')
      await provider.cancelHoldInvoice(invoice.paymentHash)

      await expect(provider.settleHoldInvoice('pre-hash-3'))
        .rejects.toThrow('already cancelled')
    })
  })

  describe('cancelHoldInvoice', () => {
    it('M9: valid hash → CANCELLED', async () => {
      const invoice = await provider.createHoldInvoice(2000, 'pre-hash-4', 'cancel test')

      await provider.cancelHoldInvoice(invoice.paymentHash)

      const state = provider.getInvoiceState(invoice.paymentHash)
      expect(state?.status).toBe('CANCELLED')
    })

    it('M10: already cancelled → throws', async () => {
      const invoice = await provider.createHoldInvoice(1000, 'pre-hash-5', 'double cancel')
      await provider.cancelHoldInvoice(invoice.paymentHash)

      await expect(provider.cancelHoldInvoice(invoice.paymentHash))
        .rejects.toThrow('already cancelled')
    })

    it('M11: settled invoice → throws', async () => {
      const invoice = await provider.createHoldInvoice(1000, 'pre-hash-6', 'cancel settled')
      await provider.settleHoldInvoice('pre-hash-6')

      await expect(provider.cancelHoldInvoice(invoice.paymentHash))
        .rejects.toThrow('already settled')
    })

    it('M12: regular invoice hash → throws', async () => {
      const invoice = await provider.createInvoice(1000, 'regular')

      await expect(provider.cancelHoldInvoice(invoice.paymentHash))
        .rejects.toThrow('Not a hold invoice')
    })
  })

  describe('getPaymentStatus', () => {
    it('M13: pending → PENDING', async () => {
      const invoice = await provider.createInvoice(500, 'status pending')
      const result = await provider.getPaymentStatus(invoice.paymentHash)
      expect(result.status).toBe('PENDING')
    })

    it('M14: paid → SUCCESS', async () => {
      const invoice = await provider.createInvoice(500, 'status paid')
      await provider.payInvoice(invoice.bolt11)

      const result = await provider.getPaymentStatus(invoice.paymentHash)
      expect(result.status).toBe('SUCCESS')
    })

    it('M15: cancelled → FAILED', async () => {
      const invoice = await provider.createHoldInvoice(500, 'ph-cancel', 'status cancel')
      await provider.cancelHoldInvoice(invoice.paymentHash)

      const result = await provider.getPaymentStatus(invoice.paymentHash)
      expect(result.status).toBe('FAILED')
    })

    it('M16: unknown hash → FAILED', async () => {
      const result = await provider.getPaymentStatus('nonexistent-hash')
      expect(result.status).toBe('FAILED')
    })
  })

  describe('getBalance', () => {
    it('M17: reflects paid/settled amounts', async () => {
      const inv1 = await provider.createInvoice(1000, 'bal1')
      await provider.payInvoice(inv1.bolt11)

      const inv2 = await provider.createHoldInvoice(2000, 'bal-ph', 'bal2')
      await provider.settleHoldInvoice('bal-ph')

      const balance = await provider.getBalance()
      expect(balance.confirmedSats).toBe(3000)
    })
  })

  describe('getTransactions', () => {
    it('M18: returns all completed invoices', async () => {
      const inv1 = await provider.createInvoice(100, 'tx1')
      await provider.payInvoice(inv1.bolt11)

      const inv2 = await provider.createInvoice(200, 'tx2')
      await provider.payInvoice(inv2.bolt11)

      const txs = await provider.getTransactions(10, 0)
      expect(txs).toHaveLength(2)
      expect(txs.every(t => t.type === 'INCOMING')).toBe(true)
      expect(txs.every(t => t.status === 'COMPLETED')).toBe(true)
    })
  })

  describe('error simulation', () => {
    it('M19: network error → all methods throw', async () => {
      const failProvider = new MockPaymentProvider({ simulateNetworkError: true })

      await expect(failProvider.createInvoice(100, 'err')).rejects.toThrow('Simulated network error')
      await expect(failProvider.createHoldInvoice(100, 'h', 'err')).rejects.toThrow('Simulated network error')
      await expect(failProvider.payInvoice('lnbc')).rejects.toThrow('Simulated network error')
      await expect(failProvider.getPaymentStatus('x')).rejects.toThrow('Simulated network error')
      await expect(failProvider.getBalance()).rejects.toThrow('Simulated network error')
      await expect(failProvider.getTransactions(10, 0)).rejects.toThrow('Simulated network error')
    })

    it('M20: configurable settle failure → throws for specific hash', async () => {
      const failProvider = new MockPaymentProvider({ failSettleOnHash: 'target-prehash' })
      await failProvider.createHoldInvoice(1000, 'target-prehash', 'fail test')

      await expect(failProvider.settleHoldInvoice('target-prehash'))
        .rejects.toThrow('Simulated settle failure')
    })
  })
})
