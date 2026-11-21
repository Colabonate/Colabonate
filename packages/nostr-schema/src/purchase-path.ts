// Purchase-path resolver (ADR-415 D7). Pure, zero-dependency: shared by server and browser.

export const PURCHASE_PATHS = ['in-app-native', 'app-redirect', 'nostr-auto', 'nostr-order', 'origin-link', 'open-in-client', 'zap-out'] as const
export type PurchasePath = typeof PURCHASE_PATHS[number]

export type PurchasePathReason =
  | 'NOT_REMOTE' | 'PUBLISHER_RECOMMENDS_APP' | 'PAYMENT_PREFERENCE_LUD16'
  | 'DM_INBOX_PRESENT' | 'DM_INBOX_ABSENT' | 'DM_INBOX_UNKNOWN'
  | 'HAS_ORIGIN_URL' | 'NO_ORIGIN_URL' | 'NON_LIGHTNING_CURRENCY'
  | 'PAYEE_AVAILABLE'

export interface PurchasePathOffer {
  source?: string | null
  priceCurrency?: string | null
  originUrl?: string | null
}

export interface PurchasePathContext {
  recommendedAppUrl?: string | null
  paymentPreference?: 'manual' | 'ecash' | 'lud16' | null
  hasLud16?: boolean
  hasDmInbox?: boolean | null
  /** true = the server confirmed the seller/publisher has a payable Lightning address for this offer. */
  hasPayee?: boolean
}

export interface PurchasePathResult {
  path: PurchasePath
  reasons: PurchasePathReason[]
  externalUrl?: string
}

const MAX_URL_LENGTH = 2048

const NON_LIGHTNING_TICKERS: ReadonlySet<string> = new Set([
  'XMR', 'ETH', 'SOL', 'BCH', 'ALGO', 'RVN', 'TESTSAT', 'LTC', 'DOGE',
  'XRP', 'ADA', 'DOT', 'MATIC', 'AVAX', 'TRX',
])

export function isLightningPayableCurrency(currency: string | null | undefined): boolean {
  if (currency === null || currency === undefined || currency === '') return true
  return !NON_LIGHTNING_TICKERS.has(String(currency).toUpperCase())
}

function validHttpUrl(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

export function resolvePurchasePath(offer: PurchasePathOffer, ctx: PurchasePathContext = {}): PurchasePathResult {
  try {
    if (offer?.source !== 'REMOTE') {
      return { path: 'in-app-native', reasons: ['NOT_REMOTE'] }
    }

    const reasons: PurchasePathReason[] = []
    const paymentPreference = ctx.paymentPreference ?? 'manual'
    const appUrl = validHttpUrl(ctx.recommendedAppUrl)
    const originUrl = validHttpUrl(offer.originUrl)

    let result: { path: PurchasePath; reasons: PurchasePathReason[]; externalUrl?: string }

    if (appUrl !== undefined && paymentPreference === 'manual') {
      result = { path: 'app-redirect', reasons: ['PUBLISHER_RECOMMENDS_APP'], externalUrl: appUrl }
    } else if (paymentPreference === 'lud16' && ctx.hasLud16 === true) {
      result = { path: 'nostr-auto', reasons: ['PAYMENT_PREFERENCE_LUD16'] }
    } else if (ctx.hasPayee === true) {
      result = { path: 'zap-out', reasons: ['PAYEE_AVAILABLE'] }
    } else if (ctx.hasDmInbox === true) {
      result = { path: 'nostr-order', reasons: ['DM_INBOX_PRESENT'] }
    } else if (originUrl !== undefined) {
      result = { path: 'origin-link', reasons: ['HAS_ORIGIN_URL'], externalUrl: originUrl }
    } else {
      result = { path: 'open-in-client', reasons: ['NO_ORIGIN_URL'] }
    }

    reasons.push(...result.reasons)
    if (ctx.hasDmInbox === false) reasons.push('DM_INBOX_ABSENT')
    else if (ctx.hasDmInbox === undefined || ctx.hasDmInbox === null) reasons.push('DM_INBOX_UNKNOWN')
    if (offer.priceCurrency && !isLightningPayableCurrency(offer.priceCurrency)) {
      reasons.push('NON_LIGHTNING_CURRENCY')
    }

    return result.externalUrl !== undefined
      ? { path: result.path, reasons, externalUrl: result.externalUrl }
      : { path: result.path, reasons }
  } catch {
    return { path: 'open-in-client', reasons: ['NO_ORIGIN_URL'] }
  }
}
