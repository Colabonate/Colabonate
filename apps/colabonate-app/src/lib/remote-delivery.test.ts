import { describe, it, expect, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, nip17, type Event } from 'nostr-tools'
import {
  buildDeliveryMessage,
  parseInboxRelays,
  sendDeliveryMessage,
  validateDeliveryDetails,
  DELIVERY_MAX_LENGTH,
  type DeliveryDeps,
} from './remote-delivery'

const sellerSk = generateSecretKey()
const sellerPk = getPublicKey(sellerSk)
const buyerSk = generateSecretKey()
const buyerPk = getPublicKey(generateSecretKey())
const DETAILS = 'Jane Doe, Main Street 1, 10115 Berlin, jane@example.com'

function inbox(relays: string[], sk = sellerSk, kind = 10050): Event {
  return finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), content: '', tags: relays.map((r) => ['relay', r]) }, sk)
}

function makeDeps(over: Partial<DeliveryDeps> = {}): DeliveryDeps & { published: Array<{ relays: string[]; event: Event }> } {
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

const input = {
  orderId: 'abcdef1234567890',
  amountSats: 3090,
  payeeLud16: 'seller@example.com',
  listingAddress: `30402:${'a'.repeat(64)}:mercasats-187`,
  details: DETAILS,
  buyerPubkey: buyerPk,
  sellerPubkey: sellerPk,
}

describe('parseInboxRelays', () => {
  it('keeps wss relays, normalizes, dedupes and caps at 5', () => {
    const event = inbox(['wss://a.example.com/', 'wss://a.example.com', ...Array.from({ length: 8 }, (_, i) => `wss://r${i}.example.com`)])
    const relays = parseInboxRelays(event)
    expect(relays[0]).toBe('wss://a.example.com')
    expect(relays).toHaveLength(5)
    expect(new Set(relays).size).toBe(5)
  })

  it.each([
    'ws://plain.example.com',
    'https://web.example.com',
    'wss://localhost',
    'wss://127.0.0.1',
    'wss://10.0.0.5',
    'wss://[::1]',
    'wss://printer.local',
    'wss://db.internal',
    'wss://0xchat',
    'wss://umbrel.local:4848',
    'wss://user:pw@evil.example.com',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(parseInboxRelays({ tags: [['relay', url]] })).toEqual([])
  })

  it('ignores malformed tags and non-relay tags', () => {
    const tags = [null, [], ['relay'], ['relay', 5], ['r', 'wss://x.example.com'], ['relay', 'wss://ok.example.com']] as unknown as string[][]
    expect(parseInboxRelays({ tags })).toEqual(['wss://ok.example.com'])
  })

  it('handles null and missing tags', () => {
    expect(parseInboxRelays(null)).toEqual([])
    expect(parseInboxRelays({ tags: undefined } as unknown as Event)).toEqual([])
  })
})

describe('validateDeliveryDetails', () => {
  it('requires a trimmed length between 10 and 1000', () => {
    expect(validateDeliveryDetails('too short')).toBe(false)
    expect(validateDeliveryDetails('   '.padEnd(50, ' '))).toBe(false)
    expect(validateDeliveryDetails('x'.repeat(10))).toBe(true)
    expect(validateDeliveryDetails('x'.repeat(DELIVERY_MAX_LENGTH))).toBe(true)
    expect(validateDeliveryDetails('x'.repeat(DELIVERY_MAX_LENGTH + 1))).toBe(false)
  })
})

describe('buildDeliveryMessage', () => {
  it('names the order reference, amount, payee, listing, buyer identity and the details', () => {
    const text = buildDeliveryMessage(input)
    expect(text).toContain('Order abcdef12')
    expect(text).toContain('3090 sats')
    expect(text).toContain('seller@example.com')
    expect(text).toContain(input.listingAddress)
    expect(text).toContain(buyerPk)
    expect(text).toContain(DETAILS)
  })

  it('trims the details and never contains a preimage-like field', () => {
    const text = buildDeliveryMessage({ ...input, details: `  ${DETAILS}  ` })
    expect(text.endsWith(DETAILS)).toBe(true)
    expect(text.toLowerCase()).not.toContain('preimage')
  })
})

describe('sendDeliveryMessage', () => {
  it('publishes a NIP-17 gift wrap only to the seller inbox relays, readable by the seller', async () => {
    const deps = makeDeps({ fetchInboxEvent: vi.fn(async () => inbox(['wss://inbox.example.com', 'wss://two.example.com'])) })
    const result = await sendDeliveryMessage(deps, input)
    expect(result).toEqual({ kind: 'sent', relayCount: 2 })
    expect(deps.published).toHaveLength(1)
    const { relays, event } = deps.published[0]
    expect(relays).toEqual(['wss://inbox.example.com', 'wss://two.example.com'])
    expect(event.kind).toBe(1059)
    expect(event.tags).toContainEqual(['p', sellerPk])
    // The wrap is signed by a one-time key, not by the buyer.
    expect(event.pubkey).not.toBe(getPublicKey(buyerSk))
    // Plaintext never appears on the wire.
    expect(JSON.stringify(event)).not.toContain('Jane Doe')

    // The seller can open it and finds a Kind-14 DM from the sender key with the message.
    const rumor = nip17.unwrapEvent(event, sellerSk)
    expect(rumor.kind).toBe(14)
    expect(rumor.pubkey).toBe(getPublicKey(buyerSk))
    expect(rumor.tags).toContainEqual(['p', sellerPk])
    expect(rumor.content).toContain(DETAILS)
    expect(rumor.content).toContain('Order abcdef12')
  })

  it('cannot be opened by anyone else', async () => {
    const deps = makeDeps()
    await sendDeliveryMessage(deps, input)
    expect(() => nip17.unwrapEvent(deps.published[0].event, generateSecretKey())).toThrow()
  })

  it('reports no-inbox and publishes nothing when the seller has no Kind 10050', async () => {
    const deps = makeDeps({ fetchInboxEvent: vi.fn(async () => null) })
    expect(await sendDeliveryMessage(deps, input)).toEqual({ kind: 'no-inbox' })
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('reports no-inbox when the list has no usable relays', async () => {
    const deps = makeDeps({ fetchInboxEvent: vi.fn(async () => inbox(['ws://insecure.example.com', 'wss://localhost'])) })
    expect(await sendDeliveryMessage(deps, input)).toEqual({ kind: 'no-inbox' })
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('ignores an inbox list signed by someone else (relay injection)', async () => {
    const deps = makeDeps({ fetchInboxEvent: vi.fn(async () => inbox(['wss://evil.example.com'], generateSecretKey())) })
    expect(await sendDeliveryMessage(deps, input)).toEqual({ kind: 'no-inbox' })
    expect(deps.publish).not.toHaveBeenCalled()
  })

  it('ignores a list of the wrong kind and one with a bad signature', async () => {
    const wrongKind = makeDeps({ fetchInboxEvent: vi.fn(async () => inbox(['wss://x.example.com'], sellerSk, 10002)) })
    expect(await sendDeliveryMessage(wrongKind, input)).toEqual({ kind: 'no-inbox' })
    const badSig = makeDeps({ verifyEvent: () => false })
    expect(await sendDeliveryMessage(badSig, input)).toEqual({ kind: 'no-inbox' })
  })

  it('reports no-relay-accepted when every relay rejects', async () => {
    const deps = makeDeps({ publish: vi.fn(async () => 0) })
    expect(await sendDeliveryMessage(deps, input)).toEqual({ kind: 'failed', reason: 'no-relay-accepted' })
  })

  it('maps thrown errors to a failed result without leaking the details', async () => {
    const deps = makeDeps({ fetchInboxEvent: vi.fn(async () => { throw new Error(`boom ${DETAILS}`) }) })
    const result = await sendDeliveryMessage(deps, input)
    expect(result).toEqual({ kind: 'failed', reason: 'error' })
    expect(JSON.stringify(result)).not.toContain('Jane')
  })

  it.each([
    ['short details', { details: 'short' }],
    ['over-long details', { details: 'x'.repeat(DELIVERY_MAX_LENGTH + 1) }],
    ['bad seller pubkey', { sellerPubkey: 'nope' }],
    ['bad buyer pubkey', { buyerPubkey: 'nope' }],
  ])('rejects %s before any network call', async (_label, over) => {
    const deps = makeDeps()
    expect(await sendDeliveryMessage(deps, { ...input, ...over })).toEqual({ kind: 'failed', reason: 'invalid-input' })
    expect(deps.fetchInboxEvent).not.toHaveBeenCalled()
  })
})
