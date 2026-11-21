import { useQuery } from '@tanstack/react-query'
import { apiCall } from '../lib/api'

interface BetaStatus {
  betaMode: boolean
  coopEscrowEnabled?: boolean
  demoStartBalance?: number
  realLndSettle?: boolean
  noticeHtml?: string
}

export function useBetaMode() {
  const { data, isLoading } = useQuery<BetaStatus>({
    queryKey: ['beta-status'],
    queryFn: async () => {
      const res = await apiCall('/api/beta/status')
      return res.json()
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return {
    isBeta: data?.betaMode ?? false,
    // Defaults to true until known so the legacy escrow UI never flashes away
    coopEscrowEnabled: data?.coopEscrowEnabled ?? true,
    // True until /api/beta/status resolves. Callers that render beta-only vs
    // production-only UI use this to avoid flashing the wrong variant.
    isBetaLoading: isLoading,
    demoStartBalance: data?.demoStartBalance ?? 50000,
    noticeHtml: data?.noticeHtml ?? '',
  }
}
