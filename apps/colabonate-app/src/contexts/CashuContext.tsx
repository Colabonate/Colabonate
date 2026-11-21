/**
 * CashuProvider — single instance of the Cashu wallet hook (ADR-187 Phase 2).
 *
 * `useCashuWallet()` opens a relay subscription on mount, so it MUST be called
 * exactly once for the whole app; otherwise multiple subscriptions + state
 * copies would race. This provider does that and exposes the API via context.
 *
 * Activation gate = build flag (VITE_CASHU_ENABLED) AND the user opt-in
 * (Settings "Enable non-custodial eCash" toggle, stored via usePref). When
 * either is false the wallet stays inert (no relay traffic).
 */

import { createContext, useContext, type ReactNode } from 'react'
import { usePref } from '../utils/userPreferences'
import { isCashuEnabled } from '../lib/cashu'
import { useCashuWallet, type CashuWalletApi } from '../hooks/useCashuWallet'

const CashuContext = createContext<CashuWalletApi | null>(null)

export function CashuProvider({ children }: { children: ReactNode }) {
  const [optedIn] = usePref<boolean>('cashuEnabled', false)
  const api = useCashuWallet({ active: isCashuEnabled() && optedIn })
  return <CashuContext.Provider value={api}>{children}</CashuContext.Provider>
}

export function useCashu(): CashuWalletApi {
  const ctx = useContext(CashuContext)
  if (!ctx) throw new Error('useCashu must be used within a CashuProvider')
  return ctx
}

/** Like `useCashu`, but null outside a provider (surfaces that treat eCash as an optional extra). */
export function useCashuOptional(): CashuWalletApi | null {
  return useContext(CashuContext)
}
