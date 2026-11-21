import { describe, it, expect } from 'vitest'
import { PURCHASE_PATHS, isLightningPayableCurrency, resolvePurchasePath } from './purchase-path.js'

const ORIGIN = 'https://mercasats.kilombino.com/?p=187'

describe('resolvePurchasePath', () => {
  it('returns in-app-native for LOCAL, undefined and null sources', () => {
    expect(resolvePurchasePath({ source: 'LOCAL' })).toEqual({ path: 'in-app-native', reasons: ['NOT_REMOTE'] })
    expect(resolvePurchasePath({})).toEqual({ path: 'in-app-native', reasons: ['NOT_REMOTE'] })
    expect(resolvePurchasePath({ source: null })).toEqual({ path: 'in-app-native', reasons: ['NOT_REMOTE'] })
  })

  it('resolves origin-link for a remote offer with an origin URL and no context', () => {
    const r = resolvePurchasePath({ source: 'REMOTE', originUrl: ORIGIN })
    expect(r.path).toBe('origin-link')
    expect(r.externalUrl).toBe(ORIGIN)
    expect(r.reasons).toEqual(['HAS_ORIGIN_URL', 'DM_INBOX_UNKNOWN'])
  })

  it('resolves open-in-client for a remote offer without origin URL', () => {
    const r = resolvePurchasePath({ source: 'REMOTE' })
    expect(r).toEqual({ path: 'open-in-client', reasons: ['NO_ORIGIN_URL', 'DM_INBOX_UNKNOWN'] })
  })

  it('never uses a javascript: origin URL', () => {
    const r = resolvePurchasePath({ source: 'REMOTE', originUrl: 'javascript:alert(1)' })
    expect(r.path).toBe('open-in-client')
    expect(r.externalUrl).toBeUndefined()
  })

  it('rejects ftp, empty and overlong origin URLs', () => {
    const long = 'https://example.com/' + 'a'.repeat(3000)
    for (const originUrl of ['ftp://x.y/z', '', long]) {
      const r = resolvePurchasePath({ source: 'REMOTE', originUrl })
      expect(r.path).toBe('open-in-client')
      expect(r.externalUrl).toBeUndefined()
    }
  })

  it('prefers nostr-order over origin-link when a DM inbox exists', () => {
    const r = resolvePurchasePath({ source: 'REMOTE', originUrl: ORIGIN }, { hasDmInbox: true })
    expect(r).toEqual({ path: 'nostr-order', reasons: ['DM_INBOX_PRESENT'] })
  })

  it('falls back to origin-link when the DM inbox is absent', () => {
    const r = resolvePurchasePath({ source: 'REMOTE', originUrl: ORIGIN }, { hasDmInbox: false })
    expect(r.path).toBe('origin-link')
    expect(r.reasons).toEqual(['HAS_ORIGIN_URL', 'DM_INBOX_ABSENT'])
  })

  it('prefers app-redirect over DM when publisher recommends an app and payment is manual', () => {
    const r = resolvePurchasePath(
      { source: 'REMOTE' },
      { recommendedAppUrl: 'https://app.example/x', paymentPreference: undefined, hasDmInbox: true },
    )
    expect(r.path).toBe('app-redirect')
    expect(r.externalUrl).toBe('https://app.example/x')
    expect(r.reasons).toEqual(['PUBLISHER_RECOMMENDS_APP'])
  })

  it('resolves nostr-auto when preference is lud16 and hasLud16, ignoring the app recommendation', () => {
    const r = resolvePurchasePath(
      { source: 'REMOTE' },
      { recommendedAppUrl: 'https://app.example/x', paymentPreference: 'lud16', hasLud16: true, hasDmInbox: true },
    )
    expect(r).toEqual({ path: 'nostr-auto', reasons: ['PAYMENT_PREFERENCE_LUD16'] })
  })

  it('falls through to nostr-order when lud16 is preferred but no lud16 address exists', () => {
    const r = resolvePurchasePath({ source: 'REMOTE' }, { paymentPreference: 'lud16', hasDmInbox: true })
    expect(r).toEqual({ path: 'nostr-order', reasons: ['DM_INBOX_PRESENT'] })
    const r2 = resolvePurchasePath({ source: 'REMOTE' }, { paymentPreference: 'lud16', hasLud16: false, hasDmInbox: true })
    expect(r2.path).toBe('nostr-order')
  })

  it('ignores an invalid recommended app URL', () => {
    const r = resolvePurchasePath({ source: 'REMOTE' }, { recommendedAppUrl: 'not a url', hasDmInbox: true })
    expect(r.path).toBe('nostr-order')
  })

  it('adds NON_LIGHTNING_CURRENCY for XMR priced remote offers', () => {
    const r = resolvePurchasePath({ source: 'REMOTE', priceCurrency: 'XMR' })
    expect(r).toEqual({ path: 'open-in-client', reasons: ['NO_ORIGIN_URL', 'DM_INBOX_UNKNOWN', 'NON_LIGHTNING_CURRENCY'] })
  })

  it('does not add NON_LIGHTNING_CURRENCY for EUR priced offers', () => {
    const r = resolvePurchasePath({ source: 'REMOTE', priceCurrency: 'EUR' })
    expect(r.reasons).not.toContain('NON_LIGHTNING_CURRENCY')
  })

  it('isLightningPayableCurrency classifies currencies', () => {
    expect(isLightningPayableCurrency(null)).toBe(true)
    expect(isLightningPayableCurrency(undefined)).toBe(true)
    expect(isLightningPayableCurrency('')).toBe(true)
    expect(isLightningPayableCurrency('xmr')).toBe(false)
    expect(isLightningPayableCurrency('XMR')).toBe(false)
    expect(isLightningPayableCurrency('EUR')).toBe(true)
    expect(isLightningPayableCurrency('BTC')).toBe(true)
    expect(isLightningPayableCurrency('USDC')).toBe(true)
    expect(isLightningPayableCurrency('sats')).toBe(true)
  })

  it('exposes the path list', () => {
    expect(PURCHASE_PATHS).toHaveLength(7)
  })

  it('does not throw on empty or partial input', () => {
    expect(() => resolvePurchasePath({})).not.toThrow()
    expect(() => resolvePurchasePath({ source: 'REMOTE', originUrl: undefined })).not.toThrow()
    expect(() => resolvePurchasePath(undefined as unknown as Parameters<typeof resolvePurchasePath>[0])).not.toThrow()
  })

  describe('zap-out (ADR-417)', () => {
    it('resolves zap-out for a remote offer with hasPayee true and origin URL', () => {
      const r = resolvePurchasePath({ source: 'REMOTE', originUrl: ORIGIN }, { hasPayee: true })
      expect(r).toEqual({ path: 'zap-out', reasons: ['PAYEE_AVAILABLE', 'DM_INBOX_UNKNOWN'] })
      expect(r.externalUrl).toBeUndefined()
    })

    it('zap-out loses to app-redirect', () => {
      const r = resolvePurchasePath(
        { source: 'REMOTE' },
        { recommendedAppUrl: 'https://app.example/x', hasPayee: true, hasDmInbox: true },
      )
      expect(r.path).toBe('app-redirect')
    })

    it('zap-out loses to nostr-auto', () => {
      const r = resolvePurchasePath(
        { source: 'REMOTE' },
        { paymentPreference: 'lud16', hasLud16: true, hasPayee: true, hasDmInbox: true },
      )
      expect(r).toEqual({ path: 'nostr-auto', reasons: ['PAYMENT_PREFERENCE_LUD16'] })
    })

    it('zap-out beats nostr-order and origin-link', () => {
      const r = resolvePurchasePath({ source: 'REMOTE', originUrl: ORIGIN }, { hasDmInbox: true, hasPayee: true })
      expect(r).toEqual({ path: 'zap-out', reasons: ['PAYEE_AVAILABLE'] })
    })

    it('hasPayee false or undefined changes nothing for existing cases', () => {
      const withFalse = resolvePurchasePath({ source: 'REMOTE', originUrl: ORIGIN }, { hasDmInbox: true, hasPayee: false })
      const withUndef = resolvePurchasePath({ source: 'REMOTE', originUrl: ORIGIN }, { hasDmInbox: true })
      expect(withFalse).toEqual({ path: 'nostr-order', reasons: ['DM_INBOX_PRESENT'] })
      expect(withUndef).toEqual({ path: 'nostr-order', reasons: ['DM_INBOX_PRESENT'] })
      const originFalse = resolvePurchasePath({ source: 'REMOTE', originUrl: ORIGIN }, { hasDmInbox: false, hasPayee: false })
      expect(originFalse.path).toBe('origin-link')
    })

    it('native offers stay in-app-native even with hasPayee true', () => {
      expect(resolvePurchasePath({ source: 'LOCAL' }, { hasPayee: true })).toEqual({
        path: 'in-app-native',
        reasons: ['NOT_REMOTE'],
      })
    })

    it('adds NON_LIGHTNING_CURRENCY to zap-out results for XMR', () => {
      const r = resolvePurchasePath({ source: 'REMOTE', priceCurrency: 'XMR' }, { hasPayee: true })
      expect(r.path).toBe('zap-out')
      expect(r.reasons).toContain('PAYEE_AVAILABLE')
      expect(r.reasons).toContain('NON_LIGHTNING_CURRENCY')
    })

    it('keeps the original six paths in their original order before zap-out', () => {
      expect(PURCHASE_PATHS.slice(0, 6)).toEqual([
        'in-app-native', 'app-redirect', 'nostr-auto', 'nostr-order', 'origin-link', 'open-in-client',
      ])
      expect(PURCHASE_PATHS[6]).toBe('zap-out')
    })
  })
})
