# @col/icp-escrow-canister

ICP Rust canister for Stufe 2/3 of the non-custodial escrow strategy. Design: `docs/decisions/254-icp-escrow-canister-detail-design.md`, strategic decision: `docs/decisions/253-non-custodial-p2p-escrow-strategy.md`.

This package is **not** part of the `npx pnpm` build graph — `package.json` exists only so `pnpm-workspace.yaml`'s `packages/*` glob doesn't choke on a directory with no `package.json`. The real toolchain is Rust + `dfx`, documented below.

## Status

Implements FU-254-A (skeleton), FU-254-B (trade state machine, Candid interface, pure-logic unit tests), FU-254-C (real t-ECDSA P2WPKH address derivation + native UTXO funding detection, `src/btc.rs`), FU-254-D (real payout transaction signing/broadcast, also `src/btc.rs`), FU-254-E (BIP-340 Schnorr signature verification, `src/sig.rs`) and FU-254-H (non-final milestone releases — the change-output gap found while building FU-254-D), all wired against local `bitcoind -regtest`. `create_trade`, `check_funding`, `claim_timeout_refund`, `open_dispute`, and **every** `release_milestone` case (final *and* non-final, single- or multi-milestone trades) are fully wired end-to-end. One thing remains an honest error rather than a silent no-op or a faked success:

- `submit_dao_verdict` verifies signatures correctly; the DAO public key is provisioned per build target (ADR-364 D5): `None` in the `bitcoin-regtest` default, and the founder's master key (`FOUNDATION_DAO_ADMIN_PUBKEY`, an existing BIP-340 x-only pubkey — Nostr keys are secp256k1 x-only keys) in the `bitcoin-testnet`/`bitcoin-mainnet` variants — a single-key M0 bootstrap until a FROST threshold council replaces it via a new build

Reproducible build pipeline exists and is verified (FU-254-G, see below) — the *decision* between blackholing the canister and a DAO-multisig controller is deliberately not made here (ADR-254 §9 reserves it for FU-253-H's later governance gate); this only documents + verifies the mechanics both options need.

`TRADES` state lives in canister heap memory only (no `ic-stable-structures` yet) — it would be lost across an upgrade. That's fine for the current skeleton/testnet-demo stage; it must move to stable memory before any real funds are ever held (tracked under FU-254-G).

`src/btc.rs` selects the **deployment target** via one of three mutually-exclusive cargo features (ADR-364 D2 — the build matrix): `bitcoin-regtest` (default: `key_1`/`Regtest`, the PocketIC local replica seeds only this test key name), `bitcoin-testnet` (`test_key_1`/`Testnet`/`tb1…`), `bitcoin-mainnet` (`key_1`/`Mainnet`/`bc1…`). Each target also provisions `sig::DAO_PUBKEY_HEX`; the t-ECDSA key name, IC Bitcoin-API network, address HRP and rust-bitcoin network move in lock-step — never a runtime flag (same reasoning as `PLATFORM_FEE_BPS`/`PLATFORM_FEE_ADDRESS`). Every real-network variant needs its own reproducible-build + attestation proof (ADR-364 D6).

**FU-254-H (non-final milestone releases):** ADR-254 §5's payout invariant only names three legal output addresses (buyer refund, seller payout, fee) — but Bitcoin UTXOs can't be partially spent, so releasing milestone *i* of *N > 1* must spend the entire current UTXO and route the still-unreleased remainder somewhere on-chain. The only sound "somewhere" is the trade's own escrow address, so `validate_partial_release_outputs` (`src/state_machine.rs`) permits it as a fourth legal output — strictly in addition to buyer/seller/fee, and strictly only for this one non-terminal case; every terminal payout (timeout refund, final milestone, DAO verdict) keeps the original three-address invariant unchanged. Each non-final release pays the seller their *fixed contractual share of the trade's original total* (`trade.expected_amount_sats`), not a percentage of the current, fee-eroded balance — so an earlier milestone's on-chain fee never eats into a later milestone's amount; the fee comes out of the change instead. The synthesized change UTXO is trusted at **0 confirmations** (the canister trusts its own just-broadcast transaction to chain the next milestone) — a tighter trust assumption than the `MIN_CONFIRMATIONS` already accepted for initial funding, flagged explicitly for FU-253-H's security gate to examine, not resolved unilaterally here.

## Prerequisites

- Rust (`rustup`, stable toolchain) + `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- [`dfx`](https://internetcomputer.org/docs) (DFINITY SDK) via `dfxvm`: `sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"`
- `candid-extractor` (regenerates `icp_escrow_canister.did` from the built wasm — only needed after changing the public candid-facing types/signatures): `cargo install candid-extractor`
- `bitcoind` + `bitcoin-cli` (regtest funding detection E2E only, FU-254-C+): e.g. `sudo dnf install bitcoin-core-server bitcoin-core-utils` on Fedora/Nobara
- `docker` (reproducible-build verification only, FU-254-G): any recent Docker Engine

None of these are installed by `npx pnpm install` — install them once per machine.

## Commands

```bash
# Unit tests — pure state-machine logic, no IC runtime needed (fast, run this first)
cargo test

# Verify the canister actually compiles to wasm (closest thing to "does this work as a canister"
# without a live replica)
cargo build --target wasm32-unknown-unknown --release

# Build matrix (ADR-364 D2): exactly one Bitcoin deployment target per build. The default is
# `bitcoin-regtest`; real networks are opted into explicitly (and are mutually exclusive — a
# compile_error guard in lib.rs enforces it).
cargo test                                                       # regtest (default)
cargo build --target wasm32-unknown-unknown --release \
  --no-default-features --features bitcoin-testnet               # Phase T: IC mainnet + Bitcoin testnet
cargo build --target wasm32-unknown-unknown --release \
  --no-default-features --features bitcoin-mainnet               # Phase M: gated on FU-253-H (ADR-364 D7)

# Regenerate the .did file after changing public types/signatures in src/lib.rs or src/types.rs
candid-extractor target/wasm32-unknown-unknown/release/icp_escrow_canister.wasm > icp_escrow_canister.did

# Full local deploy + live smoke test (no Bitcoin integration — check_funding will error on any
# real balance query if the replica wasn't started with --enable-bitcoin, see below)
dfx start --background --clean
dfx deploy
dfx canister call icp_escrow_canister create_trade '(record {
  buyer_pubkey = "buyer-hex"; seller_pubkey = "seller-hex";
  buyer_refund_address = "bcrt1qbuyer"; seller_payout_address = "bcrt1qseller";
  expected_amount_sats = 150000; milestone_bps = vec { 10_000 }; timeout_at = 999999999999999999;
})'
dfx canister call icp_escrow_canister get_trade '(0)'
dfx stop
```

### Regtest funding E2E (FU-254-C)

Exercises the real path: t-ECDSA address derivation → fund it on an actual `bitcoind -regtest` node → `check_funding` observes the UTXO via the IC Bitcoin canister → `PendingFunding → Funded`.

```bash
# 1. Start a local regtest node (data dir + config isolated from any mainnet/testnet node)
bitcoind -regtest -daemon -rpcuser=dfx -rpcpassword=dfx -fallbackfee=0.0002

# 2. Start dfx with Bitcoin integration (reads defaults.bitcoin from dfx.json)
dfx start --background --clean --enable-bitcoin
dfx deploy

# 3. Create a trade, read its derived btc_address from get_trade
dfx canister call icp_escrow_canister create_trade '(record {
  buyer_pubkey = "buyer-hex"; seller_pubkey = "seller-hex";
  buyer_refund_address = "bcrt1qbuyer"; seller_payout_address = "bcrt1qseller";
  expected_amount_sats = 150000; milestone_bps = vec { 10_000 }; timeout_at = 999999999999999999;
})'
dfx canister call icp_escrow_canister get_trade '(0)'   # copy btc_address

# 4. Fund the derived address on regtest, then mine a block so it has 1 confirmation
bitcoin-cli -regtest -rpcuser=dfx -rpcpassword=dfx -named createwallet wallet_name=miner
bitcoin-cli -regtest -rpcuser=dfx -rpcpassword=dfx sendtoaddress <btc_address> 0.0015
bitcoin-cli -regtest -rpcuser=dfx -rpcpassword=dfx -generate 1

# 5. Give the dfx replica's Bitcoin adapter a few seconds to catch up to the regtest tip, then:
dfx canister call icp_escrow_canister check_funding '(0)'   # -> Funded once caught up
dfx canister call icp_escrow_canister get_trade '(0)'        # funded_at set, funded_utxos non-empty

dfx stop
bitcoin-cli -regtest -rpcuser=dfx -rpcpassword=dfx stop
```

### Timeout-refund payout E2E (FU-254-D)

Continues straight on from the funding E2E above (same trade, now `Funded`). Exercises the only
payout entrypoint that's fully wired today: signs a real BIP143/t-ECDSA transaction and broadcasts
it, no signature verification needed since it's permissionless.

```bash
# Create trade 0 as in the funding E2E above, but with an immediately-eligible timeout_at (a real
# `nanoseconds since epoch` value would normally be `now + 30 days`; `1` just makes the pilot demo
# not have to wait) and a real regtest address (not a placeholder string) as buyer_refund_address
# so the payout is actually verifiable — e.g.
#   bitcoin-cli -regtest -rpcuser=dfx -rpcpassword=dfx -rpcwallet=miner getnewaddress
# ... then follow steps 1-5 above with that address as buyer_refund_address and timeout_at = 1.

dfx canister call icp_escrow_canister claim_timeout_refund '(0)'   # -> Refunded
dfx canister call icp_escrow_canister get_trade '(0)'              # state = Refunded

# Verify on-chain: mine one more block, then check the buyer address actually received funds
# (total_input minus the estimated miner fee).
bitcoin-cli -regtest -rpcuser=dfx -rpcpassword=dfx -generate 1
bitcoin-cli -regtest -rpcuser=dfx -rpcpassword=dfx getreceivedbyaddress <buyer_refund_address> 1
```

### Signature-authorized payout E2E (FU-254-E)

`open_dispute` and `release_milestone` need a real BIP-340 Schnorr signature (raw 64 bytes, not
hex) from the trade's `buyer_pubkey`/`seller_pubkey` (hex-encoded x-only pubkey, matching a Nostr
key) over `"colabonate-escrow-v1:<action>:<trade_id>[:<extra params>]"` — see `src/sig.rs` for the
exact per-action message format. To generate real fixtures for a manual `dfx canister call` test,
reuse `src/sig.rs`'s own already-tested `test_keypair`/`sign` helpers from a throwaway `#[test]`
(`cargo test <name> -- --nocapture`) rather than hand-rolling a second signing path — keeps the
fixtures guaranteed self-consistent with what the canister actually verifies.

```bash
# With a trade already created + funded (as in the funding E2E above) using a real hex pubkey as
# buyer_pubkey, and a signature produced over
# "colabonate-escrow-v1:release_milestone:<trade_id>:<milestone_index>" by that pubkey's key:
dfx canister call icp_escrow_canister release_milestone '(0, 0, blob "\xx\xx...")'   # -> Released
# for a single/final milestone: signs + broadcasts a real payout to seller_payout_address, same as
# the timeout-refund E2E above but to the seller instead of the buyer.
```

### Multi-milestone E2E (FU-254-H)

Live-verified end-to-end on an isolated regtest node (own datadir + non-default ports `19443`/`19444`
— **never** the shared `colabonate-beta` bitcoind/lnd stack's default regtest ports `18443`/`18444`,
which may already be running): a 3-milestone (25/50/25) trade funded with 150,000 sats, all three
milestones released in order, each verified independently via `bitcoin-cli scantxoutset` against the
actual chain state (not just the canister's own `get_trade` report):

| Step | Seller received (cumulative) | Escrow (change) address balance |
|---|---|---|
| after milestone 0 (25%) | 37,500 sats | 109,116 sats |
| after milestone 1 (50%) | 112,500 sats | 30,732 sats |
| after milestone 2 (final, full-drain) | 140,042 sats | 0 sats |

`get_trade`'s `funded_utxos` matched the on-chain change UTXO exactly at every step (same txid/vout/value
`scantxoutset` reported). `150,000 − 140,042 = 9,958` sats total miner fees across the three broadcast
transactions — every satoshi accounted for, none diverted anywhere but the seller and the trade's own
escrow address in between. A repeat `release_milestone(0, 0, ...)` call after the trade reached
`Released` was correctly rejected (`InvalidTransition { from: Released }`).

```bash
# 1. Own isolated regtest node — do NOT reuse the shared beta stack's default ports.
bitcoind -regtest -daemon -datadir=/path/to/scratch/regtest \
  -rpcuser=dfx -rpcpassword=dfx -rpcport=19443 -port=19444 -fallbackfee=0.0002
BCLI="bitcoin-cli -regtest -datadir=/path/to/scratch/regtest -rpcport=19443 -rpcuser=dfx -rpcpassword=dfx"
$BCLI -named createwallet wallet_name=miner
$BCLI -rpcwallet=miner generatetoaddress 101 "$($BCLI -rpcwallet=miner getnewaddress)"

# 2. Point dfx's bitcoin adapter at the isolated node WITHOUT editing dfx.json's committed default
#    (--bitcoin-node overrides defaults.bitcoin.nodes for this run only):
dfx start --background --clean --bitcoin-node 127.0.0.1:19444
dfx deploy

# 3. Create a 3-milestone trade (milestone_bps = 25/50/25), fund its derived btc_address, check_funding
#    (as in the funding E2E above), then release each milestone in order with a real buyer signature
#    over "colabonate-escrow-v1:release_milestone:<trade_id>:<milestone_index>" (see FU-254-E section) —
#    milestones 0 and 1 return `Funded` (trade continues), milestone 2 returns `Released` (trade ends).
dfx canister call icp_escrow_canister release_milestone '(0, 0, blob "...")'
dfx canister call icp_escrow_canister release_milestone '(0, 1, blob "...")'
dfx canister call icp_escrow_canister release_milestone '(0, 2, blob "...")'

# 4. Verify independently of the canister's own report — scantxoutset works even for addresses the
#    regtest wallet doesn't track:
$BCLI scantxoutset start '["addr(<seller_payout_address>)"]'
$BCLI scantxoutset start '["addr(<trade_btc_address>)"]'   # should be 0 after the final milestone

dfx stop
$BCLI stop
```

## Reproducible build (FU-254-G)

`Dockerfile` pins the exact environment (Debian `bookworm-slim`, `rustc 1.97.1`, `clang` from that
same Debian release) needed to independently rebuild `icp_escrow_canister.wasm` from source and get
a byte-identical result — so anyone can verify a deployed canister's on-chain module hash matches
what the public source actually produces, without trusting whoever ran `dfx deploy`.

**Don't compare against a plain local `cargo build` on your own machine** — that comparison isn't
meaningful. `secp256k1-sys` compiles libsecp256k1's C sources via `cc-rs`, which shells out to
whatever `clang`/`cc` is on `$PATH`; two hosts with different system C-compiler versions produce
genuinely different compiled bytes for that C code, independent of the Rust source being identical.
(Found empirically while building this: Fedora's `clang 22.1.8` vs. Debian bookworm's `clang
14.0.6` do not agree, even after `--remap-path-prefix` normalizes every embedded absolute path.)
The meaningful claim is "does the pinned Docker recipe reproduce itself" — any contributor's host
toolchain is expected to vary, which is exactly why the Docker recipe exists as the canonical way
to produce/verify the deployable artifact.

```bash
# Builds the Dockerfile's image twice, independently (--no-cache forces a full recompile each
# time, so neither run can silently reuse the other's cached layers), and asserts the two
# resulting wasm files are byte-identical.
./verify-reproducible-build.sh
```

To actually deploy the verified artifact (bypassing dfx's own — unpinned-toolchain — build):

```bash
docker build -t icp-escrow-canister-build .
docker run --rm icp-escrow-canister-build > icp_escrow_canister.wasm
sha256sum icp_escrow_canister.wasm   # this is the hash to compare against `dfx canister info`
dfx canister install icp_escrow_canister --wasm icp_escrow_canister.wasm --mode reinstall
```

**Not in scope here — deliberately left to FU-253-H, per ADR-254 §9:** whether the pilot canister
ends up **blackholed** (all controllers removed — code becomes permanently immutable, e.g. via a
raw `update_settings` call to the management canister with `controllers = opt vec {}`, since
`dfx canister update-settings --set-controller` doesn't accept an empty list) or has a
**DAO-multisig controller** (upgradable, but only with DAO majority approval via
`--set-controller <dao-multisig-principal>`). Both satisfy "no single human holds unilateral
control over the funds"; the difference is upgradability vs. absolute immutability. This package
does not execute either — that decision, and running the command, belongs to whoever operates
FU-253-H's pilot gate, not to this build-tooling follow-up.

## Layout

- `src/types.rs` — Candid-facing types (`Trade`, `TradeState`, `Milestone`, `TradeError`, `CreateTradeArgs`)
- `src/state_machine.rs` — pure trade-state-machine logic (no IC runtime, no crypto, no Bitcoin I/O) + its unit tests
- `src/sig.rs` — BIP-340 Schnorr signature verification for buyer/seller/DAO authorization (pure CPU, no IC runtime, no I/O — unit-testable) + its unit tests
- `src/btc.rs` — t-ECDSA address derivation, native UTXO funding queries, and payout transaction signing/broadcast (real IC/Bitcoin-canister I/O, not unit-testable without a live replica)
- `src/lib.rs` — canister entry points (`#[ic_cdk::update]`/`#[ic_cdk::query]`), in-memory trade store, candid export
- `icp_escrow_canister.did` — generated Candid interface (regenerate via `candid-extractor`, do not hand-edit)
- `Dockerfile` / `verify-reproducible-build.sh` — pinned reproducible-build recipe + its self-verification script (FU-254-G)
