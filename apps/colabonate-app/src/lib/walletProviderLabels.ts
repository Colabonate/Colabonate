/**
 * Single source of truth for how the `WalletProvider` enum is shown to users.
 *
 * Two variants on purpose:
 *  - `WALLET_PROVIDER_LABELS` (full) — Wallet page card titles, the wallet
 *    switcher dropdown and the Settings "Connected Wallets" list.
 *  - `WALLET_PROVIDER_SHORT_LABELS` — the Home KPI sublabel, which must stay
 *    short (≤ ~10 chars) to fit beside the value in the slim layout.
 *
 * ADR-228: providers are peers (NWC / WebLN / Cashu / Alby) — never render the
 * raw enum (`ALBY_OAUTH`, `LNBITS`, …) in the UI.
 */
export type WalletProviderId =
  | 'LNBITS'
  | 'LIGHTSPARK'
  | 'WEBLN'
  | 'MOCK'
  | 'CASHU'
  | 'DEMO'
  | 'NWC'
  | 'ALBY_OAUTH'

export const WALLET_PROVIDER_LABELS: Record<WalletProviderId, string> = {
  LNBITS: 'Lightning Wallet',
  LIGHTSPARK: 'Lightspark Wallet',
  WEBLN: 'WebLN Wallet',
  MOCK: 'Mock Wallet',
  CASHU: 'Cashu eCash Wallet',
  DEMO: 'Demo Wallet',
  NWC: 'Nostr Wallet Connect',
  ALBY_OAUTH: 'Alby Wallet',
}

export const WALLET_PROVIDER_SHORT_LABELS: Record<WalletProviderId, string> = {
  LNBITS: 'LNBits',
  LIGHTSPARK: 'Lightspark',
  WEBLN: 'WebLN',
  MOCK: 'Mock',
  CASHU: 'Cashu',
  DEMO: 'Demo',
  NWC: 'NWC',
  ALBY_OAUTH: 'Alby',
}

function lookup(map: Record<string, string>, provider: string | null | undefined): string {
  if (!provider) return 'Wallet'
  return map[provider] ?? provider
}

/** Full, descriptive provider label (falls back to the raw value if unknown). */
export function walletProviderLabel(provider: string | null | undefined): string {
  return lookup(WALLET_PROVIDER_LABELS, provider)
}

/** Short provider label for space-constrained spots (Home KPI sublabel). */
export function walletProviderShortLabel(provider: string | null | undefined): string {
  return lookup(WALLET_PROVIDER_SHORT_LABELS, provider)
}
