# Reproducible build for icp_escrow_canister (ADR-254 §9, FU-254-G).
#
# Goal: anyone can build this exact wasm from the public source and get a byte-identical result to
# what's deployed, so the on-chain module hash is independently verifiable without trusting whoever
# ran `dfx deploy`. Pins the Debian base image, the exact rustc version, and uses `--locked` against
# the committed Cargo.lock so dependency versions can't drift between builds.
#
# Usage: see README.md "Reproducible build verification (FU-254-G)".
#
# Known limitation (documented, not hidden): the Debian base image tag below is not pinned to a
# content digest, so a `docker build` next year could pull a different (but same-tagged) base image
# with different system libraries. Pinning `debian:bookworm-slim` to a `@sha256:...` digest would
# close that gap; left open here because grabbing a digest without being able to verify it against
# Docker Hub from this environment would risk baking in a wrong one silently.
FROM debian:bookworm-slim

ARG RUST_VERSION=1.97.1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    build-essential \
    clang \
    && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain "${RUST_VERSION}" --target wasm32-unknown-unknown --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src

# Remaps the Cargo registry cache path embedded in debug/panic info to a fixed virtual path — the
# local checkout is already at the same `/build` WORKDIR a local build's `--remap-path-prefix`
# targets (see verify-reproducible-build.sh), so only the registry path needs remapping here.
ENV RUSTFLAGS="--remap-path-prefix /root/.cargo/registry/src=/cargo-registry/src -C strip=symbols"

RUN cargo build --target wasm32-unknown-unknown --release --locked

# Prints nothing but the wasm bytes to stdout, so `docker run --rm <image> > out.wasm` gives you
# exactly the build artifact to hash/diff against a local build.
CMD ["cat", "target/wasm32-unknown-unknown/release/icp_escrow_canister.wasm"]
