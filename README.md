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
- **Bulk Verification Operations** — Batch verify, update, and delete verification records
- **AI Invoice Generation** — Automated invoice creation for completed work
- **Stellar Horizon Integration** — On-chain payment status and transaction lookups
- **Scheduled Jobs** — Cron-like tasks for background maintenance and monitoring

### Bulk Verification Endpoints

- `POST /api/v1/verification/verify/batch`
- `PATCH /api/v1/verification/batch`
- `DELETE /api/v1/verification/batch`

## Features

- **Instant Payments** — Funds released immediately upon work approval via Soroban
- **Blockchain Escrow** — Smart contract holds funds securely until milestones are met
- **Social & Wallet Login** — Connect via Google/Twitter or Freighter wallet
- **AI Verification** — Automated code review against project specifications
- **Milestone Tracking** — Track project progress with clear status updates
- **Invoice Management** — Auto-generated invoices for completed projects

---

## Prerequisites

Before setting up the project locally, ensure you have the following installed:

### Required

- **Node.js 20+** — Download from [nodejs.org](https://nodejs.org/)
- **npm 10+** — Comes with Node.js
- **Git** — For cloning the repository

### Optional (for smart contract development)

- **Rust 1.70+** — Install from [rustup.rs](https://rustup.rs/)
- **Soroban CLI** — Install with `cargo install soroban-cli`
- **Docker** — For Soroban local network (optional)

### Accounts & Keys

- **OpenAI API Key** — Required for AI verification and invoice generation. Get it from [platform.openai.com](https://platform.openai.com/api-keys)
- **Web3Auth Credentials** — Create an account at [web3auth.io](https://web3auth.io)
- **Stellar Testnet Account** — Create at [friendbot.stellar.org](https://friendbot.stellar.org)
- **Freighter Wallet** — Install the extension from [freighter.app](https://freighter.app/)

---

## Local Setup

### 1. Clone the Repository

```bash
git clone https://github.com/Smartdevs17/agenticpay.git
cd agenticpay
```

### 2. Backend Setup

The backend is an Express.js API server that handles AI verification, invoicing, and Stellar integration.

#### Install Dependencies

```bash
cd backend
npm install
cd ..
```

#### Configure Environment Variables

Create a `.env` file in the `backend` directory:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your configuration:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Stellar Configuration
STELLAR_NETWORK=testnet

# AI Services
OPENAI_API_KEY=sk_test_your_actual_key_here

# Background Jobs
JOBS_ENABLED=true
```

#### Environment Variables Reference

| Variable | Default | Description | Required |
|---|---|---|---|
| `PORT` | `3001` | Server port | No |
| `NODE_ENV` | `development` | Environment (development/production) | No |
| `CORS_ALLOWED_ORIGINS` | `*` | Comma-separated list of allowed origins | No |
| `STELLAR_NETWORK` | `testnet` | Stellar network (testnet/public) | No |
| `OPENAI_API_KEY` | - | OpenAI API key for AI verification/invoicing | **Yes** |
| `JOBS_ENABLED` | `true` | Enable background job scheduler | No |

### 3. Frontend Setup

The frontend is a Next.js application providing the web interface for project management and payments.

#### Install Dependencies

```bash
cd frontend
npm install
cd ..
```

#### Configure Environment Variables

Create a `.env.local` file in the `frontend` directory:

```bash
cp frontend/.env.example frontend/.env.local
```

Edit `frontend/.env.local` with your configuration:

```env
# Backend API
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1

# Web3Auth Configuration
NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=your_web3auth_client_id_here

# Stellar Smart Contract
NEXT_PUBLIC_CONTRACT_ADDRESS=0xyour_deployed_contract_address_here

# Theme (optional)
NEXT_PUBLIC_APP_NAME=AgenticPay
```

#### Environment Variables Reference

| Variable | Default | Description | Required |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001/api/v1` | Backend API URL | No |
| `NEXT_PUBLIC_BACKEND_URL` | `https://agentpay-backend-mu.vercel.app` | Fallback backend URL | No |
| `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` | - | Web3Auth client ID | **Yes** |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | - | Deployed Soroban contract address | **Yes** |

### 4. Smart Contracts Setup (Optional)

If you plan to develop or deploy smart contracts, set up the Soroban environment.

#### Install Rust and Soroban CLI

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install soroban-cli
```

#### Build the Contract

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

#### Deploy to Testnet

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/agenticpay.wasm \
  --network testnet \
  --source your_freighter_account
```

---

## Running the Application

### Development Mode

Run all services in development mode:

#### Terminal 1: Backend Server

```bash
cd backend
npm run dev
```

Backend will start at `http://localhost:3001`

#### Terminal 2: Frontend Application

```bash
cd frontend
npm run dev
```

Frontend will start at `http://localhost:3000`

The application is now running and ready for development at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001/api/v1
- **Health Check**: http://localhost:3001/api/v1/health

### Production Build

#### Build Backend

```bash
cd backend
npm run build
npm start
```

#### Build Frontend

```bash
cd frontend
npm run build
npm start
```

---

## Testing

### Backend Tests

Run the backend test suite:

```bash
cd backend
npm test                # Run tests once
npm run test:watch     # Run tests in watch mode
```

Tests use **Vitest** and include:
- Route testing
- Middleware validation
- Service logic verification
- Health check validation

### Frontend Tests

Run the frontend test suite:

```bash
cd frontend
npm test                # Run tests once
npm run test:watch     # Run tests in watch mode
```

Tests include:
- Component rendering
- User interaction testing
- API client testing
- Hook testing

### Contract Tests

Build and verify the smart contracts:

```bash
cd contracts
cargo test              # Run Rust tests
cargo build --target wasm32-unknown-unknown --release  # Build WASM
```

---

## API Documentation

### Health Check

```bash
curl http://localhost:3001/api/v1/health
```

### Verification Endpoints

#### Create Verification

```bash
POST /api/v1/verification/verify
Content-Type: application/json

{
  "projectId": "abc123",
  "freelancerId": "xyz789",
  "deliverables": "GitHub link",
  "requirements": "Build a React component"
}
```

#### Batch Verification

```bash
POST /api/v1/verification/verify/batch
Content-Type: application/json

{
  "verifications": [
    {
      "projectId": "abc123",
      "freelancerId": "xyz789",
      "deliverables": "GitHub link",
      "requirements": "Build a React component"
    }
  ]
}
```

### Invoice Endpoints

#### Create Invoice

```bash
POST /api/v1/invoice/create
Content-Type: application/json

{
  "projectId": "abc123",
  "freelancerId": "xyz789",
  "amount": "100.50"
}
```

### Stellar Endpoints

#### Get Transaction Status

```bash
GET /api/v1/stellar/transaction/:transactionHash
```

---

## Troubleshooting

### Backend Issues

**Port Already in Use**

```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Or specify a different port
PORT=3002 npm run dev
```

**OpenAI API Errors**

- Verify your `OPENAI_API_KEY` is correct
- Check API key has sufficient quota at [platform.openai.com](https://platform.openai.com/account/usage/overview)
- Ensure rate limits are not exceeded

**CORS Errors**

- Update `CORS_ALLOWED_ORIGINS` in `.env` to include your frontend URL
- For development: `CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001`

### Frontend Issues

**API Connection Failed**

- Verify backend is running on the correct port
- Check `NEXT_PUBLIC_API_URL` matches backend URL
- Clear browser cache: `cmd/ctrl + shift + delete`

**Web3Auth Connection Issues**

- Verify `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` is correct
- Check Web3Auth dashboard for app configuration
- Ensure redirect URLs are properly configured

**Contract Address Not Found**

- Verify `NEXT_PUBLIC_CONTRACT_ADDRESS` is deployed
- Check contract deployment on Stellar Testnet
- Use `soroban contract info --id <address> --network testnet`

### General Issues

**Port Already in Use**

```bash
# macOS/Linux
lsof -ti:3000 | xargs kill -9   # Frontend
lsof -ti:3001 | xargs kill -9   # Backend

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Node Modules Issues**

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

**Environment Variables Not Loaded**

- Restart the development server
- Verify `.env` file is in the correct directory
- Check for typos in variable names

---

## Environment Setup Validation

### Quick Validation Script

```bash
# Check Node.js version
node --version  # Should be 20+

# Check npm version
npm --version   # Should be 10+

# Verify backend environment
cd backend && npm list | head -20

# Verify frontend environment
cd frontend && npm list | head -20

# Test API connectivity
curl -s http://localhost:3001/api/v1/health | jq .
```

---

## Deployment

### Backend Deployment (Vercel/Heroku)

```bash
# Set environment variables in hosting platform
# Deploy backend
cd backend
npm run build
```

### Frontend Deployment (Vercel/Netlify)

```bash
# Vercel (recommended for Next.js)
npm install -g vercel
vercel

# Or Netlify
npm install -g netlify-cli
netlify deploy
```

---

## Development Workflow

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes and test locally
3. Run tests: `npm test` (both backend and frontend)
4. Commit changes: `git commit -am 'Add feature'`
5. Push to branch: `git push origin feature/your-feature`
6. Create Pull Request with description

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Follow the code style (ESLint configured)
4. Add tests for new features
5. Submit a pull request

---

## License

MIT License - See LICENSE file for details

---

## Support

For issues, questions, or suggestions:

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Documentation**: See [docs/](./docs) folder

---

## Quick Reference Commands

```bash
# Install all dependencies
npm install --workspaces

# Start development
npm run dev --workspace=backend &
npm run dev --workspace=frontend

# Run all tests
npm test --workspaces

# Build for production
npm run build --workspace=backend
npm run build --workspace=frontend

# Lint code
npm run lint --workspace=backend
npm run lint --workspace=frontend
```

---

## External Resources

- [Stellar Documentation](https://developers.stellar.org/)
- [Soroban Smart Contracts](https://soroban.stellar.org/)
- [OpenAI API](https://platform.openai.com/docs)
- [Web3Auth Docs](https://web3auth.io/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [Express.js Guide](https://expressjs.com/)

### Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed Soroban contract ID |
| `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` | Web3Auth client ID for social login |
| `NEXT_PUBLIC_BACKEND_URL` | Backend API base URL |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` or `public` |
| `OPENAI_API_KEY` | OpenAI API key for AI verification |
| `STELLAR_SECRET_KEY` | Server-side Stellar signing key |
| `JOBS_ENABLED` | Set to `false` to disable scheduled jobs |

### Scheduled Jobs

- Default jobs live under `backend/src/jobs`
- Job status endpoint: `GET /api/v1/jobs`

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
