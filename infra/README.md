# AgenticPay Infrastructure

This directory contains the Infrastructure as Code (IaC) for AgenticPay using Terraform. It provisions AWS resources for the Next.js frontend (AWS Amplify), Express.js backend (AWS App Runner), and underlying networking (VPC).

## Architecture
- **State Management**: Remote state stored securely in AWS S3 with DynamoDB state locking.
- **Frontend**: AWS Amplify (optimizes Next.js SSR and static asset delivery).
- **Backend**: AWS App Runner (serverless container compute pulling from ECR).
- **Networking**: Isolated VPC with public/private subnets and NAT Gateways.

## Supported Environments
We use a workspace/tfvars approach to support multiple environments:
- `dev`: Active development and testing against Stellar Testnet.
- `staging`: Pre-production replica against Stellar Testnet.
- `prod`: Live production environment against Stellar Public network.

## Usage Guide

### Prerequisites
1. Install [Terraform](https://developer.hashicorp.com/terraform/downloads) (>= 1.5.0).
2. Configure your AWS CLI credentials (`aws configure`).

### Deployment Steps

1. **Initialize Terraform**
   Downloads the required providers and initializes the S3 backend.
   ```bash
   terraform init
   ```
2. Select an Environment 
   Select the workspace corresponding to your environment (create it if it doesn't exist).
   ```
   terraform workspace select dev || terraform workspace new dev
   ```
3. Plan the Deployment
   Review the changes Terraform will make to your infrastructure.
   ```bash
   terraform plan -var-file="environments/dev.tfvars"
   ```
4. Apply the Changes
   Provision the resources.
   ```bash
   terraform apply -var-file="environments/dev.tfvars"
   ```