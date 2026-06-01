# Multi-arch base (amd64 + arm64) for Apple Silicon and Linux CI
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

USER node

# Pre-install wasm target when Rust feature runs (post-create also verifies)
RUN if command -v rustup >/dev/null 2>&1; then \
      rustup target add wasm32-unknown-unknown || true; \
    fi
