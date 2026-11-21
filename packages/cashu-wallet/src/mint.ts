// @col/cashu — mint client (ADR-187). The network-touching module.
//
// Thin wrapper over cashu-ts v4 `Mint` + `Wallet`, exposing a number-sats API
// that matches the rest of the codebase. This is the seam where ecash meets the
// existing Lightning rail: a mint quote IS a bolt11 our LNBits/Lightspark
// provider already pays. Verified live in Phase 2 (no unit tests — network).

import { Mint, Wallet } from '@cashu/cashu-ts'
import type { Proof, MeltQuoteBolt11Response } from '@cashu/cashu-ts'
import type { StoredProof } from './types.js'

function amountToSats(a: unknown): number {
  if (typeof a === 'number') return a
  if (a && typeof (a as { toNumber?: () => number }).toNumber === 'function') {
    return (a as { toNumber: () => number }).toNumber()
  }
  return Number(a)
}

function toStoredProof(p: Proof): StoredProof {
  const witness = (p as { witness?: unknown }).witness
  return {
    id: p.id,
    amount: amountToSats(p.amount),
    secret: p.secret,
    C: p.C,
    ...(witness != null
      ? { witness: typeof witness === 'string' ? witness : JSON.stringify(witness) }
      : {}),
  }
}

export interface MintQuote {
  /** Quote id used to check payment + mint proofs. */
  quote: string
  /** bolt11 invoice the buyer pays (Lightning -> ecash). */
  bolt11: string
  /** Mint-reported state, e.g. 'UNPAID' | 'PAID' | 'ISSUED'. */
  state: string
}

export interface MeltQuote {
  quote: string
  /** Amount that will be melted, in sats. */
  amountSats: number
  /** Fee reserve the mint requires on top of the amount, in sats. */
  feeReserveSats: number
  state: string
  /** Opaque cashu-ts quote object required to complete the melt (do not mutate). */
  _raw: MeltQuoteBolt11Response
}

/**
 * One connected mint. Construct, then `await load()` once before use.
 * Holds no user key; P2PK signing material is supplied per-call by the app.
 */
export class MintClient {
  readonly mintUrl: string
  private readonly mint: Mint
  /** Underlying cashu-ts wallet — exposed for advanced Phase-2 flows. */
  readonly wallet: Wallet

  constructor(mintUrl: string, unit = 'sat') {
    this.mintUrl = mintUrl
    this.mint = new Mint(mintUrl)
    this.wallet = new Wallet(this.mint, { unit })
  }

  /** Fetch keysets/keys (NUT-01/02). Call once after construction. */
  async load(): Promise<void> {
    await this.wallet.loadMint()
  }

  async getInfo(): Promise<{ name?: string; version?: string }> {
    const info = await this.mint.getInfo()
    return { name: info.name, version: info.version }
  }

  // — Lightning -> ecash —

  /** Request a mint quote; returns the bolt11 to be paid via the Lightning rail. */
  async requestMintQuote(amountSats: number): Promise<MintQuote> {
    const q = await this.wallet.createMintQuoteBolt11(amountSats)
    return { quote: q.quote, bolt11: q.request, state: String(q.state) }
  }

  async checkMintQuote(quote: string): Promise<string> {
    const q = await this.wallet.checkMintQuoteBolt11(quote)
    return String(q.state)
  }

  /** Mint proofs against a PAID quote. */
  async mintProofs(amountSats: number, quote: string): Promise<StoredProof[]> {
    const proofs = await this.wallet.mintProofsBolt11(amountSats, quote)
    return proofs.map(toStoredProof)
  }

  // — ecash -> Lightning —

  async requestMeltQuote(bolt11: string): Promise<MeltQuote> {
    const q = await this.wallet.createMeltQuoteBolt11(bolt11)
    return {
      quote: q.quote,
      amountSats: amountToSats(q.amount),
      feeReserveSats: amountToSats(q.fee_reserve),
      state: String(q.state),
      _raw: q,
    }
  }

  /**
   * Pay a bolt11 by melting the given proofs. Returns change proofs (overpaid
   * fees) and, when the mint reports it (NUT-05), the payment preimage (the
   * self-verifying proof a Direct-Pay ticket can be confirmed with, ADR-399).
   */
  async meltProofs(meltQuote: MeltQuote, proofs: readonly StoredProof[]): Promise<{ change: StoredProof[]; preimage?: string }> {
    const res = await this.wallet.meltProofsBolt11(meltQuote._raw, proofs as unknown as Proof[])
    const change = (res as { change?: Proof[] }).change ?? []
    const preimage = (res as { quote?: { payment_preimage?: string | null } }).quote?.payment_preimage ?? undefined
    return { change: change.map(toStoredProof), ...(preimage ? { preimage } : {}) }
  }

  // — receive / send tokens —

  /** Claim a received `cashuA…` token into fresh proofs (swap at mint). */
  async receiveToken(tokenString: string): Promise<StoredProof[]> {
    const proofs = await this.wallet.receive(tokenString)
    return proofs.map(toStoredProof)
  }

  /**
   * Claim a P2PK-locked `cashuA…` token: the mint requires the holder of the
   * lock privkey to sign the proofs before the swap; we hand the privkey in
   * via `ReceiveConfig.privkey` (NUT-14/NIP-61 nutzap receive flow).
   */
  async receiveLockedToken(tokenString: string, privkey: string): Promise<StoredProof[]> {
    const proofs = await this.wallet.receive(tokenString, { privkey })
    return proofs.map(toStoredProof)
  }

  /**
   * Split proofs to send exactly `amountSats`. Returns the proofs to hand over
   * and the change proofs to keep. The caller encodes `send` via token.ts.
   */
  async send(
    amountSats: number,
    proofs: readonly StoredProof[],
  ): Promise<{ send: StoredProof[]; keep: StoredProof[] }> {
    const res = await this.wallet.send(amountSats, proofs as unknown as Proof[])
    return { send: res.send.map(toStoredProof), keep: res.keep.map(toStoredProof) }
  }

  /**
   * Split proofs and lock the `send` set to `pubkey` (NUT-14 P2PK). The
   * recipient of those proofs must hold the matching privkey to swap them at
   * the mint — this is the building block for NIP-61 nutzaps: the sender
   * locks to the recipient's wallet pubkey, then publishes a kind-9321 event
   * containing the locked token.
   */
  async sendP2PK(
    amountSats: number,
    proofs: readonly StoredProof[],
    pubkey: string,
  ): Promise<{ send: StoredProof[]; keep: StoredProof[] }> {
    const res = await this.wallet.send(
      amountSats,
      proofs as unknown as Proof[],
      undefined,
      {
        send: { type: 'p2pk', options: { pubkey } },
        keep: { type: 'deterministic', counter: 0 },
      },
    )
    return { send: res.send.map(toStoredProof), keep: res.keep.map(toStoredProof) }
  }
}
