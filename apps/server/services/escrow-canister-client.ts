// ADR-362 D1 / FU-622: server ↔ ICP Escrow-Canister client (@icp-sdk/core,
// same pattern as workspace-canister-client.ts, ADR-311/FU-432).
//
// The canister (packages/icp-escrow-canister, ADR-254) is the source of truth
// for a trade's funding/state; this module is the server's only way in. The
// route layer relays client-signed authorizations (release/dispute/verdict) —
// the server never holds a party's key and never signs on a party's behalf.
//
// Env-gated: without `ICP_ESCROW_CANISTER_ID` every entry point degrades to
// null/no-op (the honest "not configured" state). With the env var set,
// failures throw (fail-loud).
//
// `ICP_HOST` defaults to the local replica (http://127.0.0.1:4943); the root
// key is fetched only for local hosts, never against mainnet.

import { Actor, HttpAgent, type ActorSubclass } from '@icp-sdk/core/agent'
import { IDL } from '@icp-sdk/core/candid'
import { Principal } from '@icp-sdk/core/principal'
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity'

// ── Candid IDL (mirrors packages/icp-escrow-canister/icp_escrow_canister.did) ──

// @icp-sdk/core/agent expects an IDL factory function, not a pre-built service
// (the same agent-js v3 defect ADR-311 hit: a pre-built IDL.Service is rejected
// by Actor.createActor).
// Exported for the .did contract test (keeps this mirror honest against the checked-in
// candid interface — field/type drift otherwise surfaces only as runtime decode failures).
export const escrowCanisterIdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const TradeStateIdl = IDL.Variant({
    PendingFunding: IDL.Null,
    Funded: IDL.Null,
    Released: IDL.Null,
    Refunded: IDL.Null,
    Disputed: IDL.Null,
    DisputeSettled: IDL.Record({ buyer_bps: IDL.Nat16, seller_bps: IDL.Nat16 }),
  })

  // ADR-362 D1: every Candid error variant must be listed, or candid decoding
  // fails with "Cannot find field hash" when the canister returns it.
  const TradeErrorIdl = IDL.Variant({
    EmptyMilestones: IDL.Null,
    TimeoutNotReached: IDL.Null,
    MilestoneIndexOutOfRange: IDL.Null,
    BitcoinApiError: IDL.Record({ reason: IDL.Text }),
    InvalidTransition: IDL.Record({ action: IDL.Text, from: TradeStateIdl }),
    NotFound: IDL.Null,
    MilestoneOutOfOrder: IDL.Null,
    PayoutInvariantViolation: IDL.Null,
    VerdictBpsMismatch: IDL.Record({ sum: IDL.Nat32 }),
    SignatureVerificationFailed: IDL.Record({ reason: IDL.Text }),
    NotImplemented: IDL.Record({ pending_followup: IDL.Text }),
    MilestoneAlreadyReleased: IDL.Null,
    FeeExceedsInput: IDL.Record({ fee_sats: IDL.Nat64, total_input_sats: IDL.Nat64 }),
    MilestoneBpsMismatch: IDL.Record({ sum: IDL.Nat32 }),
  })

  const ResultIdl = IDL.Variant({ Ok: TradeStateIdl, Err: TradeErrorIdl })
  const ResultNat64Idl = IDL.Variant({ Ok: IDL.Nat64, Err: TradeErrorIdl })

  const OutPointIdl = IDL.Record({ txid: IDL.Vec(IDL.Nat8), vout: IDL.Nat32 })
  const UtxoIdl = IDL.Record({ height: IDL.Nat32, value: IDL.Nat64, outpoint: OutPointIdl })
  const MilestoneIdl = IDL.Record({ released: IDL.Bool, pct_bps: IDL.Nat16 })

  // FU-617 (ADR-357 D3): authorization payloads are signed Nostr events — the only
  // shape NIP-07 extensions and NIP-46 bunkers can produce. Mirrors the canister's
  // `NostrAuthEvent` Candid record 1:1.
  const NostrAuthEventIdl = IDL.Record({
    id: IDL.Text,
    pubkey: IDL.Text,
    created_at: IDL.Nat64,
    kind: IDL.Nat32,
    tags: IDL.Vec(IDL.Vec(IDL.Text)),
    content: IDL.Text,
    sig: IDL.Vec(IDL.Nat8),
  })

  const TradeIdl = IDL.Record({
    id: IDL.Nat64,
    expected_amount_sats: IDL.Nat64,
    buyer_refund_address: IDL.Text,
    seller_payout_address: IDL.Text,
    seller_pubkey: IDL.Text,
    created_at: IDL.Nat64,
    funded_at: IDL.Opt(IDL.Nat64),
    timeout_at: IDL.Nat64,
    buyer_pubkey: IDL.Text,
    state: TradeStateIdl,
    funded_utxos: IDL.Vec(UtxoIdl),
    trade_terms_hash: IDL.Vec(IDL.Nat8),
    btc_address: IDL.Text,
    milestones: IDL.Vec(MilestoneIdl),
  })

  // FU-619 (GAP F-5): certified read — trade + subnet certificate + Merkle witness.
  const CertifiedTradeViewIdl = IDL.Record({
    trade: IDL.Opt(TradeIdl),
    certificate: IDL.Opt(IDL.Vec(IDL.Nat8)),
    witness: IDL.Vec(IDL.Nat8),
  })

  const CreateTradeArgsIdl = IDL.Record({
    expected_amount_sats: IDL.Nat64,
    buyer_refund_address: IDL.Text,
    seller_payout_address: IDL.Text,
    seller_pubkey: IDL.Text,
    buyer_terms_event: NostrAuthEventIdl,
    timeout_at: IDL.Nat64,
    buyer_pubkey: IDL.Text,
    seller_terms_event: NostrAuthEventIdl,
    milestone_bps: IDL.Vec(IDL.Nat16),
  })

  return IDL.Service({
    check_funding: IDL.Func([IDL.Nat64], [ResultIdl], []),
    claim_timeout_refund: IDL.Func([IDL.Nat64], [ResultIdl], []),
    create_trade: IDL.Func([CreateTradeArgsIdl], [ResultNat64Idl], []),
    get_trade: IDL.Func([IDL.Nat64], [IDL.Opt(TradeIdl)], ['query']),
    get_trade_certified: IDL.Func([IDL.Nat64], [CertifiedTradeViewIdl], ['query']),
    open_dispute: IDL.Func([IDL.Nat64, NostrAuthEventIdl], [ResultIdl], []),
    release_milestone: IDL.Func([IDL.Nat64, IDL.Nat32, NostrAuthEventIdl], [ResultIdl], []),
    submit_dao_verdict: IDL.Func([IDL.Nat64, IDL.Nat16, IDL.Nat16, IDL.Vec(IDL.Nat8)], [ResultIdl], []),
    whoami: IDL.Func([], [IDL.Principal], ['query']),
  })
}

// ── Wire types (candid decoded shapes) ──

type CanisterTradeState =
  | { PendingFunding: null }
  | { Funded: null }
  | { Released: null }
  | { Refunded: null }
  | { Disputed: null }
  | { DisputeSettled: { buyer_bps: number; seller_bps: number } }

/** Candid-decoded `NostrAuthEvent` (FU-617). */
export interface CanisterNostrAuthEvent {
  id: string
  pubkey: string
  created_at: bigint
  kind: number
  tags: string[][]
  content: string
  sig: Uint8Array
}

type CanisterTradeError =
  | { EmptyMilestones: null }
  | { TimeoutNotReached: null }
  | { MilestoneIndexOutOfRange: null }
  | { BitcoinApiError: { reason: string } }
  | { InvalidTransition: { action: string; from: CanisterTradeState } }
  | { NotFound: null }
  | { MilestoneOutOfOrder: null }
  | { PayoutInvariantViolation: null }
  | { VerdictBpsMismatch: { sum: number } }
  | { SignatureVerificationFailed: { reason: string } }
  | { NotImplemented: { pending_followup: string } }
  | { MilestoneAlreadyReleased: null }
  | { FeeExceedsInput: { fee_sats: bigint; total_input_sats: bigint } }
  | { MilestoneBpsMismatch: { sum: number } }

type CanisterResult<T> = { Ok: T } | { Err: CanisterTradeError }

interface CanisterMilestone {
  released: boolean
  pct_bps: number
}

interface CanisterUtxo {
  height: number
  value: bigint
  outpoint: { txid: Uint8Array; vout: number }
}

interface CanisterTradeView {
  id: bigint
  expected_amount_sats: bigint
  buyer_refund_address: string
  seller_payout_address: string
  seller_pubkey: string
  created_at: bigint
  funded_at: [] | [bigint]
  timeout_at: bigint
  buyer_pubkey: string
  state: CanisterTradeState
  funded_utxos: CanisterUtxo[]
  trade_terms_hash: Uint8Array
  btc_address: string
  milestones: CanisterMilestone[]
}

/** Candid-decoded `CertifiedTradeView` (FU-619). */
interface CanisterCertifiedTradeView {
  trade: [] | [CanisterTradeView]
  certificate: [] | [Uint8Array]
  witness: Uint8Array
}

interface CreateTradeArgsWire {
  expected_amount_sats: bigint
  buyer_refund_address: string
  seller_payout_address: string
  seller_pubkey: string
  buyer_terms_event: CanisterNostrAuthEvent
  timeout_at: bigint
  buyer_pubkey: string
  seller_terms_event: CanisterNostrAuthEvent
  milestone_bps: number[]
}

// The actor surface this client consumes (subset of the .did service).
export interface EscrowCanisterActor {
  check_funding(id: bigint): Promise<CanisterResult<CanisterTradeState>>
  claim_timeout_refund(id: bigint): Promise<CanisterResult<CanisterTradeState>>
  create_trade(args: CreateTradeArgsWire): Promise<CanisterResult<bigint>>
  get_trade(id: bigint): Promise<[] | [CanisterTradeView]>
  get_trade_certified(id: bigint): Promise<CanisterCertifiedTradeView>
  open_dispute(id: bigint, openerEvent: CanisterNostrAuthEvent): Promise<CanisterResult<CanisterTradeState>>
  release_milestone(id: bigint, milestoneIndex: number, buyerEvent: CanisterNostrAuthEvent): Promise<CanisterResult<CanisterTradeState>>
  submit_dao_verdict(id: bigint, buyerBps: number, sellerBps: number, daoSignature: Uint8Array): Promise<CanisterResult<CanisterTradeState>>
  whoami(): Promise<Principal>
}

// ── Server-facing types ──

// Mirrors apps/server/lib/enums.ts EscrowTradeStateSchema. Imported here as a
// plain union to keep the client free of zod; the route layer validates.
export type ServerEscrowTradeState =
  | 'PENDING_FUNDING'
  | 'FUNDED'
  | 'RELEASED'
  | 'REFUNDED'
  | 'DISPUTED'
  | 'DISPUTE_SETTLED'

export interface EscrowTradeStateView {
  state: ServerEscrowTradeState
  settledBuyerBps: number | null
  settledSellerBps: number | null
}

/**
 * Server-facing Nostr authorization event (FU-617): JSON-friendly camelCase mirror of the
 * canister's `NostrAuthEvent` — `createdAt`/`kind` as plain numbers, `sig` as bytes. The route
 * layer decodes the client's hex `sig` into bytes before handing it here.
 */
export interface EscrowNostrAuthEvent {
  id: string
  pubkey: string
  createdAt: number
  kind: number
  tags: string[][]
  content: string
  sig: Uint8Array
}

export interface EscrowCreateTradeArgs {
  expectedAmountSats: bigint
  buyerRefundAddress: string
  sellerPayoutAddress: string
  buyerPubkey: string
  sellerPubkey: string
  buyerTermsEvent: EscrowNostrAuthEvent
  sellerTermsEvent: EscrowNostrAuthEvent
  milestoneBps: number[]
  timeoutAt: bigint // nanoseconds since epoch
}

/** Certified read result (FU-619): the trade view plus raw certificate/witness blobs the
 * frontend verifies against the IC root key itself — the server relays, never vouches. */
export interface EscrowCertifiedTradeView {
  trade: EscrowTradeView | null
  certificate: Uint8Array | null
  witness: Uint8Array
}

export interface EscrowTradeView {
  canisterTradeId: string
  btcAddress: string
  buyerPubkey: string
  sellerPubkey: string
  buyerRefundAddress: string
  sellerPayoutAddress: string
  expectedAmountSats: bigint
  milestones: { pctBps: number; released: boolean }[]
  state: ServerEscrowTradeState
  settledBuyerBps: number | null
  settledSellerBps: number | null
  timeoutAt: string // nanoseconds since epoch (string: nat64)
  createdAt: string
  fundedAt: string | null
  tradeTermsHash: string // 32-byte hex
}

export class EscrowCanisterError extends Error {
  constructor(method: string, readonly canisterError: CanisterTradeError) {
    super(`escrow canister ${method} rejected: ${formatCanisterError(canisterError)}`)
    this.name = 'EscrowCanisterError'
  }
}

// ── Pure helpers (unit-tested without a replica) ──

export function canisterStateToServerState(state: CanisterTradeState): EscrowTradeStateView {
  if ('DisputeSettled' in state) {
    return {
      state: 'DISPUTE_SETTLED',
      settledBuyerBps: state.DisputeSettled.buyer_bps,
      settledSellerBps: state.DisputeSettled.seller_bps,
    }
  }
  const map: Record<string, ServerEscrowTradeState> = {
    PendingFunding: 'PENDING_FUNDING',
    Funded: 'FUNDED',
    Released: 'RELEASED',
    Refunded: 'REFUNDED',
    Disputed: 'DISPUTED',
  }
  const key = Object.keys(state)[0]
  return { state: map[key] ?? 'PENDING_FUNDING', settledBuyerBps: null, settledSellerBps: null }
}

function formatCanisterError(err: CanisterTradeError): string {
  if ('EmptyMilestones' in err) return 'EmptyMilestones'
  if ('TimeoutNotReached' in err) return 'TimeoutNotReached'
  if ('MilestoneIndexOutOfRange' in err) return 'MilestoneIndexOutOfRange'
  if ('BitcoinApiError' in err) return `BitcoinApiError(${err.BitcoinApiError.reason})`
  if ('InvalidTransition' in err) return `InvalidTransition(${err.InvalidTransition.action})`
  if ('NotFound' in err) return 'NotFound'
  if ('MilestoneOutOfOrder' in err) return 'MilestoneOutOfOrder'
  if ('PayoutInvariantViolation' in err) return 'PayoutInvariantViolation'
  if ('VerdictBpsMismatch' in err) return `VerdictBpsMismatch(sum ${err.VerdictBpsMismatch.sum})`
  if ('SignatureVerificationFailed' in err) return `SignatureVerificationFailed(${err.SignatureVerificationFailed.reason})`
  if ('NotImplemented' in err) return `NotImplemented(${err.NotImplemented.pending_followup})`
  if ('MilestoneAlreadyReleased' in err) return 'MilestoneAlreadyReleased'
  if ('FeeExceedsInput' in err) return `FeeExceedsInput(fee ${err.FeeExceedsInput.fee_sats})`
  if ('MilestoneBpsMismatch' in err) return `MilestoneBpsMismatch(sum ${err.MilestoneBpsMismatch.sum})`
  return 'UnknownTradeError'
}

function unwrap<T>(method: string, result: CanisterResult<T>): T {
  if ('Err' in result) throw new EscrowCanisterError(method, result.Err)
  return result.Ok
}

function toTradeView(trade: CanisterTradeView): EscrowTradeView {
  const stateView = canisterStateToServerState(trade.state)
  return {
    canisterTradeId: trade.id.toString(),
    btcAddress: trade.btc_address,
    buyerPubkey: trade.buyer_pubkey,
    sellerPubkey: trade.seller_pubkey,
    buyerRefundAddress: trade.buyer_refund_address,
    sellerPayoutAddress: trade.seller_payout_address,
    expectedAmountSats: trade.expected_amount_sats,
    milestones: trade.milestones.map((m) => ({ pctBps: m.pct_bps, released: m.released })),
    state: stateView.state,
    settledBuyerBps: stateView.settledBuyerBps,
    settledSellerBps: stateView.settledSellerBps,
    timeoutAt: trade.timeout_at.toString(),
    createdAt: trade.created_at.toString(),
    fundedAt: trade.funded_at.length > 0 ? (trade.funded_at[0] ?? null)?.toString() ?? null : null,
    tradeTermsHash: Buffer.from(trade.trade_terms_hash).toString('hex'),
  }
}

// ── Client ──

export interface EscrowCanisterClient {
  createTrade(args: EscrowCreateTradeArgs): Promise<{ canisterTradeId: string }>
  getTrade(canisterTradeId: string): Promise<EscrowTradeView | null>
  /** FU-619: consensus-certified read — trade + subnet certificate + Merkle witness. */
  getTradeCertified(canisterTradeId: string): Promise<EscrowCertifiedTradeView>
  checkFunding(canisterTradeId: string): Promise<EscrowTradeStateView>
  claimTimeoutRefund(canisterTradeId: string): Promise<EscrowTradeStateView>
  releaseMilestone(canisterTradeId: string, milestoneIndex: number, buyerEvent: EscrowNostrAuthEvent): Promise<EscrowTradeStateView>
  openDispute(canisterTradeId: string, openerEvent: EscrowNostrAuthEvent): Promise<EscrowTradeStateView>
  submitDaoVerdict(canisterTradeId: string, buyerBps: number, sellerBps: number, daoSignature: Uint8Array): Promise<EscrowTradeStateView>
}

/** camelCase server event → Candid wire record (bigint/nat64 for created_at). */
function toWireEvent(event: EscrowNostrAuthEvent): CanisterNostrAuthEvent {
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: BigInt(event.createdAt),
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  }
}

// Factored out so tests inject a fake actor; the module-level entry points
// below build the real actor lazily from env.
export function createEscrowCanisterClient(actor: EscrowCanisterActor, canisterId: string): EscrowCanisterClient {
  return {
    async createTrade(args) {
      const id = unwrap('create_trade', await actor.create_trade({
        expected_amount_sats: args.expectedAmountSats,
        buyer_refund_address: args.buyerRefundAddress,
        seller_payout_address: args.sellerPayoutAddress,
        seller_pubkey: args.sellerPubkey,
        buyer_terms_event: toWireEvent(args.buyerTermsEvent),
        timeout_at: args.timeoutAt,
        buyer_pubkey: args.buyerPubkey,
        seller_terms_event: toWireEvent(args.sellerTermsEvent),
        milestone_bps: args.milestoneBps,
      }))
      return { canisterTradeId: id.toString() }
    },
    async getTrade(canisterTradeId) {
      const trade = await actor.get_trade(BigInt(canisterTradeId))
      if (trade.length === 0) return null
      return toTradeView(trade[0])
    },
    async getTradeCertified(canisterTradeId) {
      const view = await actor.get_trade_certified(BigInt(canisterTradeId))
      const trade = view.trade[0] ?? null
      return {
        trade: trade ? toTradeView(trade) : null,
        certificate: view.certificate[0] ?? null,
        witness: view.witness,
      }
    },
    async checkFunding(canisterTradeId) {
      return canisterStateToServerState(unwrap('check_funding', await actor.check_funding(BigInt(canisterTradeId))))
    },
    async claimTimeoutRefund(canisterTradeId) {
      return canisterStateToServerState(unwrap('claim_timeout_refund', await actor.claim_timeout_refund(BigInt(canisterTradeId))))
    },
    async releaseMilestone(canisterTradeId, milestoneIndex, buyerEvent) {
      return canisterStateToServerState(unwrap('release_milestone', await actor.release_milestone(BigInt(canisterTradeId), milestoneIndex, toWireEvent(buyerEvent))))
    },
    async openDispute(canisterTradeId, openerEvent) {
      return canisterStateToServerState(unwrap('open_dispute', await actor.open_dispute(BigInt(canisterTradeId), toWireEvent(openerEvent))))
    },
    async submitDaoVerdict(canisterTradeId, buyerBps, sellerBps, daoSignature) {
      return canisterStateToServerState(unwrap('submit_dao_verdict', await actor.submit_dao_verdict(BigInt(canisterTradeId), buyerBps, sellerBps, daoSignature)))
    },
  }
}

// ── Env-gated default client ──

const DEFAULT_ICP_HOST = 'http://127.0.0.1:4943'

export function isEscrowCanisterConfigured(): boolean {
  return Boolean(process.env.ICP_ESCROW_CANISTER_ID)
}

// The canister gates mutating calls behind the server principal it learns at
// init; the server's ICP identity derives deterministically from
// `ICP_ESCROW_SERVER_SEED` (64 hex chars = 32-byte Ed25519 seed). Never log the
// seed or the derived secret key (FU-195-C rule).
export function escrowServerIdentity(seedHex: string): Ed25519KeyIdentity {
  if (!/^[0-9a-f]{64}$/i.test(seedHex)) {
    throw new Error('ICP_ESCROW_SERVER_SEED must be 64 hex chars (32-byte Ed25519 seed)')
  }
  return Ed25519KeyIdentity.generate(new Uint8Array(Buffer.from(seedHex, 'hex')))
}

export function escrowServerPrincipal(): string | null {
  const seed = process.env.ICP_ESCROW_SERVER_SEED
  return seed ? escrowServerIdentity(seed).getPrincipal().toText() : null
}

let defaultClient: EscrowCanisterClient | null = null

async function buildActor(canisterId: string, host: string): Promise<ActorSubclass<EscrowCanisterActor>> {
  const seed = process.env.ICP_ESCROW_SERVER_SEED
  // Without a seed the calls go out anonymously — a server-gated canister will
  // reject them with an auth error, which is the intended fail-loud behavior.
  const identity = seed ? escrowServerIdentity(seed) : undefined
  const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) })
  if (/127\.0\.0\.1|localhost/.test(host)) {
    // Local replica has a throwaway root key; never do this against mainnet.
    await agent.fetchRootKey()
  }
  return Actor.createActor<EscrowCanisterActor>(escrowCanisterIdlFactory, {
    agent,
    canisterId: Principal.fromText(canisterId),
  })
}

// Async because a local replica requires fetchRootKey before the first call.
export async function getEscrowCanisterClient(): Promise<EscrowCanisterClient | null> {
  const canisterId = process.env.ICP_ESCROW_CANISTER_ID
  if (!canisterId) return null
  if (!defaultClient) {
    const host = process.env.ICP_HOST || DEFAULT_ICP_HOST
    defaultClient = createEscrowCanisterClient(await buildActor(canisterId, host), canisterId)
  }
  return defaultClient
}
