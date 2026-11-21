/**
 * Agent Catalogs — ADR-340 D6 promoted agent-catalog CRUD into the unified
 * `/api/catalog` router (type=AGENT_SETUP + PUT /:id/agents). The hooks
 * here keep the same name so consumers (AgentStackTab, CatalogsTab) only
 * swap their endpoint paths behind the same React Query keys.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '../lib/api'

export interface AgentCatalog {
  id: string
  name: string
  standardCategoryId: string | null
  memberIds: string[]
  catalogType: 'AGENT_SETUP'
}

interface RawAgentCatalog {
  id: string
  name: string
  standardCategoryId: string | null
  catalogType: 'AGENT_SETUP' | 'PRODUCT'
  agentMembers: Array<{ agentProfileId: string; addedAt: string }>
}

async function parseError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}))
  return (data as { message?: string; error?: string }).message
    ?? (data as { error?: string }).error
    ?? `Request failed: ${res.status}`
}

async function fetchCatalogs(): Promise<{ catalogs: AgentCatalog[] }> {
  // mine=1 returns both PRODUCT and AGENT_SETUP catalogs owned by the caller.
  // The hook surface stays focused on AGENT_SETUP — AgentStackTab only cares
  // about its own agent-catalogs (CatalogsTab will use the broader fetch).
  const res = await apiCall('/api/catalog?mine=1')
  if (!res.ok) throw new Error(await parseError(res))
  const data = (await res.json()) as { catalogs: RawAgentCatalog[] }
  return {
    catalogs: data.catalogs
      .filter(c => c.catalogType === 'AGENT_SETUP')
      .map(c => ({
        id: c.id,
        name: c.name,
        standardCategoryId: c.standardCategoryId,
        memberIds: c.agentMembers.map(m => m.agentProfileId),
        catalogType: 'AGENT_SETUP' as const,
      })),
  }
}

export function useAgentCatalogs() {
  return useQuery({
    queryKey: ['agent-catalogs'],
    queryFn: fetchCatalogs,
    staleTime: 15_000,
  })
}

/** Shared mutation helper: run the request, then invalidate the catalog list. */
function useCatalogMutation<TVars>(
  fn: (vars: TVars) => Promise<void>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-catalogs'] })
      queryClient.invalidateQueries({ queryKey: ['catalogs', 'mine'] })
    },
  })
}

export function useCreateAgentCatalog() {
  return useCatalogMutation(async (name: string) => {
    const res = await apiCall('/api/catalog', {
      method: 'POST',
      body: JSON.stringify({ name, type: 'AGENT_SETUP' }),
    })
    if (!res.ok) throw new Error(await parseError(res))
  })
}

export function useDeleteAgentCatalog() {
  return useCatalogMutation(async (id: string) => {
    const res = await apiCall(`/api/catalog/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(await parseError(res))
  })
}

export function useToggleAgentCatalogMember() {
  return useCatalogMutation(async ({ catalogId, agentProfileId, member }: {
    catalogId: string
    agentProfileId: string
    member: boolean
  }) => {
    const res = await apiCall(`/api/catalog/${catalogId}/agents`, {
      method: 'PUT',
      body: JSON.stringify({ agentProfileId, member }),
    })
    if (!res.ok) throw new Error(await parseError(res))
  })
}

/**
 * Online/offline toggle for an owned Agent Setup (ADR-339 D3) — reuses
 * PATCH /api/offers/:id with status ACTIVE (online) / DRAFT (offline).
 * ADR-306's seal gate guards ACTIVE server-side.
 */
export function useToggleAgentSetupStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ offerId, nextStatus }: { offerId: string; nextStatus: 'ACTIVE' | 'DRAFT' }) => {
      const res = await apiCall(`/api/offers/${offerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) throw new Error(await parseError(res))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-roster'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search-infinite'] })
    },
  })
}

/**
 * ADR-340 D4: soft delete an owned Agent Setup. Server returns 409
 * AGENT_BUSY when the profile is currently in an active workspace or
 * has an in-flight ticket — the hook surfaces the structured error so
 * the row menu can render the busy-guard copy.
 */
export interface DeleteAgentProfileErrorDetail {
  status: number
  code: 'AGENT_BUSY' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL_ERROR'
  message: string
  workspaceId?: string
  workspaceStatus?: string
  ticketId?: string
  ticketStatus?: string
}

export class DeleteAgentProfileError extends Error {
  code: DeleteAgentProfileErrorDetail['code']
  status: number
  workspaceId?: string
  workspaceStatus?: string
  ticketId?: string
  ticketStatus?: string

  constructor(detail: DeleteAgentProfileErrorDetail) {
    super(detail.message)
    this.name = 'DeleteAgentProfileError'
    this.code = detail.code
    this.status = detail.status
    this.workspaceId = detail.workspaceId
    this.workspaceStatus = detail.workspaceStatus
    this.ticketId = detail.ticketId
    this.ticketStatus = detail.ticketStatus
  }
}

export function useDeleteAgentProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiCall(`/api/agent-profiles/${id}`, { method: 'DELETE' })
      if (res.ok) return
      const data = await res.json().catch(() => ({}))
      throw new DeleteAgentProfileError({
        status: res.status,
        code: (data as { error?: DeleteAgentProfileErrorDetail['code'] }).error ?? 'INTERNAL_ERROR',
        message: (data as { message?: string }).message ?? `Request failed: ${res.status}`,
        workspaceId: (data as { workspaceId?: string }).workspaceId,
        workspaceStatus: (data as { workspaceStatus?: string }).workspaceStatus,
        ticketId: (data as { ticketId?: string }).ticketId,
        ticketStatus: (data as { ticketStatus?: string }).ticketStatus,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-roster'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search'] })
      queryClient.invalidateQueries({ queryKey: ['offer-search-infinite'] })
    },
  })
}