# @col/icp-workspace-canister

ICP Rust canister for agent-workspace execution. Design: `docs/decisions/311-workspace-execution-icp-canisters.md`; server-side lifecycle half: `apps/server/routes/workspaces.ts` + `apps/server/services/workspace-lifecycle.ts`; server wiring via `@dfinity/agent` (FU-432, done 2026-08-19): `apps/server/services/workspace-canister-client.ts`.

This package is **not** part of the `npx pnpm` build graph — `package.json` exists only so `pnpm-workspace.yaml`'s `packages/*` glob doesn't choke on a directory with no `package.json`. The real toolchain is Rust + `dfx`, documented below.

## Status

First slice of **FU-431**: lifecycle state machine (`src/lifecycle.rs`, mirrors the server-side `WorkspaceStatusSchema` exactly), cycle-budget accounting (`src/billing.rs`, ADR-311 D3), stable-memory persistence (`ic-stable-structures`, keyed by workspace id so the same wasm serves both shared and per-workspace deployments), and the full D5 Candid surface (`create_workspace`, `get_workspace`, `check_workspace_status`, `start_workspace`, `add_cycles`, `record_cycle_usage`, `complete_workspace`, `expire_workspace`, `destroy_workspace`, `get_outputs`, `whoami`).

**FU-434 Slice A (done 2026-08-20)**: caller authorization + execution proofs (`src/sig.rs`).

- Every mutating method except the time-gated `expire_workspace` now requires `caller == server_principal` — the Colabonate backend principal handed in as a **mandatory init argument**. Wrong callers get `WorkspaceError::Unauthorized { expected }`.
- New update `record_output(workspace_id, output_type, uri, metadata)`: legal only while the workspace is `Running`; stamps `created_at` and stores a 64-byte BIP-340 Schnorr signature over the canonical message `colabonate-workspace-v1:output:{workspace_id}:{created_at}:{output_type}:{uri}:{metadata}` (sha256 of the utf-8 string, same construction as the escrow canister's `sig.rs`).
- One canister-level secp256k1 keypair signs all outputs (not per-workspace). It is generated lazily from `raw_rand` on the first `record_output` and kept in stable memory (MemoryId 3) — the private key never leaves the canister. Custody trade-off documented in `src/sig.rs`; threshold-Schnorr migration is a possible later hardening.
- New query `get_output_pubkey() -> opt text`: the x-only hex pubkey (64 chars) for external verification (e.g. nostr-tools); `null` until the first signing.
- Memory slots 0–3 are permanent: 0 = workspaces, 1 = next id, 2 = server principal, 3 = signing key. Never renumber, only append.

**FU-434 Slice B (done 2026-08-20)**: one-time encrypted config injection (`src/nip44.rs`, FU-353).

- New permissionless update `ensure_output_key() -> Result<text, _>`: generates the canister keypair if missing (same lazy `raw_rand` logic as `record_output`, incl. the post-await re-check) and returns the x-only hex pubkey. `get_output_pubkey` (query) stays the cheap read.
- New server-gated update `inject_config(workspace_id, sender_pubkey /* x-only hex */, ciphertext /* base64 NIP-44 v2 */)`: legal only while the workspace is `Running`, one-time (`ConfigAlreadyInjected` on a second call), decrypts + validates + stores `WorkspaceConfig` on the workspace record.
- Inject flow: the owner client calls `ensure_output_key`, seals their config JSON client-side (NIP-44 v2) to that pubkey, hands the ciphertext to the server; the server relays via `inject_config` and **never sees the plaintext** — the ADR-306 trade-off, the LLM API key lives in canister stable memory only.
- `get_workspace` (open query) returns a **redacted view** (`WorkspaceView`): the injected config never leaves the canister over the query surface — callers get a `has_config : bool` flag instead of the `config` record (FU-195-C).
- **One keypair, two uses**: the Slice A BIP-340 signing key (MemoryId 3) doubles as the NIP-44 ECDH target. Custody note in `src/nip44.rs`.
- `src/nip44.rs` is decrypt-only and validated against the official NIP-44 v2 test vectors (sha256 `269ed0f6…ce25040`, the checksum pinned in NIP-44 §"Tests and code"). Decrypt failures map to `InvalidArgs { reason }` — reasons name the failed check, never key material (FU-195-C).
- `WorkspaceConfig`: `llm_provider` ("openai"|"anthropic"|"ollama"), `llm_model`, `llm_api_key`, optional `llm_base_url` / `system_prompt`, `tools` allowlist. Provider/model/key validated at injection.

**FU-434 Slice C (done 2026-08-20)**: the canister IS the harness — buyer-signed chat + tool executor with real HTTPS outcalls (`src/harness.rs`, `src/llm.rs`).

- Buyer-direct actions (`post_message`, `call_tool`, `approve_tool_call`) are called **anonymously** and authorized by the buyer's BIP-340 signature over a timestamped canonical message (`colabonate-workspace-v1:{action}:{id}:{timestamp}:{params...}`, verified against `Workspace.buyer_pubkey` — escrow FU-254-E pattern). Because these actions are repeatable (unlike the escrow's one-shot ones), the timestamp is inside the signed message and a **monotonic replay guard** (`last_buyer_action_at`, strictly increasing) makes captured signatures single-use.
- `post_message`: records the user message as a signed output, runs a **single-turn** LLM call (system prompt + this message; history is recorded but NOT fed back — follow-up), records the reply as a signed output. Providers: openai / anthropic / ollama (`src/llm.rs`).
- Tool executor: allowlisted REST prefixes from `config.tools` — entries prefixed with `!` are **approval-gated** and park as `PendingToolCall` until the buyer signs `approve_tool_call`. Executed tools run `POST` (with body) / `GET` via outcall; the response body becomes a signed `tool` output. The ADR-311 D6 names read_file/write_file/execute_command are meaningless in a canister (no filesystem/shell) and are deliberately not built.
- Cycle metering is wired for real: every successful outcall books its `cost_http_request` cost into the workspace budget via the D3 accounting — reaching the budget auto-suspends. Failed outcalls book nothing.
- HTTPS outcalls carry a transform (`transform_response`) that strips response headers for consensus. Verified end-to-end on the local dfx 0.32 replica: the smoke's fake OpenAI key yields a real provider 401 (`ProviderError`), proving DNS/TLS/consensus/parse; a full 2xx roundtrip needs a real API key (not exercised — no fake success).

Deliberately **not** implemented — nothing here is a silent no-op or faked success:

- multi-turn LLM history + provider tool-calling loops (the LLM client is single-turn; tool execution is buyer-initiated)
- Nostr presence publishing (ADR-311 D7) → **FU-395**

## Prerequisites

- Rust (`rustup`, stable toolchain) + `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- **`icp`** (ICP CLI) — see ADR-346. Install: `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/dfinity/icp-cli/releases/latest/download/icp-cli-installer.sh | sh`. (`dfx` is deprecated by DFINITY upstream — not used here anymore.)
- `candid-extractor` (regenerates `icp_workspace_canister.did` from the built wasm — only needed after changing the public candid-facing types/signatures): `cargo install candid-extractor`
- `clang` (native build dependency of the `bitcoin`/`secp256k1` crates used in `src/sig.rs`) — e.g. `apt install clang` on Debian/Ubuntu.

None of these are installed by `npx pnpm install` — install them once per machine.

## Commands

```bash
# Unit tests — pure state-machine + billing + signature logic, no IC runtime needed (fast, run this first)
cargo test

# Verify the canister actually compiles to wasm
cargo build --target wasm32-unknown-unknown --release

# Regenerate the .did after changing candid-facing types/signatures
candid-extractor target/wasm32-unknown-unknown/release/icp_workspace_canister.wasm > icp_workspace_canister.did

# Deploy to a local replica — the init argument (authorized server principal) is MANDATORY.
# icp.yaml pins the local gateway to port 4943 (not icp-cli's 8000 default) for continuity
# with every ICP_HOST value already used across this repo's scripts/docs.
icp network start -d
icp deploy -y --args '(principal "<server-principal>")'

# End-to-end smoke of the server wiring (FU-432): run the server with
#   ICP_WORKSPACE_CANISTER_ID=$(icp canister status icp_workspace_canister --id-only) ICP_HOST=http://127.0.0.1:4943
# then, from the repo root:
#   ICP_SMOKE=1 ICP_WORKSPACE_CANISTER_ID=<id> DATABASE_URL=... BASE_URL=http://localhost:<port> \
#     npx pnpm exec tsx apps/server/scripts/adr311-workspace-smoke.ts
```
