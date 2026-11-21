import { describe, it, expect } from 'vitest'
import { createProvider, LNBitsProvider, MockPaymentProvider } from './index.js'

describe('createProvider — lnbits production guard', () => {
  it('throws in production when LNbits keys are missing (no silent mock)', () => {
    expect(() => createProvider('lnbits', { NODE_ENV: 'production' })).toThrow(/required in production/i)
  })

  it('returns a real (non-mock) LNBitsProvider in production when keys and LND hold config are present', () => {
    const provider = createProvider('lnbits', {
      NODE_ENV: 'production',
      LNBITS_ADMIN_KEY: 'admin-key',
      LNBITS_INVOICE_KEY: 'invoice-key',
      LND_REST_URL: 'https://lnd:8080',
      LND_MACAROON_HEX: '0a0b0c',
    })
    expect(provider).toBeInstanceOf(LNBitsProvider)
  })

  it('throws in production when LND_REST_URL is missing (hold invoices required for real escrow)', () => {
    expect(() =>
      createProvider('lnbits', {
        NODE_ENV: 'production',
        LNBITS_ADMIN_KEY: 'admin-key',
        LNBITS_INVOICE_KEY: 'invoice-key',
      }),
    ).toThrow(/LND_REST_URL.*required in production/i)
  })

  it('throws in production when LND_REST_URL is set but no macaroon is provided', () => {
    expect(() =>
      createProvider('lnbits', {
        NODE_ENV: 'production',
        LNBITS_ADMIN_KEY: 'admin-key',
        LNBITS_INVOICE_KEY: 'invoice-key',
        LND_REST_URL: 'https://lnd:8080',
      }),
    ).toThrow(/macaroon/i)
  })

  it('throws in production when LNBITS_REGTEST_MODE is true', () => {
    expect(() =>
      createProvider('lnbits', {
        NODE_ENV: 'production',
        LNBITS_ADMIN_KEY: 'admin-key',
        LNBITS_INVOICE_KEY: 'invoice-key',
        LND_REST_URL: 'https://lnd:8080',
        LND_MACAROON_HEX: '0a0b0c',
        LNBITS_REGTEST_MODE: 'true',
      }),
    ).toThrow(/LNBITS_REGTEST_MODE=true is not allowed in production/i)
  })

  it('falls back to mock LNbits outside production when keys are missing', () => {
    const provider = createProvider('lnbits', { NODE_ENV: 'development' })
    expect(provider).toBeInstanceOf(LNBitsProvider)
  })

  it('returns the mock provider when explicitly requested', () => {
    expect(createProvider('mock', {})).toBeInstanceOf(MockPaymentProvider)
  })
})
