import { describe, it, expect } from 'vitest'
import { remoteOfferPurchaseBlock } from './remote-offer-guard.js'

const ERROR_TEXT =
  'This listing was published on another Nostr marketplace and cannot be ordered through Colabonate yet. Use the link on the offer page to order at the merchant.'

describe('remoteOfferPurchaseBlock', () => {
  it('returns null for LOCAL offers', () => {
    expect(remoteOfferPurchaseBlock({ source: 'LOCAL' })).toBeNull()
    expect(remoteOfferPurchaseBlock({ source: 'LOCAL', priceCurrency: 'EUR' })).toBeNull()
  })

  it('returns null when source is undefined or null', () => {
    expect(remoteOfferPurchaseBlock({})).toBeNull()
    expect(remoteOfferPurchaseBlock({ source: undefined })).toBeNull()
    expect(remoteOfferPurchaseBlock({ source: null, priceCurrency: 'EUR' })).toBeNull()
  })

  it('blocks a REMOTE offer without originUrl with open-in-client and no externalUrl', () => {
    const block = remoteOfferPurchaseBlock({ source: 'REMOTE' })
    expect(block).not.toBeNull()
    expect(block?.status).toBe(400)
    expect(block?.body.code).toBe('BAD_REQUEST')
    expect(block?.body.reason).toBe('REMOTE_OFFER_NOT_ORDERABLE')
    expect(block?.body.purchasePath).toBe('open-in-client')
    expect(block?.body.error).toBe(ERROR_TEXT)
    expect(block && 'externalUrl' in block.body).toBe(false)
  })

  it('returns origin-link and externalUrl for a REMOTE offer with a valid originUrl', () => {
    const url = 'https://mercasats.kilombino.com/?p=187'
    const block = remoteOfferPurchaseBlock({ source: 'REMOTE', originUrl: url })
    expect(block?.body.purchasePath).toBe('origin-link')
    expect(block?.body.externalUrl).toBe(url)
  })

  it('ignores a non-http(s) originUrl', () => {
    const block = remoteOfferPurchaseBlock({ source: 'REMOTE', originUrl: 'javascript:alert(1)' })
    expect(block?.body.purchasePath).toBe('open-in-client')
    expect(block && 'externalUrl' in block.body).toBe(false)
  })

  it('blocks a REMOTE sats-priced offer (priceCurrency null), the former 422 case', () => {
    const block = remoteOfferPurchaseBlock({ source: 'REMOTE', priceCurrency: null })
    expect(block?.status).toBe(400)
    expect(block?.body.reason).toBe('REMOTE_OFFER_NOT_ORDERABLE')
  })

  it('never throws for an empty object', () => {
    expect(() => remoteOfferPurchaseBlock({})).not.toThrow()
  })
})
