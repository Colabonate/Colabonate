import { describe, it, expect } from 'vitest'
import {
  computeVerdict,
  controllerDisposition,
  certificationPayload,
  verifyCertifiedTrade,
  type TrustFacts,
} from './icp-verification'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function facts(overrides: Partial<TrustFacts> = {}): TrustFacts {
  return {
    moduleHash: HASH_A,
    controllers: [],
    attestationHash: null,
    hasAttestation: false,
    previousControllers: null,
    livenessDegraded: false,
    ...overrides,
  }
}

describe('controllerDisposition', () => {
  it('empty controller set is blackhole', () => {
    expect(controllerDisposition([], null)).toBe('blackhole')
  })
  it('single declared DAO multisig is dao-multisig', () => {
    expect(controllerDisposition(['dao-principal'], 'dao-principal')).toBe('dao-multisig')
  })
  it('plain single controller is mutable (no immutability claim)', () => {
    expect(controllerDisposition(['some-principal'], null)).toBe('mutable')
  })
  it('multiple controllers are mutable even if DAO is one of them', () => {
    expect(controllerDisposition(['dao-principal', 'other'], 'dao-principal')).toBe('mutable')
  })
})

describe('computeVerdict', () => {
  it('no attestation -> HashUnknown (blocks funding)', () => {
    const r = computeVerdict(facts({ controllers: ['x'] }), null)
    expect(r.verdict).toBe('HashUnknown')
  })

  it('attestation mismatches certified hash -> HashMismatch', () => {
    const r = computeVerdict(facts({ hasAttestation: true, attestationHash: HASH_B }), null)
    expect(r.verdict).toBe('HashMismatch')
  })

  it('attestation matches and empty controllers -> VerifiedImmutable', () => {
    const r = computeVerdict(facts({ hasAttestation: true, attestationHash: HASH_A, controllers: [] }), null)
    expect(r.verdict).toBe('VerifiedImmutable')
    expect(r.controllerDisposition).toBe('blackhole')
  })

  it('attestation matches and DAO controller -> VerifiedGoverned (dao-multisig)', () => {
    const r = computeVerdict(
      facts({ hasAttestation: true, attestationHash: HASH_A, controllers: ['dao-p'] }),
      'dao-p',
    )
    expect(r.verdict).toBe('VerifiedGoverned')
    expect(r.controllerDisposition).toBe('dao-multisig')
  })

  it('attestation matches and plain controller -> VerifiedGoverned (mutable)', () => {
    const r = computeVerdict(
      facts({ hasAttestation: true, attestationHash: HASH_A, controllers: ['someone'] }),
      null,
    )
    expect(r.verdict).toBe('VerifiedGoverned')
    expect(r.controllerDisposition).toBe('mutable')
  })

  it('controller change takes precedence over HashUnknown', () => {
    const r = computeVerdict(
      facts({ controllers: ['new'], previousControllers: ['old'] }),
      null,
    )
    expect(r.verdict).toBe('ControllerChanged')
  })

  it('controller change takes precedence over HashMismatch', () => {
    const r = computeVerdict(
      facts({
        controllers: ['new'],
        previousControllers: ['old'],
        hasAttestation: true,
        attestationHash: HASH_B,
      }),
      null,
    )
    expect(r.verdict).toBe('ControllerChanged')
  })

  it('carries the liveness overlay', () => {
    const r = computeVerdict(facts({ livenessDegraded: true, hasAttestation: true, attestationHash: HASH_A }), null)
    expect(r.livenessDegraded).toBe(true)
    expect(r.verdict).toBe('VerifiedImmutable')
  })

  it('attestation hash comparison is case-insensitive', () => {
    const r = computeVerdict(
      facts({ hasAttestation: true, attestationHash: HASH_A.toUpperCase() }),
      null,
    )
    expect(r.verdict).toBe('VerifiedImmutable')
  })
})

describe('FU-619: certificationPayload (canister `certification_payload` mirror)', () => {
  // Pinned to the same vectors as the Rust cert tests in
  // packages/icp-escrow-canister/src/lib.rs — byte-contract between canister leaf
  // and client recomputation.
  it('binds trade id, funding address, amount and state (plain states)', () => {
    expect(certificationPayload({
      canisterTradeId: 7,
      btcAddress: 'bc1qtest7',
      expectedAmountSats: 100_000,
      state: 'PENDING_FUNDING',
      settledBuyerBps: null,
      settledSellerBps: null,
    })).toBe('colabonate-escrow-cert-v1|7|bc1qtest7|100000|PendingFunding')
  })

  it('carries the bps pair for DISPUTE_SETTLED', () => {
    expect(certificationPayload({
      canisterTradeId: 7,
      btcAddress: 'bc1qtest7',
      expectedAmountSats: 100_000,
      state: 'DISPUTE_SETTLED',
      settledBuyerBps: 4_000,
      settledSellerBps: 6_000,
    })).toBe('colabonate-escrow-cert-v1|7|bc1qtest7|100000|DisputeSettled:4000:6000')
  })

  it('returns null for unknown states or missing bps (never a fabricated payload)', () => {
    expect(certificationPayload({
      canisterTradeId: 7,
      btcAddress: 'bc1qtest7',
      expectedAmountSats: 100_000,
      state: 'SOMETHING_ELSE',
      settledBuyerBps: null,
      settledSellerBps: null,
    })).toBeNull()
    expect(certificationPayload({
      canisterTradeId: 7,
      btcAddress: 'bc1qtest7',
      expectedAmountSats: 100_000,
      state: 'DISPUTE_SETTLED',
      settledBuyerBps: null,
      settledSellerBps: null,
    })).toBeNull()
  })
})

describe('FU-619: verifyCertifiedTrade failure paths (no network)', () => {
  it('reports no-certificate when the server relayed nothing', async () => {
    const result = await verifyCertifiedTrade({
      canisterId: 'aaaaa-aa',
      tradeCanisterId: 'aaaaa-aa',
      certificateBase64: null,
      witnessBase64: null,
      trade: {
        canisterTradeId: '7',
        btcAddress: 'bc1qtest7',
        expectedAmountSats: 100_000,
        state: 'PENDING_FUNDING',
        settledBuyerBps: null,
        settledSellerBps: null,
      },
    })
    expect(result).toMatchObject({ verified: false, reason: 'no-certificate' })
  })

  it('rejects a trade row claiming a different canister than the pin (server MITM guard)', async () => {
    const result = await verifyCertifiedTrade({
      canisterId: 'aaaaa-aa',
      tradeCanisterId: 'attacker-canister-id',
      certificateBase64: 'AAECAw==',
      witnessBase64: 'AAECAw==',
      trade: {
        canisterTradeId: '7',
        btcAddress: 'bc1qattacker',
        expectedAmountSats: 100_000,
        state: 'PENDING_FUNDING',
        settledBuyerBps: null,
        settledSellerBps: null,
      },
    })
    expect(result).toMatchObject({ verified: false, reason: 'canister-mismatch' })
  })
})

describe('FU-619: witness fixture from the canister Rust tests (cross-implementation)', () => {
  // Exact bytes pinned in packages/icp-escrow-canister/src/lib.rs
  // `cert_witness_fixture_vector`: a two-trade tree (7 Funded, 8 PendingFunding), witness for
  // trade 7. Exercises verifyCertifiedTrade's witness half against canister-produced CBOR —
  // key encoding (8-byte big-endian), witness walk, leaf payload compare, root reconstruction.
  const WITNESS_HEX = '8301830248000000000000000782035833636f6c61626f6e6174652d657363726f772d636572742d76317c377c6263317174657374377c3130303030307c46756e646564820458209d71fe1c4e5e09b15b0dc7e6307e3af34e8556a536f4601f265080d264f4570e'
  const ROOT_HEX = '0387e18e73f15e012108f3bf9368ee94e4aa1c1920b521b6c9512f01893f8d8c'
  const PAYLOAD_7 = 'colabonate-escrow-cert-v1|7|bc1qtest7|100000|Funded'

  function hexToBytes(hex: string): Uint8Array {
    return Uint8Array.from(hex.match(/.{2}/g) ?? [], (h) => parseInt(h, 16))
  }

  it('decodes the canister witness, reconstructs the pinned root, and finds the leaf under the BE-u64 key', async () => {
    const { Cbor, reconstruct, lookup_path, lookupResultToBuffer } = await import('@icp-sdk/core/agent')
    const tree = Cbor.decode<never>(hexToBytes(WITNESS_HEX))
    const reconstructed = await reconstruct(tree)
    expect(Array.from(reconstructed)).toEqual(Array.from(hexToBytes(ROOT_HEX)))

    // 8-byte big-endian u64 key for trade id 7 — mirrors Rust `cert_key` (`to_be_bytes`).
    const key = new Uint8Array(8)
    new DataView(key.buffer).setBigUint64(0, 7n, false)
    const leaf = lookupResultToBuffer(lookup_path([key], tree))
    expect(leaf).toBeDefined()
    expect(new TextDecoder().decode(leaf ?? new Uint8Array())).toBe(PAYLOAD_7)
  })
})
