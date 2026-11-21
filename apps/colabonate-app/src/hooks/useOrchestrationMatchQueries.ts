// FU-483 (ADR-328 D2/D4) — Coop Guide Agent Orchestration Match-Preview.
// Mirrors the useAgentTaskQueries.ts pattern: one self-contained file for a
// bounded feature area.
//
// Server contract: POST /api/cooperation-templates/match-agents
// (apps/server/index.ts) — public, no auth required (same tier as the
// existing GET /:id/match-agents template-bound route it reuses
// matchAgentsToOrchestration() from). Takes ad-hoc orchestrationSteps
// directly in the body since the Guide's pipeline isn't a saved
// CooperationTemplate.
import { useMutation } from '@tanstack/react-query'
import { apiCall } from '../lib/api'

export interface OrchestrationMatchStep {
  order: number
  title: string
  requiredAgentCapabilities: string[]
  inputFromStep: number | null
  outputToSteps: number[]
}

export interface OrchestrationMatchCandidate {
  agentProfileId: string
  name: string
  avatarUrl: string | null
  reputationScore: number | null
  minOfferPriceSats: number | null
  // ADR-352 D1a (FU-606): the candidate's cheapest matching AGENT_SETUP
  // offer — sent back as assigneeOfferId when the buyer picks this candidate,
  // since AgentProfile<->Offer is many-to-one and the execution Workspace
  // anchors to a specific Offer. Null only if the server-side lookup somehow
  // missed it (defensive — a candidate always comes from an active offer).
  cheapestOfferId: string | null
  score: number
}

export interface OrchestrationStepMatch {
  step: OrchestrationMatchStep
  candidates: OrchestrationMatchCandidate[]
}

export function useMatchAgentsToOrchestration() {
  return useMutation({
    mutationFn: async (steps: OrchestrationMatchStep[]) => {
      const res = await apiCall('/api/cooperation-templates/match-agents', {
        method: 'POST',
        body: JSON.stringify({ orchestrationSteps: steps }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to match agents')
      return data as { matches: OrchestrationStepMatch[] }
    },
  })
}
