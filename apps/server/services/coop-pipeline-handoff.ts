import type { PrismaClient } from '@prisma/client'
import { getWorkspaceCanisterClient, type WorkspaceCanisterClient } from './workspace-canister-client.js'

// ADR-352 D1 (FU-607): cross-agent pipeline handoff. The common case — one
// agent handling several consecutive steps — needs NO handoff at all (it's
// all one ongoing workspace, D1's whole point). This only matters at a real
// agent boundary: step N is assigned to Offer A, step N+1 to a DIFFERENT
// Offer B. When Offer B's workspace is created, this seeds Offer A's most
// recent agent output into B's context index (via the new server-only
// `seed_context` canister call) so B's very first real chat turn can
// retrieve it through the existing ADR-321 D3 RAG lookup — no protocol
// change needed on the chat/signing side, since `post_message` itself stays
// buyer-signed and untouched.
//
// Deliberately scoped to the topology the Match-Preview UI can actually
// author today: a strictly linear chain across (milestoneIndex, stepIndex)
// order — the client's own `inputFromStep`/`outputToSteps` computation
// (MatchPreviewStep.tsx) is always linear in practice, and the schema has no
// persisted DAG edges to read a richer topology from even if one existed.

export interface PipelineStepRef {
  milestoneIndex: number
  stepIndex: number
  assigneeOfferId: string | null
}

// Pure: given every step across a Cooperation's pipeline, finds the offerId
// of the step immediately preceding the first step assigned to
// `targetOfferId` — only when that preceding step is assigned to a
// DIFFERENT, non-null offer (no real boundary otherwise: no predecessor, an
// unassigned predecessor, or the same agent continuing).
export function findHandoffSourceOfferId(steps: PipelineStepRef[], targetOfferId: string): string | null {
  const sorted = [...steps].sort((a, b) => a.milestoneIndex - b.milestoneIndex || a.stepIndex - b.stepIndex)
  const firstIndex = sorted.findIndex(s => s.assigneeOfferId === targetOfferId)
  if (firstIndex <= 0) return null
  const prev = sorted[firstIndex - 1]
  if (!prev.assigneeOfferId || prev.assigneeOfferId === targetOfferId) return null
  return prev.assigneeOfferId
}

// Extracts the most recent assistant chat reply's text from a canister
// output list — the "final output" of a completed step, in the absence of
// any richer per-step deliverable concept in the current canister model.
export function extractLastAssistantReply(outputs: Array<{ outputType: string; metadata: string }>): string | null {
  for (let i = outputs.length - 1; i >= 0; i--) {
    const o = outputs[i]
    if (o.outputType !== 'chat') continue
    try {
      const parsed = JSON.parse(o.metadata) as { role?: string; content?: string }
      if (parsed.role === 'assistant' && typeof parsed.content === 'string' && parsed.content.trim()) {
        return parsed.content
      }
    } catch {
      // malformed metadata — skip, never throw from a best-effort path.
    }
  }
  return null
}

// Best-effort, non-blocking: never throws, only logs. Called right after a
// successful POST /:id/inject-config for a cooperation-anchored workspace —
// config must exist before seed_context can embed anything (same
// precondition search_context already enforces canister-side).
export async function seedHandoffContextIfApplicable(
  prisma: PrismaClient,
  targetWorkspace: { id: string; cooperationId: string | null; offerId: string; canisterWorkspaceId: string | null },
): Promise<void> {
  if (!targetWorkspace.cooperationId || !targetWorkspace.canisterWorkspaceId) return

  try {
    const steps = await prisma.coopMilestoneStep.findMany({
      where: { milestone: { cooperationId: targetWorkspace.cooperationId } },
      select: { stepIndex: true, assigneeOfferId: true, milestone: { select: { milestoneIndex: true } } },
    })
    const refs: PipelineStepRef[] = steps.map(s => ({
      milestoneIndex: s.milestone.milestoneIndex,
      stepIndex: s.stepIndex,
      assigneeOfferId: s.assigneeOfferId,
    }))
    const sourceOfferId = findHandoffSourceOfferId(refs, targetWorkspace.offerId)
    if (!sourceOfferId) return

    const sourceWorkspace = await prisma.workspace.findUnique({
      where: { cooperationId_offerId: { cooperationId: targetWorkspace.cooperationId, offerId: sourceOfferId } },
      select: { canisterWorkspaceId: true },
    })
    if (!sourceWorkspace?.canisterWorkspaceId) return // predecessor never ran (or not yet) — nothing to seed

    const client: WorkspaceCanisterClient | null = await getWorkspaceCanisterClient()
    if (!client) return

    const outputs = await client.getOutputs(sourceWorkspace.canisterWorkspaceId)
    const content = extractLastAssistantReply(outputs)
    if (!content) return

    await client.seedContext(targetWorkspace.canisterWorkspaceId, content, `handoff:${sourceOfferId}`)
  } catch (err) {
    console.error(`[coop-pipeline-handoff] seeding failed for workspace ${targetWorkspace.id} — context handoff skipped, chat still works:`, err instanceof Error ? err.message : err)
  }
}
