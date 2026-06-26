# Pull Request: Add Deployment Guidelines

## 📝 Description
This Pull Request introduces comprehensive deployment documentation for AgenticPay. Previously, the project lacked centralized instructions for deploying the various components. This guide provides step-by-step instructions for deploying the Smart Contracts, Backend API Server, and Frontend Web Application.

## 🚀 Changes Made
Created a new `docs/deployment.md` file including:
- **Deployment Prerequisites**: Outlining required tools (Node.js, Rust, Cargo, Stellar CLI, PM2).
- **Environment Configuration**: Listing necessary `.env` variables for smart contracts, backend, and frontend.
- **Deployment Steps**: Detailed execution order for building and deploying each part of the stack (contracts -> backend -> frontend).
- **Rollback Procedures**: Clear instructions for reverting failed deployments on all layers, including smart contract behavior.

## ✅ Checklist
- [x] Verified prerequisites are accurate for the current tech stack.
- [x] Verified deployment steps align with actual project structure (Next.js, Express, Soroban).
- [x] Documentation is formatted in clean and readable Markdown.

## 📸 Notes to Reviewers
Reviewers, please confirm that the environment variables listed for the React frontend and Express backend match any recent updates to our config systems, and that the Smart Contract deployment steps match the latest Soroban CLI changes.
