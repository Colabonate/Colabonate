import { useState } from 'react'
import { useWallet } from '../contexts/WalletContext'
import { fetchLnAddressInvoice } from '../lib/lnurl'
import { apiCall } from '../lib/api'

const DONATION_LN_ADDRESS = (import.meta.env.VITE_PROJECT_LN_ADDRESS as string | undefined)?.trim() || null

export type SupportTipState = 'idle' | 'sending' | 'sent' | 'error'

export interface SupportTipApi {
  /** A donation address is configured for this build. */
  configured: boolean
  /** Address configured AND the viewer has a connected wallet — the only case
   *  in which a tip can actually be sent. Every send control gates on this. */
  available: boolean
  state: SupportTipState
  pendingAmount: number | null
  error: string | null
  sendTip(amountSats: number): Promise<void>
}

/**
 * Shared "support the project" tip logic — pays VITE_PROJECT_LN_ADDRESS via
 * whatever wallet the viewer already has configured (WalletContext.sendPayment).
 * Used by SupportProjectCard (desktop hero sidebar + mobile footer) and
 * SearchHeroSection (button next to Explore, opening CustomTipModal).
 *
 * `available` is the single gate for every control: without a wallet the tip
 * cannot be paid (sendPayment would POST the custodial endpoint with no wallet
 * and surface a 404 as a user-facing error), and without a configured address
 * there is nothing to pay.
 */
export function useSupportTip(): SupportTipApi {
  const { wallet, sendPayment } = useWallet()
  const [pendingAmount, setPendingAmount] = useState<number | null>(null)
  const [state, setState] = useState<SupportTipState>('idle')
  const [error, setError] = useState<string | null>(null)

  const configured = Boolean(DONATION_LN_ADDRESS)
  const available = configured && Boolean(wallet)

  async function sendTip(amountSats: number) {
    if (!DONATION_LN_ADDRESS || state === 'sending') return
    setPendingAmount(amountSats)
    setState('sending')
    setError(null)
    try {
      const bolt11 = await fetchLnAddressInvoice(DONATION_LN_ADDRESS, amountSats)
      const result = await sendPayment(bolt11)
      if (result.status === 'FAILED') throw new Error('Payment failed')
      // Feed the Home "Recent Supporters" list (ADR-247). Fire-and-forget: a
      // recording failure must never turn an already-sent tip into an error.
      // The list is decorative — the amount is client-reported, not verified
      // server-side (there is no inbound-payment webhook on the platform rail).
      void apiCall('/api/support-tips', { method: 'POST', body: JSON.stringify({ amountSats }) }).catch(() => {})
      setState('sent')
      setTimeout(() => setState('idle'), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    } finally {
      setPendingAmount(null)
    }
  }

  return { configured, available, state, pendingAmount, error, sendTip }
}
