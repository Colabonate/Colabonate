import { describe, it, expect, vi } from 'vitest'
import { meltRemoteInvoice } from './remote-ecash'

type Quote = { requiredSats: number; mintUrl: string }
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'failed')

function makeDeps(quotes: Record<string, number | Error>, confirm?: (quote: Quote) => Promise<{ preimage?: string }>) {
  return {
    requestMeltQuote: vi.fn(async (_bolt11: string, mintUrl: string): Promise<Quote> => {
      const q = quotes[mintUrl]
      if (q instanceof Error) throw q
      return { requiredSats: q, mintUrl }
    }),
    confirmMelt: vi.fn(confirm ?? (async (_quote: Quote) => ({ preimage: 'a'.repeat(64) }))),
  }
}

describe('meltRemoteInvoice (FU-1002)', () => {
  it('melts at the first mint that can cover the quote and returns the preimage', async () => {
    const deps = makeDeps({ 'https://a': 4300 })
    const result = await meltRemoteInvoice(deps, {
      bolt11: 'lnbc1',
      candidates: [{ mintUrl: 'https://a', balanceSats: 5000 }],
      errorMessage,
    })
    expect(result).toEqual({ ok: true, preimage: 'a'.repeat(64) })
    expect(deps.confirmMelt).toHaveBeenCalledTimes(1)
  })

  it('skips a mint whose quote exceeds its balance and uses the next one', async () => {
    const deps = makeDeps({ 'https://a': 5100, 'https://b': 4300 })
    const result = await meltRemoteInvoice(deps, {
      bolt11: 'lnbc1',
      candidates: [
        { mintUrl: 'https://a', balanceSats: 5000 },
        { mintUrl: 'https://b', balanceSats: 4400 },
      ],
      errorMessage,
    })
    expect(result.ok).toBe(true)
    expect(deps.confirmMelt).toHaveBeenCalledTimes(1)
    expect(deps.confirmMelt.mock.calls[0][0].mintUrl).toBe('https://b')
  })

  it('reports the shortfall and never melts when no mint covers the fee reserve', async () => {
    const deps = makeDeps({ 'https://a': 5100 })
    const result = await meltRemoteInvoice(deps, {
      bolt11: 'lnbc1',
      candidates: [{ mintUrl: 'https://a', balanceSats: 5000 }],
      errorMessage,
    })
    expect(result).toEqual({
      ok: false,
      message: 'Not enough eCash at https://a: need 5100 sats including the fee reserve.',
    })
    expect(deps.confirmMelt).not.toHaveBeenCalled()
  })

  it('fails with the generic message when there is no candidate', async () => {
    const result = await meltRemoteInvoice(makeDeps({}), { bolt11: 'lnbc1', candidates: [], errorMessage })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('No mint holds enough eCash') })
  })

  it('tries the next mint when a quote request fails (nothing spent yet)', async () => {
    const deps = makeDeps({ 'https://a': new Error('mint down'), 'https://b': 4300 })
    const result = await meltRemoteInvoice(deps, {
      bolt11: 'lnbc1',
      candidates: [
        { mintUrl: 'https://a', balanceSats: 9000 },
        { mintUrl: 'https://b', balanceSats: 5000 },
      ],
      errorMessage,
    })
    expect(result.ok).toBe(true)
  })

  it('does not try another mint when the melt itself throws (the payment may have gone out)', async () => {
    const deps = makeDeps({ 'https://a': 4300, 'https://b': 4300 }, async () => {
      throw new Error('melt timed out')
    })
    const result = await meltRemoteInvoice(deps, {
      bolt11: 'lnbc1',
      candidates: [
        { mintUrl: 'https://a', balanceSats: 9000 },
        { mintUrl: 'https://b', balanceSats: 9000 },
      ],
      errorMessage,
    })
    expect(result).toEqual({ ok: false, message: 'melt timed out' })
    expect(deps.confirmMelt).toHaveBeenCalledTimes(1)
  })

  it('succeeds without a preimage when the mint does not return one', async () => {
    const deps = makeDeps({ 'https://a': 4300 }, async () => ({}))
    const result = await meltRemoteInvoice(deps, {
      bolt11: 'lnbc1',
      candidates: [{ mintUrl: 'https://a', balanceSats: 5000 }],
      errorMessage,
    })
    expect(result).toEqual({ ok: true })
  })
})
