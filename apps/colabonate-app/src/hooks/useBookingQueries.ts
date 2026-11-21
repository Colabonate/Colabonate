/**
 * Booking queries + mutations — ADR-271.
 * Server = index + advisory hold; Nostr events are signed client-side (lib/booking).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '../lib/api'
import type { BookableResourceDTO, BookingDTO } from '../lib/booking'

export interface AvailabilitySlotDTO {
  kind: 'SPACE' | 'SESSION'
  /** SPACE: resource-local YYYY-MM-DD (end exclusive). SESSION: ISO instants. */
  startDate?: string
  endDate?: string
  start?: string
  end?: string
  seatsTotal?: number
  seatsLeft?: number
  /** ADR-369 OPEN sessions: containing WEEKLY_WINDOW bounds (start-grid anchor). */
  windowStart?: string
  windowEnd?: string
}

export interface AvailabilityDTO {
  resourceId: string
  kind: 'SPACE' | 'SESSION'
  /** ADR-369: FIXED (occurrences) | OPEN (start + duration inside slots). */
  style: 'FIXED' | 'OPEN'
  slotMinutes: number
  timezone: string
  slots: AvailabilitySlotDTO[]
  holds: AvailabilityHoldDTO[]
}

/** D4 advisory hold — surfacing only, never blocks a slot. */
export interface AvailabilityHoldDTO {
  start: string
  end: string
  units: number
  expiresAt: string
}

async function fetchJson<T>(endpoint: string): Promise<T> {
  const res = await apiCall(endpoint)
  const data = await res.json()
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `Request failed: ${res.status}`)
  return data as T
}

export function useBookableResourcesMine(pubkey: string | undefined) {
  return useQuery({
    queryKey: ['bookable-resources', pubkey],
    queryFn: () => fetchJson<{ resources: (BookableResourceDTO & { _count?: { bookings: number; offers: number } })[] }>('/api/resources/mine'),
    enabled: Boolean(pubkey),
    staleTime: 30_000,
  })
}

export function useBookableResource(resourceId: string | null | undefined) {
  return useQuery({
    queryKey: ['bookable-resource', resourceId],
    queryFn: () => fetchJson<{ resource: BookableResourceDTO }>(`/api/resources/${resourceId}`),
    enabled: Boolean(resourceId),
    staleTime: 60_000,
  })
}

export function useAvailability(resourceId: string | null | undefined) {
  return useQuery({
    queryKey: ['availability', resourceId],
    queryFn: () => fetchJson<AvailabilityDTO>(
      `/api/resources/${resourceId}/availability`,
    ),
    enabled: Boolean(resourceId),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

export function useIncomingBookings(pubkey: string | undefined) {
  return useQuery({
    queryKey: ['bookings-incoming', pubkey],
    queryFn: () => fetchJson<{ bookings: BookingDTO[] }>('/api/bookings/incoming'),
    enabled: Boolean(pubkey),
    refetchInterval: 60_000,
  })
}

export function useMyBookings(pubkey: string | undefined) {
  return useQuery({
    queryKey: ['bookings-mine', pubkey],
    queryFn: () => fetchJson<{ bookings: BookingDTO[] }>('/api/bookings/mine'),
    enabled: Boolean(pubkey),
    refetchInterval: 60_000,
  })
}

export interface CreateResourceInput {
  kind: 'SPACE' | 'SESSION'
  title: string
  description?: string
  timezone: string
  capacity: number
  minUnits?: number | null
  maxUnits?: number | null
  leadTimeHours?: number
  bufferMinutes?: number
  /** ADR-369: OPEN = buyers pick a start + duration (time blocks, capacity 1). */
  bookingStyle?: 'FIXED' | 'OPEN'
  slotMinutes?: number
  country?: string
  city?: string
  rules: Array<{
    ruleKind: 'WEEKLY_WINDOW' | 'DATE_RANGE'
    weekday?: number
    startMinute?: number
    endMinute?: number
    validFrom?: string | null
    validUntil?: string | null
  }>
  blackouts?: Array<{ start: string; end: string; reason?: string }>
}

export function useCreateBookableResource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateResourceInput) => {
      const res = await apiCall('/api/resources', { method: 'POST', body: JSON.stringify(input) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Failed to create resource')
      return data as { resource: BookableResourceDTO }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookable-resources'] }),
  })
}

export interface RequestBookingInput {
  resourceId: string
  offerId?: string
  start: string
  end: string
  units: number
  note?: string
}

export function useRequestBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: RequestBookingInput) => {
      const res = await apiCall(`/api/resources/${input.resourceId}/bookings`, {
        method: 'POST',
        body: JSON.stringify({ offerId: input.offerId, start: input.start, end: input.end, units: input.units, note: input.note }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Booking request failed')
      return data as { booking: BookingDTO; rsvpTemplate: { kind: 31925; content: string; tags: string[][]; created_at: number } | null }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings-mine'] })
      queryClient.invalidateQueries({ queryKey: ['availability'] })
    },
  })
}

export function useAttachRequestEvent() {
  return useMutation({
    mutationFn: async (params: { bookingId: string; event: unknown }) => {
      const res = await apiCall(`/api/bookings/${params.bookingId}/request-event`, {
        method: 'PATCH',
        body: JSON.stringify({ event: params.event }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Failed to attach request event')
      return data as { booking: BookingDTO }
    },
  })
}

export function useConfirmBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { bookingId: string; event: unknown }) => {
      const res = await apiCall(`/api/bookings/${params.bookingId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ event: params.event }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Confirmation failed')
      return data as { booking: BookingDTO; cancelledConflicts?: BookingDTO[] }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings-incoming'] })
      queryClient.invalidateQueries({ queryKey: ['availability'] })
    },
  })
}

export function useDeclineBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiCall(`/api/bookings/${bookingId}/decline`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Decline failed')
      return data as { booking: BookingDTO }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings-incoming'] }),
  })
}

export function useCancelBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const res = await apiCall(`/api/bookings/${bookingId}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Cancel failed')
      return data as { booking: BookingDTO; requiresNip09Deletion: boolean; nip09EventIds: string[] }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings-mine'] })
      queryClient.invalidateQueries({ queryKey: ['bookings-incoming'] })
      queryClient.invalidateQueries({ queryKey: ['availability'] })
    },
  })
}
