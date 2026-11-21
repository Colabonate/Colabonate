import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildZapRequestTemplate, signZapRequest, type ZapTemplate } from './zap-request'
import { signOrDelegate } from './nostr-identity'

vi.mock('./nostr-identity', () => ({
  signOrDelegate: vi.fn(),
}))

const base: ZapTemplate = {
  payeePubkey: 'a'.repeat(64),
  amountMsats: 21_000,
  lnurl: 'lnurl1example',
  relays: ['wss://relay.one', 'ws://relay.two'],
  listingAddress: '30402:' + 'b'.repeat(64) + ':listing-d',
}

describe('buildZapRequestTemplate', () => {
  it('builds kind 9734 with the exact tag order', () => {
    const tpl = buildZapRequestTemplate(base, 'thanks', 1_700_000_000)
    expect(tpl.kind).toBe(9734)
    expect(tpl.created_at).toBe(1_700_000_000)
    expect(tpl.content).toBe('thanks')
    expect(tpl.tags).toEqual([
      ['relays', 'wss://relay.one', 'ws://relay.two'],
      ['amount', '21000'],
      ['lnurl', 'lnurl1example'],
      ['p', 'a'.repeat(64)],
      ['a', '30402:' + 'b'.repeat(64) + ':listing-d'],
    ])
  })

  it('adds no client or e tags', () => {
    const tags = buildZapRequestTemplate(base, '', 1).tags as string[][]
    const names = tags.map((t) => t[0])
    expect(names).not.toContain('client')
    expect(names).not.toContain('e')
  })

  it('defaults content to empty and created_at to now in seconds', () => {
    const before = Math.floor(Date.now() / 1000)
    const tpl = buildZapRequestTemplate(base)
    const after = Math.floor(Date.now() / 1000)
    expect(tpl.content).toBe('')
    expect(tpl.created_at).toBeGreaterThanOrEqual(before)
    expect(tpl.created_at).toBeLessThanOrEqual(after)
  })

  it('trims content to 280 characters', () => {
    const tpl = buildZapRequestTemplate(base, 'x'.repeat(500), 1)
    expect(tpl.content).toHaveLength(280)
  })

  it('drops relay URLs that are not ws or wss', () => {
    const tpl = buildZapRequestTemplate(
      { ...base, relays: ['https://nope.example', 'wss://ok.example', 'relay.bare', 'ws://also.ok'] },
      '',
      1,
    )
    expect(tpl.tags?.[0]).toEqual(['relays', 'wss://ok.example', 'ws://also.ok'])
  })

  it('keeps at most 10 relays', () => {
    const relays = Array.from({ length: 15 }, (_, i) => `wss://r${i}.example`)
    const tpl = buildZapRequestTemplate({ ...base, relays }, '', 1)
    const relayTag = tpl.tags?.[0] as string[]
    expect(relayTag).toHaveLength(11) // 'relays' + 10 urls
    expect(relayTag[10]).toBe('wss://r9.example')
  })
})

describe('signZapRequest', () => {
  beforeEach(() => {
    vi.mocked(signOrDelegate).mockReset()
  })

  it('signs the built template via signOrDelegate and returns its result', async () => {
    const fakeSigned = { id: 'f'.repeat(64), sig: 's', kind: 9734 } as never
    vi.mocked(signOrDelegate).mockResolvedValue(fakeSigned)

    const result = await signZapRequest(base, 'hi')

    expect(result).toBe(fakeSigned)
    expect(signOrDelegate).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(signOrDelegate).mock.calls[0][0]
    expect(arg.kind).toBe(9734)
    expect(arg.content).toBe('hi')
    expect(arg.tags).toEqual(buildZapRequestTemplate(base, 'hi', arg.created_at).tags)
  })
})
