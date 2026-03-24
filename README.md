# AgenticPay

**AI-Powered Payment Infrastructure for Autonomous Agents on Stellar**

AgenticPay is a decentralized payment platform built on the Stellar network that enables AI agents to autonomously manage escrow, verify work, and process payments through Soroban smart contracts.

## Architecture

```
agenticpay/
├── frontend/     # Next.js web application
├── backend/      # Express.js API server (AI verification & invoicing)
├── contracts/    # Soroban smart contracts (Rust)
```

### Frontend

Built with **Next.js**, **React**, and **TypeScript**.

- **Stellar SDK + Freighter** — Stellar wallet connection and contract interaction
- **Web3Auth** — Social login support (Google, Twitter, email)
- **Zustand** — State management
- **Framer Motion** — Animations
- **Tailwind CSS** — Styling
- **shadcn/ui** — UI components

### Smart Contracts (Soroban)

Rust-based smart contracts deployed on **Stellar Testnet** via Soroban. Features:

- Project creation with client/freelancer roles
- XLM and Stellar token escrow payments
- Escrow funding and release on work approval
- Work submission with GitHub repository linking
- Dispute resolution and arbitration

### Backend

Express.js API server providing:

- **AI Work Verification** — Validates freelancer deliverables against project requirements using AI
- **AI Invoice Generation** — Automated invoice creation for completed work
- **Stellar Horizon Integration** — On-chain payment status and transaction lookups

## Features

- **Instant Payments** — Funds released immediately upon work approval via Soroban
- **Blockchain Escrow** — Smart contract holds funds securely until milestones are met
- **Social & Wallet Login** — Connect via Google/Twitter or Freighter wallet
- **AI Verification** — Automated code review against project specifications
- **Milestone Tracking** — Track project progress with clear status updates
- **Invoice Management** — Auto-generated invoices for completed projects

## Getting Started

### Prerequisites

- Node.js 20+
- Rust + Soroban CLI (for contract development)
- [Freighter Wallet](https://freighter.app/) or social account

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

### Contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/agenticpay.wasm --network testnet
```

### Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed Soroban contract ID |
| `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` | Web3Auth client ID for social login |
| `NEXT_PUBLIC_BACKEND_URL` | Backend API base URL |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` or `public` |
| `OPENAI_API_KEY` | OpenAI API key for AI verification |
| `STELLAR_SECRET_KEY` | Server-side Stellar signing key |

## Contract Verification

The AgenticPay smart contract source code is published for on-chain verification. To verify the deployed contract matches the source:

### Build the contract from source

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

### Verify the WASM hash matches the deployed contract

```bash
# Get the on-chain WASM hash
soroban contract inspect --id $NEXT_PUBLIC_CONTRACT_ID --network testnet

# Compute the local WASM hash
sha256sum target/wasm32-unknown-unknown/release/agenticpay.wasm
```

The SHA-256 hash of the locally compiled WASM should match the on-chain contract hash, confirming the deployed bytecode was produced from this source.

### Verification status

| Network | Contract ID | Status |
|---------|-------------|--------|
| Testnet | See `NEXT_PUBLIC_CONTRACT_ID` in `.env` | Source published |

> **Note:** Deterministic builds require the same Rust toolchain version. See `contracts/Cargo.toml` for the SDK version and use `rust-toolchain.toml` if present.

## Network

Currently configured for **Stellar Testnet**.

## Contributing

We welcome contributions! This project participates in the **Stellar Wave Program** via [Drips](https://drips.network). Check the issues labeled `Stellar Wave` for bounty-eligible tasks.

## License

MIT
