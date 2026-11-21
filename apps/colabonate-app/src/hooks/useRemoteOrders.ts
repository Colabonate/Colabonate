import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { VerifiedEvent } from 'nostr-tools'
import {
  fetchMyRemoteOrders,
  fetchRemotePayee,
  confirmRemoteOrder,
  createRemoteOrder,
  requestRemoteInvoice,
} from '../lib/remote-orders-api'

export function useRemotePayee(offerId: string, quantity = 1, enabled = true) {
  return useQuery({
    queryKey: ['remote-payee', offerId, quantity],
    queryFn: () => fetchRemotePayee(offerId, quantity),
    enabled: enabled && Boolean(offerId),
    staleTime: 60_000,
    retry: false,
  })
}

export function useRemoteOrders(offerId?: string, enabled = true) {
  return useQuery({
    queryKey: ['remote-orders', offerId ?? 'all'],
    queryFn: () => fetchMyRemoteOrders(offerId),
    enabled,
  })
}

export function useCreateRemoteOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ offerId, quantity }: { offerId: string; quantity?: number }) =>
      createRemoteOrder(offerId, quantity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-orders'] })
    },
  })
}

export function useRequestRemoteInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, zapRequest }: { orderId: string; zapRequest?: VerifiedEvent }) =>
      requestRemoteInvoice(orderId, zapRequest),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-orders'] })
    },
  })
}

export function useConfirmRemoteOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, preimage }: { orderId: string; preimage: string }) =>
      confirmRemoteOrder(orderId, preimage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['remote-orders'] })
    },
  })
}
