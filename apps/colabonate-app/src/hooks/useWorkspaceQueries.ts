/**
 * Agent Workspace queries + mutations — ADR-311 (Workspace Execution on ICP
 * Canisters) D2/D5, wired to the UI per ADR-326 D5 / FU-447.
 *
 * Mirrors the useAgentTaskQueries.ts pattern: one self-contained file for a
 * bounded feature area. Server contract: apps/server/routes/workspaces.ts —
 * every route requires auth (a workspace is buyer/seller-scoped runtime
 * state, not marketplace data).
 */

import type { BountyBrief } from './useAgentTaskQueries'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall, ApiError } from '../lib/api'
import { useWallet } from '../contexts/WalletContext'
import { getWorkspaceSignerPubkey, signChatMessage } from '../lib/workspaceChat'
import { getPrivkeyHex, getMyPubkeySync } from '../lib/nostr-identity'
import { unsealAgentConfig, sealForRecipient, toWorkspaceInjectedConfig } from '../lib/agentConfig'

export type WorkspaceStatus = 'PENDING_DEPLOY' | 'RUNNING' | 'SUSPENDED' | 'COMPLETED' | 'EXPIRED'

export interface Workspace {
  id: string
  ticketId: string
  /** ADR-397 D6: set when the workspace was created from a bounty ticket. */
  bountyBrief?: BountyBrief | null
  offerId: string
  agentProfileId: string | null
  buyerPubkey: string
  // ADR-314: the pubkey authorized to sign chat/tool-call actions on the
  // canister — null for workspaces created before this slice shipped.
  canisterBuyerPubkey: string | null
  canisterId: string | null
  canisterWorkspaceId: string | null
  status: WorkspaceStatus
  cycleBudgetSats: number | null
  activatedAt: string | null
  completedAt: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
  // FU-470: whether the canister already has a config injected (false when
  // no canister backend is configured — honest default, not an error).
  hasConfig: boolean
  // ADR-349 D1: server-computed viewer role — never infer `isSeller` from
  // `!isBuyer` client-side, an invited collaborator (D1) is neither.
  viewerRole: 'buyer' | 'seller' | 'collaborator'
  // FU-589: the device-local key THIS viewer needs to match (via
  // getWorkspaceSignerPubkey()) to actually sign buyer-direct actions.
  // canisterBuyerPubkey for the buyer; a collaborator's own registered
  // signer (null until they call useRegisterWorkspaceSigner themselves);
  // always null for a read-only seller.
  viewerSignerPubkey: string | null
  // ADR-351: the mandatory-funding recharge — null for pre-FU-376 legacy
  // workspaces that never got one (already implicitly usable). `bolt11` is
  // only present while `rail==='LN' && status==='PENDING'`.
  mandatoryFunding: {
    id: string
    amountSats: number
    status: string
    rail: string
    bolt11: string | null
  } | null
  // ADR-342 D4a / ADR-370 D2 (Phase 1): doop-hosted canvas binding mirrored
  // onto the workspace row — the server returns these on
  // GET /api/workspaces/:id. Drives the "Collaboration Canvas" open card in
  // WorkspaceDetail (ADR-370 D8, Phase 5 / FU-674).
  canvasProvider?: 'doop-local' | 'doop-hosted' | null
  canvasId?: string | null
  canvasProvisioningStatus?: 'pending' | 'ready' | 'failed' | null
  canvasBuyerAccess?: 'edit' | 'none' | null
}

// ADR-349 D1: an invited read-scoped collaborator (e.g. the Agent-Setup
// provider) — distinct from the buyer (implicit Owner) and the ticket seller
// (already has read access without an invite).
export interface WorkspaceMember {
  id: string
  pubkey: string
  invitedBy: string
  createdAt: string
  member: { pubkey: string; name: string | null; picture: string | null }
  // FU-589: null until this collaborator registers their own device-local
  // signer (POST /:id/members/me/signer) — see Workspace.viewerSignerPubkey.
  canisterSignerPubkey: string | null
}

export interface WorkspaceOutput {
  outputType: string
  uri: string
  metadata: string
  createdAt: string
  signature: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant' | string
  content: string
  createdAt: string
}

export interface ToolActivity {
  url: string
  status: number | null
  body: string | null
  createdAt: string
}

// ADR-314 D5 (transparency UI, 2026-08-21): tool-call outputs used to only
// surface in the separate raw Outputs list, never woven into the chat
// thread — this interleaves both output types chronologically so tool
// activity renders inline where it actually happened. "Thinking blocks" and
// a decision tree (also named in D5) stay open — the canister has no
// dedicated output type for either today (only 'chat' from post_message and
// 'tool' from execute_tool), so there is nothing to render yet.
export type TimelineItem =
  | ({ kind: 'chat' } & ChatMessage)
  | ({ kind: 'tool' } & ToolActivity)

export function parseTimeline(outputs: WorkspaceOutput[]): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const o of outputs) {
    if (o.outputType === 'chat') {
      try {
        const parsed = JSON.parse(o.metadata) as { role?: unknown; content?: unknown }
        if (typeof parsed.role === 'string' && typeof parsed.content === 'string') {
          items.push({ kind: 'chat', role: parsed.role, content: parsed.content, createdAt: o.createdAt })
        }
      } catch {
        // skip malformed metadata
      }
    } else if (o.outputType === 'tool') {
      let status: number | null = null
      let body: string | null = null
      try {
        const parsed = JSON.parse(o.metadata) as { status?: unknown; body?: unknown }
        status = typeof parsed.status === 'number' ? parsed.status : null
        body = typeof parsed.body === 'string' ? parsed.body : null
      } catch {
        // malformed metadata — still show the activity, just without status/body
      }
      items.push({ kind: 'tool', url: o.uri, status, body, createdAt: o.createdAt })
    }
  }
  return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

// apiCall() (lib/api.ts) already throws an ApiError for any non-2xx
// response before a caller ever sees `res.ok === false` — its `.message` is
// the raw error CODE (e.g. "ALREADY_MEMBER"), while the server's
// human-readable text lives in `.data.message`. Every `if (!res.ok) throw
// new Error(data.message ?? data.error ?? ...)` pattern below it is
// therefore dead code (found via ADR-349 D2 browser testing, FU-590 tracks
// auditing the rest of the app for the same pattern). Route every mutation
// in this file through this helper instead so error text is consistently
// the friendly one.
function rethrowFriendly(e: unknown): never {
  if (e instanceof ApiError) throw new Error(e.data?.message ?? e.message)
  throw e
}

async function fetchJson<T>(endpoint: string): Promise<T> {
  try {
    const res = await apiCall(endpoint)
    return (await res.json()) as T
  } catch (e) {
    rethrowFriendly(e)
  }
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function useWorkspace(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => fetchJson<{ workspace: Workspace }>(`/api/workspaces/${workspaceId}`),
    enabled: Boolean(workspaceId),
    staleTime: 10_000,
    select: data => data.workspace,
  })
}

export function useWorkspaceOutputs(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace-outputs', workspaceId],
    queryFn: () => fetchJson<{ outputs: WorkspaceOutput[] }>(`/api/workspaces/${workspaceId}/outputs`),
    enabled: Boolean(workspaceId),
    staleTime: 10_000,
    select: data => data.outputs,
  })
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: () => fetchJson<{ members: WorkspaceMember[] }>(`/api/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId),
    staleTime: 10_000,
    select: data => data.members,
  })
}

// ── Mutations ───────────────────────────────────────────────────────────────

/**
 * Create-or-get: POST /api/workspaces is safe to retry (unique on ticketId).
 * A 409 WORKSPACE_EXISTS response carries the existing workspace, which we
 * treat as success — the caller only cares "does a workspace exist for this
 * ticket now", not whether this specific call created it.
 */
export function useCreateOrGetWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ticketId: string) => {
      // ADR-314: register this device's burner pubkey as the canister's
      // buyer_pubkey up front so chat is usable immediately — see
      // lib/workspaceChat.ts's module doc for why NIP-07/bunker logins can't
      // sign chat messages directly. A no-op if the workspace already exists
      // (WORKSPACE_EXISTS keeps whatever signer the first create used).
      try {
        const res = await apiCall('/api/workspaces', {
          method: 'POST',
          body: JSON.stringify({ ticketId, signerPubkey: getWorkspaceSignerPubkey() }),
        })
        return (await res.json()) as { workspace: Workspace }
      } catch (e) {
        // FU-590: apiCall() throws before this code could ever see
        // res.ok===false, so the previous `if (!res.ok && data.error !==
        // 'WORKSPACE_EXISTS')` branch never ran — a retry of an already-open
        // workspace threw a hard error instead of the intended idempotent
        // no-op. The 409 body carries the existing workspace (server route:
        // `res.status(409).json({ error: 'WORKSPACE_EXISTS', workspace })`).
        if (e instanceof ApiError && e.data?.error === 'WORKSPACE_EXISTS' && e.data.workspace) {
          return { workspace: e.data.workspace as Workspace }
        }
        rethrowFriendly(e)
      }
    },
    onSuccess: ({ workspace }) => {
      queryClient.setQueryData(['workspace', workspace.id], { workspace })
    },
  })
}

// ADR-349 D1/D2: Owner-only invite/revoke of a read-scoped collaborator (e.g.
// the Agent-Setup provider). Write access (chat/tool-calls) stays out of
// scope until FU-589 (canister multi-signer support) ships.
export function useInviteWorkspaceMember(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (pubkey: string) => {
      try {
        const res = await apiCall(`/api/workspaces/${workspaceId}/members`, { method: 'POST', body: JSON.stringify({ pubkey }) })
        return (await res.json()) as { member: WorkspaceMember }
      } catch (e) {
        rethrowFriendly(e)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] })
    },
  })
}

export function useRemoveWorkspaceMember(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (pubkey: string) => {
      try {
        await apiCall(`/api/workspaces/${workspaceId}/members/${pubkey}`, { method: 'DELETE' })
      } catch (e) {
        rethrowFriendly(e)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] })
    },
  })
}

// FU-589: an invited collaborator registers their own device-local signer
// (getWorkspaceSignerPubkey(), the same per-device burner key the buyer
// already uses) — the inviting buyer cannot know this key, it only exists
// once the collaborator's own browser generates it. Grants full write
// parity with the buyer once the server relays it to the canister.
export function useRegisterWorkspaceSigner(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (signerPubkey: string) => {
      try {
        const res = await apiCall(`/api/workspaces/${workspaceId}/members/me/signer`, {
          method: 'POST',
          body: JSON.stringify({ signerPubkey }),
        })
        return (await res.json()) as { signerPubkey: string }
      } catch (e) {
        rethrowFriendly(e)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] })
    },
  })
}

// ADR-314 minimal chat slice: signs the message client-side (the server
// never sees the buyer's key) and relays it via POST /:id/messages. Refetches
// outputs on success so the reply (and the just-sent user turn) appear.
export function useSendWorkspaceMessage(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ canisterWorkspaceId, content }: { canisterWorkspaceId: string; content: string }) => {
      const signed = signChatMessage(canisterWorkspaceId, content)
      try {
        const res = await apiCall(`/api/workspaces/${workspaceId}/messages`, { method: 'POST', body: JSON.stringify(signed) })
        return (await res.json()) as { output: WorkspaceOutput }
      } catch (e) {
        rethrowFriendly(e)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-outputs', workspaceId] })
    },
  })
}

// FU-470 (ADR-306 D4 / FU-353): the client trigger that was missing — the
// server relay (POST /:id/inject-config) has existed since FU-434 Slice B,
// but nothing ever called it. Unseals the offer's config (sealed to the
// owner's own burner key at offer-creation time, ADR-306 D2), re-seals it to
// the canister's output pubkey, and relays it. Model, base URL and the tool
// allowlist come from the sealed config since ADR-396 (FU-847/848); legacy
// seals without a model fall back to `DEFAULT_AGENT_MODEL`.
/**
 * ADR-396 D4 (FU-850): the sealed agent config is no longer part of the public
 * offer payload — only the offer's creator can read it here. Shared by
 * workspace injection, the canvas runner and the edit wizard.
 */
export async function fetchSealedAgentConfig(offerId: string): Promise<string | null> {
  const res = await apiCall(`/api/offers/${offerId}/sealed-config`)
  const data = (await res.json()) as { agentConfigSealed?: string | null }
  return data.agentConfigSealed ?? null
}

/**
 * ADR-396 D3 (FU-851): the config pinned at booking time (seller-only). Falls
 * back server-side to the offer's current seal for tickets booked before the
 * pin existed. Injection uses this so later offer edits never change a booking.
 */
export async function fetchPinnedAgentConfig(ticketId: string): Promise<string | null> {
  const res = await apiCall(`/api/tickets/${ticketId}/agent-config-seal`)
  const data = (await res.json()) as { agentConfigSealed?: string | null }
  return data.agentConfigSealed ?? null
}

export function useInjectWorkspaceConfig(workspaceId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ offerId, ticketId }: { offerId: string; ticketId?: string | null }) => {
      const privkeyHex = getPrivkeyHex()

      let sealed: string | null = null
      try {
        // Ticket-anchored workspaces use the booking's pinned config;
        // cooperation-pipeline workspaces (no ticket) use the offer's seal.
        sealed = ticketId ? await fetchPinnedAgentConfig(ticketId) : await fetchSealedAgentConfig(offerId)
      } catch (e) {
        rethrowFriendly(e)
      }
      if (!sealed) throw new Error('This offer has no sealed configuration to inject.')

      const secrets = await unsealAgentConfig(privkeyHex, sealed)

      let keyData: { outputPubkey?: string }
      try {
        const keyRes = await apiCall(`/api/workspaces/${workspaceId}/output-key`)
        keyData = await keyRes.json()
      } catch (e) {
        rethrowFriendly(e)
      }

      // ADR-396 D1: model, base URL and the tool allowlist now come from the
      // seller's sealed config (FU-847/848) instead of hard-coded defaults.
      const config = toWorkspaceInjectedConfig(secrets)
      const ciphertext = sealForRecipient(privkeyHex, keyData.outputPubkey as string, config)

      try {
        const res = await apiCall(`/api/workspaces/${workspaceId}/inject-config`, {
          method: 'POST',
          body: JSON.stringify({ senderPubkey: getMyPubkeySync(), ciphertext }),
        })
        return await res.json()
      } catch (e) {
        // FU-590: same dead-code bug as WORKSPACE_EXISTS above — a re-inject
        // on an already-configured workspace threw a hard error instead of
        // the intended idempotent no-op.
        if (e instanceof ApiError && e.data?.error === 'CONFIG_ALREADY_INJECTED') {
          return e.data
        }
        rethrowFriendly(e)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] })
    },
  })
}

export function useCompleteWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (workspaceId: string) => {
      try {
        const res = await apiCall(`/api/workspaces/${workspaceId}/complete`, { method: 'POST' })
        return (await res.json()) as { workspace: Workspace }
      } catch (e) {
        rethrowFriendly(e)
      }
    },
    onSuccess: (_data, workspaceId) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] })
    },
  })
}

// ADR-351: pays the workspace's mandatory-funding recharge and confirms it —
// a bespoke state-machine hook (mirrors useSupportTip.ts) rather than a plain
// useMutation, since it needs WalletContext.sendPayment() internally (a
// mutationFn can't call hooks). LN rail pays the platform's invoice via the
// viewer's own connected wallet and self-reports the resulting preimage
// (same proof pattern as tickets' confirm-direct-payment, ADR-253); DEMO
// rail (beta only) confirms with no body, matching the server's guard.
export type PayMandatoryFundingState = 'idle' | 'paying' | 'paid' | 'error'

export function usePayMandatoryFunding(workspaceId: string | undefined) {
  const { sendPayment } = useWallet()
  const queryClient = useQueryClient()
  const [state, setState] = useState<PayMandatoryFundingState>('idle')
  const [error, setError] = useState<string | null>(null)

  async function pay(rechargeId: string, rail: string, bolt11: string | null) {
    if (!workspaceId || state === 'paying') return
    setState('paying')
    setError(null)
    try {
      let preimage: string | undefined
      if (rail === 'LN') {
        if (!bolt11) throw new Error('No invoice available to pay')
        const result = await sendPayment(bolt11)
        if (result.status === 'FAILED' || !result.preimage) throw new Error('Payment failed')
        preimage = result.preimage
      }
      await apiCall(`/api/workspaces/${workspaceId}/recharge/${rechargeId}/confirm`, {
        method: 'POST',
        body: JSON.stringify(preimage ? { preimage } : {}),
      })
      setState('paid')
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] })
    } catch (e) {
      // FU-590: apiCall() throws ApiError with the raw error CODE as
      // `.message` — prefer the server's human-readable `.data.message`.
      const message = e instanceof ApiError ? (e.data?.message ?? e.message) : e instanceof Error ? e.message : String(e)
      setError(message)
      setState('error')
    }
  }

  return { state, error, pay }
}
