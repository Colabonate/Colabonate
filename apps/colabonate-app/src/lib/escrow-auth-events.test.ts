/**
 * FU-618 (ADR-357 D3): escrow authorization event tests. Pins the contract the
 * canister verifies (`sig.rs`, FU-617):
 *  - the canonical terms message format (byte-exact mirror of
 *    `sig::trade_terms_message`, including Rust slice-Debug bps formatting),
 *  - the NIP-01 event id cross-vector shared with the Rust test suite
 *    (`canonical_serialization_matches_nostr_tools_vector`),
 *  - the sign → wire pipeline against nostr-tools' own verification.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, nip19, verifyEvent } from 'nostr-tools'
import {
  ESCROW_TERMS_EVENT_KIND,
  ESCROW_ACTION_EVENT_KIND,
  escrowTradeTermsMessage,
  buildTermsEventTemplate,
  buildReleaseMilestoneEventTemplate,
  buildOpenDisputeEventTemplate,
  signEscrowEvent,
  signTermsEvent,
  signReleaseMilestoneEvent,
  signOpenDisputeEvent,
  toAuthEventWire,
  escrowEventId,
  pubkeyFromNsec,
  signTermsEventWithNsec,
} from './escrow-auth-events'

function makeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k ?? '') ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage: Storage }).localStorage = makeLocalStorage() as unknown as Storage
})

describe('escrowTradeTermsMessage', () => {
  it('pins the canonical format (single milestone)', () => {
    const message = escrowTradeTermsMessage({
      buyerPubkey: 'aa'.repeat(32),
      sellerPubkey: 'bb'.repeat(32),
      buyerRefundAddress: 'bc1qrefund',
      sellerPayoutAddress: 'bc1qpayout',
      expectedAmountSats: 100_000,
      milestoneBps: [10_000],
      timeoutAt: 1_735_689_600_000_000_000,
    })
    expect(message).toBe(
      `colabonate-escrow-v1:create_trade:${'aa'.repeat(32)}:${'bb'.repeat(32)}:bc1qrefund:bc1qpayout:100000:[10000]:1735689600000000000`,
    )
  })

  it('formats multi-milestone bps in Rust slice-Debug style (comma + space)', () => {
    const message = escrowTradeTermsMessage({
      buyerPubkey: 'aa'.repeat(32),
      sellerPubkey: 'bb'.repeat(32),
      buyerRefundAddress: 'bc1qrefund',
      sellerPayoutAddress: 'bc1qpayout',
      expectedAmountSats: 999n,
      milestoneBps: [2_500, 5_000, 2_500],
      timeoutAt: 1n,
    })
    expect(message).toMatch(/:999:\[2500, 5000, 2500\]:1$/)
  })
})

describe('event templates', () => {
  it('terms template: kind 30416, action tag, terms message as content', () => {
    const template = buildTermsEventTemplate({
      buyerPubkey: 'aa'.repeat(32),
      sellerPubkey: 'bb'.repeat(32),
      buyerRefundAddress: 'bc1qrefund',
      sellerPayoutAddress: 'bc1qpayout',
      expectedAmountSats: 100_000,
      milestoneBps: [10_000],
      timeoutAt: 1_735_689_600_000_000_000,
    })
    expect(template.kind).toBe(ESCROW_TERMS_EVENT_KIND)
    expect(template.tags).toEqual([['action', 'create_trade']])
    expect(template.content).toContain('colabonate-escrow-v1:create_trade:')
  })

  it('release template binds trade id, action and milestone index via tags', () => {
    const template = buildReleaseMilestoneEventTemplate(7, 1)
    expect(template.kind).toBe(ESCROW_ACTION_EVENT_KIND)
    expect(template.tags).toEqual([
      ['trade', '7'],
      ['action', 'release_milestone'],
      ['i', '1'],
    ])
    expect(template.content).toBe('')
  })

  it('dispute template binds trade id and action via tags', () => {
    const template = buildOpenDisputeEventTemplate(42)
    expect(template.kind).toBe(ESCROW_ACTION_EVENT_KIND)
    expect(template.tags).toEqual([
      ['trade', '42'],
      ['action', 'open_dispute'],
    ])
  })

  it('cross-checks the NIP-01 action-event id against the canister Rust test vector', () => {
    // Same event as sig.rs `canonical_serialization_matches_nostr_tools_action_vector`
    // (kind 30417): the canister recomputes exactly this id and verifies BIP-340 over it.
    // If nostr-tools and the canister ever drift apart, this pins the break here.
    const template = buildReleaseMilestoneEventTemplate(7, 1)
    const id = escrowEventId(template, '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 1_730_000_000)
    expect(id).toBe('fcbda4d2032ddb8aa77100f1ff1bbe7d9832b5affcc83b49a131a64148a275f7')
  })

  it('cross-checks the NIP-01 terms-event id against the canister Rust test vector', () => {
    // Mirrors sig.rs `canonical_serialization_matches_nostr_tools_terms_vector` (kind 30416):
    // pins the terms contract — kind + ["action","create_trade"] tag + the canonical terms
    // message as content — not just the action half of the protocol.
    const template = buildTermsEventTemplate({
      buyerPubkey: 'aa'.repeat(32),
      sellerPubkey: 'bb'.repeat(32),
      buyerRefundAddress: 'bc1qrefund',
      sellerPayoutAddress: 'bc1qpayout',
      expectedAmountSats: 100_000,
      milestoneBps: [10_000],
      timeoutAt: 1_735_689_600_000_000_000,
    })
    const id = escrowEventId(template, '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 1_730_000_000)
    expect(id).toBe('9e40dec5ad9595f8f2bb5cc3613d4c7c1c977b9b70779a9aedaa034582a43676')
  })
})

describe('signEscrowEvent → wire', () => {
  it('burner path produces a nostr-tools-verifiable event (what the canister verifies)', async () => {
    const template = buildReleaseMilestoneEventTemplate(7, 1)
    const event = await signEscrowEvent(template)
    expect(verifyEvent(event)).toBe(true)
    expect(event.kind).toBe(ESCROW_ACTION_EVENT_KIND)
    expect(event.tags).toContainEqual(['trade', '7'])
    const wire = toAuthEventWire(event)
    expect(wire.id).toBe(event.id)
    expect(wire.createdAt).toBe(event.created_at)
    expect(wire.sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it('a locally finalized release event passes the same verification (signer-agnostic)', () => {
    const template = buildReleaseMilestoneEventTemplate(3, 0)
    const sk = generateSecretKey()
    const event = finalizeEvent({ ...template, created_at: 1_730_000_000 }, sk)
    expect(event.id).toBe(getEventHash({ ...template, created_at: 1_730_000_000, pubkey: event.pubkey }))
    expect(verifyEvent(event)).toBe(true)
    const wire = toAuthEventWire(event)
    expect(wire.sig).toHaveLength(128)
  })
})

describe('convenience signers (P3/P4 call-site API)', () => {
  it('signTermsEvent wires a verifiable kind-30416 terms event', async () => {
    const wire = await signTermsEvent({
      buyerPubkey: 'aa'.repeat(32),
      sellerPubkey: 'bb'.repeat(32),
      buyerRefundAddress: 'bc1qrefund',
      sellerPayoutAddress: 'bc1qpayout',
      expectedAmountSats: 100_000,
      milestoneBps: [10_000],
      timeoutAt: 1_735_689_600_000_000_000,
    })
    expect(wire.kind).toBe(ESCROW_TERMS_EVENT_KIND)
    expect(wire.tags).toEqual([['action', 'create_trade']])
    expect(wire.content).toContain('colabonate-escrow-v1:create_trade:')
    expect(wire.sig).toMatch(/^[0-9a-f]{128}$/)
  })

  it('signReleaseMilestoneEvent wires a verifiable kind-30417 action event', async () => {
    const wire = await signReleaseMilestoneEvent(7, 1)
    expect(wire.kind).toBe(ESCROW_ACTION_EVENT_KIND)
    expect(wire.tags).toEqual([['trade', '7'], ['action', 'release_milestone'], ['i', '1']])
    expect(wire.createdAt).toBeGreaterThan(0)
  })

  it('signOpenDisputeEvent wires a verifiable kind-30417 action event', async () => {
    const wire = await signOpenDisputeEvent(42)
    expect(wire.kind).toBe(ESCROW_ACTION_EVENT_KIND)
    expect(wire.tags).toEqual([['trade', '42'], ['action', 'open_dispute']])
  })
})

describe('counterparty nsec signing (local test path)', () => {
  it('pubkeyFromNsec derives the same pubkey as the nsec', () => {
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)
    expect(pubkeyFromNsec(nsec)).toBe(getPublicKey(sk))
  })

  it('signTermsEventWithNsec produces a verifiable terms event signed by the nsec owner', () => {
    const sk = generateSecretKey()
    const nsec = nip19.nsecEncode(sk)
    const wire = signTermsEventWithNsec(nsec, {
      buyerPubkey: 'aa'.repeat(32),
      sellerPubkey: 'bb'.repeat(32),
      buyerRefundAddress: 'bc1qrefund',
      sellerPayoutAddress: 'bc1qpayout',
      expectedAmountSats: 100_000,
      milestoneBps: [10_000],
      timeoutAt: 1_735_689_600_000_000_000,
    })
    expect(wire.pubkey).toBe(getPublicKey(sk))
    expect(wire.kind).toBe(ESCROW_TERMS_EVENT_KIND)
    expect(wire.sig).toMatch(/^[0-9a-f]{128}$/)
    const event = { id: wire.id, pubkey: wire.pubkey, created_at: wire.createdAt, kind: wire.kind, tags: wire.tags, content: wire.content, sig: wire.sig }
    expect(verifyEvent(event)).toBe(true)
  })

  it('rejects a non-nsec secret', () => {
    const sk = generateSecretKey()
    const npub = nip19.npubEncode(getPublicKey(sk))
    expect(() => pubkeyFromNsec(npub)).toThrow(/not a private key/)
  })
})
