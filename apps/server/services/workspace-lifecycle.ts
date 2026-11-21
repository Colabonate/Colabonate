import type { PrismaClient } from '@prisma/client'
import { WorkspaceStatusSchema, type WorkspaceStatus } from '../lib/enums.js'
import {
  getWorkspaceCanisterClient,
  isWorkspaceRelayInSyncError,
  type WorkspaceCanisterClient,
} from './workspace-canister-client.js'

// ADR-311 D2: workspace lifecycle state machine.
//
//   PENDING_DEPLOY → RUNNING → SUSPENDED → COMPLETED → EXPIRED
//                       ↑          │
//                       └──────────┘ (resume via cycle reload)
//
// The server owns three of these transitions today (deploy request →
// PENDING_DEPLOY at creation, buyer-confirm → COMPLETED, TTL → EXPIRED via
// sweep). RUNNING/SUSPENDED are driven by the Workspace-Canister once the D5
// wiring exists (FU-432) — the canister suspends on budget exhaustion and
// resumes on reload — but the full transition map is defined here already so
// the canister client and the routes share one source of truth.
//
// SUSPENDED → COMPLETED is deliberately legal: a buyer whose workspace ran
// out of budget must still be able to confirm completion (or walk away)
// without being forced to reload cycles first.

const TRANSITIONS: Record<WorkspaceStatus, readonly WorkspaceStatus[]> = {
  PENDING_DEPLOY: ['RUNNING'],
  RUNNING: ['SUSPENDED', 'COMPLETED'],
  SUSPENDED: ['RUNNING', 'COMPLETED'],
  COMPLETED: ['EXPIRED'],
  EXPIRED: [],
}

export function canTransitionWorkspace(from: WorkspaceStatus, to: WorkspaceStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isWorkspaceStatus(value: string): value is WorkspaceStatus {
  return WorkspaceStatusSchema.safeParse(value).success
}

// ADR-311 D2/D7: Completed → Expired sweep. `Offer.agentWorkspaceTTL` (seconds,
// default 604800) is stamped as `expiresAt` when the buyer confirms completion;
// this sweep freezes the workspace once the retention window elapses.
//
// FU-435: for canister-backed workspaces the expiry is relayed to the
// canister FIRST (`expire_workspace` is permissionless but time-gated) and
// the server row only flips when the canister agrees — otherwise the two
// state-machine views would drift silently. In-sync rejections (canister
// record already expired/gone) still flip; transient failures keep the row
// COMPLETED so the next hourly tick retries. The canister-side farewell
// message (FU-395) and destroy step (outputs archival, FU-434-era) come later.
export async function runWorkspaceExpirySweep(
  prisma: PrismaClient,
  now: Date = new Date(),
  client?: WorkspaceCanisterClient | null,
): Promise<number> {
  const due = await prisma.workspace.findMany({
    where: { status: 'COMPLETED', expiresAt: { lte: now } },
    select: { id: true, canisterWorkspaceId: true },
  })
  if (due.length === 0) return 0

  const canister = client === undefined ? await getWorkspaceCanisterClient() : client
  const flippable: string[] = []
  for (const ws of due) {
    if (ws.canisterWorkspaceId && canister) {
      try {
        await canister.expireWorkspace(ws.canisterWorkspaceId)
      } catch (err) {
        if (!isWorkspaceRelayInSyncError(err)) {
          console.error(
            `[workspaces] canister expire relay failed for ${ws.id}, staying COMPLETED for next-tick retry:`,
            err instanceof Error ? err.message : err,
          )
          continue
        }
      }
    }
    flippable.push(ws.id)
  }
  if (flippable.length === 0) return 0

  const result = await prisma.workspace.updateMany({
    where: { id: { in: flippable } },
    data: { status: 'EXPIRED' },
  })
  return result.count
}
