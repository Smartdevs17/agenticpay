# Multi-arch base (amd64 + arm64) for Apple Silicon and Linux CI
#
# The Rust toolchain and the Soroban CLI are built in their own stage and copied
# in. The image therefore ships with them ready to use, and container creation
# does not compile anything (#1498). Keep SOROBAN_CLI_VERSION in step with
# scripts/setup.sh and soroban-sdk in contracts/Cargo.toml.
ARG RUST_VERSION=1.93
ARG SOROBAN_CLI_VERSION=21.0.0

FROM rust:${RUST_VERSION}-bookworm AS rust
ARG SOROBAN_CLI_VERSION
# soroban-cli links against OpenSSL, so it needs the headers and pkg-config.
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
  && apt-get install -y --no-install-recommends pkg-config libssl-dev \
  && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown \
  && rustup component add clippy rustfmt rust-analyzer \
  && cargo install --locked soroban-cli --version "${SOROBAN_CLI_VERSION}" \
  && rm -rf "${CARGO_HOME}/registry" "${CARGO_HOME}/git"

FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

USER root

# Soroban / WASM build deps
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
  && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    libssl-dev \
    clang \
    llvm \
    libclang-dev \
  && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Toolchain copied from the rust stage. Owned by `node` so rustup and cargo can
# write caches when the container runs as that user.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:${PATH}
COPY --from=rust /usr/local/rustup /usr/local/rustup
COPY --from=rust /usr/local/cargo /usr/local/cargo
RUN chown -R node:node /usr/local/rustup /usr/local/cargo

USER node
