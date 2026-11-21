// ADR-362 D1: unit tests for the escrow canister client. No replica involved —
// a fake actor stands in for @icp-sdk/core/agent; the live deploy path is
// covered by the canister's own `cargo test` and future smoke scripts.
import { describe, it, expect, afterEach } from 'vitest'
import {
  canisterStateToServerState,
  createEscrowCanisterClient,
  escrowServerIdentity,
  isEscrowCanisterConfigured,
  EscrowCanisterError,
  type EscrowCanisterActor,
  type EscrowNostrAuthEvent,
} from './escrow-canister-client.js'

const CANISTER_ID = 'aaaaa-aa'

function fakeActor(overrides: Partial<EscrowCanisterActor> = {}): EscrowCanisterActor {
  return {
    check_funding: async () => ({ Ok: { Funded: null } }),
    claim_timeout_refund: async () => ({ Ok: { Refunded: null } }),
    create_trade: async () => ({ Ok: 7n }),
    get_trade: async () => [{
      id: 7n,
      expected_amount_sats: 100_000n,
      buyer_refund_address: 'bc1qrefund',
      seller_payout_address: 'bc1qpayout',
      seller_pubkey: 'cd'.repeat(32),
      created_at: 1_700_000_000_000_000_000n,
      funded_at: [1_700_000_000_100_000_000n] as [bigint],
      timeout_at: 1_700_000_086_400_000_000n,
      buyer_pubkey: 'ab'.repeat(32),
      state: { Funded: null },
      funded_utxos: [{ height: 850_000, value: 100_000n, outpoint: { txid: new Uint8Array(32).fill(0x11), vout: 1 } }],
      trade_terms_hash: new Uint8Array(32).fill(0xaa),
      btc_address: 'bc1qfunding',
      milestones: [{ released: false, pct_bps: 10_000 }],
    }],
    get_trade_certified: async () => ({
      trade: [],
      certificate: [new Uint8Array([0xd9, 0xd9, 0xf7, 0xa2])],
      witness: new Uint8Array([0x82, 0x03, 0x58]),
    }),
    open_dispute: async () => ({ Ok: { Disputed: null } }),
    release_milestone: async () => ({ Ok: { Released: null } }),
    submit_dao_verdict: async () => ({ Ok: { DisputeSettled: { buyer_bps: 5000, seller_bps: 5000 } } }),
    whoami: async () => ({ toText: () => 'aaaaa-aa' } as never),
    ...overrides,
  }
}

/** Event fixture matching the canister's wire `NostrAuthEvent` (camelCase server shape). */
function fakeEvent(overrides: Partial<EscrowNostrAuthEvent> = {}): EscrowNostrAuthEvent {
  return {
    id: 'ab'.repeat(32),
    pubkey: 'ab'.repeat(32),
    createdAt: 1_730_000_000,
    kind: 30_417,
    tags: [['trade', '7'], ['action', 'release_milestone'], ['i', '1']],
    content: '',
    sig: new Uint8Array(64).fill(0x22),
    ...overrides,
  }
}

const CREATE_ARGS = {
  expectedAmountSats: 100_000n,
  buyerRefundAddress: 'bc1qrefund',
  sellerPayoutAddress: 'bc1qpayout',
  buyerPubkey: 'ab'.repeat(32),
  sellerPubkey: 'cd'.repeat(32),
  buyerTermsEvent: fakeEvent({ pubkey: 'ab'.repeat(32), kind: 30_416, tags: [['action', 'create_trade']] }),
  sellerTermsEvent: fakeEvent({ pubkey: 'cd'.repeat(32), kind: 30_416, tags: [['action', 'create_trade']] }),
  milestoneBps: [10_000],
  timeoutAt: 1_700_000_086_400_000_000n,
}

describe('isEscrowCanisterConfigured', () => {
  afterEach(() => {
    delete process.env.ICP_ESCROW_CANISTER_ID
  })

  it('is false without ICP_ESCROW_CANISTER_ID', () => {
    delete process.env.ICP_ESCROW_CANISTER_ID
    expect(isEscrowCanisterConfigured()).toBe(false)
  })

  it('is true with ICP_ESCROW_CANISTER_ID set', () => {
    process.env.ICP_ESCROW_CANISTER_ID = CANISTER_ID
    expect(isEscrowCanisterConfigured()).toBe(true)
  })
})

describe('canisterStateToServerState', () => {
  it('maps every canister variant to the server enum', () => {
    expect(canisterStateToServerState({ PendingFunding: null })).toEqual({ state: 'PENDING_FUNDING', settledBuyerBps: null, settledSellerBps: null })
    expect(canisterStateToServerState({ Funded: null })).toEqual({ state: 'FUNDED', settledBuyerBps: null, settledSellerBps: null })
    expect(canisterStateToServerState({ Released: null })).toEqual({ state: 'RELEASED', settledBuyerBps: null, settledSellerBps: null })
    expect(canisterStateToServerState({ Refunded: null })).toEqual({ state: 'REFUNDED', settledBuyerBps: null, settledSellerBps: null })
    expect(canisterStateToServerState({ Disputed: null })).toEqual({ state: 'DISPUTED', settledBuyerBps: null, settledSellerBps: null })
  })

  it('carries the bps pair for DisputeSettled', () => {
    expect(canisterStateToServerState({ DisputeSettled: { buyer_bps: 3000, seller_bps: 7000 } }))
      .toEqual({ state: 'DISPUTE_SETTLED', settledBuyerBps: 3000, settledSellerBps: 7000 })
  })
})

describe('createEscrowCanisterClient', () => {
  it('createTrade relays args (events included) and returns the nat64 id as string', async () => {
    const calls: string[] = []
    const actor = fakeActor({
      create_trade: async (args) => {
        calls.push(`${args.expected_amount_sats}:${args.buyer_pubkey}:${args.milestone_bps.join(',')}`)
        calls.push(`${args.buyer_terms_event.kind}:${args.buyer_terms_event.created_at}:${args.buyer_terms_event.sig.length}`)
        calls.push(`${args.seller_terms_event.kind}:${args.seller_terms_event.content}`)
        return { Ok: 42n }
      },
    })
    const client = createEscrowCanisterClient(actor, CANISTER_ID)
    const result = await client.createTrade(CREATE_ARGS)
    expect(result).toEqual({ canisterTradeId: '42' })
    expect(calls).toEqual([
      `100000:${'ab'.repeat(32)}:10000`,
      '30416:1730000000:64',
      '30416:',
    ])
  })

  it('createTrade throws EscrowCanisterError on rejection', async () => {
    const actor = fakeActor({
      create_trade: async () => ({ Err: { MilestoneBpsMismatch: { sum: 9000 } } }),
    })
    const client = createEscrowCanisterClient(actor, CANISTER_ID)
    await expect(client.createTrade(CREATE_ARGS)).rejects.toThrow(EscrowCanisterError)
    await expect(client.createTrade(CREATE_ARGS)).rejects.toThrow(/MilestoneBpsMismatch/)
  })

  it('getTrade maps the canister view, or null when absent', async () => {
    const client = createEscrowCanisterClient(fakeActor(), CANISTER_ID)
    const trade = await client.getTrade('7')
    expect(trade).toMatchObject({
      canisterTradeId: '7',
      btcAddress: 'bc1qfunding',
      expectedAmountSats: 100_000n,
      state: 'FUNDED',
      tradeTermsHash: 'aa'.repeat(32),
    })
    expect(trade?.fundedAt).toBe('1700000000100000000')
    expect(trade?.milestones).toEqual([{ pctBps: 10_000, released: false }])

    const empty = createEscrowCanisterClient(fakeActor({ get_trade: async () => [] }), CANISTER_ID)
    await expect(empty.getTrade('99')).resolves.toBeNull()
  })

  it('getTradeCertified maps trade + certificate + witness (or absent trade)', async () => {
    const client = createEscrowCanisterClient(fakeActor(), CANISTER_ID)
    const view = await client.getTradeCertified('7')
    expect(view.trade).toBeNull()
    expect(view.certificate).toEqual(new Uint8Array([0xd9, 0xd9, 0xf7, 0xa2]))
    expect(view.witness).toEqual(new Uint8Array([0x82, 0x03, 0x58]))

    const withTrade = fakeActor({
      get_trade_certified: async () => ({
        trade: [{
          id: 7n,
          expected_amount_sats: 100_000n,
          buyer_refund_address: 'bc1qrefund',
          seller_payout_address: 'bc1qpayout',
          seller_pubkey: 'cd'.repeat(32),
          created_at: 1_700_000_000_000_000_000n,
          funded_at: [] as [],
          timeout_at: 1_700_000_086_400_000_000n,
          buyer_pubkey: 'ab'.repeat(32),
          state: { PendingFunding: null },
          funded_utxos: [],
          trade_terms_hash: new Uint8Array(32).fill(0xaa),
          btc_address: 'bc1qfunding',
          milestones: [{ released: false, pct_bps: 10_000 }],
        }],
        certificate: [],
        witness: new Uint8Array([0x82]),
      }),
    })
    const certified = await createEscrowCanisterClient(withTrade, CANISTER_ID).getTradeCertified('7')
    expect(certified.trade).toMatchObject({ canisterTradeId: '7', btcAddress: 'bc1qfunding', state: 'PENDING_FUNDING' })
    expect(certified.certificate).toBeNull()
  })

  it('checkFunding / claimTimeoutRefund map the resulting state', async () => {
    const client = createEscrowCanisterClient(fakeActor(), CANISTER_ID)
    await expect(client.checkFunding('7')).resolves.toMatchObject({ state: 'FUNDED' })
    await expect(client.claimTimeoutRefund('7')).resolves.toMatchObject({ state: 'REFUNDED' })
  })

  it('releaseMilestone / openDispute / submitDaoVerdict relay payloads and map state', async () => {
    const seen: string[] = []
    const actor = fakeActor({
      release_milestone: async (_id, idx, ev) => {
        seen.push(`release:${idx}:${ev.kind}:${ev.tags.find((t) => t[0] === 'action')?.[1] ?? ''}:${ev.sig.length}`)
        return { Ok: { Released: null } }
      },
      open_dispute: async (_id, ev) => {
        seen.push(`dispute:${ev.kind}:${ev.pubkey.slice(0, 2)}`)
        return { Ok: { Disputed: null } }
      },
    })
    const client = createEscrowCanisterClient(actor, CANISTER_ID)
    await expect(client.releaseMilestone('7', 1, fakeEvent())).resolves.toMatchObject({ state: 'RELEASED' })
    await expect(client.openDispute('7', fakeEvent({ tags: [['trade', '7'], ['action', 'open_dispute']] })))
      .resolves.toMatchObject({ state: 'DISPUTED' })
    await expect(client.submitDaoVerdict('7', 5000, 5000, new Uint8Array(64))).resolves.toMatchObject({
      state: 'DISPUTE_SETTLED',
      settledBuyerBps: 5000,
      settledSellerBps: 5000,
    })
    // Events travel camelCase → wire snake_case/bigint intact (FU-617 relay contract).
    expect(seen).toEqual(['release:1:30417:release_milestone:64', 'dispute:30417:ab'])
  })

  it('surfaces canister errors with the typed variant name', async () => {
    const notFound = fakeActor({ check_funding: async () => ({ Err: { NotFound: null } }) })
    await expect(createEscrowCanisterClient(notFound, CANISTER_ID).checkFunding('99')).rejects.toThrow(/NotFound/)

    const fee = fakeActor({
      claim_timeout_refund: async () => ({ Err: { FeeExceedsInput: { fee_sats: 5000n, total_input_sats: 3000n } } }),
    })
    await expect(createEscrowCanisterClient(fee, CANISTER_ID).claimTimeoutRefund('7')).rejects.toThrow(/FeeExceedsInput/)

    const ni = fakeActor({
      submit_dao_verdict: async () => ({ Err: { NotImplemented: { pending_followup: 'FU-253-H' } } }),
    })
    await expect(createEscrowCanisterClient(ni, CANISTER_ID).submitDaoVerdict('7', 0, 10_000, new Uint8Array(64)))
      .rejects.toThrow(/NotImplemented/)
  })
})

describe('escrowServerIdentity', () => {
  it('derives a deterministic Ed25519 principal from a 32-byte hex seed', () => {
    const seed = 'ab'.repeat(32)
    const a = escrowServerIdentity(seed).getPrincipal().toText()
    const b = escrowServerIdentity(seed).getPrincipal().toText()
    expect(a).toBe(b)
    expect(escrowServerIdentity('cd'.repeat(32)).getPrincipal().toText()).not.toBe(a)
  })

  it('rejects malformed seeds', () => {
    expect(() => escrowServerIdentity('too-short')).toThrow(/64 hex chars/)
    expect(() => escrowServerIdentity('zz'.repeat(32))).toThrow(/64 hex chars/)
  })
})
