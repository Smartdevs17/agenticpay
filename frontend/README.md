This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Content Security Policy

Every page is served with a strict, nonce-based CSP (#1466). `middleware.ts`
creates a fresh 128-bit nonce for each request and builds the policy with
`lib/csp.ts`. Next.js reads the nonce from the forwarded request header and
adds it to every script it renders:

```
script-src 'self' 'nonce-<per request>' 'strict-dynamic'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'none'; ...
```

- **Scripts:** only nonced scripts run, plus the chunks they load
  (`'strict-dynamic'`). Injected `<script>` tags and inline event handlers are
  blocked. `next dev` also gets `'unsafe-eval'`, which React needs for debugging.
- **Inline scripts:** add them through Next.js (`next/script`, or read the
  nonce with `(await headers()).get('x-nonce')` in a server component). A raw
  inline `<script>` without the nonce will not run.
- **Styles** keep `'unsafe-inline'`, because React, Radix and Web3Modal set
  inline style attributes, which a nonce cannot cover.
- **Connections** allow any `https:`/`wss:` origin, for wallet RPCs and
  WalletConnect relays, plus the configured API and WebSocket origins.
- **Framing** is denied (`frame-ancestors 'none'` and `X-Frame-Options: DENY`)
  except on `/forms/embed/:id`, which merchants embed on their own sites.
- **Rendering:** the root layout calls `connection()`, so pages render per
  request. A nonce cannot be added to statically prerendered HTML.

Rollout and monitoring:

- Set `CSP_REPORT_ONLY=true` to send the policy as
  `Content-Security-Policy-Report-Only`. Browsers then report violations without
  blocking anything. Remove the variable to enforce.
- Reports go to `CSP_REPORT_URI` or, by default, to Sentry's security endpoint
  for `NEXT_PUBLIC_SENTRY_DSN`. They are sent through both `report-uri` and
  `report-to` with a `Reporting-Endpoints` header.

`nosniff` and `Referrer-Policy` are static headers in `next.config.ts`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
