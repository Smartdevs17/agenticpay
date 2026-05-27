# AgenticPay Public Roadmap

AgenticPay is an AI-powered decentralized payment infrastructure built on Stellar, enabling trustless escrow and automated work verification between clients and contributors. This roadmap reflects current development priorities, upcoming features, and the long-term vision for the platform.

> **Last updated:** March 2026
> **Network:** Stellar Testnet (Mainnet launch planned — see [Long-Term Goals](#long-term-goals))

---

## Current Milestone

**v0.4 — Production Hardening & Developer Experience**

The team is focused on stabilizing the existing feature set and making the platform reliable enough for broader public use. Work in this milestone includes:

- **Advanced invoice editing** — Full CRUD editing for generated invoices, including line items, tax fields, and custom metadata (PR #167)
- **Backend environment validation** — Zod-based schema validation for all environment variables at startup, preventing misconfigured deployments from silently failing
- **Transaction failure recovery** — Retry logic and user-facing error recovery flows for failed Stellar transactions, including fee-bump support
- **Recurring Payment Engine** — Implementation of the SubscriptionManager for automated periodic payments (Completed v0.4 addition)
- **Response caching with ETags** — Per-route TTL caching with `ETag` / `If-None-Match` support across the Express API, reducing redundant blockchain lookups
- **Infrastructure as code** — Terraform modules for dev/staging/prod environments with cost tagging, auto-scaling, and automated rollback scripts
- **Tiered rate limiting** — Separate limits for free, pro, and enterprise API consumers, backed by a configurable custom store

---

## Upcoming Features

These items are planned for the next one to two milestones. Ordering reflects rough priority, not a fixed schedule.

### Payment & Escrow
- **Multi-token escrow** — Support USDC and other Stellar assets (currently XLM-only) so clients and freelancers can settle in stablecoins
- **Partial payment releases** — Allow milestone-based partial fund releases before full project completion, reducing lock-up risk for longer engagements
- **Dispute dashboard** — A dedicated UI for tracking open disputes, viewing arbitration status, and submitting evidence

### AI Verification
- **Pluggable verifier backends** — Abstract the OpenAI dependency behind a provider interface so teams can use Anthropic, local models, or custom verification logic
- **Structured verification reports** — Return per-criterion pass/fail breakdowns instead of a single boolean, giving both parties transparency into what was checked
- **Human-in-the-loop override** — Allow clients to optionally require a human review step before AI approval triggers fund release

### Developer & Platform
- **Webhook notifications** — Push project lifecycle events (funded, work submitted, verified, disputed) to user-configured endpoints
- **SDK / npm package** — A typed JavaScript/TypeScript client library wrapping the Soroban contract calls and REST API, making integrations easier for external developers
- **Contract event indexing** — A lightweight indexer that listens to on-chain `ProjectCreated` and state-change events and exposes them via a queryable API
- **Role-based access control** — Support team accounts where multiple members can manage projects under a shared organization

### Observability & Quality
- **Distributed tracing** — Propagate trace IDs from the frontend through the backend to Stellar Horizon calls, enabling end-to-end request tracing
- **SLA alerting** — Integrate the existing SLA tracking middleware with PagerDuty or a configurable webhook so on-call engineers are notified when p99 latency exceeds thresholds
- **Expanded test coverage** — Integration tests covering the full escrow lifecycle (create → fund → submit → verify → release) against a local Stellar sandbox

---

## Long-Term Goals

These represent the broader vision for where AgenticPay is headed over the next several development cycles.

### Stellar Mainnet Launch
Move from Testnet to the Stellar public network with a formal security audit of the Soroban smart contracts. This includes a responsible disclosure policy, bug bounty program, and a staged rollout starting with a capped deployment.

### Autonomous Agent-to-Agent Payments
Enable AI agents to participate in the payment network without human intermediaries — an agent can create a project, fund it, submit work, and trigger payment entirely programmatically. This aligns with the broader agentic-AI ecosystem where LLM-powered tools need native payment primitives.

### Cross-Chain Compatibility
Extend escrow support beyond Stellar to EVM-compatible networks (using the existing Wagmi/Viem infrastructure already in the frontend) and eventually to other chains via bridges or a chain-agnostic settlement layer.

### Reputation & Trust Layer
Build an on-chain reputation system that aggregates a contributor's history of approvals, disputes, and resolution outcomes. Reputation scores could influence default escrow terms, dispute resolution weight, and platform fee tiers.

### Decentralized Governance
Transition platform parameter changes (fee structures, verifier whitelisting, dispute resolution rules) to an on-chain governance process, reducing reliance on a central admin key.

### Enterprise & DAO Integrations
Provide first-class support for DAOs paying contributors for bounties and grants, including multi-sig approval flows, treasury management integrations, and bulk payout tooling.

---

## How to Contribute Ideas

AgenticPay is built in public through the **Stellar Wave Program via Drips**, and community input directly shapes what gets built.

### Submit a Feature Request
Open an issue on GitHub using the **Feature Request** template. A good feature request includes:
- The problem you're trying to solve (not just the solution)
- Who would benefit and how often the use case arises
- Any constraints or tradeoffs you've thought through

### Join the Discussion
Check the existing GitHub Issues and Discussions before opening something new — your idea may already have a thread. Upvoting and adding context to existing issues is often more valuable than creating duplicates.

### Work on a Bounty
Open tasks eligible for Stellar Wave Program bounties are labeled `bounty` in the issue tracker. Before starting, comment on the issue to claim it and avoid duplicate work. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full contribution workflow, code style guide, and PR review process.

### Share Feedback on This Roadmap
This document is not set in stone. If you think a priority is wrong, a use case is missing, or an item in the long-term section should be pulled forward, open an issue titled `[Roadmap Feedback]: <your topic>` and make your case. The maintainers review roadmap feedback each milestone.
