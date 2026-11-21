import { useQuery } from '@tanstack/react-query'
import { apiCall } from '../lib/api'

export interface LnAddressInfo {
  handle: string | null
  mode: 'EXTERNAL' | 'NWC' | 'CASHU' | null
  address: string | null
  domain: string
  lnAddress: string | null
  nwcConnected: boolean
}

/**
 * ADR-240 D1/D2 — the user's self-serve receiving address state. Used by the
 * settings form and by the wallet dashboard's "set up how you get paid" nudge
 * (FU-240-E) for users who already hold a wallet but no public address.
 */
export function useLnAddress(pubkey: string | null | undefined) {
  return useQuery<LnAddressInfo>({
    queryKey: ['ln-address', pubkey],
    enabled: Boolean(pubkey),
    queryFn: async () => {
      const res = await apiCall('/api/wallet/ln-address')
      return res.json()
    },
    staleTime: 60_000,
  })
}
