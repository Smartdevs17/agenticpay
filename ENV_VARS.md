# Environment Variables

## Backend

| Variable             | Description                         | Default | Required |
| -------------------- | ----------------------------------- | ------- | -------- |
| PORT                 | Server port                         | 3001    | No       |
| CORS_ALLOWED_ORIGINS | Allowed origins for CORS            | \*      | No       |
| JOBS_ENABLED         | Enable/disable background jobs      | true    | No       |
| STELLAR_NETWORK      | Stellar network (testnet or public) | testnet | No       |
| OPENAI_API_KEY       | OpenAI API key for AI services      | -       | **Yes**  |
| SOROBAN_CONTRACT_ID  | Deployed Soroban contract to pin; enables startup hash verification | - | No |
| SOROBAN_RPC_URL      | Soroban RPC endpoint used to fetch deployed bytecode | testnet RPC | Required when `STELLAR_NETWORK=public` |
| SOROBAN_BUILD_MANIFEST | Path to the build manifest | `contracts/build-manifest.json` | No |
| CONTRACT_HASH_VERIFICATION | Contract hash check mode: `enforce`, `warn` or `off` | enforce | No |

## Frontend

| Variable                | Description          | Default                      |
| ----------------------- | -------------------- | ---------------------------- |
| NEXT_PUBLIC_API_URL     | Backend API base URL | http://localhost:3001/api/v1 |
| NEXT_PUBLIC_BACKEND_URL | Backend URL fallback | http://localhost:3001/api/v1 |

## Environment Files

- `.env.example`
PORT=3001
CORS_ALLOWED_ORIGINS=http://localhost:3000
JOBS_ENABLED=true
STELLAR_NETWORK=testnet
SOROBAN_CONTRACT_ID=
SOROBAN_RPC_URL=
SOROBAN_BUILD_MANIFEST=contracts/build-manifest.json
CONTRACT_HASH_VERIFICATION=enforce
OPENAI_API_KEY=sk-your-openai-api-key

- `.env.development` — local development
- `.env.staging` — staging environment
- `.env.production` — production environment

## Notes

- Never commit `.env` files containing real secrets to version control
- Copy the appropriate file and rename to `.env` when running locally
