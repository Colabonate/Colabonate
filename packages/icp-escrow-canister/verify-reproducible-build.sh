#!/usr/bin/env bash
# Reproducible-build verification (ADR-254 §9, FU-254-G).
#
# Builds the Dockerfile's pinned image TWICE, completely independently (`--no-cache`, so both runs
# genuinely recompile from scratch rather than one reusing the other's cached layers), and asserts
# the two resulting wasm artifacts are byte-identical.
#
# Deliberately does NOT compare against a plain local `cargo build` on the host running this
# script. Found empirically while building this: the wasm isn't pure Rust codegen — `secp256k1-sys`
# compiles libsecp256k1's C sources via `cc-rs`, which shells out to whatever `clang`/`cc` is on
# the host's `$PATH`. Two hosts with different system clang versions (confirmed here: Fedora's
# clang 22.1.8 vs. Debian bookworm's clang 14.0.6) produce genuinely different compiled bytes for
# that C code — not a path-embedding artifact `--remap-path-prefix` can fix, an actual difference
# in what got compiled. The Dockerfile pins the C toolchain too (via its Debian base image), so
# "does the Dockerfile's own build reproduce itself" is the meaningful, host-independent claim; "do
# my personal laptop and the Dockerfile agree" is not a claim reproducible-build verification is
# supposed to make in the first place — any contributor's host toolchain is expected to vary, which
# is exactly why the pinned Docker recipe exists as the canonical way to produce/verify the
# deployable artifact.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> Build 1/2 (--no-cache, forces a full independent recompile)"
docker build --no-cache -t icp-escrow-canister-repro-check-1 . >/dev/null
WASM_1="$(mktemp)"
docker run --rm icp-escrow-canister-repro-check-1 > "$WASM_1"

echo "==> Build 2/2 (--no-cache, forces a full independent recompile)"
docker build --no-cache -t icp-escrow-canister-repro-check-2 . >/dev/null
WASM_2="$(mktemp)"
docker run --rm icp-escrow-canister-repro-check-2 > "$WASM_2"

HASH_1="$(sha256sum "$WASM_1" | cut -d' ' -f1)"
HASH_2="$(sha256sum "$WASM_2" | cut -d' ' -f1)"
rm -f "$WASM_1" "$WASM_2"

echo "build 1: $HASH_1"
echo "build 2: $HASH_2"

if [ "$HASH_1" = "$HASH_2" ]; then
  echo "==> MATCH: the Dockerfile's build is reproducible."
  exit 0
else
  echo "==> MISMATCH: the Dockerfile's build is NOT reproducible even against itself."
  exit 1
fi
