//! ICP workspace canister — the runtime half of ADR-311 (Workspace Execution
//! on ICP Canisters). First slice of FU-431: lifecycle state machine, cycle
//! budget accounting, stable-memory persistence, and the full D5 Candid
//! surface the Colabonate server calls via `@dfinity/agent` (FU-432).
//! FU-434 Slice A adds caller authorization (server-principal gate) and
//! BIP-340 execution-proof signing of outputs (`sig.rs`); Slice B adds the
//! one-time encrypted config-injection channel (`nip44.rs`, FU-353).
//!
//! Authorization model (Slice A): every state-changing method except the
//! time-gated `expire_workspace` requires `caller == server_principal`, the
//! Colabonate backend principal handed in as an init argument
//! (`dfx deploy --argument '(principal "...")'`). Queries stay open. This
//! covers the server-relayed flows only — buyer-signature authorization for
//! buyer-direct actions (chat, ADR-311 D5) comes with the harness slice
//! (FU-434 Slice C), same BIP-340 pattern the escrow canister's FU-254-E
//! established.
//!
//! Config injection (Slice B / FU-353): the owner seals their
//! `WorkspaceConfig` JSON client-side to the canister's pubkey
//! (`ensure_output_key`), the server relays the ciphertext via
//! `inject_config` and never sees the plaintext (ADR-306: the LLM API key
//! belongs to the canister, not the server). One keypair, two uses — the
//! Slice A BIP-340 signing key doubles as the NIP-44 ECDH target; one secret
//! to protect, one pubkey to publish. Injection is one-time per workspace.
//!
//! Harness (Slice C): the canister itself is the harness. Buyer-direct chat
//! (`post_message`) and tool calls (`call_tool`/`approve_tool_call`) are
//! authorized by the buyer's BIP-340 signature against
//! `Workspace.buyer_pubkey` over a timestamped canonical message — the
//! caller is anonymous, the signature IS the authorization (escrow FU-254-E
//! pattern), with a monotonic-timestamp replay guard because these actions
//! are repeatable (unlike the escrow's one-shot ones). LLM and tool calls
//! are HTTPS outcalls to the injected config; every executed call books its
//! outcall cycle cost into the workspace budget (D3 metering, auto-suspend
//! included). Tools are allowlisted REST prefixes; `!`-marked entries park
//! as pending approvals until the buyer signs.
//!
//! What this crate deliberately does NOT do yet (owning follow-up in parens):
//! - multi-turn LLM history (outputs are recorded but not fed back) and
//!   provider tool-calling loops — the LLM client is single-turn; tool
//!   execution is buyer-initiated.
//! - the ADR-311 D6 tool names read_file/write_file/execute_command — no
//!   filesystem/shell exists in a canister; REST outcalls only.
//! - Nostr presence publishing (ADR-311 D7, FU-395).
//!
//! State lives in `ic-stable-structures` from day one (the escrow canister's
//! FU-254-I lesson: heap-only state is lost on every upgrade, which is not
//! acceptable once real cycle budgets are metered). `MemoryId::new(0..=3)`
//! are permanent, upgrade-stable slot assignments — never renumber, only
//! append: 0 = workspaces, 1 = next id, 2 = server principal, 3 = signing key.
//!
//! Deployment topology note (ADR-311 rejected-alternative A2): storage is
//! keyed by workspace id, so the same wasm serves both a shared multi-workspace
//! deployment and a dedicated per-workspace instance (the isolation choice) —
//! the topology is a deployment decision, not a code difference.

mod audit_chain;
mod billing;
mod embedder;
mod harness;
mod lifecycle;
mod llm;
mod nip44;
mod sig;
mod types;
mod vector_store;

use bitcoin::secp256k1::SecretKey;
use candid::Principal;
use ic_cdk_management_canister::{
    HttpHeader, HttpMethod, HttpRequestArgs, HttpRequestResult, TransformArgs, TransformContext, TransformFunc,
    cost_http_request, http_request, raw_rand,
};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell};
use std::cell::RefCell;

pub use types::{
    ContextSearchResult, CreateWorkspaceArgs, IndexedChunk, PendingToolCall, ToolCallOutcome, Workspace, WorkspaceConfig,
    WorkspaceError, WorkspaceOutput, WorkspaceState, WorkspaceStatus, WorkspaceView,
};

type Memory = VirtualMemory<DefaultMemoryImpl>;

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static WORKSPACES: RefCell<StableBTreeMap<u64, Workspace, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))))
    );

    static NEXT_WORKSPACE_ID: RefCell<StableCell<u64, Memory>> = RefCell::new(
        StableCell::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1))), 0)
    );

    /// The Colabonate backend principal, set once via the init argument
    /// (FU-434 Slice A). Default is the anonymous principal, which fails
    /// closed in the wrong direction only if a deployment somehow skipped
    /// `init` (dfx refuses that: the init arg is mandatory).
    static SERVER_PRINCIPAL: RefCell<StableCell<Principal, Memory>> = RefCell::new(
        StableCell::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(2))), Principal::anonymous())
    );

    /// Canister-held secp256k1 signing key (32-byte secret scalar), generated
    /// lazily from `raw_rand` on the first `record_output` call. Custody note:
    /// the private key lives in stable memory and never leaves the canister;
    /// threshold-Schnorr (chain-key) migration is a possible later hardening.
    static SIGNING_KEY: RefCell<StableCell<Option<[u8; 32]>, Memory>> = RefCell::new(
        StableCell::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(3))), None)
    );
}

#[ic_cdk::init]
fn init(server_principal: Principal) {
    SERVER_PRINCIPAL.with(|p| p.borrow_mut().set(server_principal));
}

/// Server-principal gate (FU-434 Slice A). Pure function of the two
/// principals so plain `cargo test` covers the guard logic — `msg_caller`
/// can't be mocked without the IC runtime.
fn require_server(caller: Principal, server: Principal) -> Result<(), WorkspaceError> {
    if caller == server {
        Ok(())
    } else {
        Err(WorkspaceError::Unauthorized {
            expected: server.to_text(),
        })
    }
}

/// Reads the configured server principal and checks the caller against it.
fn require_server_caller() -> Result<(), WorkspaceError> {
    let server = SERVER_PRINCIPAL.with(|p| *p.borrow().get());
    require_server(ic_cdk::api::msg_caller(), server)
}

/// Returns the canister-held signing key, generating and persisting it from
/// `raw_rand` on first use. A random 32-byte string is an invalid secp256k1
/// secret only if it is zero or >= the curve order (~2^-128 chance); we reject
/// honestly via `SigningFailed` rather than loop on the entropy source.
async fn signing_key() -> Result<SecretKey, WorkspaceError> {
    if let Some(seed) = SIGNING_KEY.with(|k| *k.borrow().get()) {
        // The seed was validated as a SecretKey before being stored.
        return SecretKey::from_slice(&seed).map_err(|e| WorkspaceError::SigningFailed {
            reason: format!("stored signing key is invalid: {e}"),
        });
    }
    let rand = raw_rand().await.map_err(|e| WorkspaceError::SigningFailed {
        reason: format!("raw_rand call failed: {e}"),
    })?;
    // Another `record_output` call may have populated the cell while this one
    // awaited raw_rand — prefer the already-stored key so the pubkey never
    // silently rotates.
    if let Some(seed) = SIGNING_KEY.with(|k| *k.borrow().get()) {
        return SecretKey::from_slice(&seed).map_err(|e| WorkspaceError::SigningFailed {
            reason: format!("stored signing key is invalid: {e}"),
        });
    }
    let seed: [u8; 32] = rand.as_slice().try_into().map_err(|_| WorkspaceError::SigningFailed {
        reason: format!("raw_rand returned {} bytes, expected 32", rand.len()),
    })?;
    let key = SecretKey::from_slice(&seed).map_err(|e| WorkspaceError::SigningFailed {
        reason: format!("raw_rand seed is not a valid secp256k1 secret: {e}"),
    })?;
    SIGNING_KEY.with(|k| {
        k.borrow_mut().set(Some(seed));
    });
    Ok(key)
}

fn with_workspace<R>(id: u64, f: impl FnOnce(&Workspace) -> Result<R, WorkspaceError>) -> Result<R, WorkspaceError> {
    WORKSPACES.with(|w| {
        let workspace = w.borrow().get(&id).ok_or(WorkspaceError::NotFound)?;
        f(&workspace)
    })
}

/// Reads, mutates, and writes back a workspace in one step — the
/// `StableBTreeMap` equivalent of a `get_mut` (stable structures deserialize
/// on read, so every change is an explicit `insert` of the whole value).
fn update_workspace(id: u64, f: impl FnOnce(&mut Workspace)) {
    WORKSPACES.with(|w| {
        let mut workspaces = w.borrow_mut();
        if let Some(mut workspace) = workspaces.get(&id) {
            f(&mut workspace);
            workspaces.insert(id, workspace);
        }
    });
}

fn status_of(workspace: &Workspace) -> WorkspaceStatus {
    WorkspaceStatus {
        state: workspace.state.clone(),
        cycle_budget: workspace.cycle_budget,
        cycles_used: workspace.cycles_used,
        remaining_cycles: billing::remaining_cycles(workspace.cycle_budget, workspace.cycles_used),
    }
}

/// Server-relayed workspace creation (ADR-311 D2/D5): the Colabonate backend
/// calls this after the buyer's AGENT_SETUP ticket is paid. Creates the
/// workspace in `PendingDeploy` — it only flips to `Running` via
/// `start_workspace` once deployment has actually finished.
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
fn create_workspace(args: CreateWorkspaceArgs) -> Result<u64, WorkspaceError> {
    require_server_caller()?;
    if args.external_id.trim().is_empty()
        || args.buyer_pubkey.trim().is_empty()
        || args.agent_profile_id.trim().is_empty()
    {
        return Err(WorkspaceError::InvalidArgs {
            reason: "external_id, buyer_pubkey and agent_profile_id must be non-empty".to_string(),
        });
    }
    if args.ttl_seconds == 0 {
        return Err(WorkspaceError::InvalidArgs {
            reason: "ttl_seconds must be positive".to_string(),
        });
    }
    billing::validate_billing_model(&args.billing_model)?;

    let id = NEXT_WORKSPACE_ID.with(|n| {
        let mut n = n.borrow_mut();
        let id = *n.get();
        n.set(id + 1);
        id
    });
    let workspace = Workspace {
        id,
        external_id: args.external_id,
        buyer_pubkey: args.buyer_pubkey,
        agent_profile_id: args.agent_profile_id,
        state: WorkspaceState::PendingDeploy,
        cycle_budget: args.cycle_budget,
        cycles_used: 0,
        ttl_seconds: args.ttl_seconds,
        created_at: ic_cdk::api::time(),
        activated_at: None,
        completed_at: None,
        expires_at: None,
        outputs: Vec::new(),
        config: None,
        last_buyer_action_at: None,
        pending_tool_calls: Vec::new(),
        next_approval_id: 0,
        context_index: Vec::new(),
        billing_model: args.billing_model,
        authorized_signers: Vec::new(),
    };
    WORKSPACES.with(|w| w.borrow_mut().insert(id, workspace));
    Ok(id)
}

/// Open query, so it returns the redacted `WorkspaceView`: the injected
/// config (with the owner's plaintext LLM API key) never leaves the canister
/// over the query surface — callers get `has_config` instead (FU-195-C).
#[ic_cdk::query]
fn get_workspace(workspace_id: u64) -> Option<WorkspaceView> {
    WORKSPACES.with(|w| w.borrow().get(&workspace_id)).map(|w| WorkspaceView::from(&w))
}

/// D5 `checkWorkspaceStatus` — state plus budget numbers, cheap enough to poll.
#[ic_cdk::query]
fn check_workspace_status(workspace_id: u64) -> Result<WorkspaceStatus, WorkspaceError> {
    with_workspace(workspace_id, |w| Ok(status_of(w)))
}

/// Deployment-finished hook: `PendingDeploy -> Running`. In the final
/// architecture (ADR-311 D7) the canister starts itself and publishes
/// presence; for the current server-relayed deployment this is the explicit
/// flip the server (FU-432) or an operator calls after deploy.
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
fn start_workspace(workspace_id: u64) -> Result<WorkspaceState, WorkspaceError> {
    require_server_caller()?;
    let new_state = with_workspace(workspace_id, |w| lifecycle::transition_on_start(&w.state))?;
    update_workspace(workspace_id, |w| {
        w.state = new_state.clone();
        w.activated_at = Some(ic_cdk::api::time());
    });
    Ok(new_state)
}

/// D3/D5 `addCycles` — server-relayed after the buyer's LN reload payment is
/// confirmed. Tops up the budget; resumes a suspended workspace iff the new
/// budget covers what's already consumed.
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
fn add_cycles(workspace_id: u64, amount: u128) -> Result<WorkspaceStatus, WorkspaceError> {
    require_server_caller()?;
    let (new_budget, new_state) = with_workspace(workspace_id, |w| {
        billing::apply_topup(&w.state, w.cycle_budget, w.cycles_used, amount)
    })?;
    update_workspace(workspace_id, |w| {
        w.cycle_budget = new_budget;
        w.state = new_state;
    });
    with_workspace(workspace_id, |w| Ok(status_of(w)))
}

/// FU-589 (ADR-349 D1): authorizes an additional signer — an invited
/// WorkspaceMember — for buyer-direct actions, full parity with the buyer's
/// own key (explicit product decision, 2026-08-30: an invited collaborator
/// is a second, equally-trusted actor, not a restricted one). Server-gated
/// and idempotent, mirroring `add_cycles`/`complete_workspace`: the server
/// calls this right after committing the `WorkspaceMember` row in Postgres
/// (`POST /:id/members`), the canister mirrors the fact.
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
fn add_authorized_signer(workspace_id: u64, pubkey: String) -> Result<(), WorkspaceError> {
    require_server_caller()?;
    if pubkey.trim().is_empty() {
        return Err(WorkspaceError::InvalidArgs {
            reason: "pubkey must be non-empty".to_string(),
        });
    }
    with_workspace(workspace_id, |_| Ok(()))?;
    update_workspace(workspace_id, |w| {
        if w.buyer_pubkey != pubkey && !w.authorized_signers.contains(&pubkey) {
            w.authorized_signers.push(pubkey);
        }
    });
    Ok(())
}

/// FU-589: revokes a previously-authorized signer. Idempotent — removing a
/// pubkey that isn't currently authorized (e.g. a retried relay after an
/// earlier `add_authorized_signer` call never reached the canister) is a
/// no-op success, not an error, same "canister mirrors, server is
/// authoritative" precedent as every other relay in this file.
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
fn remove_authorized_signer(workspace_id: u64, pubkey: String) -> Result<(), WorkspaceError> {
    require_server_caller()?;
    with_workspace(workspace_id, |_| Ok(()))?;
    update_workspace(workspace_id, |w| {
        w.authorized_signers.retain(|pk| pk != &pubkey);
    });
    Ok(())
}

/// D3 metering entry point — the agent harness (FU-434) records consumption
/// here after every metered action. Reaching or exceeding the budget suspends
/// the workspace (`Running -> Suspended`).
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
fn record_cycle_usage(workspace_id: u64, amount: u128) -> Result<WorkspaceStatus, WorkspaceError> {
    require_server_caller()?;
    let (new_used, new_state) = with_workspace(workspace_id, |w| {
        billing::apply_usage(&w.state, w.cycle_budget, w.cycles_used, amount)
    })?;
    update_workspace(workspace_id, |w| {
        w.cycles_used = new_used;
        w.state = new_state;
    });
    with_workspace(workspace_id, |w| Ok(status_of(w)))
}

/// Buyer-confirmed completion (ADR-311 D2): `Running|Suspended -> Completed`,
/// stamps `completed_at` and the retention deadline
/// (`expires_at = now + ttl_seconds`). Outputs stay readable until expiry.
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
fn complete_workspace(workspace_id: u64) -> Result<WorkspaceState, WorkspaceError> {
    require_server_caller()?;
    let new_state = with_workspace(workspace_id, |w| lifecycle::transition_on_complete(&w.state))?;
    let now = ic_cdk::api::time();
    update_workspace(workspace_id, |w| {
        w.state = new_state.clone();
        w.completed_at = Some(now);
        w.expires_at = Some(now + w.ttl_seconds.saturating_mul(1_000_000_000));
    });
    Ok(new_state)
}

/// Permissionless expiry after the retention window — `Completed -> Expired`.
/// The time check is the whole guard (same pattern as the escrow canister's
/// `claim_timeout_refund`).
#[ic_cdk::update]
fn expire_workspace(workspace_id: u64) -> Result<WorkspaceState, WorkspaceError> {
    let new_state = with_workspace(workspace_id, |w| {
        lifecycle::transition_on_expire(&w.state, w.expires_at, ic_cdk::api::time())
    })?;
    update_workspace(workspace_id, |w| {
        w.state = new_state.clone();
    });
    Ok(new_state)
}

/// D5 `destroyWorkspace` — only legal from `Expired`: outputs must outlive
/// their retention window before the workspace record is removed.
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
fn destroy_workspace(workspace_id: u64) -> Result<(), WorkspaceError> {
    require_server_caller()?;
    with_workspace(workspace_id, |w| {
        if matches!(w.state, WorkspaceState::Expired) {
            Ok(())
        } else {
            Err(WorkspaceError::NotDestroyable {
                state: w.state.clone(),
            })
        }
    })?;
    WORKSPACES.with(|w| w.borrow_mut().remove(&workspace_id));
    Ok(())
}

/// Shared output-recording core (Slice A `record_output`, Slice C harness):
/// stamps `created_at`, signs the canonical payload with the canister key,
/// links it into the workspace's audit hash-chain (ADR-322 D5), appends to
/// the workspace. Callers validate state first.
async fn record_signed_output(
    workspace_id: u64,
    output_type: String,
    uri: String,
    metadata: String,
) -> Result<WorkspaceOutput, WorkspaceError> {
    let created_at = ic_cdk::api::time();
    let key = signing_key().await?;
    let signature = sig::sign_output(&key, workspace_id, created_at, &output_type, &uri, &metadata);
    let event_bytes = sig::output_message(workspace_id, created_at, &output_type, &uri, &metadata);
    // Read the chain head as late as possible (right before the push below,
    // no further await in between) to keep the read-then-append window as
    // tight as this single-threaded-per-call runtime allows — same
    // acknowledged-by-design posture as the escrow CAS race (F-D4-02).
    let prev_hash = with_workspace(workspace_id, |w| {
        Ok(w.outputs.last().map(|o| o.chain_hash.clone()).unwrap_or_else(|| audit_chain::genesis_hash(&w.external_id)))
    })?;
    let chain_hash = audit_chain::chain_link(&prev_hash, event_bytes.as_bytes());
    let output = WorkspaceOutput {
        output_type,
        uri,
        metadata,
        signature: Some(signature),
        created_at,
        chain_hash,
    };
    update_workspace(workspace_id, |w| w.outputs.push(output.clone()));
    Ok(output)
}

/// ADR-322 D5: recomputes the audit hash-chain from `w.outputs` and confirms
/// every stored `chain_hash` matches — the "provable by anyone" half of D5's
/// promise. Pure recomputation over already-stored fields (no signing, no
/// outcall), so this is a `query`, not an `update`. Any external verifier
/// (future audit-trail UI — FU-380/FU-465) can run the identical
/// recomputation itself from `get_outputs`; this entry point just saves them
/// re-implementing `audit_chain::chain_link` client-side.
#[ic_cdk::query]
fn verify_audit_chain(workspace_id: u64) -> Result<bool, WorkspaceError> {
    with_workspace(workspace_id, |w| {
        let mut prev = audit_chain::genesis_hash(&w.external_id);
        for output in &w.outputs {
            let event_bytes = sig::output_message(workspace_id, output.created_at, &output.output_type, &output.uri, &output.metadata);
            let expected = audit_chain::chain_link(&prev, event_bytes.as_bytes());
            if expected != output.chain_hash {
                return Ok(false);
            }
            prev = expected;
        }
        Ok(true)
    })
}

/// Books `amount` cycles of consumption into the workspace budget (D3), the
/// same accounting `record_cycle_usage` exposes to the server — reaching the
/// budget auto-suspends. Only legal from `Running`; callers re-check state
/// after outcall awaits, so a mid-call completion surfaces as
/// `InvalidTransition` rather than silently unmetered work.
fn book_cycles(workspace_id: u64, amount: u128) -> Result<(), WorkspaceError> {
    let (new_used, new_state) = with_workspace(workspace_id, |w| {
        billing::apply_usage(&w.state, w.cycle_budget, w.cycles_used, amount)
    })?;
    update_workspace(workspace_id, |w| {
        w.cycles_used = new_used;
        w.state = new_state;
    });
    Ok(())
}

/// One HTTPS outcall through the management canister. Returns the response
/// plus the cycle cost that was attached (the amount booked into the
/// workspace budget on success — the exact cost computed by
/// `cost_http_request`; any refund difference is deliberately ignored, which
/// makes the metering conservative, never under-counting).
async fn https_outcall(
    url: String,
    method: HttpMethod,
    headers: Vec<(String, String)>,
    body: Option<Vec<u8>>,
) -> Result<(HttpRequestResult, u128), WorkspaceError> {
    let args = HttpRequestArgs {
        url,
        // 64 KiB caps both the cost and what a hostile/compromised endpoint
        // can push into canister memory per call.
        max_response_bytes: Some(64 * 1024),
        method,
        headers: headers.into_iter().map(|(name, value)| HttpHeader { name, value }).collect(),
        body,
        // Consensus safety: strip response headers (they differ across
        // replicas); status + body are what the callers parse.
        transform: Some(TransformContext {
            function: TransformFunc(candid::Func {
                principal: ic_cdk::api::canister_self(),
                method: "transform_response".to_string(),
            }),
            context: Vec::new(),
        }),
        is_replicated: None,
    };
    let cost = cost_http_request(&args);
    let result = http_request(&args).await.map_err(|e| WorkspaceError::OutcallFailed {
        reason: format!("http_request rejected: {e}"),
    })?;
    Ok((result, cost))
}

/// Transform for HTTPS outcalls: drops headers so all replicas agree on the
/// transformed response (headers like timestamps differ per replica).
#[ic_cdk::query]
fn transform_response(args: TransformArgs) -> HttpRequestResult {
    let mut response = args.response;
    response.headers = Vec::new();
    response
}

/// D4/D5 output recording with an execution proof (FU-434 Slice A): only
/// legal while the workspace is `Running`. The canister signs the canonical
/// `sig::output_message` payload with its own key (lazily generated on first
/// use) and stores the 64-byte BIP-340 signature on the output — verifiable
/// externally against `get_output_pubkey`. Content honesty note: the canister
/// attests *that it recorded* this output at `created_at`, not that an LLM
/// produced the bytes behind `uri` — the harness (Slice C) supplies them.
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
async fn record_output(
    workspace_id: u64,
    output_type: String,
    uri: String,
    metadata: String,
) -> Result<WorkspaceOutput, WorkspaceError> {
    require_server_caller()?;
    with_workspace(workspace_id, |w| {
        if matches!(w.state, WorkspaceState::Running) {
            Ok(())
        } else {
            Err(WorkspaceError::InvalidTransition {
                from: w.state.clone(),
                action: "record_output".to_string(),
            })
        }
    })?;
    record_signed_output(workspace_id, output_type, uri, metadata).await
}

/// Shared gate for buyer-direct signed actions (FU-434 Slice C): workspace
/// exists and is `Running`, config injected, timestamp fresh (monotonic
/// replay guard), signature valid against `buyer_pubkey`. Advances
/// `last_buyer_action_at` on success — a failed downstream step (outcall
/// error) still consumes the timestamp, so a retried action must be signed
/// anew; that is what keeps captured signatures single-use.
fn authorize_buyer_action(
    workspace_id: u64,
    action: &str,
    timestamp: u64,
    params: &[&str],
    signature: &[u8],
) -> Result<WorkspaceConfig, WorkspaceError> {
    let (candidate_pubkeys, last_action_at, config) = with_workspace(workspace_id, |w| {
        if !matches!(w.state, WorkspaceState::Running) {
            return Err(WorkspaceError::InvalidTransition {
                from: w.state.clone(),
                action: action.to_string(),
            });
        }
        let config = w.config.clone().ok_or(WorkspaceError::ConfigNotInjected)?;
        // FU-589: the buyer plus any invited, full-parity collaborators may
        // all perform buyer-direct actions identically.
        let mut candidates = vec![w.buyer_pubkey.clone()];
        candidates.extend(w.authorized_signers.iter().cloned());
        Ok((candidates, w.last_buyer_action_at, config))
    })?;
    harness::check_fresh_action(timestamp, last_action_at, ic_cdk::api::time())?;
    sig::verify_buyer_action_multi(action, workspace_id, timestamp, params, signature, &candidate_pubkeys)?;
    update_workspace(workspace_id, |w| w.last_buyer_action_at = Some(timestamp));
    Ok(config)
}

/// Embeds `text` via the workspace's configured provider (ADR-321 D1).
/// Returns `None` — never a `WorkspaceError` — on any failure (unsupported
/// provider, outcall rejection, non-2xx, unparseable response): RAG/indexing
/// is best-effort and must never break the primary chat response. On success,
/// books the embedding outcall's cycle cost the same way a chat/tool outcall
/// does.
async fn try_embed(workspace_id: u64, config: &WorkspaceConfig, text: &str) -> Option<Vec<f32>> {
    let spec = embedder::build_embedding_request(config, text).ok()?;
    let (response, cost) = https_outcall(spec.url, HttpMethod::POST, spec.headers, Some(spec.body)).await.ok()?;
    let embedding =
        embedder::parse_embedding_response(&config.llm_provider, nat_to_u64(&response.status), &response.body).ok()?;
    let _ = book_cycles(workspace_id, cost);
    Some(embedding)
}

/// Embeds `content` and appends it to the workspace's context index
/// (ADR-321 D1/D7 — chunk created → automatically indexed). No-op on
/// embedding failure, same graceful-degradation contract as `try_embed`.
async fn try_index_content(workspace_id: u64, config: &WorkspaceConfig, content: &str, source: &str) {
    let Some(embedding) = try_embed(workspace_id, config, content).await else {
        return;
    };
    let chunk = IndexedChunk {
        content: content.to_string(),
        embedding,
        source: source.to_string(),
        created_at: ic_cdk::api::time(),
    };
    update_workspace(workspace_id, |w| w.context_index.push(chunk));
}

/// Embeds `query` and returns the `top_k` most similar chunk texts from the
/// workspace's context index (ADR-321 D3 RAG retrieval). Empty on any
/// embedding failure or an empty index — the caller (`post_message`) treats
/// an empty result exactly like "no context available", not an error.
async fn try_retrieve_context(workspace_id: u64, config: &WorkspaceConfig, query: &str, top_k: usize) -> Vec<String> {
    let Some(query_embedding) = try_embed(workspace_id, config, query).await else {
        return Vec::new();
    };
    with_workspace(workspace_id, |w| {
        Ok(vector_store::top_k(&query_embedding, &w.context_index, top_k)
            .into_iter()
            .map(|scored| scored.chunk.content.clone())
            .collect())
    })
    .unwrap_or_default()
}

/// Buyer-direct chat (FU-434 Slice C): verifies the buyer's signature over
/// `colabonate-workspace-v1:post_message:{id}:{timestamp}:{content}`, records
/// the user message as a signed output, runs a single-turn LLM call against
/// the injected config, records the reply as a signed output, and books the
/// outcall's cycle cost. The caller is anonymous — the signature is the
/// authorization.
///
/// ADR-321 D1/D3 (RAG): before calling the LLM, retrieves the top-5 most
/// similar prior chunks from this workspace's context index and folds them
/// into the request as extra system context (`llm::build_chat_request`);
/// after both the user and assistant turns are recorded, embeds and indexes
/// each of them for future retrieval. Both steps degrade gracefully — an
/// unconfigured/failing embedding provider (e.g. `anthropic`, which has none)
/// never blocks the chat reply itself, it just runs without workspace context.
#[ic_cdk::update]
async fn post_message(
    workspace_id: u64,
    content: String,
    timestamp: u64,
    signature: Vec<u8>,
) -> Result<WorkspaceOutput, WorkspaceError> {
    let config = authorize_buyer_action(workspace_id, "post_message", timestamp, &[&content], &signature)?;

    let context_chunks = try_retrieve_context(workspace_id, &config, &content, 5).await;

    let user_metadata = serde_json::to_string(&serde_json::json!({ "role": "user", "content": content }))
        .expect("chat metadata JSON must always serialize");
    record_signed_output(workspace_id, "chat".to_string(), "inline:chat".to_string(), user_metadata).await?;
    try_index_content(workspace_id, &config, &content, "chat:user").await;

    let spec = llm::build_chat_request(&config, &content, &context_chunks)?;
    let (response, cost) = https_outcall(spec.url, HttpMethod::POST, spec.headers, Some(spec.body)).await?;
    let reply = llm::parse_chat_response(&config.llm_provider, nat_to_u64(&response.status), &response.body)?;

    // ADR-312 D4: PER_TOKEN workspaces book cycles proportional to the LLM's
    // reported token usage instead of the raw outcall infra cost — that is
    // the whole point of the billing model (the buyer pays for what the
    // agent's LLM calls actually cost, not for IC compute). Any other
    // billing model, or a response that didn't report usage (fail-soft, not
    // silently free — falls back to the real infra cost), keeps the
    // pre-ADR-312 behavior unchanged.
    let billing_model = with_workspace(workspace_id, |w| Ok(w.billing_model.clone()))?;
    let billed_cycles = if billing_model == "PER_TOKEN" {
        llm::parse_token_usage(&config.llm_provider, &response.body)
            .map(|usage| billing::token_cost_cycles(usage.total_tokens))
            .unwrap_or(cost)
    } else {
        cost
    };

    // The outcall succeeded — book its cost (auto-suspends at budget).
    book_cycles(workspace_id, billed_cycles)?;

    let reply_metadata = serde_json::to_string(&serde_json::json!({ "role": "assistant", "content": reply }))
        .expect("chat metadata JSON must always serialize");
    let output = record_signed_output(workspace_id, "chat".to_string(), "inline:chat".to_string(), reply_metadata).await?;
    try_index_content(workspace_id, &config, &reply, "chat:assistant").await;
    Ok(output)
}

/// Introspection/debug entry point for the ADR-321 context index — embeds
/// `query` and returns the `top_k` most similar chunks with their similarity
/// score. Server-gated (like `record_output`): the embedding outcall costs
/// cycles, and no buyer-facing UI calls this yet (the RAG retrieval inside
/// `post_message` is automatic and needs no explicit search). Must be an
/// `update`, not a `query` — IC forbids HTTPS outcalls from query calls.
#[ic_cdk::update]
async fn search_context(workspace_id: u64, query: String, top_k: u32) -> Result<Vec<ContextSearchResult>, WorkspaceError> {
    require_server_caller()?;
    let config = with_workspace(workspace_id, |w| w.config.clone().ok_or(WorkspaceError::ConfigNotInjected))?;
    let Some(query_embedding) = try_embed(workspace_id, &config, &query).await else {
        return Ok(Vec::new());
    };
    with_workspace(workspace_id, |w| {
        Ok(vector_store::top_k(&query_embedding, &w.context_index, top_k as usize)
            .into_iter()
            .map(|scored| ContextSearchResult {
                content: scored.chunk.content.clone(),
                source: scored.chunk.source.clone(),
                score: scored.score as f64,
                created_at: scored.chunk.created_at,
            })
            .collect())
    })
}

/// ADR-352 D1 (FU-607): server-gated cross-agent pipeline handoff. When a
/// Cooperation-orchestration step (Offer A) completes and the next step is
/// assigned to a *different* Offer (B), the server carries step A's final
/// output into workspace B's context index directly — bypassing
/// `post_message` entirely, because that method's authorization IS the
/// buyer's own signature over the exact canonical content; the server
/// forging or prepending to that content would invalidate the whole
/// buyer-signing scheme. Indexing straight into `context_index` (the same
/// path `try_index_content` already uses for real chat turns) means the very
/// first real `post_message` in workspace B automatically retrieves this
/// context via the existing D3 RAG lookup — no protocol change needed there.
///
/// Requires config already injected (embedding needs a configured provider,
/// same precondition as `search_context`) — the server only calls this right
/// after a successful `inject_config`, so this is expected to always hold at
/// the real call site, not a corner case being papered over. Best-effort like
/// every other embedding path in this file: an embedding-provider failure is
/// swallowed by `try_index_content`, never surfaced as an error, since a
/// handoff-context miss must never look like a broken workspace.
#[ic_cdk::update]
async fn seed_context(workspace_id: u64, content: String, source: String) -> Result<(), WorkspaceError> {
    require_server_caller()?;
    let config = with_workspace(workspace_id, |w| w.config.clone().ok_or(WorkspaceError::ConfigNotInjected))?;
    try_index_content(workspace_id, &config, &content, &source).await;
    Ok(())
}

/// Buyer-initiated tool call (FU-434 Slice C): allowlisted REST tools only
/// (`config.tools`; `!`-prefixed entries park as pending approvals). Executed
/// calls hit the tool endpoint via HTTPS outcall (POST with `body`, GET
/// without) and record the response body as a signed output.
#[ic_cdk::update]
async fn call_tool(
    workspace_id: u64,
    url: String,
    body: Option<String>,
    timestamp: u64,
    signature: Vec<u8>,
) -> Result<ToolCallOutcome, WorkspaceError> {
    let empty = String::new();
    let config = authorize_buyer_action(workspace_id, "call_tool", timestamp, &[&url, body.as_deref().unwrap_or(&empty)], &signature)?;

    let tool_match = harness::find_tool(&config.tools, &url)?;
    if tool_match.approval_required {
        let id = with_workspace(workspace_id, |w| Ok(w.next_approval_id))?;
        update_workspace(workspace_id, |w| {
            w.pending_tool_calls.push(PendingToolCall {
                id,
                url: url.clone(),
                body: body.clone(),
                parked_at: ic_cdk::api::time(),
            });
            w.next_approval_id = id + 1;
        });
        return Ok(ToolCallOutcome::PendingApproval(id));
    }
    execute_tool(workspace_id, url, body).await.map(ToolCallOutcome::Executed)
}

/// Executes a parked tool call after the buyer signs the approval (FU-434
/// Slice C). The signed message binds to the approval id; the parking itself
/// happened inside an already-signed `call_tool`.
#[ic_cdk::update]
async fn approve_tool_call(
    workspace_id: u64,
    approval_id: u64,
    timestamp: u64,
    signature: Vec<u8>,
) -> Result<WorkspaceOutput, WorkspaceError> {
    let approval_id_str = approval_id.to_string();
    authorize_buyer_action(workspace_id, "approve_tool_call", timestamp, &[&approval_id_str], &signature)?;

    let (url, body) = with_workspace(workspace_id, |w| {
        w.pending_tool_calls
            .iter()
            .find(|p| p.id == approval_id)
            .map(|p| (p.url.clone(), p.body.clone()))
            .ok_or(WorkspaceError::ApprovalNotFound { id: approval_id })
    })?;
    update_workspace(workspace_id, |w| w.pending_tool_calls.retain(|p| p.id != approval_id));
    execute_tool(workspace_id, url, body).await
}

/// Runs an allowlisted REST tool: POST with a body, GET without. The
/// response body (utf-8 lossy) becomes a signed `tool` output; the outcall
/// cost is booked into the workspace budget.
async fn execute_tool(workspace_id: u64, url: String, body: Option<String>) -> Result<WorkspaceOutput, WorkspaceError> {
    let (method, payload) = match &body {
        Some(b) => (HttpMethod::POST, Some(b.clone().into_bytes())),
        None => (HttpMethod::GET, None),
    };
    let headers = match &body {
        Some(_) => vec![("content-type".to_string(), "application/json".to_string())],
        None => Vec::new(),
    };
    let (response, cost) = https_outcall(url.clone(), method, headers, payload).await?;
    let status = nat_to_u64(&response.status);
    if !(200..300).contains(&status) {
        return Err(WorkspaceError::ProviderError {
            reason: format!("tool endpoint answered HTTP {status}"),
        });
    }
    book_cycles(workspace_id, cost)?;
    let metadata = serde_json::to_string(&serde_json::json!({
        "status": status,
        "body": String::from_utf8_lossy(&response.body),
    }))
    .expect("tool metadata JSON must always serialize");
    record_signed_output(workspace_id, "tool".to_string(), url, metadata).await
}

/// `HttpRequestResult.status` is a candid Nat; statuses fit u64 trivially.
fn nat_to_u64(nat: &candid::Nat) -> u64 {
    nat.0.to_string().parse().unwrap_or(0)
}

/// Pure core of `inject_config` (FU-434 Slice B): decrypt the NIP-44 v2
/// payload, parse the JSON, validate the `WorkspaceConfig`. No IC runtime, no
/// stable memory — plain `cargo test` covers it (same pattern as
/// `require_server`). All failures map to `InvalidArgs` with a reason that
/// names the check, never key material or decrypted bytes (FU-195-C).
fn decrypt_config(
    secret_key: &SecretKey,
    sender_pubkey_hex: &str,
    ciphertext: &str,
) -> Result<WorkspaceConfig, WorkspaceError> {
    let plaintext = nip44::decrypt(ciphertext, secret_key, sender_pubkey_hex).map_err(|e| WorkspaceError::InvalidArgs {
        reason: format!("config ciphertext rejected: {e}"),
    })?;
    let config: WorkspaceConfig = serde_json::from_slice(&plaintext).map_err(|_| WorkspaceError::InvalidArgs {
        reason: "config plaintext is not a valid WorkspaceConfig JSON document".to_string(),
    })?;
    validate_config(&config)?;
    Ok(config)
}

const KNOWN_LLM_PROVIDERS: [&str; 3] = ["openai", "anthropic", "ollama"];

fn validate_config(config: &WorkspaceConfig) -> Result<(), WorkspaceError> {
    if !KNOWN_LLM_PROVIDERS.contains(&config.llm_provider.as_str()) {
        return Err(WorkspaceError::InvalidArgs {
            reason: format!(
                "llm_provider must be one of {}",
                KNOWN_LLM_PROVIDERS.join("|")
            ),
        });
    }
    if config.llm_model.trim().is_empty() || config.llm_api_key.trim().is_empty() {
        return Err(WorkspaceError::InvalidArgs {
            reason: "llm_model and llm_api_key must be non-empty".to_string(),
        });
    }
    Ok(())
}

/// Permissionless key bootstrap (FU-434 Slice B): generates the canister
/// keypair on first call (same lazy logic as `record_output`) and returns the
/// x-only hex pubkey. The owner client needs this *before* any output exists
/// to seal the workspace config; `get_output_pubkey` stays the cheap query
/// read for the already-generated case.
#[ic_cdk::update]
async fn ensure_output_key() -> Result<String, WorkspaceError> {
    let key = signing_key().await?;
    Ok(sig::pubkey_hex(&key))
}

/// One-time encrypted config injection (FU-434 Slice B / FU-353): the server
/// relays the owner's NIP-44 v2 ciphertext (sealed client-side to the
/// canister pubkey from `ensure_output_key`) and never sees the plaintext.
/// Only legal while the workspace is `Running`; a second injection is
/// rejected with `ConfigAlreadyInjected`.
/// Caller must be the server principal (FU-434 Slice A).
#[ic_cdk::update]
async fn inject_config(
    workspace_id: u64,
    sender_pubkey: String,
    ciphertext: String,
) -> Result<(), WorkspaceError> {
    require_server_caller()?;
    with_workspace(workspace_id, |w| {
        if !matches!(w.state, WorkspaceState::Running) {
            return Err(WorkspaceError::InvalidTransition {
                from: w.state.clone(),
                action: "inject_config".to_string(),
            });
        }
        if w.config.is_some() {
            return Err(WorkspaceError::ConfigAlreadyInjected);
        }
        Ok(())
    })?;
    let key = signing_key().await?;
    let config = decrypt_config(&key, &sender_pubkey, &ciphertext)?;
    // Re-check after the raw_rand await: a concurrent inject may have won
    // while this call yielded.
    with_workspace(workspace_id, |w| {
        if w.config.is_some() {
            Err(WorkspaceError::ConfigAlreadyInjected)
        } else {
            Ok(())
        }
    })?;
    update_workspace(workspace_id, |w| w.config = Some(config));
    Ok(())
}

/// X-only (BIP-340) public key of the canister-held output-signing key,
/// hex-encoded (64 chars) — the verification key for every
/// `WorkspaceOutput::signature`. `None` until the first `record_output` call
/// generates the key (honest empty, not an error: no key exists before the
/// first signing).
#[ic_cdk::query]
fn get_output_pubkey() -> Option<String> {
    SIGNING_KEY.with(|k| {
        k.borrow()
            .get()
            .and_then(|seed| SecretKey::from_slice(&seed).ok().map(|sk| sig::pubkey_hex(&sk)))
    })
}

/// D5 `getOutputs`. Outputs recorded via `record_output` carry a BIP-340
/// execution proof; an empty list is honest, not an error: a legitimately
/// quiet workspace and a not-yet-productive one are indistinguishable from
/// outside.
#[ic_cdk::query]
fn get_outputs(workspace_id: u64) -> Result<Vec<WorkspaceOutput>, WorkspaceError> {
    with_workspace(workspace_id, |w| Ok(w.outputs.clone()))
}

#[ic_cdk::query]
fn whoami() -> Principal {
    ic_cdk::api::msg_caller()
}

ic_cdk::export_candid!();

#[cfg(test)]
mod tests {
    use super::*;

    fn principal(text: &str) -> Principal {
        Principal::from_text(text).unwrap()
    }

    #[test]
    fn require_server_accepts_the_server_principal() {
        let server = principal("aaaaa-aa");
        assert!(require_server(server, server).is_ok());
    }

    #[test]
    fn require_server_rejects_anonymous_and_strangers() {
        let server = principal("aaaaa-aa");
        for caller in [Principal::anonymous(), principal("ryjl3-tyaaa-aaaaa-aaaba-cai")] {
            match require_server(caller, server) {
                Err(WorkspaceError::Unauthorized { expected }) => assert_eq!(expected, "aaaaa-aa"),
                other => panic!("expected Unauthorized, got {other:?}"),
            }
        }
    }

    // --- FU-434 Slice B: decrypt_config (pure inject_config core) ---

    use bitcoin::secp256k1::{Keypair, Secp256k1, SecretKey as SecpSecretKey};

    fn canister_key() -> SecpSecretKey {
        SecpSecretKey::from_slice(&[9u8; 32]).unwrap()
    }

    fn sender_key() -> SecpSecretKey {
        SecpSecretKey::from_slice(&[7u8; 32]).unwrap()
    }

    fn sender_pub_hex() -> String {
        sig::pubkey_hex(&sender_key())
    }

    /// Seals `json` to the canister key, as the owner client would.
    fn sealed(json: &str) -> String {
        let secp = Secp256k1::new();
        let canister_xonly = Keypair::from_secret_key(&secp, &canister_key()).x_only_public_key().0;
        nip44::encrypt_for_test(json.as_bytes(), &sender_key(), &canister_xonly, &[5u8; 32])
    }

    const VALID_CONFIG_JSON: &str = r#"{"llm_provider":"openai","llm_model":"gpt-4o","llm_api_key":"sk-test","llm_base_url":null,"system_prompt":"be terse","tools":["fs.read"]}"#;

    #[test]
    fn decrypt_config_happy_path() {
        let config = decrypt_config(&canister_key(), &sender_pub_hex(), &sealed(VALID_CONFIG_JSON)).unwrap();
        assert_eq!(config.llm_provider, "openai");
        assert_eq!(config.llm_model, "gpt-4o");
        assert_eq!(config.llm_api_key, "sk-test");
        assert_eq!(config.system_prompt.as_deref(), Some("be terse"));
        assert_eq!(config.tools, vec!["fs.read".to_string()]);
    }

    #[test]
    fn decrypt_config_accepts_minimal_json() {
        // Option fields absent (serde defaults them to None), empty allowlist.
        let json = r#"{"llm_provider":"ollama","llm_model":"qwen3","llm_api_key":"k","tools":[]}"#;
        let config = decrypt_config(&canister_key(), &sender_pub_hex(), &sealed(json)).unwrap();
        assert_eq!(config.llm_base_url, None);
        assert_eq!(config.system_prompt, None);
        assert!(config.tools.is_empty());
    }

    #[test]
    fn decrypt_config_rejects_unknown_provider_and_empty_fields() {
        for json in [
            r#"{"llm_provider":"mistral","llm_model":"m","llm_api_key":"k","tools":[]}"#,
            r#"{"llm_provider":"openai","llm_model":"  ","llm_api_key":"k","tools":[]}"#,
            r#"{"llm_provider":"openai","llm_model":"m","llm_api_key":"","tools":[]}"#,
        ] {
            match decrypt_config(&canister_key(), &sender_pub_hex(), &sealed(json)) {
                Err(WorkspaceError::InvalidArgs { .. }) => {}
                other => panic!("expected InvalidArgs for {json}, got {other:?}"),
            }
        }
    }

    #[test]
    fn decrypt_config_rejects_non_json_plaintext() {
        let err = decrypt_config(&canister_key(), &sender_pub_hex(), &sealed("not json")).unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidArgs { .. }));
    }

    #[test]
    fn decrypt_config_rejects_ciphertext_sealed_to_another_key() {
        // The owner sealed to pubkey of key 8, but the canister holds key 9.
        let secp = Secp256k1::new();
        let other_key = SecpSecretKey::from_slice(&[8u8; 32]).unwrap();
        let other_xonly = Keypair::from_secret_key(&secp, &other_key).x_only_public_key().0;
        let payload = nip44::encrypt_for_test(VALID_CONFIG_JSON.as_bytes(), &sender_key(), &other_xonly, &[5u8; 32]);
        let err = decrypt_config(&canister_key(), &sender_pub_hex(), &payload).unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidArgs { .. }));
    }

    #[test]
    fn decrypt_config_rejects_garbage_ciphertext() {
        let err = decrypt_config(&canister_key(), &sender_pub_hex(), "not base64").unwrap_err();
        assert!(matches!(err, WorkspaceError::InvalidArgs { .. }));
    }

    #[test]
    fn workspace_view_redacts_config_to_has_config() {
        let base = Workspace {
            id: 1,
            external_id: "ext".to_string(),
            buyer_pubkey: "pk".to_string(),
            agent_profile_id: "agent".to_string(),
            state: WorkspaceState::Running,
            cycle_budget: 100,
            cycles_used: 10,
            ttl_seconds: 60,
            created_at: 1,
            activated_at: None,
            completed_at: None,
            expires_at: None,
            outputs: Vec::new(),
            config: None,
            last_buyer_action_at: None,
            pending_tool_calls: Vec::new(),
            next_approval_id: 0,
            context_index: Vec::new(),
            billing_model: "ONE_TIME".to_string(),
            authorized_signers: Vec::new(),
        };
        assert!(!WorkspaceView::from(&base).has_config);
        let mut with_config = base.clone();
        with_config.config = Some(WorkspaceConfig {
            llm_provider: "openai".to_string(),
            llm_model: "m".to_string(),
            llm_api_key: "secret".to_string(),
            llm_base_url: None,
            system_prompt: None,
            tools: Vec::new(),
        });
        let view = WorkspaceView::from(&with_config);
        assert!(view.has_config);
        assert_eq!(view.billing_model, "ONE_TIME");
        // The view type has no config field at all — the key material is
        // unrepresentable on the query surface, not merely hidden.
        let encoded = candid::encode_one(&view).unwrap();
        let text = String::from_utf8_lossy(&encoded);
        assert!(!text.contains("secret"));
    }
}
