/**
 * FU-619 live consensus-certified read check (ADR-362 GAP F-5) — OPT-IN and
 * network-touching; skipped unless `ICP_LIVE_CHECK=1`.
 *
 * Targets an already-deployed escrow canister (local replica by default — the
 * "live against the replica" gate closed on the FU-572 icp.yaml testnet deploy,
 * 2026-09-02, canister `4caro-hl777-77775-aaaba-cai`). It exercises the exact
 * path a P3 buyer funding flow will use, end to end against real consensus:
 *
 *   1. Sign kind-30416 trade-terms events with the production FU-618 builders
 *      (`escrowTradeTermsMessage`/`buildTermsEventTemplate`, byte-exact mirror
 *      of `sig.rs`) — FU-617 verifies these on-chain.
 *   2. `create_trade` on the canister (real t-ECDSA address derivation).
 *   3. `get_trade_certified` → trade + subnet data certificate + CBOR Merkle
 *      witness (FU-619).
 *   4. `verifyCertifiedTrade` (browser-side, against the replica root key):
 *      certificate BLS + freshness, witness root == certified_data, leaf ==
 *      recomputed payload. Asserts the honest result AND that a tampered field
 *      and an absent trade both fail loudly.
 *   5. `verifyCanister` (L1 `/trade/verify` read): certified module_hash +
 *      controllers.
 *
 * Env:
 *   ICP_LIVE_CHECK=1       enable this describe block
 *   ICP_LIVE_HOST          replica URL (default http://127.0.0.1:4943)
 *   ICP_LIVE_CANISTER_ID   deployed canister id (required when enabled)
 */
// @vitest-environment node

import { describe, it, expect } from 'vitest'
import { Actor, HttpAgent, type ActorSubclass } from '@icp-sdk/core/agent'
import { IDL } from '@icp-sdk/core/candid'
import { Principal } from '@icp-sdk/core/principal'
import { hexToBytes } from '@noble/hashes/utils'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools'
import { buildTermsEventTemplate, escrowTradeTermsMessage, type UnsignedEventTemplate } from './escrow-auth-events'
import { verifyCanister, verifyCertifiedTrade } from './icp-verification'

const processEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const ENABLED = processEnv.ICP_LIVE_CHECK === '1'
const HOST = processEnv.ICP_LIVE_HOST ?? 'http://127.0.0.1:4943'
const CANISTER_ID = (processEnv.ICP_LIVE_CANISTER_ID ?? '').trim()

// ── Minimal Candid mirror of packages/icp-escrow-canister/icp_escrow_canister.did ──
// Kept identical to the server client's factory (apps/server/services/
// escrow-canister-client.ts) so decode stays honest; only the methods this live
// check calls are exposed on the service.

const escrowIdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const TradeStateIdl = IDL.Variant({
    PendingFunding: IDL.Null,
    Funded: IDL.Null,
    Released: IDL.Null,
    Refunded: IDL.Null,
    Disputed: IDL.Null,
    DisputeSettled: IDL.Record({ buyer_bps: IDL.Nat16, seller_bps: IDL.Nat16 }),
  })

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

  const ResultNat64Idl = IDL.Variant({ Ok: IDL.Nat64, Err: TradeErrorIdl })

  const OutPointIdl = IDL.Record({ txid: IDL.Vec(IDL.Nat8), vout: IDL.Nat32 })
  const UtxoIdl = IDL.Record({ height: IDL.Nat32, value: IDL.Nat64, outpoint: OutPointIdl })
  const MilestoneIdl = IDL.Record({ released: IDL.Bool, pct_bps: IDL.Nat16 })

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
    create_trade: IDL.Func([CreateTradeArgsIdl], [ResultNat64Idl], []),
    get_trade_certified: IDL.Func([IDL.Nat64], [CertifiedTradeViewIdl], ['query']),
  })
}

// ── Wire types (candid-decoded shapes) ──

type CanisterTradeState = { PendingFunding: null } | { Funded: null } | { Released: null }
  | { Refunded: null } | { Disputed: null } | { DisputeSettled: { buyer_bps: number; seller_bps: number } }

interface LiveCanisterActor {
  create_trade(args: {
    expected_amount_sats: bigint
    buyer_refund_address: string
    seller_payout_address: string
    seller_pubkey: string
    buyer_terms_event: CanisterEvent
    timeout_at: bigint
    buyer_pubkey: string
    seller_terms_event: CanisterEvent
    milestone_bps: number[]
  }): Promise<{ Ok: bigint } | { Err: unknown }>
  get_trade_certified(id: bigint): Promise<{
    trade: [] | [CanisterTrade]
    certificate: [] | [Uint8Array]
    witness: Uint8Array
  }>
}

interface CanisterEvent {
  id: string
  pubkey: string
  created_at: bigint
  kind: number
  tags: string[][]
  content: string
  sig: Uint8Array
}

interface CanisterTrade {
  id: bigint
  expected_amount_sats: bigint
  buyer_refund_address: string
  seller_payout_address: string
  buyer_pubkey: string
  seller_pubkey: string
  btc_address: string
  state: CanisterTradeState
}

async function makeActor(): Promise<ActorSubclass<LiveCanisterActor>> {
  const agent = await HttpAgent.create({ host: HOST })
  await agent.fetchRootKey()
  return Actor.createActor<LiveCanisterActor>(escrowIdlFactory, {
    agent,
    canisterId: Principal.fromText(CANISTER_ID),
  })
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function termsEventWire(template: UnsignedEventTemplate, secretKey: Uint8Array, createdAt: number): CanisterEvent {
  const event = finalizeEvent({ ...template, created_at: createdAt }, secretKey)
  if (!verifyEvent(event)) throw new Error('test fixture event failed self-verification')
  return {
    id: event.id,
    pubkey: event.pubkey,
    created_at: BigInt(event.created_at),
    kind: event.kind,
    tags: event.tags as string[][],
    content: event.content,
    sig: hexToBytes(event.sig),
  }
}

describe.skipIf(!ENABLED)('FU-619 live certified-read check (opt-in, ICP_LIVE_CHECK=1)', () => {
  it('signs terms events → create_trade → get_trade_certified → client verification passes, tamper + absence fail', async () => {
    expect(CANISTER_ID, 'ICP_LIVE_CANISTER_ID must be set when ICP_LIVE_CHECK=1').toBeTruthy()

    const actor = await makeActor()

    // Fresh signable keypair per run (any valid BIP-340 pair works —
    // the canister verifies the signature against the args' pubkeys, nothing else).
    const buyerSecret = generateSecretKey()
    const sellerSecret = generateSecretKey()
    const buyerPubkey = getPublicKey(buyerSecret)
    const sellerPubkey = getPublicKey(sellerSecret)

    const buyerRefundAddress = 'bc1qbuyerrefund'
    const sellerPayoutAddress = 'bc1qsellerpayout'
    const expectedAmountSats = 100_000
    const milestoneBps = [10_000]
    const timeoutAt = 1_735_689_600_000_000_000n

    const termsArgs = {
      buyerPubkey,
      sellerPubkey,
      buyerRefundAddress,
      sellerPayoutAddress,
      expectedAmountSats,
      milestoneBps,
      timeoutAt,
    }
    const message = escrowTradeTermsMessage(termsArgs)
    const template = buildTermsEventTemplate(termsArgs)
    expect(template.content).toBe(message)

    const buyerEvent = termsEventWire(template, buyerSecret, 1_730_000_000)
    const sellerEvent = termsEventWire(template, sellerSecret, 1_730_000_001)
    expect(buyerEvent.pubkey).toBe(buyerPubkey)
    expect(sellerEvent.pubkey).toBe(sellerPubkey)

    const created = await actor.create_trade({
      expected_amount_sats: BigInt(expectedAmountSats),
      buyer_refund_address: buyerRefundAddress,
      seller_payout_address: sellerPayoutAddress,
      seller_pubkey: sellerPubkey,
      buyer_terms_event: buyerEvent,
      timeout_at: timeoutAt,
      buyer_pubkey: buyerPubkey,
      seller_terms_event: sellerEvent,
      milestone_bps: milestoneBps,
    })
    if ('Err' in created) throw new Error(`create_trade rejected by canister: ${JSON.stringify(created.Err)}`)
    const tradeId = created.Ok

    const certified = await actor.get_trade_certified(tradeId)
    expect(certified.trade.length, 'trade must exist in certified read').toBe(1)
    const certificate = certified.certificate[0]
    expect(certificate, 'query context must supply a subnet data certificate').toBeInstanceOf(Uint8Array)
    expect(certificate!.length).toBeGreaterThan(0)
    expect(certified.witness.length).toBeGreaterThan(0)

    const trade = certified.trade[0]!
    const certifiedInput = {
      canisterTradeId: trade.id,
      btcAddress: trade.btc_address,
      expectedAmountSats: trade.expected_amount_sats,
      state: 'PENDING_FUNDING',
      settledBuyerBps: null as number | null,
      settledSellerBps: null as number | null,
    }

    // The trust statement FU-619 exists for: the funding-critical fields the client is shown
    // are consensus-certified, verified purely against the replica root key.
    const verified = await verifyCertifiedTrade({
      canisterId: CANISTER_ID,
      tradeCanisterId: CANISTER_ID,
      certificateBase64: base64(certificate!),
      witnessBase64: base64(certified.witness),
      trade: certifiedInput,
      host: HOST,
    })
    if (!verified.verified) throw new Error(`certified read must verify: ${verified.detail}`)

    // Negative 1: a tampered displayed amount must fail the leaf-payload comparison.
    const tampered = await verifyCertifiedTrade({
      canisterId: CANISTER_ID,
      tradeCanisterId: CANISTER_ID,
      certificateBase64: base64(certificate!),
      witnessBase64: base64(certified.witness),
      trade: { ...certifiedInput, expectedAmountSats: certifiedInput.expectedAmountSats + 1n },
      host: HOST,
    })
    if (tampered.verified) throw new Error('tampered displayed amount must fail verification')
    expect(tampered.reason).toBe('field-mismatch')

    // Negative 2: an unknown trade id must surface as an honest proof-of-absence.
    const absent = await actor.get_trade_certified(9_999_999_999n)
    expect(absent.trade.length).toBe(0)
    expect(absent.certificate[0]).toBeInstanceOf(Uint8Array)
    const absentCheck = await verifyCertifiedTrade({
      canisterId: CANISTER_ID,
      tradeCanisterId: CANISTER_ID,
      certificateBase64: base64(absent.certificate[0]!),
      witnessBase64: base64(absent.witness),
      trade: {
        canisterTradeId: 9_999_999_999n,
        btcAddress: 'bc1qabsent',
        expectedAmountSats: 1n,
        state: 'PENDING_FUNDING',
        settledBuyerBps: null,
        settledSellerBps: null,
      },
      host: HOST,
    })
    if (absentCheck.verified) throw new Error('unknown trade id must fail verification')
    expect(absentCheck.reason).toBe('trade-absent')
  }, 120_000)

  it('L1 canister trust read (module_hash + controllers) verifies against the replica root key', async () => {
    expect(CANISTER_ID, 'ICP_LIVE_CANISTER_ID must be set when ICP_LIVE_CHECK=1').toBeTruthy()
    const outcome = await verifyCanister(CANISTER_ID, { host: HOST })
    expect(outcome.status).toBe('verified')
    if (outcome.status === 'verified') {
      expect(outcome.facts.moduleHash).toMatch(/^[0-9a-f]{64}$/)
      expect(outcome.facts.controllers.length).toBeGreaterThan(0)
    }
  }, 120_000)
})
