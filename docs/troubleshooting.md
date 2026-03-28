# Troubleshooting Guide

This guide provides solutions to common issues encountered while setting up, developing, or deploying AgenticPay.

## Common Errors & Solutions

### Backend Issues

#### Port Already in Use (3001)
**Error**: `Error: listen EADDRINUSE: address already in use :::3001`
**Solution**:
```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Or specify a different port in your .env file
PORT=3002 npm run dev
```

#### OpenAI API Errors
**Error**: `401 Unauthorized` or `429 Too Many Requests`
**Solution**:
- Verify your `OPENAI_API_KEY` in `backend/.env` is correct.
- Check if your API key has sufficient quota at [platform.openai.com](https://platform.openai.com/account/usage/overview).
- Ensure you haven't exceeded rate limits for your account tier.

#### CORS Errors
**Error**: `Access to fetch at '...' from origin '...' has been blocked by CORS policy`
**Solution**:
- Update `CORS_ALLOWED_ORIGINS` in `backend/.env` to include your frontend URL.
- Current development default: `CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001`

### Frontend Issues

#### API Connection Failed
**Error**: `FetchError: request to http://localhost:3001/api/v1/health failed`
**Solution**:
- Verify the backend server is running on the correct port.
- Check `NEXT_PUBLIC_API_URL` in `frontend/.env.local` matches your backend URL.
- Ensure there are no firewall rules blocking local traffic between ports 3000 and 3001.

#### Web3Auth Connection Issues
**Error**: `Web3Auth error: Invalid client id`
**Solution**:
- Verify `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` in `frontend/.env.local` is correct.
- Ensure the redirect URL in your Web3Auth dashboard matches your local development URL (usually `http://localhost:3000`).

#### Contract Address Not Found
**Error**: `Error: Contract not found at address ...`
**Solution**:
- Verify `NEXT_PUBLIC_CONTRACT_ADDRESS` is correctly set to a deployed Soroban contract.
- Check the contract status on Stellar Testnet using the Stellar CLI:
  ```bash
  stellar contract info --id <contract_id> --network testnet
  ```

### Smart Contract & Stellar Issues

#### Soroban CLI Installation Failures
**Error**: `cargo install soroban-cli` fails with compilation errors.
**Solution**:
- Ensure you have the latest Rust version: `rustup update`.
- Install required system dependencies (e.g., `libssl-dev`, `pkg-config` on Linux).
- Try installing the pre-compiled binary instead.

#### Insufficient Testnet XLM
**Error**: `Transaction failed: op_insufficient_balance`
**Solution**:
- Fund your testnet account using Friendbot:
  ```bash
  curl "https://friendbot.stellar.org/?addr=<your_public_key>"
  ```

---

## Debug Tips

### 1. Check Backend Health
Always verify the backend is healthy before debugging frontend issues:
```bash
curl http://localhost:3001/api/v1/health
```

### 2. Inspect Smart Contract State
Use the Stellar CLI to read contract data directly from the network:
```bash
stellar contract read --id <contract_id> --source <account> --network testnet
```

### 3. Clear Local Cache
If you encounter weird UI behaviors after an update:
```bash
# Frontend
rm -rf frontend/.next
npm run dev

# Global Node Modules
rm -rf node_modules package-lock.json
npm install
```

---

## FAQ

**Q: Can I run AgenticPay on Mainnet?**
A: Yes, but ensure you update `STELLAR_NETWORK` to `public` and use a production-ready RPC provider in your environment variables.

**Q: How do I update a deployed smart contract?**
A: Soroban contracts are currently immutable. You must deploy a new version and update the `CONTRACT_ID` in your backend and frontend configuration.

**Q: Why is AI verification taking so long?**
A: AI verification depends on the OpenAI API response time and the size of the codebase being reviewed. Ensure your `GITHUB_TOKEN` is configured to avoid rate limits when fetching repos.
