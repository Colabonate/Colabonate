import type { PaymentProvider } from './PaymentProvider.js'
import { LNBitsProvider } from './LNBitsProvider.js'
import { LightsparkProvider } from './LightsparkProvider.js'
import { MockPaymentProvider } from './MockPaymentProvider.js'
import { LndHoldClient } from './LndHoldClient.js'

export type ProviderType = 'lnbits' | 'lightspark' | 'mock'

export function createProvider(providerType: ProviderType, env: Record<string, string | undefined>): PaymentProvider {
  switch (providerType) {
    case 'mock':
      return new MockPaymentProvider()

    case 'lnbits': {
      const adminKey = env.LNBITS_ADMIN_KEY
      const invoiceKey = env.LNBITS_INVOICE_KEY
      const baseUrl = env.LNBITS_URL || 'https://demo.lnbits.com'
      const regtestMode = env.LNBITS_REGTEST_MODE === 'true'
      const isMock = !adminKey || !invoiceKey

      if (isMock) {
        // Never silently run mock Lightning in production — that would settle real orders
        // against fake invoices. Fail loudly so the deploy is fixed (ADR-141 follow-up).
        if (env.NODE_ENV === 'production') {
          throw new Error('LNBITS_ADMIN_KEY and LNBITS_INVOICE_KEY are required in production (refusing to start with mock Lightning).')
        }
        return new LNBitsProvider('mock-admin', 'mock-invoice', baseUrl, true, null)
      }

      // ADR-193 — LND native hold invoices (replaces the non-existent LNBits holdinvoice extension).
      const holdClient = LndHoldClient.fromEnv(env)
      if (env.NODE_ENV === 'production') {
        if (!holdClient) {
          throw new Error(
            'LND_REST_URL + LND_MACAROON_HEX (or LND_MACAROON_PATH) are required in production ' +
            '(LND native hold invoices are required for real escrow — ADR-193).',
          )
        }
        if (regtestMode) {
          throw new Error('LNBITS_REGTEST_MODE=true is not allowed in production.')
        }
      }

      return new LNBitsProvider(adminKey, invoiceKey, baseUrl, false, holdClient)
    }

    case 'lightspark': {
      const apiKey = env.LIGHTSPARK_API_KEY
      const apiSecret = env.LIGHTSPARK_API_SECRET

      if (!apiKey || !apiSecret) {
        throw new Error('LIGHTSPARK_API_KEY and LIGHTSPARK_API_SECRET are required for Lightspark provider')
      }

      return new LightsparkProvider(apiKey, apiSecret)
    }

    default:
      throw new Error(`Unknown payment provider: ${providerType}`)
  }
}

export { LNBitsProvider } from './LNBitsProvider.js'
export { LndHoldClient } from './LndHoldClient.js'
export type { LndHoldClientConfig, LndHoldState } from './LndHoldClient.js'
export { LND_STATE_TO_HOLD } from './LndHoldClient.js'
export { LightsparkProvider } from './LightsparkProvider.js'
export { MockPaymentProvider } from './MockPaymentProvider.js'
export type { MockPaymentConfig } from './MockPaymentProvider.js'
export type { PaymentProvider, Invoice, PaymentResult, WalletBalance, Transaction } from './PaymentProvider.js'
