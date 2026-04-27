terraform {
  required_version = ">= 1.5.0"

  # Acceptance Criteria: State management
  backend "s3" {
    bucket         = "agenticpay-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "agenticpay-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "AgenticPay"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# ------------------------------------------------------------------------------
# FOUNDATIONAL NETWORKING
# ------------------------------------------------------------------------------
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.0.0"

  name = "agenticpay-${var.environment}-vpc"
  cidr = var.vpc_cidr

  azs             = ["${var.aws_region}a", "${var.aws_region}b"]
  private_subnets = var.private_subnets
  public_subnets  = var.public_subnets

  enable_nat_gateway = true
  single_nat_gateway = var.environment != "prod" # Cost optimization for non-prod
}

# ------------------------------------------------------------------------------
# BACKEND RESOURCES (Express.js API)
# ------------------------------------------------------------------------------
resource "aws_ecr_repository" "backend" {
  name                 = "agenticpay-backend-${var.environment}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_apprunner_service" "backend" {
  service_name = "agenticpay-backend-${var.environment}"

  source_configuration {
    image_repository {
      image_configuration {
        port = "3001"
        runtime_environment_variables = {
          NODE_ENV        = var.environment
          STELLAR_NETWORK = var.stellar_network
        }
      }
      image_identifier      = "${aws_ecr_repository.backend.repository_url}:latest"
      image_repository_type = "ECR"
    }
    auto_deployments_enabled = true
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.connector.arn
    }
  }
}

resource "aws_apprunner_vpc_connector" "connector" {
  vpc_connector_name = "agenticpay-vpc-connector-${var.environment}"
  subnets            = module.vpc.private_subnets
  security_groups    = [module.vpc.default_security_group_id]
}

# ------------------------------------------------------------------------------
# FRONTEND RESOURCES (Next.js)
# ------------------------------------------------------------------------------
resource "aws_amplify_app" "frontend" {
  name       = "agenticpay-frontend-${var.environment}"
  repository = "https://github.com/Smartdevs17/agenticpay"

  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        preBuild:
          commands:
            - cd frontend
            - npm install
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: frontend/.next
        files:
          - '**/*'
      cache:
        paths:
          - frontend/node_modules/**/*
  EOT

  environment_variables = {
    NEXT_PUBLIC_API_URL = "https://${aws_apprunner_service.backend.service_url}/api/v1"
    NODE_ENV            = var.environment
  }
}