/**
 * Bounty Board queries + mutations — ADR-319 (Coordination Layer: Dynamic
 * Human-Agent Task Allocation), FU-428. UI-facing terminology renamed
 * "Task Board" → "Bounty Board" by ADR-336; this hook's file name, exported
 * identifiers (`useAgentTasks`, `AgentTask`, …) and the underlying Prisma
 * model/API path (`AgentTask` / `/api/agent-tasks`) deliberately keep their
 * original name — ADR-336 explicitly defers that internal/data-model rename
 * (a real migration, ~15 call sites) to a separate pass. Only the strings a
 * user actually sees were updated here.
 *
 * Mirrors the useBookingQueries.ts pattern (ADR-271): one self-contained file
 * for a bounded feature area, not folded into the giant useEntityQueries.ts /
 * useEntityMutations.ts pair. Deliberately does NOT import the shared `Offer`
 * type or the shared `useUserAgentOffers`/`useUserAllOffers` hooks — this
 * feature only needs the tiny id/title/priceSats/agentProfileId/status slice
 * of an AGENT_SETUP offer, fetched directly here.
 *
 * Server contract (apps/server/routes/agent-tasks.ts, apps/server/routes/
 * agent-profiles.ts): GET routes are public; all mutating routes require auth
 * (apiCall attaches the Bearer token automatically when logged in).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '../lib/api'

// ADR-397 D4: IN_PROGRESS / COMPLETED follow the linked ticket.
export type AgentTaskStatus = 'OPEN' | 'SELECTING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'
export type AgentTaskApplicationStatus = 'PENDING' | 'AWAITING_OWNER_APPROVAL' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN'
// FU-483 (ADR-328 D2): reuses OrchestrationMode's own wire values (server:
// agent-tasks.ts PREFERRED_SUPERVISION_VALUES).
export type AgentTaskSupervision = 'HUMAN' | 'AUTONOMOUS'

export interface AgentTask {
  id: string
  creatorPubkey: string
  title: string
  description: string
  requiredCapabilities: string[]
  budgetSats: number
  /** Offer.images contract: data-URL photos, first entry = card cover. */
  images: string[] | null
  deadline: string | null
  /** ADR-397 D8: optional plain-text "done means". */
  acceptanceCriteria: string | null
  status: AgentTaskStatus
  selectedAgentProfileId: string | null
  selectedOfferId: string | null
  preferredSupervision: AgentTaskSupervision | null
  /** ADR-397 D2-C: the poster's record on their own bounty tickets (list + detail responses). */
  posterReliability?: PosterReliability | null
  createdAt: string
  updatedAt: string
}

export interface PosterReliability {
  /** Bounty tickets that were paid or cancelled unpaid. */
  decided: number
  paid: number
  paidRate: number | null
  medianHoursToPay: number | null
}

/** ADR-397 D6: the brief frozen onto a bounty ticket (also shown in the workspace). */
export interface BountyBrief {
  bountyId: string
  title: string
  description: string
  acceptanceCriteria: string | null
  deadline: string | null
}

export interface AgentTaskApplicationAgentProfile {
  id: string
  ownerPubkey: string
  name: string
  avatarUrl: string | null
  reputationScore: number | null
  trustScore: number | null
  // ADR-315 D3: badge fields surface here so the Verified chip can render
  // on the applicant row in the task-owner's decision view.
  isVerified?: boolean
  verifiedAt?: string | null
}

export interface AgentTaskApplicationOffer {
  id: string
  title: string
  priceSats: number
}

export interface AgentTaskApplication {
  id: string
  taskId: string
  agentProfileId: string
  offerId: string
  message: string | null
  proposedPriceSats: number | null
  proposedETA: string | null
  status: AgentTaskApplicationStatus
  createdAt: string
  agentProfile?: AgentTaskApplicationAgentProfile
  offer?: AgentTaskApplicationOffer
}

/** Minimal AgentProfile shape needed to populate the "apply with which agent" picker. */
export interface AgentProfileLite {
  id: string
  name: string
  capabilities: string[]
}

/** Minimal AGENT_SETUP Offer shape needed to populate the "apply with which listing" picker. */
export interface AgentOfferLite {
  id: string
  title: string
  priceSats: number
  agentProfileId: string | null
  status: string
}

async function fetchJson<T>(endpoint: string): Promise<T> {
  const res = await apiCall(endpoint)
  const data = await res.json()
  if (!res.ok) throw new Error((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `Request failed: ${res.status}`)
  return data as T
}

// ── Queries ─────────────────────────────────────────────────────────────────

export interface AgentTaskListParams {
  status?: AgentTaskStatus
  capability?: string
  limit?: number
  offset?: number
  // FU-483: "my tasks" (Manage). Passing this drops the OPEN-only default —
  // see the matching server-side comment in agent-tasks.ts GET /.
  creatorPubkey?: string
}

export function useAgentTasks(params: AgentTaskListParams = {}) {
  const { status, capability, limit = 20, offset = 0, creatorPubkey } = params
  return useQuery({
    queryKey: ['agent-tasks', status, capability, limit, offset, creatorPubkey],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (status) qs.set('status', status)
      if (capability) qs.set('capability', capability)
      if (creatorPubkey) qs.set('creatorPubkey', creatorPubkey)
      return fetchJson<{ tasks: AgentTask[]; total: number; limit: number; offset: number }>(`/api/agent-tasks?${qs.toString()}`)
    },
    staleTime: 15_000,
  })
}

/**
 * FU-870: the single cache entry for open bounties (Home slider + coop browse
 * + search). Under the ['agent-tasks'] prefix, so every bounty mutation's
 * invalidation refreshes it. 50 = the server's list cap.
 */
export function useOpenBounties(refetchInterval?: number | false) {
  return useQuery({
    queryKey: ['agent-tasks', 'open-browse'],
    queryFn: async (): Promise<AgentTask[]> => {
      const data = await fetchJson<{ tasks: AgentTask[] }>('/api/agent-tasks?status=OPEN&limit=50')
      return data.tasks ?? []
    },
    staleTime: 30_000,
    refetchInterval,
  })
}

const ALL_TASK_STATUSES: AgentTaskStatus[] = ['OPEN', 'SELECTING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']

/**
 * Status counts for the Bounty Board KPI strip. There's no aggregate endpoint,
 * so this fires one limit:1 request per status (cheap — just reads `total`
 * from each) and sums them for the "All" figure. Scope to `creatorPubkey`
 * for the "My Tasks" pill's counts.
 */
export function useAgentTaskCounts(creatorPubkey?: string) {
  return useQuery({
    queryKey: ['agent-task-counts', creatorPubkey],
    queryFn: async () => {
      const entries = await Promise.all(ALL_TASK_STATUSES.map(async (status) => {
        const qs = new URLSearchParams({ limit: '1', offset: '0', status })
        if (creatorPubkey) qs.set('creatorPubkey', creatorPubkey)
        const data = await fetchJson<{ total: number }>(`/api/agent-tasks?${qs.toString()}`)
        return [status, data.total] as const
      }))
      const byStatus = Object.fromEntries(entries) as Record<AgentTaskStatus, number>
      const all = ALL_TASK_STATUSES.reduce((sum, s) => sum + byStatus[s], 0)
      return { all, byStatus }
    },
    staleTime: 15_000,
  })
}

/** ADR-397 D4: the ticket paying the winner — visible to the poster and the winner only. */
export interface AgentTaskLinkedTicket {
  id: string
  status: string
}

export interface AgentTaskDetail {
  task: AgentTask
  applications: AgentTaskApplication[]
  viewerIsCreator: boolean
  ticket: AgentTaskLinkedTicket | null
}

export function useAgentTask(taskId: string | undefined) {
  return useQuery({
    queryKey: ['agent-task', taskId],
    queryFn: () => fetchJson<AgentTaskDetail>(`/api/agent-tasks/${taskId}`),
    enabled: Boolean(taskId),
    staleTime: 10_000,
  })
}

/** The caller's own AgentProfiles (Manage list scope — GET /api/agent-profiles is owner-scoped, not public). */
export function useMyAgentProfiles(enabled = true) {
  return useQuery({
    queryKey: ['my-agent-profiles'],
    queryFn: () => fetchJson<{ agentProfiles: AgentProfileLite[] }>('/api/agent-profiles'),
    enabled,
    staleTime: 30_000,
    select: data => data.agentProfiles,
  })
}

/** The caller's own AGENT_SETUP offers, for picking a listing to apply with. */
export function useMyAgentOffers(pubkey: string | undefined) {
  return useQuery({
    queryKey: ['my-agent-offers', pubkey],
    queryFn: () => fetchJson<{ offers: AgentOfferLite[] }>(`/api/offers?creatorPubkey=${pubkey}&offerType=AGENT_SETUP`),
    enabled: Boolean(pubkey),
    staleTime: 30_000,
    select: data => data.offers,
  })
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface CreateAgentTaskInput {
  title: string
  description: string
  requiredCapabilities: string[]
  budgetSats: number
  /** Optional data-URL photos (max 5, server-validated) — first = cover. */
  images?: string[]
  deadline?: string
  preferredSupervision?: AgentTaskSupervision | null
  /** ADR-397 D8: ≤ 2,000 chars; null/empty clears it on edit. */
  acceptanceCriteria?: string | null
}

export function useCreateAgentTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateAgentTaskInput) => {
      const res = await apiCall('/api/agent-tasks', { method: 'POST', body: JSON.stringify(input) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Failed to create bounty')
      return data as { task: AgentTask }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-tasks'] }),
  })
}

export function useCancelAgentTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiCall(`/api/agent-tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ action: 'cancel' }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Failed to cancel bounty')
      return data as { task: AgentTask }
    },
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] })
    },
  })
}

// ADR-368 follow-up (2026-09-05): creator edit — same field contract as
// create (PATCH /api/agent-tasks/:id with action:'update'), only allowed for
// the creator while the bounty is still OPEN/SELECTING.
export function useUpdateAgentTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ taskId, input }: { taskId: string; input: CreateAgentTaskInput }) => {
      const res = await apiCall(`/api/agent-tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ action: 'update', ...input }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Failed to update bounty')
      return data as { task: AgentTask }
    },
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] })
    },
  })
}

export interface ApplyToAgentTaskInput {
  taskId: string
  agentProfileId: string
  offerId: string
  message?: string
  proposedPriceSats?: number
  proposedETA?: string
}

export function useApplyToAgentTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ taskId, ...body }: ApplyToAgentTaskInput) => {
      const res = await apiCall(`/api/agent-tasks/${taskId}/applications`, { method: 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Failed to apply')
      return data as { application: AgentTaskApplication }
    },
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] })
    },
  })
}

/** Covers both application actions the applicant can take: withdraw a live application, or confirm an auto-applied one that's AWAITING_OWNER_APPROVAL. */
export function useUpdateAgentTaskApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ taskId, applicationId, action }: { taskId: string; applicationId: string; action: 'withdraw' | 'confirm' }) => {
      const res = await apiCall(`/api/agent-tasks/${taskId}/applications/${applicationId}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? `Failed to ${action} application`)
      return data as { application: AgentTaskApplication }
    },
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] })
    },
  })
}

export interface SelectAgentTaskWinnerResult {
  task: AgentTask
  selectedApplication: AgentTaskApplication
  // ADR-397 D3: pass the body through unchanged — the application id makes the
  // ticket charge the agreed price and link to the bounty.
  nextStep: { method: 'POST'; path: '/api/tickets'; body: { offerId: string; agentTaskApplicationId: string } }
}

export function useSelectAgentTaskWinner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ taskId, applicationId }: { taskId: string; applicationId: string }) => {
      const res = await apiCall(`/api/agent-tasks/${taskId}/select`, { method: 'POST', body: JSON.stringify({ applicationId }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? data.error ?? 'Failed to select winner')
      return data as SelectAgentTaskWinnerResult
    },
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] })
    },
  })
}

/** ADR-397 D4: undo a selection while no live ticket exists (bounty → SELECTING). */
export function useRevertAgentTaskSelection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiCall(`/api/agent-tasks/${taskId}/revert-selection`, { method: 'POST' })
      return (await res.json()) as { task: AgentTask }
    },
    onSuccess: (_data, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['agent-task', taskId] })
    },
  })
}
