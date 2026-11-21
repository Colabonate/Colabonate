import { describe, it, expect } from 'vitest'
import { MAX_TICKET_QUANTITY, resolveShippingSats, resolveTicketQuantity } from './ticket-quantity.js'

describe('resolveTicketQuantity (ADR-394)', () => {
  it('defaults to 1 when no quantity is sent', () => {
    expect(resolveTicketQuantity({ rawQuantity: undefined, unitPriceSats: 1000, stock: 5 })).toEqual({
      ok: true,
      quantity: 1,
      amountSats: 1000,
      shippingSats: 0,
    })
    expect(resolveTicketQuantity({ rawQuantity: null, unitPriceSats: 1000, stock: 5 })).toEqual({
      ok: true,
      quantity: 1,
      amountSats: 1000,
      shippingSats: 0,
    })
  })

  it('multiplies the unit price by the quantity (the bug this fixes)', () => {
    expect(resolveTicketQuantity({ rawQuantity: 3, unitPriceSats: 1000, stock: 5 })).toEqual({
      ok: true,
      quantity: 3,
      amountSats: 3000,
      shippingSats: 0,
    })
  })

  it('allows the full stock and any quantity when stock is unlimited (null)', () => {
    expect(resolveTicketQuantity({ rawQuantity: 5, unitPriceSats: 2600, stock: 5 })).toEqual({
      ok: true,
      quantity: 5,
      amountSats: 13000,
      shippingSats: 0,
    })
    expect(resolveTicketQuantity({ rawQuantity: 42, unitPriceSats: 2600, stock: null })).toEqual({
      ok: true,
      quantity: 42,
      amountSats: 109200,
      shippingSats: 0,
    })
  })

  it('rejects non-integer / zero / negative / non-numeric quantities', () => {
    for (const raw of [0, -1, 1.5, 'abc', NaN, Infinity]) {
      const result = resolveTicketQuantity({ rawQuantity: raw, unitPriceSats: 1000, stock: null })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('INVALID_QUANTITY')
    }
  })

  it('rejects a quantity above the finite stock and reports the available stock', () => {
    const result = resolveTicketQuantity({ rawQuantity: 6, unitPriceSats: 1000, stock: 5 })
    expect(result).toEqual({ ok: false, reason: 'INSUFFICIENT_STOCK', availableStock: 5 })
  })

  it('rejects values that Number() would silently coerce', () => {
    for (const raw of [true, [3], ' 2 ', '2.0', '', {}]) {
      const result = resolveTicketQuantity({ rawQuantity: raw, unitPriceSats: 1000, stock: null })
      expect(result.ok).toBe(false)
    }
  })

  it('caps the quantity even when stock is unlimited', () => {
    expect(resolveTicketQuantity({ rawQuantity: MAX_TICKET_QUANTITY, unitPriceSats: 1, stock: null }).ok).toBe(true)
    const over = resolveTicketQuantity({ rawQuantity: MAX_TICKET_QUANTITY + 1, unitPriceSats: 1, stock: null })
    expect(over).toEqual({ ok: false, reason: 'INVALID_QUANTITY' })
  })

  it('rejects a total that would overflow the INT4 amountSats column', () => {
    const result = resolveTicketQuantity({ rawQuantity: 1000, unitPriceSats: 3_000_000, stock: null })
    expect(result).toEqual({ ok: false, reason: 'INVALID_QUANTITY' })
  })

  it('accepts a numeric string quantity', () => {
    expect(resolveTicketQuantity({ rawQuantity: '2', unitPriceSats: 700, stock: null })).toEqual({
      ok: true,
      quantity: 2,
      amountSats: 1400,
      shippingSats: 0,
    })
  })

  it('adds shipping once per ticket, not per unit (FU-842)', () => {
    expect(resolveTicketQuantity({ rawQuantity: 3, unitPriceSats: 1000, stock: null, shippingSats: 500 })).toEqual({
      ok: true,
      quantity: 3,
      amountSats: 3500,
      shippingSats: 500,
    })
  })
})

describe('resolveShippingSats (ADR-394 FU-842)', () => {
  it('charges the offer shipping cost for physical ITEM/PRODUCT offers', () => {
    expect(resolveShippingSats({ offerType: 'ITEM', deliveryCostSats: 400 })).toBe(400)
    expect(resolveShippingSats({ offerType: 'PRODUCT', physicalType: 'physical', deliveryCostSats: 400 })).toBe(400)
  })

  it('never charges shipping for digital goods or non-shippable offer types', () => {
    expect(resolveShippingSats({ offerType: 'PRODUCT', physicalType: 'digital', deliveryCostSats: 400 })).toBe(0)
    for (const offerType of ['SERVICE', 'AGENT_SETUP', 'COOP']) {
      expect(resolveShippingSats({ offerType, deliveryCostSats: 400 })).toBe(0)
    }
  })

  it('treats a missing, zero, negative or fractional cost as no shipping', () => {
    for (const deliveryCostSats of [null, undefined, 0, -5, 1.5]) {
      expect(resolveShippingSats({ offerType: 'ITEM', deliveryCostSats })).toBe(0)
    }
  })
})
