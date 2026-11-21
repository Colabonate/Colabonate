//! Candid-facing data types. See docs/decisions/311-workspace-execution-icp-canisters.md D2/D3/D5.

use candid::CandidType;
use ic_stable_structures::storable::{Bound, Storable};
use serde::Deserialize;
use std::borrow::Cow;

/// Workspace lifecycle (ADR-311 D2). Mirrors the server-side
/// `WorkspaceStatusSchema` in `apps/server/lib/enums.ts` exactly — the server
/// row and the canister state are two views of the same state machine, with
/// the canister owning the RUNNING/SUSPENDED transitions (budget-driven) and
/// the server owning creation, completion, and TTL expiry.
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceState {
    PendingDeploy,
    Running,
    Suspended,
    Completed,
    Expired,
}

/// A single agent output (ADR-311 D4). `signature` is the BIP-340
/// execution-proof over the canonical `sig::output_message` payload, produced
/// by the canister-held key (`get_output_pubkey`) when the output is recorded
/// via `record_output` (FU-434 Slice A) — always `Some` for any output the
/// canister itself recorded; `None` remains encodable for forward
/// compatibility only.
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceOutput {
    /// Free-form kind discriminator, e.g. "text" | "file" | "chat-log".
    pub output_type: String,
    /// Content reference — canister-internal path or external URL.
    pub uri: String,
    /// JSON metadata bag (mime type, size, source tool call, ...).
    pub metadata: String,
    pub signature: Option<Vec<u8>>,
    pub created_at: u64,
    /// ADR-322 D5: running SHA-256 hash-chain link — `chain_link(prev_hash,
    /// sig::output_message(...))`, where `prev_hash` is the previous output's
    /// `chain_hash` or `audit_chain::genesis_hash(external_id)` for the first
    /// output. Tamper-evident: `lib.rs::verify_audit_chain` recomputes this
    /// from `output_type`/`uri`/`metadata`/`created_at` and flags any
    /// mismatch. Always 32 bytes for any output this canister recorded.
    pub chain_hash: Vec<u8>,
}

/// One-time injected workspace configuration (FU-434 Slice B / FU-353).
/// The owner seals this JSON client-side to the canister's pubkey (NIP-44
/// v2); the server relays the ciphertext and never sees the plaintext. The
/// canister decrypts once, validates, and stores the parsed struct.
///
/// Custody note: the decrypted config — including `llm_api_key` — lives in
/// canister stable memory from that point on. That is exactly the ADR-306
/// trade-off (the Colabonate server never sees the key), not an oversight.
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceConfig {
    /// Known set enforced at injection: "openai" | "anthropic" | "ollama".
    pub llm_provider: String,
    pub llm_model: String,
    pub llm_api_key: String,
    pub llm_base_url: Option<String>,
    pub system_prompt: Option<String>,
    /// Tool allowlist the harness (Slice C) restricts itself to.
    pub tools: Vec<String>,
}

#[derive(CandidType, Deserialize, Debug, Clone)]
pub struct Workspace {
    pub id: u64,
    /// Correlation id handed in by the Colabonate server — the `Workspace.id`
    /// (cuid) of the server-side lifecycle row (ADR-311 D5). The canister does
    /// not interpret it, only stores and echoes it.
    pub external_id: String,
    pub buyer_pubkey: String,
    pub agent_profile_id: String,
    pub state: WorkspaceState,
    /// Total cycle budget the buyer has paid for (D3). Topped up via
    /// `add_cycles` after the server confirms the LN reload payment.
    pub cycle_budget: u128,
    /// Cycles consumed by agent activity so far (D3), recorded by the harness
    /// via `record_cycle_usage`. `cycles_used >= cycle_budget` suspends the
    /// workspace.
    pub cycles_used: u128,
    /// Retention window after completion (from `Offer.agentWorkspaceTTL`).
    pub ttl_seconds: u64,
    pub created_at: u64,
    pub activated_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub outputs: Vec<WorkspaceOutput>,
    /// Injected exactly once via `inject_config` (FU-434 Slice B); `None`
    /// until then. Consumed by the harness (Slice C).
    pub config: Option<WorkspaceConfig>,
    /// Replay guard for buyer-signed actions (FU-434 Slice C): the timestamp
    /// of the last accepted signed call; every new one must be strictly
    /// greater. Doubles as the action ordering.
    pub last_buyer_action_at: Option<u64>,
    /// Tool calls parked behind an approval gate (`!`-prefixed allowlist
    /// entries) until the buyer signs `approve_tool_call`.
    pub pending_tool_calls: Vec<PendingToolCall>,
    pub next_approval_id: u64,
    /// ADR-321 D1/D2: embedded chat/tool-output chunks, indexed automatically
    /// as they're recorded. Brute-force-scanned by `search_context` and the
    /// D3 RAG retrieval inside `post_message` — see the module doc comment
    /// on `vector_store.rs` for why this is an exact scan, not HNSW.
    pub context_index: Vec<IndexedChunk>,
    /// ADR-312 D6: "ONE_TIME" | "PER_HOUR" | "PER_TOKEN" | "SUBSCRIPTION",
    /// set once at `create_workspace` (validated by
    /// `billing::validate_billing_model`) and never changed afterward — a
    /// billing-model switch mid-workspace is out of scope. Only "PER_TOKEN"
    /// changes `post_message`'s cycle-booking behavior today (see `lib.rs`);
    /// the others keep booking the real outcall infra cost, unchanged.
    pub billing_model: String,
    /// FU-589 (ADR-349 D1): invited WorkspaceMember pubkeys authorized for
    /// buyer-direct actions (post_message/call_tool/approve_tool_call), in
    /// addition to `buyer_pubkey`. Full parity by explicit product decision
    /// (2026-08-30) — an invited collaborator is a second, equally-trusted
    /// actor, not a restricted one; there is no separate "read-only" set here
    /// because the server already gates read access independently
    /// (`workspaces.ts`). Maintained via `add_authorized_signer`/
    /// `remove_authorized_signer`, server-gated and idempotent, mirroring
    /// every other server-relayed fact this canister holds.
    pub authorized_signers: Vec<String>,
}

/// One embedded chunk of workspace context (ADR-321 D1/D2). Not exposed over
/// candid directly — `search_context` returns the derived `ContextSearchResult`
/// instead, which never puts the raw embedding vector on the wire (nobody
/// needs it outside the canister, and it would bloat every response).
#[derive(CandidType, Deserialize, Debug, Clone)]
pub struct IndexedChunk {
    pub content: String,
    pub embedding: Vec<f32>,
    /// Free-form provenance tag, e.g. "chat:user" | "chat:assistant" | "tool".
    pub source: String,
    pub created_at: u64,
}

/// `search_context` result row (ADR-321 D3): the matched chunk's content plus
/// its similarity score, never the raw embedding.
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq)]
pub struct ContextSearchResult {
    pub content: String,
    pub source: String,
    pub score: f64,
    pub created_at: u64,
}

/// A tool call parked behind the buyer-approval gate (FU-434 Slice C).
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct PendingToolCall {
    pub id: u64,
    pub url: String,
    pub body: Option<String>,
    pub parked_at: u64,
}

/// `call_tool` result: either the tool executed immediately and produced a
/// signed output, or the tool is approval-gated and the call parked — the
/// buyer then executes it via `approve_tool_call` with the returned id.
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum ToolCallOutcome {
    Executed(WorkspaceOutput),
    PendingApproval(u64),
}

/// Candid-facing redacted view of `Workspace` for the open `get_workspace`
/// query. Identical field-for-field EXCEPT `config`, which collapses to
/// `has_config`: the decrypted config contains the owner's LLM API key in
/// plaintext, and the query surface is callable by anyone — serializing it
/// out would hand the key to any replica/mainnet caller (FU-195-C discipline;
/// the key never leaving the canister is exactly the ADR-306 trade-off).
/// The internal `Workspace` is unchanged; the mapping lives in `From`.
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceView {
    pub id: u64,
    pub external_id: String,
    pub buyer_pubkey: String,
    pub agent_profile_id: String,
    pub state: WorkspaceState,
    pub cycle_budget: u128,
    pub cycles_used: u128,
    pub ttl_seconds: u64,
    pub created_at: u64,
    pub activated_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub expires_at: Option<u64>,
    pub outputs: Vec<WorkspaceOutput>,
    /// `true` once a config has been injected — the only thing the query
    /// surface ever reveals about `config`.
    pub has_config: bool,
    pub last_buyer_action_at: Option<u64>,
    pub pending_tool_calls: Vec<PendingToolCall>,
    pub next_approval_id: u64,
    /// ADR-312 D6 — see `Workspace.billing_model`. Non-secret, safe on the
    /// open query surface (unlike `config`).
    pub billing_model: String,
    /// FU-589 — see `Workspace.authorized_signers`. Pubkeys aren't secret,
    /// safe on the open query surface (same reasoning as `buyer_pubkey`).
    pub authorized_signers: Vec<String>,
}

impl From<&Workspace> for WorkspaceView {
    fn from(w: &Workspace) -> Self {
        WorkspaceView {
            id: w.id,
            external_id: w.external_id.clone(),
            buyer_pubkey: w.buyer_pubkey.clone(),
            agent_profile_id: w.agent_profile_id.clone(),
            state: w.state.clone(),
            cycle_budget: w.cycle_budget,
            cycles_used: w.cycles_used,
            ttl_seconds: w.ttl_seconds,
            created_at: w.created_at,
            activated_at: w.activated_at,
            completed_at: w.completed_at,
            expires_at: w.expires_at,
            outputs: w.outputs.clone(),
            has_config: w.config.is_some(),
            last_buyer_action_at: w.last_buyer_action_at,
            pending_tool_calls: w.pending_tool_calls.clone(),
            next_approval_id: w.next_approval_id,
            billing_model: w.billing_model.clone(),
            authorized_signers: w.authorized_signers.clone(),
        }
    }
}


/// Stored in `ic-stable-structures::StableBTreeMap` so workspaces survive
/// canister upgrades — same reasoning as the escrow canister's FU-254-I:
/// heap-only state is acceptable for a first skeleton, not for anything that
/// meters real money (cycle budgets here, UTXOs there). Encoding reuses the
/// Candid derive rather than inventing a second wire format; `Vec<WorkspaceOutput>`
/// is unbounded, so `Bound::Unbounded` is the correct choice.
impl Storable for Workspace {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(candid::encode_one(self).expect("Workspace must always be Candid-encodable"))
    }

    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).expect("stable memory must only ever contain Workspace-encoded bytes")
    }

    fn into_bytes(self) -> Vec<u8> {
        candid::encode_one(&self).expect("Workspace must always be Candid-encodable")
    }

    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Debug, Clone, PartialEq)]
pub struct CreateWorkspaceArgs {
    pub external_id: String,
    pub buyer_pubkey: String,
    pub agent_profile_id: String,
    pub cycle_budget: u128,
    pub ttl_seconds: u64,
    /// ADR-312 D6 — see `Workspace.billing_model`. Validated at creation via
    /// `billing::validate_billing_model`.
    pub billing_model: String,
}

/// D5 `checkWorkspaceStatus` response: state plus the budget numbers a buyer
/// (or the relaying server) needs to decide on a cycle reload.
#[derive(CandidType, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceStatus {
    pub state: WorkspaceState,
    pub cycle_budget: u128,
    pub cycles_used: u128,
    pub remaining_cycles: u128,
}

#[derive(CandidType, Deserialize, Debug, Clone, PartialEq)]
pub enum WorkspaceError {
    NotFound,
    InvalidTransition { from: WorkspaceState, action: String },
    /// `expire_workspace` called before the retention window elapsed.
    NotExpired { expires_at: u64, now: u64 },
    /// `destroy_workspace` called on a workspace that isn't `Expired` yet.
    NotDestroyable { state: WorkspaceState },
    /// Caller is not the authorized server principal (FU-434 Slice A). The
    /// text-encoded principal the canister was initialized with, so an
    /// operator can tell a misconfigured server from an intruder.
    Unauthorized { expected: String },
    /// `inject_config` called on a workspace that already has a config —
    /// injection is one-time by design (FU-434 Slice B).
    ConfigAlreadyInjected,
    /// The canister-held signing key could not be obtained (raw_rand rejected
    /// or returned an invalid secp256k1 scalar). Transient by nature — the
    /// caller may retry.
    SigningFailed { reason: String },
    /// Creation args failed validation (empty id/pubkey, zero TTL).
    InvalidArgs { reason: String },
    /// Buyer-signed action (FU-434 Slice C) whose BIP-340 signature does not
    /// verify against the workspace's `buyer_pubkey`. The reason names the
    /// failed check, never key material (FU-195-C).
    SignatureVerificationFailed { reason: String },
    /// Buyer-signed action whose timestamp is not strictly greater than the
    /// last accepted one (replay / stale), or too far in the future.
    ReplayRejected { reason: String },
    /// A harness action (chat, tool call) needs the injected config, but none
    /// was injected yet (FU-434 Slice B).
    ConfigNotInjected,
    /// `call_tool` with a URL no `config.tools` allowlist entry covers.
    ToolNotAllowed { url: String },
    /// `approve_tool_call` with an approval id that isn't parked.
    ApprovalNotFound { id: u64 },
    /// The HTTPS outcall itself failed (rejected by the subnet/IC, e.g. local
    /// replica without outcall support). Transport-level; no response existed.
    OutcallFailed { reason: String },
    /// The provider/tool endpoint answered, but with a non-2xx status or an
    /// unparseable body. The reason carries the status code, never the
    /// response body (it can echo request data — FU-195-C discipline).
    ProviderError { reason: String },
    /// Feature is designed (ADR-311) but not yet implemented — names the
    /// follow-up that closes it.
    NotImplemented { pending_followup: String },
}
