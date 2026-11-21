// ADR-277 D2/A4 — categoryCode / gammaTags ingest split.

import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'

import { extractOriginUrl, extractSellerPubkey, normalizeOfferEvent } from './nostr-normalizer.js'

function fixtureEvent(tags: string[][], content = 'A fine listing'): Event {
  return {
    kind: 30402,
    tags,
    content,
    created_at: 1_700_000_000,
    pubkey: 'foreign-merchant-pubkey',
    id: 'event-id-1',
    sig: 'sig',
  }
}

describe('normalizeOfferEvent — ADR-277 categoryCode/gammaTags split', () => {
  it('reads categoryCode from `category` only, and gammaTags from all `t` tags, normalized', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['category', 'goods/electronics'],
      ['t', 'Electronics'],
      ['t', '#Second Hand'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.categoryCode).toBe('goods/electronics')
    expect(result?.gammaTags).toEqual(['electronics', 'second-hand'])
  })

  it('a conforming Gamma listing without a `category` tag maps categoryCode from gammaTags via the D3 seed map', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['t', 'electronics'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.categoryCode).toBe('goods/electronics')
    expect(result?.gammaTags).toEqual(['electronics'])
  })

  it('leaves categoryCode empty (not a wrong slug) when no `category` tag and no `t` tag maps', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['t', 'some-unmapped-hashtag'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.categoryCode).toBe('')
    expect(result?.gammaTags).toEqual(['some-unmapped-hashtag'])
  })

  it('a `category` tag never leaks into gammaTags and a `t` tag never leaks into categoryCode', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['category', 'goods/clothing'],
      ['t', 'streetwear'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.categoryCode).toBe('goods/clothing')
    expect(result?.gammaTags).toEqual(['streetwear'])
    expect(result?.gammaTags).not.toContain('goods/clothing')
  })
})

describe('normalizeOfferEvent — ADR-380 service offerType derivation', () => {
  it('a foreign service listing with no `offer_type` tag is classified SERVICE from its mapped category', () => {
    const event = fixtureEvent([
      ['title', 'Website build'],
      ['price', '1000', 'sats'],
      ['t', 'web-development'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.categoryCode).toBe('services/development/web')
    expect(result?.offerType).toBe('SERVICE')
  })

  it('an explicit `offer_type` tag wins over the category-derived type', () => {
    const event = fixtureEvent([
      ['title', 'Website build'],
      ['price', '1000', 'sats'],
      ['offer_type', 'PRODUCT'],
      ['t', 'web-development'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.categoryCode).toBe('services/development/web')
    expect(result?.offerType).toBe('PRODUCT')
  })

  it('a goods listing still defaults to PRODUCT', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['t', 'electronics'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.categoryCode).toBe('goods/electronics')
    expect(result?.offerType).toBe('PRODUCT')
  })

  it('a listing with no mappable tag stays PRODUCT (honest default, not a guess)', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['t', 'some-unmapped-hashtag'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.categoryCode).toBe('')
    expect(result?.offerType).toBe('PRODUCT')
  })
})

describe('normalizeOfferEvent — ADR-277 Phase R remote listing fidelity', () => {
  it('D9.1/R2: a non-sats price is never coerced into priceSats — priceAmount/priceCurrency carry it instead', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '49.99', 'USD'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.priceSats).toBeNull()
    expect(result?.priceAmount).toBe('49.99')
    expect(result?.priceCurrency).toBe('USD')
  })

  it('R2: sats/sat/msat currencies still populate priceSats as before', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.priceSats).toBe(1000)
    expect(result?.priceAmount).toBeNull()
    expect(result?.priceCurrency).toBeNull()
  })

  it('R2: a price with no currency tag defaults to sats per NIP-99', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.priceSats).toBe(1000)
  })

  it('D9.3/R3: visibility=hidden is not ingested', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['visibility', 'hidden'],
    ])

    expect(normalizeOfferEvent(event, 'wss://relay.example')).toBeNull()
  })

  it('D9.2/R3: type[0]=variation maps to productType so the ADR-270 variation filter applies to foreign listings', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['type', 'variation', 'physical'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.productType).toBe('variation')
    expect(result?.physicalType).toBe('physical')
  })

  it('D9.4/R3: stock=0 is carried through as sold out, not dropped', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['stock', '0'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.stock).toBe(0)
  })

  it('D9.5/R4 (amended): location + g are read; country is derived from free-text location ("Berlin, Germany" → DE)', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['location', 'Berlin, Germany'],
      ['g', 'u33dbfz'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.location).toBe('Berlin, Germany')
    expect(result?.geohash).toBe('u33dbfz')
    expect(result?.country).toBe('DE')
  })

  it('D9.5: a bare ISO code as the last location segment is honoured ("Lisbon, PT" → PT)', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['location', 'Lisbon, PT'],
    ])

    expect(normalizeOfferEvent(event, 'wss://relay.example')?.country).toBe('PT')
  })

  it('D9.5: an explicit country tag is normalized to ISO ("de" → DE, "Germany" → DE), invalid values drop to location derivation', () => {
    const lowerIso = normalizeOfferEvent(fixtureEvent([
      ['title', 'Widget'], ['price', '1000', 'sats'], ['country', 'de'],
    ]), 'wss://relay.example')
    const fullName = normalizeOfferEvent(fixtureEvent([
      ['title', 'Widget'], ['price', '1000', 'sats'], ['country', 'Germany'],
    ]), 'wss://relay.example')
    const invalidFallsBack = normalizeOfferEvent(fixtureEvent([
      ['title', 'Widget'], ['price', '1000', 'sats'], ['country', 'not-a-country'], ['location', 'Vienna, Austria'],
    ]), 'wss://relay.example')

    expect(lowerIso?.country).toBe('DE')
    expect(fullName?.country).toBe('DE')
    expect(invalidFallsBack?.country).toBe('AT')
  })

  it('D9.5: US/CA subnational abbreviations map to their country ("Sodus, MI" → US, "Toronto, ON" → CA)', () => {
    const michigan = normalizeOfferEvent(fixtureEvent([
      ['title', 'Widget'], ['price', '1000', 'sats'], ['location', 'Sodus, MI'],
    ]), 'wss://relay.example')
    const ontario = normalizeOfferEvent(fixtureEvent([
      ['title', 'Widget'], ['price', '1000', 'sats'], ['location', 'Toronto, ON'],
    ]), 'wss://relay.example')

    expect(michigan?.country).toBe('US')
    expect(ontario?.country).toBe('CA')
  })

  it('D9.5: codes colliding between ISO and US states resolve ISO-first ("Berlin, DE" → DE, not Delaware→US)', () => {
    const event = fixtureEvent([
      ['title', 'Widget'], ['price', '1000', 'sats'], ['location', 'Berlin, DE'],
    ])

    expect(normalizeOfferEvent(event, 'wss://relay.example')?.country).toBe('DE')
  })

  it('D9.5: stopwords never yield a country ("shop at 5th Ave" → null) and geohash-only listings stay null', () => {
    const stopword = normalizeOfferEvent(fixtureEvent([
      ['title', 'Widget'], ['price', '1000', 'sats'], ['location', 'shop at 5th Ave'],
    ]), 'wss://relay.example')
    const geohashOnly = normalizeOfferEvent(fixtureEvent([
      ['title', 'Widget'], ['price', '1000', 'sats'], ['g', 'u33dbfz'],
    ]), 'wss://relay.example')

    expect(stopword?.country).toBeNull()
    expect(geohashOnly?.country).toBeNull()
  })

  it('D9.7/R7: multiple images keep their published sort order, not tag-declaration order', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['image', 'https://example.com/second.jpg', '800x600', '2'],
      ['image', 'https://example.com/first.jpg', '800x600', '1'],
    ])

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.images).toEqual([
      'https://example.com/first.jpg',
      'https://example.com/second.jpg',
    ])
  })

  it('R6/R8: summary, specs, weight and dim are all carried through', () => {
    const event = fixtureEvent([
      ['title', 'Widget'],
      ['price', '1000', 'sats'],
      ['summary', 'Short blurb'],
      ['spec', 'color', 'red'],
      ['weight', '0.5'],
      ['dim', '10x10x5'],
    ], 'Long markdown description')

    const result = normalizeOfferEvent(event, 'wss://relay.example')
    expect(result?.summary).toBe('Short blurb')
    expect(result?.description).toBe('Long markdown description')
    expect(result?.specs).toEqual([{ key: 'color', value: 'red' }])
    expect(result?.weight).toBe('0.5')
    expect(result?.dim).toBe('10x10x5')
  })
})

describe('normalizeOfferEvent — ADR-415 origin URL', () => {
  const base = [['title', 'Widget'], ['price', '1000', 'sats']]

  it('a listing with an https `r` tag keeps it as originUrl', () => {
    const result = normalizeOfferEvent(
      fixtureEvent([...base, ['r', 'https://mercasats.kilombino.com/?p=187']]),
      'wss://relay.example',
    )
    expect(result?.originUrl).toBe('https://mercasats.kilombino.com/?p=187')
  })

  it('a listing without any `r` tag has originUrl null', () => {
    const result = normalizeOfferEvent(fixtureEvent(base), 'wss://relay.example')
    expect(result?.originUrl).toBeNull()
  })

  it('a relay-style `r` tag (wss://) is not an origin URL', () => {
    const result = normalizeOfferEvent(
      fixtureEvent([...base, ['r', 'wss://relay.example.com']]),
      'wss://relay.example',
    )
    expect(result?.originUrl).toBeNull()
  })

  it('a javascript: `r` tag is not an origin URL', () => {
    const result = normalizeOfferEvent(
      fixtureEvent([...base, ['r', 'javascript:alert(1)']]),
      'wss://relay.example',
    )
    expect(result?.originUrl).toBeNull()
  })

  it('the first invalid `r` tag is skipped in favour of the next valid https one', () => {
    const result = normalizeOfferEvent(
      fixtureEvent([...base, ['r', 'wss://relay.example.com'], ['r', 'https://shop.example/item/1']]),
      'wss://relay.example',
    )
    expect(result?.originUrl).toBe('https://shop.example/item/1')
  })

  it('a URL longer than 2048 characters is rejected', () => {
    const longUrl = 'https://shop.example/?q=' + 'a'.repeat(2048)
    const result = normalizeOfferEvent(
      fixtureEvent([...base, ['r', longUrl]]),
      'wss://relay.example',
    )
    expect(result?.originUrl).toBeNull()
  })

  it('extractOriginUrl returns null for an empty tags array', () => {
    expect(extractOriginUrl([])).toBeNull()
  })

  it('extractOriginUrl does not throw on a malformed short `r` tag', () => {
    expect(() => extractOriginUrl([['r']])).not.toThrow()
    expect(extractOriginUrl([['r']])).toBeNull()
  })
})

// ADR-417 D1 — seller pubkey from a `p` tag with the `seller` role marker.
describe('extractSellerPubkey — ADR-417 seller `p` tag', () => {
  const SELLER = '9a43f3ee53d67c6cc24aeeda2f575548db352f60f8b9d997ce32a995bd353e59'
  const OTHER = '1111111111111111111111111111111111111111111111111111111111111111'

  it('returns the seller pubkey lowercased for a `seller`-role p tag', () => {
    const upper = SELLER.toUpperCase()
    const result = normalizeOfferEvent(
      fixtureEvent([['title', 'Widget'], ['price', '1000', 'sats'], ['p', upper, '', 'seller']]),
      'wss://relay.example',
    )
    expect(result?.remoteSellerPubkey).toBe(SELLER)
    expect(extractSellerPubkey([['p', upper, '', 'seller']])).toBe(SELLER)
  })

  it('a p tag without the seller role marker yields null', () => {
    expect(extractSellerPubkey([['p', SELLER]])).toBeNull()
    expect(extractSellerPubkey([['p', SELLER, '', 'mention']])).toBeNull()
  })

  it('with two seller tags the first valid one wins', () => {
    expect(extractSellerPubkey([['p', SELLER, '', 'seller'], ['p', OTHER, '', 'seller']])).toBe(SELLER)
  })

  it('a seller tag with a 63-char or non-hex pubkey is skipped in favour of a later valid one', () => {
    const short = SELLER.slice(0, 63)
    const nonHex = 'z'.repeat(64)
    expect(extractSellerPubkey([['p', short, '', 'seller']])).toBeNull()
    expect(extractSellerPubkey([['p', nonHex, '', 'seller']])).toBeNull()
    expect(extractSellerPubkey([['p', short, '', 'seller'], ['p', SELLER, '', 'seller']])).toBe(SELLER)
  })

  it('empty, malformed and short tag arrays return null without throwing', () => {
    expect(extractSellerPubkey([])).toBeNull()
    expect(() => extractSellerPubkey([['p']])).not.toThrow()
    expect(extractSellerPubkey([['p']])).toBeNull()
    expect(() => extractSellerPubkey([['p', 'x', '', 'seller']])).not.toThrow()
    expect(extractSellerPubkey([['p', 'x', '', 'seller']])).toBeNull()
  })

  it('a listing without a seller tag normalizes with remoteSellerPubkey null', () => {
    const result = normalizeOfferEvent(
      fixtureEvent([['title', 'Widget'], ['price', '1000', 'sats'], ['p', SELLER]]),
      'wss://relay.example',
    )
    expect(result?.remoteSellerPubkey).toBeNull()
  })
})
