import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { buildListingNaddr, buildNjumpUrl, buildNostrUri } from './remote-listing-link'

const PUBKEY = '0000000287d80000b421da1ef9556a969689c1c21d45582b6184cc5162799156'
const D_TAG = 'mercasats-187'

describe('buildListingNaddr', () => {
  it('encodes a naddr that decodes back to the same kind, pubkey and identifier', () => {
    const naddr = buildListingNaddr({ pubkey: PUBKEY, dTag: D_TAG })
    expect(naddr).not.toBeNull()
    expect(naddr!.startsWith('naddr1')).toBe(true)

    const decoded = nip19.decode(naddr!)
    expect(decoded.type).toBe('naddr')
    if (decoded.type !== 'naddr') throw new Error('unexpected type')
    expect(decoded.data.kind).toBe(30402)
    expect(decoded.data.pubkey).toBe(PUBKEY)
    expect(decoded.data.identifier).toBe(D_TAG)
    expect(decoded.data.relays).toEqual([])
  })

  it('keeps at most 3 relays, filters invalid ones and removes duplicates', () => {
    const naddr = buildListingNaddr({
      pubkey: PUBKEY,
      dTag: D_TAG,
      relays: [
        'wss://relay.one',
        'https://bad',
        'wss://relay.one',
        'ws://relay.two',
        'wss://relay.three',
        'wss://relay.four',
        'wss://relay.five',
      ],
    })
    const decoded = nip19.decode(naddr!)
    if (decoded.type !== 'naddr') throw new Error('unexpected type')
    expect(decoded.data.relays).toEqual(['wss://relay.one', 'ws://relay.two', 'wss://relay.three'])
  })

  it('trims relay strings before filtering', () => {
    const naddr = buildListingNaddr({ pubkey: PUBKEY, dTag: D_TAG, relays: ['  wss://relay.one  '] })
    const decoded = nip19.decode(naddr!)
    if (decoded.type !== 'naddr') throw new Error('unexpected type')
    expect(decoded.data.relays).toEqual(['wss://relay.one'])
  })

  it('returns null for a pubkey that is too short', () => {
    expect(buildListingNaddr({ pubkey: 'abc', dTag: D_TAG })).toBeNull()
  })

  it('returns null for a 63-character pubkey', () => {
    expect(buildListingNaddr({ pubkey: PUBKEY.slice(0, 63), dTag: D_TAG })).toBeNull()
  })

  it('returns null for an uppercase pubkey', () => {
    expect(buildListingNaddr({ pubkey: PUBKEY.toUpperCase(), dTag: D_TAG })).toBeNull()
  })

  it('returns null for an empty dTag', () => {
    expect(buildListingNaddr({ pubkey: PUBKEY, dTag: '' })).toBeNull()
  })

  it('never throws on malformed input', () => {
    expect(() => buildListingNaddr(null as unknown as { pubkey: string; dTag: string })).not.toThrow()
    expect(buildListingNaddr(null as unknown as { pubkey: string; dTag: string })).toBeNull()
  })
})

describe('buildNostrUri', () => {
  it('prefixes the naddr with nostr:', () => {
    const uri = buildNostrUri({ pubkey: PUBKEY, dTag: D_TAG })
    expect(uri).not.toBeNull()
    expect(uri!.startsWith('nostr:naddr1')).toBe(true)
  })

  it('returns null for an invalid reference', () => {
    expect(buildNostrUri({ pubkey: 'abc', dTag: D_TAG })).toBeNull()
  })
})

describe('buildNjumpUrl', () => {
  it('builds an njump.me URL with the naddr', () => {
    const url = buildNjumpUrl({ pubkey: PUBKEY, dTag: D_TAG })
    expect(url).not.toBeNull()
    expect(url!.startsWith('https://njump.me/naddr1')).toBe(true)
  })

  it('returns null for an empty dTag', () => {
    expect(buildNjumpUrl({ pubkey: PUBKEY, dTag: '' })).toBeNull()
  })
})
