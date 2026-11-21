/**
 * Agent Roster query — ADR-314 D10 (Hermes-Bot-Mode-adaptiert), closes
 * FU-436. Workspace-overarching "My Agents" view: the caller's own
 * AgentProfile rows plus every AgentProfile reached via their AGENT_SETUP
 * ticket history. Pure query-projection (server: GET /api/agent-profiles/
 * roster) — no dedicated Prisma model, per ADR-314's own A6 rejection.
 */

import { useQuery } from '@tanstack/react-query'
import { apiCall } from '../lib/api'

export interface RosterAgentProfile {
  id: string
  name: string
  description: string | null
  capabilities: string[]
  avatarUrl: string | null
  isPublic: boolean
  isVerified?: boolean
  reputationScore: number | null
  trustScore: number | null
  // ADR-326 D7: roster sort uses the AgentProfile.createdAt field directly.
  // Server returns it on GET /api/agent/roster (Prisma model field) — kept
  // optional here so existing call sites that don't read it don't have to
  // change. Powers the "Newest" sort on the Roster tab.
  createdAt?: string
  // ADR-339 D1: newest non-archived AGENT_SETUP offer for this profile —
  // the "listing half" of an Agent Setup (gallery image, price, online/
  // offline state). Null when the profile has no active/draft listing.
  offer?: RosterAgentOffer | null
  // ADR-326 D10.6 (FU-494): only meaningful for owned entries — a booked
  // agent's companyId belongs to another seller's dashboard organization,
  // not the caller's own Private/Corporate context.
  companyId?: string | null
}

export interface RosterAgentOffer {
  id: string
  status: string
  images: string[] | null
  imageThumbs: string[] | null
  title: string
  priceSats: number
  publishedAt: string | null
  agentBillingModel?: string | null
  agentWorkspaceTTL?: number | null
  categoryCode?: string
  description?: string | null
}

export interface BookedRosterEntry {
  agentProfile: RosterAgentProfile
  ticket: { id: string; status: string; updatedAt: string }
  workspace: { id: string; status: string; updatedAt: string } | null
  // FU-395 presence events aren't built — this is the updatedAt-based
  // fallback the ADR's own text documents, not a live presence signal.
  lastActiveAt: string
}

export interface AgentRoster {
  owned: RosterAgentProfile[]
  booked: BookedRosterEntry[]
}

async function fetchRoster(): Promise<AgentRoster> {
  const res = await apiCall('/api/agent-profiles/roster')
  const data = await res.json()
  if (!res.ok) throw new Error((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `Request failed: ${res.status}`)
  return data as AgentRoster
}

export function useAgentRoster() {
  return useQuery({
    queryKey: ['agent-roster'],
    queryFn: fetchRoster,
    staleTime: 15_000,
  })
}
