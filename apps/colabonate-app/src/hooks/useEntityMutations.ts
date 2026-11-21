import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '../lib/api'

export function useCreateOffer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: unknown) => {
      const res = await apiCall('/api/offers', { method: 'POST', body: JSON.stringify(body) })
      return res.json()
    },
    onSuccess: (data) => {
      const pubkey = (data as { creatorPubkey?: string }).creatorPubkey
      if (pubkey) queryClient.invalidateQueries({ queryKey: ['offers', pubkey] })
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      queryClient.invalidateQueries({ queryKey: ['user-product-offers', pubkey] })
      queryClient.invalidateQueries({ queryKey: ['user-service-offers', pubkey] })
      queryClient.invalidateQueries({ queryKey: ['user-all-offers', pubkey] })
      queryClient.invalidateQueries({ queryKey: ['user-active-offers-slim', pubkey] })
      // ADR-335 FU-528: an already-open /buy or /search tab won't otherwise
      // learn about a newly-created offer until its cache staleTime expires.
      queryClient.invalidateQueries({ queryKey: ['offer-search'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search-infinite'] })
    },
  })
}

export function useUpdateOffer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Record<string, unknown>) => {
      const res = await apiCall(`/api/offers/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      return res.json()
    },
    onSuccess: (data) => {
      const pubkey = (data as { creatorPubkey?: string }).creatorPubkey
      if (pubkey) {
        queryClient.invalidateQueries({ queryKey: ['offers', pubkey] })
        queryClient.invalidateQueries({ queryKey: ['listings'] })
        queryClient.invalidateQueries({ queryKey: ['user-product-offers', pubkey] })
        queryClient.invalidateQueries({ queryKey: ['user-service-offers', pubkey] })
        queryClient.invalidateQueries({ queryKey: ['user-all-offers', pubkey] })
        queryClient.invalidateQueries({ queryKey: ['user-active-offers-slim', pubkey] })
        queryClient.invalidateQueries({ queryKey: ['offer-search'] })
        queryClient.invalidateQueries({ queryKey: ['offer-search-infinite'] })
      }
    },
  })
}

export function useDeleteOffer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, pubkey }: { id: string; pubkey: string }) => {
      await apiCall(`/api/offers/${id}`, { method: 'DELETE', body: JSON.stringify({ creatorPubkey: pubkey }) })
      return { pubkey }
    },
    onSuccess: ({ pubkey: _pubkey }) => {
      void _pubkey
      queryClient.invalidateQueries({ queryKey: ['offers'] })
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      queryClient.invalidateQueries({ queryKey: ['user-product-offers'] })
      queryClient.invalidateQueries({ queryKey: ['user-service-offers'] })
      queryClient.invalidateQueries({ queryKey: ['user-all-offers'] })
      queryClient.invalidateQueries({ queryKey: ['user-active-offers-slim'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search-infinite'] })
    },
  })
}

export function usePublishOffer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, pubkey }: { id: string; pubkey: string }) => {
      const res = await apiCall(`/api/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE', creatorPubkey: pubkey }) })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] })
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      queryClient.invalidateQueries({ queryKey: ['user-product-offers'] })
      queryClient.invalidateQueries({ queryKey: ['user-service-offers'] })
      queryClient.invalidateQueries({ queryKey: ['user-all-offers'] })
      queryClient.invalidateQueries({ queryKey: ['user-active-offers-slim'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search-infinite'] })
    },
  })
}

export function useArchiveOffer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, pubkey }: { id: string; pubkey: string }) => {
      const res = await apiCall(`/api/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ARCHIVED', creatorPubkey: pubkey }) })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] })
      queryClient.invalidateQueries({ queryKey: ['listings'] })
      queryClient.invalidateQueries({ queryKey: ['user-product-offers'] })
      queryClient.invalidateQueries({ queryKey: ['user-service-offers'] })
      queryClient.invalidateQueries({ queryKey: ['user-all-offers'] })
      queryClient.invalidateQueries({ queryKey: ['user-active-offers-slim'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search-infinite'] })
    },
  })
}

export function useCancelCooperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, pubkey }: { id: string; pubkey: string }) => {
      await apiCall(`/api/cooperations/${id}/cancel`, { method: 'POST' })
      return { pubkey }
    },
    onSuccess: ({ pubkey }) => {
      queryClient.invalidateQueries({ queryKey: ['cooperations', pubkey] })
      queryClient.invalidateQueries({ queryKey: ['cooperations-discover'] })
    },
  })
}

export function usePublishCooperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, pubkey }: { id: string; pubkey: string }) => {
      await apiCall(`/api/cooperations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'OPEN' }) })
      return { pubkey }
    },
    onSuccess: ({ pubkey }) => {
      queryClient.invalidateQueries({ queryKey: ['cooperations', pubkey] })
      queryClient.invalidateQueries({ queryKey: ['cooperations-discover'] })
    },
  })
}

export function useFundEscrow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, pubkey }: { id: string; pubkey: string }) => {
      const res = await apiCall(`/api/cooperations/${id}/fund-escrow`, { method: 'POST' })
      return { res: await res.json(), coopId: id, pubkey }
    },
    onSuccess: ({ res: _res, coopId, pubkey: _pubkey }) => {
      queryClient.invalidateQueries({ queryKey: ['cooperations', _pubkey] })
      queryClient.invalidateQueries({ queryKey: ['cooperation', coopId] })
    },
  })
}

export function useReleasePayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, milestoneId, pubkey }: { id: string; milestoneId: string; pubkey: string }) => {
      const res = await apiCall(`/api/cooperations/${id}/milestones/${milestoneId}/release-payment`, { method: 'POST' })
      return { res: await res.json(), coopId: id, pubkey }
    },
    onSuccess: ({ res: _res, coopId, pubkey: _pubkey }) => {
      queryClient.invalidateQueries({ queryKey: ['cooperations', _pubkey] })
      queryClient.invalidateQueries({ queryKey: ['cooperation', coopId] })
    },
  })
}

export function useAcceptApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, milestoneId, appId, pubkey }: { id: string; milestoneId: string; appId: string; pubkey: string }) => {
      const res = await apiCall(`/api/cooperations/${id}/milestones/${milestoneId}/applications/${appId}/accept`, { method: 'POST' })
      return { res: await res.json(), coopId: id, pubkey }
    },
    onSuccess: ({ res: _res, coopId, pubkey: _pubkey }) => {
      queryClient.invalidateQueries({ queryKey: ['cooperations', _pubkey] })
      queryClient.invalidateQueries({ queryKey: ['cooperation', coopId] })
    },
  })
}

export function useDeclineApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, milestoneId, appId, pubkey }: { id: string; milestoneId: string; appId: string; pubkey: string }) => {
      const res = await apiCall(`/api/cooperations/${id}/milestones/${milestoneId}/applications/${appId}/decline`, { method: 'POST' })
      return { res: await res.json(), coopId: id, pubkey }
    },
    onSuccess: ({ res: _res, coopId, pubkey: _pubkey }) => {
      queryClient.invalidateQueries({ queryKey: ['cooperations', _pubkey] })
      queryClient.invalidateQueries({ queryKey: ['cooperation', coopId] })
    },
  })
}

export function useStartCooperation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, pubkey }: { id: string; pubkey: string }) => {
      const res = await apiCall(`/api/cooperations/${id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerPubkey: pubkey }),
      })
      return { res: await res.json(), pubkey }
    },
    onSuccess: ({ res: _res, pubkey: _pubkey }) => {
      queryClient.invalidateQueries({ queryKey: ['cooperations', _pubkey] })
      queryClient.invalidateQueries({ queryKey: ['cooperations-discover'] })
    },
  })
}

export function useCreateTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: unknown) => {
      const res = await apiCall('/api/tickets', { method: 'POST', body: JSON.stringify(body) })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-tickets'] })
    },
  })
}

export function useDeleteCatalogItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await apiCall(`/api/catalog/${id}`, { method: 'DELETE' })
      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog'] })
    },
  })
}
