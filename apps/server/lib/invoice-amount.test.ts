import { describe, it, expect } from 'vitest'
import { assertSellerInvoiceAmount } from './invoice-amount.js'

// Real 1-sat mainnet invoice minted 2026-09-20 (blink.sv) — same fixture as
// invoiceFreshness.test.ts. `lnbc10n` = 10 nano-BTC = 1 sat.
const ONE_SAT_INVOICE =
  'lnbc10n1p4tq3ywpp5200qw8j7khl6njt07z0raexu5t0kxtt52xs3x3t6xsc46zh048lssp5985zxw2jgks73wxx5rxyq06ayavfqsssu5d2gvr67d09pytc8yeqxq9z0rgqnp4qvyndeaqzman7h898jxm98dzkm0mlrsx36s93smrur7h0azyyuxc5rzjqwghf7zxvfkxq5a6sr65g0gdkv768p83mhsnt0msszapamzx2qvuxqqqqrt49lmtcqqqqqqqqqqq86qq9qcqzpuhp5tzs3mkx7ed8kvd5ynqjk5vnwakh2mrp9te7wf0mk9gcw6ty2ce0q9qyyssqp8aa2ttzdyvav4leh39h7zc65um58ev20wm4jvamzgkkah773krxzzghr2rrnzkv85qtpg0jjh40any075smelp9ssqk2u07a8djm3spas27hp'

describe('assertSellerInvoiceAmount (ADR-394)', () => {
  it('accepts an invoice whose decoded amount matches the expected sats', () => {
    expect(() => assertSellerInvoiceAmount(ONE_SAT_INVOICE, 1)).not.toThrow()
  })

  it('rejects an invoice whose amount does not match the listing price', () => {
    expect(() => assertSellerInvoiceAmount(ONE_SAT_INVOICE, 100)).toThrow(/amount mismatch/i)
  })

  it('rejects an undecodable invoice rather than silently accepting it', () => {
    expect(() => assertSellerInvoiceAmount('not-an-invoice', 1)).toThrow(/invoice/i)
  })
})
