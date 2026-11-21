/**
 * ADR-417 / FU-1002: pay the invoice of a remote order from the buyer's eCash balance (Cashu melt).
 * Pure orchestration with injected I/O, same candidate rules as the ticket card (ADR-399): try the
 * mints that can cover the amount, largest balance first, skip a mint whose quote (amount plus fee
 * reserve) exceeds its balance. A melt moves real money, so a throw after the quote is surfaced
 * as an error and never retried on another mint.
 */
export interface EcashMeltDeps<Q extends { requiredSats: number }> {
  requestMeltQuote(bolt11: string, mintUrl: string): Promise<Q>
  confirmMelt(quote: Q): Promise<{ preimage?: string }>
}

export interface MeltCandidate {
  mintUrl: string
  balanceSats: number
}

export type EcashMeltResult =
  | { ok: true; preimage?: string }
  | { ok: false; message: string }

const NO_MINT_MESSAGE = 'No mint holds enough eCash to cover this invoice and its fee reserve.'

export async function meltRemoteInvoice<Q extends { requiredSats: number }>(
  deps: EcashMeltDeps<Q>,
  input: { bolt11: string; candidates: ReadonlyArray<MeltCandidate>; errorMessage(err: unknown): string },
): Promise<EcashMeltResult> {
  let message = NO_MINT_MESSAGE
  for (const candidate of input.candidates) {
    let quote: Q
    try {
      quote = await deps.requestMeltQuote(input.bolt11, candidate.mintUrl)
    } catch (err) {
      // Nothing was spent yet: a later mint may still work.
      message = input.errorMessage(err)
      continue
    }
    if (quote.requiredSats > candidate.balanceSats) {
      message = `Not enough eCash at ${candidate.mintUrl}: need ${quote.requiredSats} sats including the fee reserve.`
      continue
    }
    try {
      const result = await deps.confirmMelt(quote)
      return result.preimage ? { ok: true, preimage: result.preimage } : { ok: true }
    } catch (err) {
      // The melt may or may not have gone through: do not try another mint.
      return { ok: false, message: input.errorMessage(err) }
    }
  }
  return { ok: false, message }
}
