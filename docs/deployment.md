# AgenticPay Deployment Guide

This document provides a comprehensive guide for deploying all three components of AgenticPay: the Soroban Smart Contracts, the Backend API Server, and the Frontend Web Application.

## Deployment Prerequisites

Before deploying AgenticPay to a production or staging environment, ensure you have the following installed and configured:

- **Node.js** (v18 or higher) and npm/yarn/pnpm
- **Rust** and **Cargo** (for building smart contracts)
- **Stellar CLI** (for deploying smart contracts to the Stellar network)
- **Git**
- **Process Manager** (e.g., PM2) or Docker (if containerizing the backend)
- **Third-Party Service Accounts**:
  - OpenAI (for API keys used in the AI verification engine)
  - Web3Auth (for social login integration)
  - GitHub Personal Access Token (if elevated API rate limits are required for code fetching)

## Environment Configuration

Each component requires specific environment variables to function correctly. 

### 1. Smart Contracts
You need a Stellar account (funded with XLM) for deploying the contracts.
Configure the Stellar CLI network and identities:
```bash
stellar network add --global mainnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Public Global Stellar Network ; September 2015"

stellar keys generate --global deployer
```

### 2. Backend API (`backend/.env`)
Create a `.env` file in the `backend/` directory:
```env
PORT=3001
NODE_ENV=production
OPENAI_API_KEY=sk-...
GITHUB_TOKEN=ghp_...
STELLAR_NETWORK=MAINNET
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_CONTRACT_ID=... # Updated after contract deployment
```

### 3. Frontend Web Application (`frontend/.env.local`)
Create a `.env.local` file in the `frontend/` directory:
```env
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_WEB3AUTH_CLIENT_ID=...
NEXT_PUBLIC_STELLAR_NETWORK=MAINNET
NEXT_PUBLIC_SOROBAN_CONTRACT_ID=... # Updated after contract deployment
```

## Deployment Steps

AgenticPay must be deployed in a specific order: Smart Contracts first, then Backend, and finally Frontend, ensuring that dependency references (like Contract IDs) are propagated correctly.

### Step 1: Deploy Smart Contracts

1. Navigate to the `contracts/` directory:
   ```bash
   cd contracts
   ```
2. Build the optimized WebAssembly binary:
   ```bash
   cargo build --target wasm32-unknown-unknown --release
   ```
3. Deploy the compiled contract using the Stellar CLI:
   ```bash
   stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/agenticpay_escrow.wasm \
     --source deployer \
     --network mainnet
   ```
4. **Save the output Contract ID**. You will need to add this to both the Backend and Frontend `.env` files.

### Step 2: Deploy the Backend API Server

The backend can be deployed on any standard VPS (AWS EC2, DigitalOcean, etc.) or PaaS (Render, Heroku).

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the TypeScript code:
   ```bash
   npm run build
   ```
4. Start the server using a process manager like PM2 to ensure it stays running:
   ```bash
   npm install -g pm2
   pm2 start dist/index.js --name agenticpay-backend
   pm2 save
   pm2 startup
   ```

### Step 3: Deploy the Frontend Web Application

The Next.js frontend is ideally suited for deployment on Vercel, but can also be hosted on a standard Node.js server.

**Option A: Deploying to Vercel (Recommended)**
1. Push your code to a GitHub repository.
2. Import the project in the Vercel Dashboard.
3. Set the Root Directory to `frontend`.
4. Add all environment variables from your `.env.local` file into the Vercel project settings.
5. Click **Deploy**.

**Option B: Manual Node.js Server Deployment**
1. Navigate to the `frontend/` directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the production application:
   ```bash
   npm run build
   ```
4. Start the application:
   ```bash
   npm start
   ```

## Rollback Procedures

If an issue occurs after a deployment, follow these rollback procedures for the affected components:

### Frontend Rollback
- **Vercel**: Navigate to the "Deployments" tab in your Vercel project dashboard, find the previous stable deployment, click the vertical dots, and select "Promote to Production".
- **Manual**: Revert your git working tree to the last stable commit (`git checkout <commit_hash>`), run `npm run build`, and restart the application (`pm2 restart agenticpay-frontend`).

### Backend Rollback
1. Revert the codebase to the last known stable state:
   ```bash
   git checkout <stable_commit_hash>
   ```
2. Re-build the application:
   ```bash
   npm run build
   ```
3. Restart the backend process:
   ```bash
   pm2 restart agenticpay-backend
   ```

### Smart Contract Rollback
Smart contracts deployed on Stellar (Soroban) are immutable. "Rolling back" a smart contract involves deploying a new version of the contract and migrating existing services to point to the new Contract ID.
1. Revert your contract codebase to the last stable commit.
2. Re-build and re-deploy the contract following **Step 1** of the deployment process.
3. Update the `SOROBAN_CONTRACT_ID` (or equivalent) environment variables in both the Backend and Frontend to point to the new Contract ID.
4. Restart the Backend and redeploy the Frontend to apply the configuration changes.
*(Note: If the flawed contract holds funds in escrow, manual migration or refund procedures must be executed via the old contract logic if possible).*
