import { describe, it, expect } from 'vitest'
import { isInvoiceFresh } from './invoiceFreshness.js'

// Real 1-sat mainnet invoice minted 2026-09-20 (blink.sv), default 1h expiry.
const INVOICE =
  'lnbc10n1p4tq3ywpp5200qw8j7khl6njt07z0raexu5t0kxtt52xs3x3t6xsc46zh048lssp5985zxw2jgks73wxx5rxyq06ayavfqsssu5d2gvr67d09pytc8yeqxq9z0rgqnp4qvyndeaqzman7h898jxm98dzkm0mlrsx36s93smrur7h0azyyuxc5rzjqwghf7zxvfkxq5a6sr65g0gdkv768p83mhsnt0msszapamzx2qvuxqqqqrt49lmtcqqqqqqqqqqq86qq9qcqzpuhp5tzs3mkx7ed8kvd5ynqjk5vnwakh2mrp9te7wf0mk9gcw6ty2ce0q9qyyssqp8aa2ttzdyvav4leh39h7zc65um58ev20wm4jvamzgkkah773krxzzghr2rrnzkv85qtpg0jjh40any075smelp9ssqk2u07a8djm3spas27hp'

describe('isInvoiceFresh', () => {
  it('is false for garbage', () => {
    expect(isInvoiceFresh('not-an-invoice')).toBe(false)
  })
  it('is false for an invoice long past its expiry', () => {
    expect(isInvoiceFresh(INVOICE, Math.floor(Date.now() / 1000) + 30 * 24 * 3600)).toBe(false)
  })
  it('is true for an invoice that was just created', () => {
    // timestamp of the sample is fixed, so evaluate "now" right after it
    expect(isInvoiceFresh(INVOICE, Math.floor(Date.parse('2026-09-20T22:00:00Z') / 1000))).toBe(true)
  })
})
