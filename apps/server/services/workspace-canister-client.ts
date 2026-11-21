// ADR-311 D5 / FU-432: server ↔ Workspace-Canister client (@icp-sdk/core,
// migrated from @dfinity/agent per ADR-346).
//
// The canister (`packages/icp-workspace-canister`) owns the RUNNING/SUSPENDED
// transitions and cycle metering; this module is the server's only way in.
// The route layer consumes `deployWorkspace` (creation) and the FU-435
// lifecycle relays (`completeWorkspace` from the complete route,
// `expireWorkspace` from the TTL sweep); `addCycles`/`getOutputs`/
// `destroyWorkspace` are wired for FU-433 and the destroy path.
//
// Env-gated: without `ICP_WORKSPACE_CANISTER_ID` every entry point degrades
// to null/no-op and the server-side workspace stays PENDING_DEPLOY — the
// honest state. With the env var set, failures throw (fail-loud): a
// configured-but-broken deploy path is a bug, not a no-op.
//
// `ICP_HOST` defaults to the local replica (http://127.0.0.1:4943); the root
// key is fetched only for local hosts, never against mainnet.
//
// Caller authorization (FU-434 Slice A): the canister gates mutating calls
// behind the server principal it learns at init; the server calls with an
// Ed25519 identity derived from `ICP_WORKSPACE_SERVER_SEED` (see
// `workspaceServerIdentity`). Buyer-signature authorization for buyer-direct
// actions (chat/approvals) comes with the harness slice (FU-434 Slice C).

import { Actor, HttpAgent, type ActorSubclass } from '@icp-sdk/core/agent'
import { IDL } from '@icp-sdk/core/candid'
import { Principal } from '@icp-sdk/core/principal'
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity'
import type { WorkspaceStatus as ServerWorkspaceStatus } from '../lib/enums.js'

// ── Candid IDL (mirrors packages/icp-workspace-canister/icp_workspace_canister.did) ──

// @icp-sdk/core/agent expects an IDL factory function, not a pre-built service.
const workspaceCanisterIdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const WorkspaceStateIdl = IDL.Variant({
    Suspended: IDL.Null,
    PendingDeploy: IDL.Null,
    Running: IDL.Null,
    Completed: IDL.Null,
    Expired: IDL.Null,
  })

  const WorkspaceErrorIdl = IDL.Variant({
    InvalidTransition: IDL.Record({ action: IDL.Text, from: WorkspaceStateIdl }),
    NotFound: IDL.Null,
    InvalidArgs: IDL.Record({ reason: IDL.Text }),
    NotImplemented: IDL.Record({ pending_followup: IDL.Text }),
    NotExpired: IDL.Record({ now: IDL.Nat64, expires_at: IDL.Nat64 }),
    NotDestroyable: IDL.Record({ state: WorkspaceStateIdl }),
    Unauthorized: IDL.Record({ expected: IDL.Text }),
    SigningFailed: IDL.Record({ reason: IDL.Text }),
    ConfigAlreadyInjected: IDL.Null,
    // FU-434 Slice C — every variant must be listed or candid decoding fails
    // with "Cannot find field hash" when the canister returns it.
    SignatureVerificationFailed: IDL.Record({ reason: IDL.Text }),
    ReplayRejected: IDL.Record({ reason: IDL.Text }),
    ConfigNotInjected: IDL.Null,
    ToolNotAllowed: IDL.Record({ url: IDL.Text }),
    ApprovalNotFound: IDL.Record({ id: IDL.Nat64 }),
    OutcallFailed: IDL.Record({ reason: IDL.Text }),
    ProviderError: IDL.Record({ reason: IDL.Text }),
  })

  const WorkspaceStatusIdl = IDL.Record({
    cycle_budget: IDL.Nat,
    state: WorkspaceStateIdl,
    remaining_cycles: IDL.Nat,
    cycles_used: IDL.Nat,
  })

  // ADR-321 D3: `search_context` result row — content + similarity score,
  // never the raw embedding vector (that never leaves the canister).
  const ContextSearchResultIdl = IDL.Record({
    content: IDL.Text,
    source: IDL.Text,
    score: IDL.Float64,
    created_at: IDL.Nat64,
  })

  const WorkspaceOutputIdl = IDL.Record({
    uri: IDL.Text,
    signature: IDL.Opt(IDL.Vec(IDL.Nat8)),
    metadata: IDL.Text,
    created_at: IDL.Nat64,
    output_type: IDL.Text,
    // ADR-322 D5: hash-chain link, always 32 bytes for any recorded output.
    chain_hash: IDL.Vec(IDL.Nat8),
  })

  // FU-434 Slice C: parked approval-gated tool call + call_tool outcome.
  const PendingToolCallIdl = IDL.Record({
    id: IDL.Nat64,
    url: IDL.Text,
    body: IDL.Opt(IDL.Text),
    parked_at: IDL.Nat64,
  })

  const ToolCallOutcomeIdl = IDL.Variant({
    Executed: WorkspaceOutputIdl,
    PendingApproval: IDL.Nat64,
  })

  const WorkspaceIdl = IDL.Record({
    id: IDL.Nat64,
    ttl_seconds: IDL.Nat64,
    activated_at: IDL.Opt(IDL.Nat64),
    created_at: IDL.Nat64,
    buyer_pubkey: IDL.Text,
    cycle_budget: IDL.Nat,
    state: WorkspaceStateIdl,
    agent_profile_id: IDL.Text,
    external_id: IDL.Text,
    completed_at: IDL.Opt(IDL.Nat64),
    cycles_used: IDL.Nat,
    expires_at: IDL.Opt(IDL.Nat64),
    outputs: IDL.Vec(WorkspaceOutputIdl),
    // Redacted view (FU-434 Slice B): the injected config never leaves the
    // canister over the query surface — flag only.
    has_config: IDL.Bool,
    // FU-434 Slice C: replay-guard cursor + parked tool approvals.
    last_buyer_action_at: IDL.Opt(IDL.Nat64),
    pending_tool_calls: IDL.Vec(PendingToolCallIdl),
    next_approval_id: IDL.Nat64,
    // ADR-312 D6: billing model set at create_workspace — "ONE_TIME" |
    // "PER_HOUR" | "PER_TOKEN" | "SUBSCRIPTION". Governs how post_message
    // books cycles for the LLM outcall.
    billing_model: IDL.Text,
    // FU-589: invited WorkspaceMember pubkeys authorized for buyer-direct
    // actions, full parity with buyer_pubkey.
    authorized_signers: IDL.Vec(IDL.Text),
  })

  const CreateWorkspaceArgsIdl = IDL.Record({
    ttl_seconds: IDL.Nat64,
    buyer_pubkey: IDL.Text,
    cycle_budget: IDL.Nat,
    agent_profile_id: IDL.Text,
    external_id: IDL.Text,
    billing_model: IDL.Text,
  })

  const resultOf = (ok: IDL.Type) => IDL.Variant({ Ok: ok, Err: WorkspaceErrorIdl })

  return IDL.Service({
    // FU-589: server-gated, idempotent. Mirrors the WorkspaceMember row the
    // server just committed in Postgres.
    add_authorized_signer: IDL.Func([IDL.Nat64, IDL.Text], [resultOf(IDL.Null)], []),
    remove_authorized_signer: IDL.Func([IDL.Nat64, IDL.Text], [resultOf(IDL.Null)], []),
    add_cycles: IDL.Func([IDL.Nat64, IDL.Nat], [resultOf(WorkspaceStatusIdl)], []),
    check_workspace_status: IDL.Func([IDL.Nat64], [resultOf(WorkspaceStatusIdl)], ['query']),
    complete_workspace: IDL.Func([IDL.Nat64], [resultOf(WorkspaceStateIdl)], []),
    create_workspace: IDL.Func([CreateWorkspaceArgsIdl], [resultOf(IDL.Nat64)], []),
    destroy_workspace: IDL.Func([IDL.Nat64], [resultOf(IDL.Null)], []),
    expire_workspace: IDL.Func([IDL.Nat64], [resultOf(WorkspaceStateIdl)], []),
    get_outputs: IDL.Func([IDL.Nat64], [resultOf(IDL.Vec(WorkspaceOutputIdl))], ['query']),
    get_workspace: IDL.Func([IDL.Nat64], [IDL.Opt(WorkspaceIdl)], ['query']),
    record_cycle_usage: IDL.Func([IDL.Nat64, IDL.Nat], [resultOf(WorkspaceStatusIdl)], []),
    start_workspace: IDL.Func([IDL.Nat64], [resultOf(WorkspaceStateIdl)], []),
    record_output: IDL.Func([IDL.Nat64, IDL.Text, IDL.Text, IDL.Text], [resultOf(WorkspaceOutputIdl)], []),
    ensure_output_key: IDL.Func([], [resultOf(IDL.Text)], []),
    inject_config: IDL.Func([IDL.Nat64, IDL.Text, IDL.Text], [resultOf(IDL.Null)], []),
    // FU-434 Slice C: buyer-direct signed actions (caller is anonymous — the
    // BIP-340 signature against the workspace's buyer_pubkey authorizes).
    post_message: IDL.Func([IDL.Nat64, IDL.Text, IDL.Nat64, IDL.Vec(IDL.Nat8)], [resultOf(WorkspaceOutputIdl)], []),
    call_tool: IDL.Func([IDL.Nat64, IDL.Text, IDL.Opt(IDL.Text), IDL.Nat64, IDL.Vec(IDL.Nat8)], [resultOf(ToolCallOutcomeIdl)], []),
    approve_tool_call: IDL.Func([IDL.Nat64, IDL.Nat64, IDL.Nat64, IDL.Vec(IDL.Nat8)], [resultOf(WorkspaceOutputIdl)], []),
    // ADR-321 D1/D3: introspection/debug context search — must be an update
    // (not 'query'), the embedding step is an HTTPS outcall.
    search_context: IDL.Func([IDL.Nat64, IDL.Text, IDL.Nat32], [resultOf(IDL.Vec(ContextSearchResultIdl))], []),
    // ADR-352 D1 (FU-607): server-gated cross-agent handoff seeding.
    seed_context: IDL.Func([IDL.Nat64, IDL.Text, IDL.Text], [resultOf(IDL.Null)], []),
    // ADR-322 D5: pure recomputation over stored outputs, no outcall — query.
    verify_audit_chain: IDL.Func([IDL.Nat64], [resultOf(IDL.Bool)], ['query']),
    get_output_pubkey: IDL.Func([], [IDL.Opt(IDL.Text)], ['query']),
    whoami: IDL.Func([], [IDL.Principal], ['query']),
  })
}

// ── Wire types (candid decoded shapes) ──

type CanisterWorkspaceState =
  | { Suspended: null } | { PendingDeploy: null } | { Running: null }
  | { Completed: null } | { Expired: null }

type CanisterWorkspaceError =
  | { InvalidTransition: { action: string; from: CanisterWorkspaceState } }
  | { NotFound: null }
  | { InvalidArgs: { reason: string } }
  | { NotImplemented: { pending_followup: string } }
  | { NotExpired: { now: bigint; expires_at: bigint } }
  | { NotDestroyable: { state: CanisterWorkspaceState } }
  | { Unauthorized: { expected: string } }
  | { SigningFailed: { reason: string } }
  | { ConfigAlreadyInjected: null }
  // FU-434 Slice C
  | { SignatureVerificationFailed: { reason: string } }
  | { ReplayRejected: { reason: string } }
  | { ConfigNotInjected: null }
  | { ToolNotAllowed: { url: string } }
  | { ApprovalNotFound: { id: bigint } }
  | { OutcallFailed: { reason: string } }
  | { ProviderError: { reason: string } }

type CanisterResult<T> = { Ok: T } | { Err: CanisterWorkspaceError }

interface CanisterWorkspaceStatus {
  cycle_budget: bigint
  state: CanisterWorkspaceState
  remaining_cycles: bigint
  cycles_used: bigint
}

interface CanisterContextSearchResult {
  content: string
  source: string
  score: number
  created_at: bigint
}

interface CanisterWorkspaceOutput {
  uri: string
  signature: [] | [Uint8Array]
  metadata: string
  created_at: bigint
  output_type: string
  chain_hash: Uint8Array
}

interface CreateWorkspaceArgsWire {
  ttl_seconds: bigint
  buyer_pubkey: string
  cycle_budget: bigint
  agent_profile_id: string
  external_id: string
  billing_model: string
}

// Redacted canister view (FU-434 Slice B) — the injected config is never on
// the wire, only the flag. Slice C adds the replay-guard cursor and the
// parked approval-gated tool calls.
interface CanisterPendingToolCall {
  id: bigint
  url: string
  body: [] | [string]
  parked_at: bigint
}

interface CanisterWorkspaceView {
  id: bigint
  external_id: string
  buyer_pubkey: string
  agent_profile_id: string
  state: CanisterWorkspaceState
  has_config: boolean
  last_buyer_action_at: [] | [bigint]
  pending_tool_calls: CanisterPendingToolCall[]
  next_approval_id: bigint
  billing_model: string
  // FU-589 — see Workspace.authorized_signers on the canister side.
  authorized_signers: string[]
}

// FU-434 Slice C: call_tool outcome — executed output or parked approval id.
type CanisterToolCallOutcome =
  | { Executed: CanisterWorkspaceOutput }
  | { PendingApproval: bigint }

// The actor surface this client consumes (subset of the .did service).
export interface WorkspaceCanisterActor {
  create_workspace(args: CreateWorkspaceArgsWire): Promise<CanisterResult<bigint>>
  start_workspace(id: bigint): Promise<CanisterResult<CanisterWorkspaceState>>
  check_workspace_status(id: bigint): Promise<CanisterResult<CanisterWorkspaceStatus>>
  add_cycles(id: bigint, amount: bigint): Promise<CanisterResult<CanisterWorkspaceStatus>>
  record_cycle_usage(id: bigint, amount: bigint): Promise<CanisterResult<CanisterWorkspaceStatus>>
  complete_workspace(id: bigint): Promise<CanisterResult<CanisterWorkspaceState>>
  expire_workspace(id: bigint): Promise<CanisterResult<CanisterWorkspaceState>>
  get_outputs(id: bigint): Promise<CanisterResult<CanisterWorkspaceOutput[]>>
  get_workspace(id: bigint): Promise<[] | [CanisterWorkspaceView]>
  ensure_output_key(): Promise<CanisterResult<string>>
  inject_config(id: bigint, senderPubkey: string, ciphertext: string): Promise<CanisterResult<null>>
  // FU-434 Slice C: buyer-direct signed actions.
  post_message(id: bigint, content: string, timestamp: bigint, signature: Uint8Array): Promise<CanisterResult<CanisterWorkspaceOutput>>
  call_tool(id: bigint, url: string, body: [] | [string], timestamp: bigint, signature: Uint8Array): Promise<CanisterResult<CanisterToolCallOutcome>>
  approve_tool_call(id: bigint, approvalId: bigint, timestamp: bigint, signature: Uint8Array): Promise<CanisterResult<CanisterWorkspaceOutput>>
  destroy_workspace(id: bigint): Promise<CanisterResult<null>>
  search_context(id: bigint, query: string, topK: number): Promise<CanisterResult<CanisterContextSearchResult[]>>
  // ADR-352 D1 (FU-607): server-gated cross-agent handoff seeding.
  seed_context(id: bigint, content: string, source: string): Promise<CanisterResult<null>>
  verify_audit_chain(id: bigint): Promise<CanisterResult<boolean>>
  // FU-589
  add_authorized_signer(id: bigint, pubkey: string): Promise<CanisterResult<null>>
  remove_authorized_signer(id: bigint, pubkey: string): Promise<CanisterResult<null>>
}

// ── Server-facing types ──

export interface WorkspaceDeployArgs {
  workspaceId: string // server Workspace.id (cuid) → canister external_id
  buyerPubkey: string
  agentProfileId: string
  ttlSeconds: number
  // Cycle budget at creation. Defaults to 0: the paid budget flow (sats →
  // cycles → add_cycles) is FU-433, and the canister accepts a zero budget.
  cycleBudget?: bigint
  // ADR-312 D6: "ONE_TIME" | "PER_HOUR" | "PER_TOKEN" | "SUBSCRIPTION",
  // mirrors Ticket.agentBillingModel. Defaults to "ONE_TIME" (the only fully
  // implemented mode) when the caller omits it.
  billingModel?: string
}

export interface WorkspaceDeployResult {
  canisterId: string
  // Canister-internal nat64 handle, as decimal string (nat64 > 2^53). The
  // server persists it in Workspace.canisterWorkspaceId.
  canisterWorkspaceId: string
}

export interface WorkspaceCanisterStatusView {
  state: ServerWorkspaceStatus
  cycleBudget: bigint
  cyclesUsed: bigint
  remainingCycles: bigint
}

// ADR-321 D3: one `search_context` match — content + similarity score.
export interface ContextSearchResultView {
  content: string
  source: string
  score: number
  createdAt: bigint
}

export interface WorkspaceOutputView {
  outputType: string
  uri: string
  metadata: string
  createdAt: bigint
  signature: Uint8Array | null
  // ADR-322 D5: hash-chain link — see `verifyAuditChain`.
  chainHash: Uint8Array
}

// FU-434 Slice B: redacted canister-side workspace view (config never crosses
// the wire — flag only).
export interface WorkspaceView {
  externalId: string
  buyerPubkey: string
  agentProfileId: string
  state: ServerWorkspaceStatus
  hasConfig: boolean
  // ADR-312 D6 — see Workspace.billing_model on the canister side.
  billingModel: string
  // FU-589 — see Workspace.authorized_signers on the canister side.
  authorizedSigners: string[]
}

export class WorkspaceCanisterError extends Error {
  constructor(method: string, readonly canisterError: CanisterWorkspaceError) {
    super(`workspace canister ${method} rejected: ${formatCanisterError(canisterError)}`)
    this.name = 'WorkspaceCanisterError'
  }
}

// ── Pure helpers (unit-tested without a replica) ──

export function canisterStateToServerStatus(state: CanisterWorkspaceState): ServerWorkspaceStatus {
  if ('PendingDeploy' in state) return 'PENDING_DEPLOY'
  if ('Running' in state) return 'RUNNING'
  if ('Suspended' in state) return 'SUSPENDED'
  if ('Completed' in state) return 'COMPLETED'
  return 'EXPIRED'
}

function formatCanisterError(err: CanisterWorkspaceError): string {
  if ('NotFound' in err) return 'NotFound'
  if ('InvalidArgs' in err) return `InvalidArgs(${err.InvalidArgs.reason})`
  if ('NotImplemented' in err) return `NotImplemented(${err.NotImplemented.pending_followup})`
  if ('InvalidTransition' in err) return `InvalidTransition(${err.InvalidTransition.action})`
  if ('NotExpired' in err) return 'NotExpired'
  if ('Unauthorized' in err) return `Unauthorized(expected ${err.Unauthorized.expected})`
  if ('SigningFailed' in err) return `SigningFailed(${err.SigningFailed.reason})`
  if ('ConfigAlreadyInjected' in err) return 'ConfigAlreadyInjected'
  if ('SignatureVerificationFailed' in err) return `SignatureVerificationFailed(${err.SignatureVerificationFailed.reason})`
  if ('ReplayRejected' in err) return `ReplayRejected(${err.ReplayRejected.reason})`
  if ('ConfigNotInjected' in err) return 'ConfigNotInjected'
  if ('ToolNotAllowed' in err) return `ToolNotAllowed(${err.ToolNotAllowed.url})`
  if ('ApprovalNotFound' in err) return `ApprovalNotFound(${err.ApprovalNotFound.id})`
  if ('OutcallFailed' in err) return `OutcallFailed(${err.OutcallFailed.reason})`
  if ('ProviderError' in err) return `ProviderError(${err.ProviderError.reason})`
  return 'NotDestroyable'
}

function unwrap<T>(method: string, result: CanisterResult<T>): T {
  if ('Err' in result) throw new WorkspaceCanisterError(method, result.Err)
  return result.Ok
}

function toStatusView(status: CanisterWorkspaceStatus): WorkspaceCanisterStatusView {
  return {
    state: canisterStateToServerStatus(status.state),
    cycleBudget: status.cycle_budget,
    cyclesUsed: status.cycles_used,
    remainingCycles: status.remaining_cycles,
  }
}

function toOutputView(o: CanisterWorkspaceOutput): WorkspaceOutputView {
  return {
    outputType: o.output_type,
    uri: o.uri,
    metadata: o.metadata,
    createdAt: o.created_at,
    signature: o.signature.length > 0 ? (o.signature[0] ?? null) : null,
    chainHash: o.chain_hash,
  }
}

// FU-435: true when a lifecycle relay was rejected because the canister is
// already in (or past) the desired state — NotFound (record destroyed) or
// InvalidTransition (already completed/expired). Those mean the two state
// machine views are in sync and the relay is a no-op, not a failure.
export function isWorkspaceRelayInSyncError(err: unknown): boolean {
  return (
    err instanceof WorkspaceCanisterError
    && ('NotFound' in err.canisterError || 'InvalidTransition' in err.canisterError)
  )
}

// ── Client ──

export interface WorkspaceCanisterClient {
  deployWorkspace(args: WorkspaceDeployArgs): Promise<WorkspaceDeployResult>
  checkWorkspaceStatus(canisterWorkspaceId: string): Promise<WorkspaceCanisterStatusView>
  addCycles(canisterWorkspaceId: string, amount: bigint): Promise<WorkspaceCanisterStatusView>
  // D3 metering relay (FU-433 smoke / harness): records consumption; the
  // canister suspends the workspace when the budget is exhausted.
  recordCycleUsage(canisterWorkspaceId: string, amount: bigint): Promise<WorkspaceCanisterStatusView>
  // FU-435 lifecycle relays — return the canister-side state after the flip.
  completeWorkspace(canisterWorkspaceId: string): Promise<ServerWorkspaceStatus>
  expireWorkspace(canisterWorkspaceId: string): Promise<ServerWorkspaceStatus>
  // FU-434 Slice B (FU-353): one-time encrypted config injection. The server
  // relays the owner's NIP-44 ciphertext and never sees the plaintext.
  ensureOutputKey(): Promise<string>
  injectConfig(canisterWorkspaceId: string, senderPubkey: string, ciphertext: string): Promise<void>
  getWorkspaceView(canisterWorkspaceId: string): Promise<WorkspaceView | null>
  getOutputs(canisterWorkspaceId: string): Promise<WorkspaceOutputView[]>
  // FU-434 Slice C: buyer-direct signed harness actions. The caller (smoke /
  // future buyer client) builds the canonical message and signs it with the
  // buyer's nostr key — the server only relays and cannot forge calls.
  postMessage(canisterWorkspaceId: string, content: string, timestamp: bigint, signature: Uint8Array): Promise<WorkspaceOutputView>
  callTool(
    canisterWorkspaceId: string,
    url: string,
    body: string | null,
    timestamp: bigint,
    signature: Uint8Array,
  ): Promise<{ executed: WorkspaceOutputView } | { pendingApprovalId: bigint }>
  approveToolCall(canisterWorkspaceId: string, approvalId: bigint, timestamp: bigint, signature: Uint8Array): Promise<WorkspaceOutputView>
  destroyWorkspace(canisterWorkspaceId: string): Promise<void>
  // ADR-321 D1/D3: introspection/debug context search (embeds `query`, scans
  // the workspace's context index). No buyer-facing UI calls this today —
  // RAG retrieval inside postMessage/post_message is automatic.
  searchContext(canisterWorkspaceId: string, query: string, topK: number): Promise<ContextSearchResultView[]>
  // ADR-352 D1 (FU-607): server-only cross-agent handoff — indexes `content`
  // (e.g. the previous pipeline step's final agent output) into this
  // workspace's context index directly, without a buyer-signed chat turn.
  // Requires the workspace's config to already be injected.
  seedContext(canisterWorkspaceId: string, content: string, source: string): Promise<void>
  // ADR-322 D5: recomputes the workspace's audit hash-chain and confirms it's
  // intact. No buyer-facing UI calls this today (FU-465, blocked on FU-380's
  // audit-trail browser existing at all) — introspection/verification tool.
  verifyAuditChain(canisterWorkspaceId: string): Promise<boolean>
  // FU-589 (ADR-349 D1): authorizes/revokes an invited WorkspaceMember as a
  // full-parity signer, mirroring the server's own membership row. Called
  // right after the Postgres commit in POST/DELETE /:id/members.
  addAuthorizedSigner(canisterWorkspaceId: string, pubkey: string): Promise<void>
  removeAuthorizedSigner(canisterWorkspaceId: string, pubkey: string): Promise<void>
}

// Factored out so tests inject a fake actor; the module-level entry points
// below build the real actor lazily from env.
export function createWorkspaceCanisterClient(actor: WorkspaceCanisterActor, canisterId: string): WorkspaceCanisterClient {
  return {
    async deployWorkspace(args) {
      const id = unwrap('create_workspace', await actor.create_workspace({
        external_id: args.workspaceId,
        buyer_pubkey: args.buyerPubkey,
        agent_profile_id: args.agentProfileId,
        ttl_seconds: BigInt(args.ttlSeconds),
        cycle_budget: args.cycleBudget ?? 0n,
        billing_model: args.billingModel ?? 'ONE_TIME',
      }))
      // Deployment-finished hook: PendingDeploy → Running (D2).
      unwrap('start_workspace', await actor.start_workspace(id))
      return { canisterId, canisterWorkspaceId: id.toString() }
    },
    async checkWorkspaceStatus(canisterWorkspaceId) {
      const status = unwrap('check_workspace_status', await actor.check_workspace_status(BigInt(canisterWorkspaceId)))
      return toStatusView(status)
    },
    async addCycles(canisterWorkspaceId, amount) {
      const status = unwrap('add_cycles', await actor.add_cycles(BigInt(canisterWorkspaceId), amount))
      return toStatusView(status)
    },
    async recordCycleUsage(canisterWorkspaceId, amount) {
      const status = unwrap('record_cycle_usage', await actor.record_cycle_usage(BigInt(canisterWorkspaceId), amount))
      return toStatusView(status)
    },
    async completeWorkspace(canisterWorkspaceId) {
      const state = unwrap('complete_workspace', await actor.complete_workspace(BigInt(canisterWorkspaceId)))
      return canisterStateToServerStatus(state)
    },
    async expireWorkspace(canisterWorkspaceId) {
      const state = unwrap('expire_workspace', await actor.expire_workspace(BigInt(canisterWorkspaceId)))
      return canisterStateToServerStatus(state)
    },
    async ensureOutputKey() {
      return unwrap('ensure_output_key', await actor.ensure_output_key())
    },
    async injectConfig(canisterWorkspaceId, senderPubkey, ciphertext) {
      unwrap('inject_config', await actor.inject_config(BigInt(canisterWorkspaceId), senderPubkey, ciphertext))
    },
    async getWorkspaceView(canisterWorkspaceId) {
      const view = await actor.get_workspace(BigInt(canisterWorkspaceId))
      if (view.length === 0) return null
      const w = view[0]
      return {
        externalId: w.external_id,
        buyerPubkey: w.buyer_pubkey,
        agentProfileId: w.agent_profile_id,
        state: canisterStateToServerStatus(w.state),
        hasConfig: w.has_config,
        billingModel: w.billing_model,
        authorizedSigners: w.authorized_signers,
      }
    },
    async getOutputs(canisterWorkspaceId) {
      const outputs = unwrap('get_outputs', await actor.get_outputs(BigInt(canisterWorkspaceId)))
      return outputs.map(toOutputView)
    },
    async postMessage(canisterWorkspaceId, content, timestamp, signature) {
      const output = unwrap('post_message', await actor.post_message(BigInt(canisterWorkspaceId), content, timestamp, signature))
      return toOutputView(output)
    },
    async callTool(canisterWorkspaceId, url, body, timestamp, signature) {
      const outcome = unwrap('call_tool', await actor.call_tool(BigInt(canisterWorkspaceId), url, body === null ? [] : [body], timestamp, signature))
      if ('Executed' in outcome) return { executed: toOutputView(outcome.Executed) }
      return { pendingApprovalId: outcome.PendingApproval }
    },
    async approveToolCall(canisterWorkspaceId, approvalId, timestamp, signature) {
      const output = unwrap('approve_tool_call', await actor.approve_tool_call(BigInt(canisterWorkspaceId), approvalId, timestamp, signature))
      return toOutputView(output)
    },
    async destroyWorkspace(canisterWorkspaceId) {
      unwrap('destroy_workspace', await actor.destroy_workspace(BigInt(canisterWorkspaceId)))
    },
    async searchContext(canisterWorkspaceId, query, topK) {
      const results = unwrap('search_context', await actor.search_context(BigInt(canisterWorkspaceId), query, topK))
      return results.map((r) => ({ content: r.content, source: r.source, score: r.score, createdAt: r.created_at }))
    },
    async seedContext(canisterWorkspaceId, content, source) {
      unwrap('seed_context', await actor.seed_context(BigInt(canisterWorkspaceId), content, source))
    },
    async verifyAuditChain(canisterWorkspaceId) {
      return unwrap('verify_audit_chain', await actor.verify_audit_chain(BigInt(canisterWorkspaceId)))
    },
    async addAuthorizedSigner(canisterWorkspaceId, pubkey) {
      unwrap('add_authorized_signer', await actor.add_authorized_signer(BigInt(canisterWorkspaceId), pubkey))
    },
    async removeAuthorizedSigner(canisterWorkspaceId, pubkey) {
      unwrap('remove_authorized_signer', await actor.remove_authorized_signer(BigInt(canisterWorkspaceId), pubkey))
    },
  }
}

// ── Env-gated default client ──

const DEFAULT_ICP_HOST = 'http://127.0.0.1:4943'

export function isWorkspaceCanisterConfigured(): boolean {
  return Boolean(process.env.ICP_WORKSPACE_CANISTER_ID)
}

// FU-434 Slice A: the canister gates mutating calls behind the authorized
// server principal (init arg). The server's ICP identity derives
// deterministically from `ICP_WORKSPACE_SERVER_SEED` (64 hex chars = 32-byte
// Ed25519 seed) so local/dev/prod can pin the same principal without key
// files. Never log the seed or the derived secret key (FU-195-C rule).
export function workspaceServerIdentity(seedHex: string): Ed25519KeyIdentity {
  if (!/^[0-9a-f]{64}$/i.test(seedHex)) {
    throw new Error('ICP_WORKSPACE_SERVER_SEED must be 64 hex chars (32-byte Ed25519 seed)')
  }
  return Ed25519KeyIdentity.generate(new Uint8Array(Buffer.from(seedHex, 'hex')))
}

export function workspaceServerPrincipal(): string | null {
  const seed = process.env.ICP_WORKSPACE_SERVER_SEED
  return seed ? workspaceServerIdentity(seed).getPrincipal().toText() : null
}

let defaultClient: WorkspaceCanisterClient | null = null

async function buildActor(canisterId: string, host: string): Promise<ActorSubclass<WorkspaceCanisterActor>> {
  const seed = process.env.ICP_WORKSPACE_SERVER_SEED
  // Without a seed the calls go out anonymously — a Slice-A canister will
  // reject them with Unauthorized, which is the intended fail-loud behavior.
  const identity = seed ? workspaceServerIdentity(seed) : undefined
  const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) })
  if (/127\.0\.0\.1|localhost/.test(host)) {
    // Local replica has a throwaway root key; never do this against mainnet.
    await agent.fetchRootKey()
  }
  return Actor.createActor<WorkspaceCanisterActor>(workspaceCanisterIdlFactory, {
    agent,
    canisterId: Principal.fromText(canisterId),
  })
}

// Async because a local replica requires fetchRootKey before the first call.
export async function getWorkspaceCanisterClient(): Promise<WorkspaceCanisterClient | null> {
  const canisterId = process.env.ICP_WORKSPACE_CANISTER_ID
  if (!canisterId) return null
  if (!defaultClient) {
    const host = process.env.ICP_HOST || DEFAULT_ICP_HOST
    defaultClient = createWorkspaceCanisterClient(await buildActor(canisterId, host), canisterId)
  }
  return defaultClient
}

// Returns null when no canister backend is configured — the workspace then
// stays PENDING_DEPLOY, which is the honest state. When the env var IS set
// this throws rather than pretending (fail-loud, see module header).
export async function deployWorkspace(args: WorkspaceDeployArgs): Promise<WorkspaceDeployResult | null> {
  const client = await getWorkspaceCanisterClient()
  if (!client) return null
  return client.deployWorkspace(args)
}
