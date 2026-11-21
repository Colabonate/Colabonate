// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, nip17, type Event } from 'nostr-tools'
import {
  buildOrderNotice,
  hasNoticeBeenSent,
  markNoticeSent,
  sendOrderNotice,
  shouldAutoSendNotice,
} from './remote-order-notice'
import type { DeliveryDeps } from './remote-delivery'

const sellerSk = generateSecretKey()
const sellerPk = getPublicKey(sellerSk)
const buyerSk = generateSecretKey()
const buyerPk = getPublicKey(buyerSk)
// Looks like a preimage / invoice: must never be part of the notice.
const SECRET = 'f'.repeat(64)

const input = {
  orderId: 'abcdef1234567890',
  amountSats: 3090,
  payeeLud16: 'seller@example.com',
  listingAddress: `30402:${'a'.repeat(64)}:mercasats-187`,
  buyerPubkey: buyerPk,
  sellerPubkey: sellerPk,
}

function inbox(relays: string[], sk = sellerSk): Event {
  return finalizeEvent({ kind: 10050, created_at: Math.floor(Date.now() / 1000), content: '', tags: relays.map((r) => ['relay', r]) }, sk)
}

function makeDeps(over: Partial<DeliveryDeps> = {}) {
  const published: Array<{ relays: string[]; event: Event }> = []
  const deps: DeliveryDeps = {
    fetchInboxEvent: vi.fn(async () => inbox(['wss://inbox.example.com'])),
    publish: vi.fn(async (relays: string[], event: Event) => {
      published.push({ relays, event })
      return relays.length
    }),
    senderKey: () => buyerSk,
    verifyEvent: () => true,
    ...over,
  }
  return Object.assign(deps, { published })
}

beforeEach(() => localStorage.clear())

describe('buildOrderNotice', () => {
  it('names reference, amount, payee, listing and buyer identity, and no contact data or secret', () => {
    const text = buildOrderNotice(input)
    expect(text).toContain('abcdef12')
    expect(text).not.toContain('abcdef1234567890')
    expect(text).toContain('3090 sats')
    expect(text).toContain('seller@example.com')
    expect(text).toContain(input.listingAddress)
    expect(text).toContain(buyerPk)
    expect(text).not.toMatch(/preimage:|bolt11|lnbc/i)
    expect(text).not.toContain(SECRET)
  })
})

describe('shouldAutoSendNotice', () => {
  it.each([
    ['seller', true, false, true],
    ['author', true, false, false],
    ['seller', false, false, false],
    ['seller', true, true, false],
    ['author', false, true, false],
  ] as const)('role=%s optIn=%s alreadySent=%s -> %s', (payeeRole, optIn, alreadySent, expected) => {
    expect(shouldAutoSendNotice({ payeeRole, optIn, alreadySent })).toBe(expected)
  })
})

describe('sent marker', () => {
  it('is per order and survives reads', () => {
    expect(hasNoticeBeenSent('o1')).toBe(false)
    markNoticeSent('o1')
    expect(hasNoticeBeenSent('o1')).toBe(true)
    expect(hasNoticeBeenSent('o2')).toBe(false)
  })

  it('does not throw when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(hasNoticeBeenSent('o1')).toBe(false)
    expect(() => markNoticeSent('o1')).not.toThrow()
    spy.mockRestore()
    set.mockRestore()
  })
})

describe('sendOrderNotice', () => {
  it('publishes a NIP-17 wrap to the seller inbox relays only; the seller can read it, no plaintext on the wire', async () => {
    const deps = makeDeps()
    const result = await sendOrderNotice(deps, input)
    expect(result).toEqual({ kind: 'sent', relayCount: 1 })
    expect(deps.published).toHaveLength(1)
    expect(deps.published[0]!.relays).toEqual(['wss://inbox.example.com'])
    const wrap = deps.published[0]!.event
    expect(wrap.kind).toBe(1059)
    expect(JSON.stringify(wrap)).not.toContain('Order notice')
    expect(JSON.stringify(wrap)).not.toContain(buyerPk.slice(0, 16) + ' ')
    const rumor = nip17.unwrapEvent(wrap, sellerSk)
    expect(rumor.kind).toBe(14)
    expect(rumor.content).toBe(buildOrderNotice(input))
    expect(rumor.pubkey).toBe(buyerPk)
    expect(() => nip17.unwrapEvent(wrap, generateSecretKey())).toThrow()
  })

  it('reports no-inbox and publishes nothing without a Kind 10050', async () => {
    const deps = makeDeps({ fetchInboxEvent: vi.fn(async () => null) })
    expect(await sendOrderNotice(deps, input)).toEqual({ kind: 'no-inbox' })
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('ignores an inbox list signed by someone else', async () => {
    const deps = makeDeps({ fetchInboxEvent: vi.fn(async () => inbox(['wss://evil.example.com'], generateSecretKey())) })
    expect(await sendOrderNotice(deps, input)).toEqual({ kind: 'no-inbox' })
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('rejects invalid keys or a missing order id without any network call', async () => {
    const deps = makeDeps()
    expect(await sendOrderNotice(deps, { ...input, sellerPubkey: 'nope' })).toEqual({ kind: 'failed', reason: 'invalid-input' })
    expect(await sendOrderNotice(deps, { ...input, buyerPubkey: '' })).toEqual({ kind: 'failed', reason: 'invalid-input' })
    expect(await sendOrderNotice(deps, { ...input, orderId: '' })).toEqual({ kind: 'failed', reason: 'invalid-input' })
    expect(deps.fetchInboxEvent).not.toHaveBeenCalled()
  })

  it('reports no-relay-accepted and error without leaking', async () => {
    expect(await sendOrderNotice(makeDeps({ publish: vi.fn(async () => 0) }), input)).toEqual({ kind: 'failed', reason: 'no-relay-accepted' })
    expect(await sendOrderNotice(makeDeps({ publish: vi.fn(async () => { throw new Error('boom ' + buyerPk) }) }), input)).toEqual({ kind: 'failed', reason: 'error' })
  })

  it('publishes the own inbox best effort, and a failure there does not fail the send', async () => {
    const ok = vi.fn(async () => undefined)
    expect((await sendOrderNotice(makeDeps({ ensureOwnInbox: ok }), input)).kind).toBe('sent')
    expect(ok).toHaveBeenCalledTimes(1)
    const bad = vi.fn(async () => { throw new Error('relay down') })
    expect((await sendOrderNotice(makeDeps({ ensureOwnInbox: bad }), input)).kind).toBe('sent')
    const syncThrow = vi.fn(() => { throw new Error('sync') }) as unknown as () => Promise<void>
    expect((await sendOrderNotice(makeDeps({ ensureOwnInbox: syncThrow }), input)).kind).toBe('sent')
  })

  it('does not publish the own inbox when there is nobody to send to', async () => {
    const ensure = vi.fn(async () => undefined)
    await sendOrderNotice(makeDeps({ fetchInboxEvent: vi.fn(async () => null), ensureOwnInbox: ensure }), input)
    expect(ensure).not.toHaveBeenCalled()
  })
})
