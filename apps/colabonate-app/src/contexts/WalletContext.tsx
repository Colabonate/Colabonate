import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { apiCall } from '../lib/api'
import { payNormalInvoice, dispatchHoldInvoice } from '../lib/payment-dispatch'

export interface Wallet {
  id: string
  userId: string
  provider: 'LIGHTSPARK' | 'LNBITS' | 'WEBLN' | 'MOCK' | 'CASHU' | 'DEMO' | 'NWC' | 'ALBY_OAUTH'
  mode: 'CUSTODIAL' | 'NON_CUSTODIAL'
  walletId: string | null
  accountId: string | null
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  balanceSats: number
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
  balance?: {
    confirmedSats: number
    unconfirmedSats: number
    pendingSats: number
  }
  // ADR-208: NWC connection fields (provider === 'NWC'). The encrypted URI is
  // server-side only; the client only sees the non-secret pubkey for display.
  nwcWalletPubkey?: string | null
  nwcRelayUrls?: string | null
  nwcConnectedAt?: string | null
  nwcLastSyncedAt?: string | null
}

export interface PaymentResult {
  paymentHash: string
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  feeSats?: number
  // ADR-351: preimage, when the underlying rail exposes one — see the
  // matching field on lib/payment-dispatch.ts's PaymentResult.
  preimage?: string
}

// ADR-228: a user can hold one Wallet row per provider — this is the peer
// list (no per-wallet balance, that stays lazy behind switching to it).
export interface WalletSummary {
  id: string
  provider: Wallet['provider']
  mode: 'CUSTODIAL' | 'NON_CUSTODIAL'
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  isActive: boolean
}

interface WalletContextValue {
  wallet: Wallet | null
  wallets: WalletSummary[]
  isLoading: boolean
  connectWebLN(): Promise<void>
  disconnectWallet(): Promise<void>
  sendPayment(bolt11: string): Promise<PaymentResult>
  /** ADR-209: dispatch-only payment for 3-phase escrow hold invoices.
   *  Returns immediately after the wallet has been instructed to pay;
   *  settlement is confirmed later via polling (e.g. pollUntilPaid). */
  payHoldInvoice(bolt11: string): Promise<{ dispatched: boolean }>
  /** ADR-413 D3: re-read the wallet (and its live balance for the synced
   *  rails) and return the fresh row — callers that check affordability need
   *  the new balance, not the one captured in their closure. */
  refreshBalance(): Promise<Wallet | null>
  createWallet(): Promise<void>
  // ADR-208: Nostr Wallet Connect (NIP-47) — non-custodial spending wallet.
  connectNWC(connectionUri: string): Promise<{ alias?: string; walletPubkey: string; methods: string[]; balanceSats?: number }>
  disconnectNWC(): Promise<void>
  refreshNWC(): Promise<{ alias?: string; balanceSats: number } | null>
  // ADR-228: switch which existing Wallet row is active (no reconnect).
  switchActiveWallet(walletId: string): Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [wallets, setWallets] = useState<WalletSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [pubkey, setPubkey] = useState<string | null>(null)

  useEffect(() => {
    setPubkey(localStorage.getItem('pubkey'))
  }, [])

  const fetchWallet = useCallback(async (pk: string | null): Promise<Wallet | null> => {
    if (!pk) {
      setWallet(null)
      setWallets([])
      setIsLoading(false)
      return null
    }

    try {
      const res = await apiCall(`/api/wallet?pubkey=${pk}`)
      const data = await res.json()
      setWallet(data.wallet)
      setWallets(data.wallets ?? [])
      return (data.wallet as Wallet) ?? null
    } catch {
      setWallet(null)
      setWallets([])
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const switchActiveWallet = useCallback(async (walletId: string) => {
    await apiCall('/api/wallet/active', {
      method: 'POST',
      body: JSON.stringify({ walletId }),
    })
    await fetchWallet(pubkey)
  }, [pubkey, fetchWallet])

  useEffect(() => {
    fetchWallet(pubkey)
  }, [pubkey, fetchWallet])

  const createWallet = useCallback(async () => {
    // ADR-179 Fix B: read pubkey from localStorage lazily so callers can
    // bootstrap right after login, before the provider state has caught up
    // with the new localStorage write. The other operations still key off the
    // state-derived pubkey because they run after a full mount cycle.
    const effectivePubkey = pubkey ?? (typeof window !== 'undefined' ? window.localStorage.getItem('pubkey') : null)
    if (!effectivePubkey) return

    try {
      const res = await apiCall('/api/wallet/create', {
        method: 'POST',
        body: JSON.stringify({ pubkey: effectivePubkey }),
      })
      const data = await res.json()
      if (data.wallet) setWallet(data.wallet)
      // Refresh the state-derived pubkey + wallet after a successful bootstrap
      // so subsequent connectWebLN / sendPayment calls see the new wallet.
      setPubkey(effectivePubkey)
      await fetchWallet(effectivePubkey)
    } catch (error) {
      console.error('[WalletContext] Failed to create wallet:', error)
    }
  }, [pubkey, fetchWallet])

  const connectWebLN = useCallback(async () => {
    if (!pubkey) return

    if (typeof window === 'undefined' || !(window as any).webln) {
      throw new Error('No WebLN wallet found. Install Alby or another WebLN-compatible wallet.')
    }

    try {
      await (window as any).webln.enable()
      await apiCall('/api/wallet/connect', {
        method: 'POST',
        body: JSON.stringify({ pubkey, provider: 'WEBLN' }),
      })
      await fetchWallet(pubkey)
    } catch (error) {
      console.error('[WalletContext] WebLN connect failed:', error)
      throw error
    }
  }, [pubkey, fetchWallet])

  const disconnectWallet = useCallback(async () => {
    if (!pubkey) return

    try {
      await apiCall('/api/wallet/connection', {
        method: 'DELETE',
        body: JSON.stringify({ pubkey }),
      })
      await fetchWallet(pubkey)
    } catch (error) {
      console.error('[WalletContext] Disconnect failed:', error)
    }
  }, [pubkey, fetchWallet])

  const sendPayment = useCallback(async (bolt11: string): Promise<PaymentResult> => {
    return payNormalInvoice(wallet, bolt11, { post: (url, body) => apiCall(url, { method: 'POST', body: JSON.stringify(body) }) }, (window as any).webln)
  }, [wallet])

  // ADR-209 D2 / FU-209-E: dispatch-only payment for ADR-184 3-phase escrow
  // hold invoices. A hold invoice has no immediate settlement result — the
  // receiver may only settle it much later (e.g. after delivery confirmation).
  // So this function returns as soon as the wallet has accepted the payment
  // instruction; callers must confirm actual settlement via polling.
  const payHoldInvoice = useCallback(async (bolt11: string): Promise<{ dispatched: boolean }> => {
    return dispatchHoldInvoice(wallet, bolt11, { post: (url, body) => apiCall(url, { method: 'POST', body: JSON.stringify(body) }) }, (window as any).webln)
  }, [wallet])

  // ADR-208: connect a Nostr Wallet Connect (NIP-47) spending wallet.
  const connectNWC = useCallback(async (connectionUri: string) => {
    if (!pubkey) throw new Error('Not authenticated')
    const res = await apiCall('/api/wallet/nwc/connect', {
      method: 'POST',
      body: JSON.stringify({ nwcConnectionUri: connectionUri }),
    })
    const data = await res.json()
    await fetchWallet(pubkey)
    return { alias: data.alias, walletPubkey: data.walletPubkey, methods: data.methods ?? [], balanceSats: data.balanceSats }
  }, [pubkey, fetchWallet])

  const disconnectNWC = useCallback(async () => {
    await apiCall('/api/wallet/nwc/disconnect', { method: 'POST' })
    if (pubkey) await fetchWallet(pubkey)
  }, [pubkey, fetchWallet])

  const refreshNWC = useCallback(async () => {
    if (wallet?.provider !== 'NWC') return null
    const res = await apiCall('/api/wallet/nwc/info')
    const data = await res.json()
    if (pubkey) await fetchWallet(pubkey)
    return { alias: data.alias, balanceSats: data.balanceSats as number }
  }, [wallet, pubkey, fetchWallet])

  const refreshBalance = useCallback(async (): Promise<Wallet | null> => {
    return fetchWallet(pubkey)
  }, [fetchWallet, pubkey])

  return (
    <WalletContext.Provider value={{
      wallet,
      wallets,
      isLoading,
      connectWebLN,
      disconnectWallet,
      sendPayment,
      payHoldInvoice,
      refreshBalance,
      createWallet,
      connectNWC,
      disconnectNWC,
      refreshNWC,
      switchActiveWallet,
    }}>
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider')
  return ctx
}
