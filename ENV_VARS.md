# Environment Variables

## Backend

| Variable             | Description                         | Default |
| -------------------- | ----------------------------------- | ------- |
| PORT                 | Server port                         | 3001    |
| CORS_ALLOWED_ORIGINS | Allowed origins for CORS            | \*      |
| JOBS_ENABLED         | Enable/disable background jobs      | true    |
| STELLAR_NETWORK      | Stellar network (testnet or public) | testnet |

## Frontend

| Variable                | Description          | Default                      |
| ----------------------- | -------------------- | ---------------------------- |
| NEXT_PUBLIC_API_URL     | Backend API base URL | http://localhost:3001/api/v1 |
| NEXT_PUBLIC_BACKEND_URL | Backend URL fallback | http://localhost:3001/api/v1 |

## Environment Files

- `.env.development` — local development
- `.env.staging` — staging environment
- `.env.production` — production environment

## Notes

- Never commit `.env` files containing real secrets to version control
- Copy the appropriate file and rename to `.env` when running locally
