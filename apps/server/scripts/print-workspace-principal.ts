// Ops helper (ADR-311 / FU-434 Slice A): prints the ICP principal the server
// derives from ICP_WORKSPACE_SERVER_SEED. The workspace canister must be
// deployed with exactly this principal as its init arg, otherwise every
// mutating server call is rejected with Unauthorized:
//   icp deploy icp_workspace_canister -y --args "(principal \"$(ICP_WORKSPACE_SERVER_SEED=... npx tsx apps/server/scripts/print-workspace-principal.ts)\")"
// (ADR-346: migrated from `dfx deploy --argument`.)
// Prints the principal only — never the seed (FU-195-C).
import { workspaceServerPrincipal } from '../services/workspace-canister-client.js'

const principal = workspaceServerPrincipal()
if (!principal) {
  console.error('ICP_WORKSPACE_SERVER_SEED is not set (64 hex chars expected)')
  process.exit(1)
}
console.log(principal)
