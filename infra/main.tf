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

  # Security group for RDS
  create_database_subnet_group = true
  database_subnets             = var.database_subnets
  create_database_internet_gateway_route = false
}

# ------------------------------------------------------------------------------
# DATABASE RESOURCES (PostgreSQL + PgBouncer via RDS Proxy)
# ------------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "agenticpay-${var.environment}-db-subnet-group"
  subnet_ids = module.vpc.database_subnets

  tags = {
    Name = "agenticpay-${var.environment}-db-subnet-group"
  }
}

resource "aws_security_group" "rds" {
  name   = "agenticpay-${var.environment}-rds-sg"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port = 5432
    to_port   = 5432
    protocol  = "tcp"
    security_groups = [aws_security_group.rds_proxy.id]
    description     = "Allow RDS Proxy access to PostgreSQL"
  }

  tags = {
    Name = "agenticpay-${var.environment}-rds-sg"
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "agenticpay-${var.environment}"

  engine         = "postgres"
  engine_version = "16.3"
  instance_class = var.db_instance_class

  db_name  = "agenticpay"
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  backup_retention_period = var.environment == "prod" ? 30 : 7
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"

  auto_minor_version_upgrade = true
  deletion_protection        = var.environment == "prod"
  skip_final_snapshot        = var.environment != "prod"
  copy_tags_to_snapshot      = true

  performance_insights_enabled          = var.environment == "prod"
  performance_insights_retention_period = var.environment == "prod" ? 7 : 0

  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = {
    Name = "agenticpay-${var.environment}"
  }
}

# RDS Proxy (AWS-managed PgBouncer in transaction mode)
resource "aws_security_group" "rds_proxy" {
  name   = "agenticpay-${var.environment}-rds-proxy-sg"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port = 5432
    to_port   = 5432
    protocol  = "tcp"
    # Allow from App Runner VPC connector (default security group)
    security_groups = [module.vpc.default_security_group_id]
    description     = "Allow App Runner to connect to RDS Proxy"
  }

  egress {
    from_port = 5432
    to_port   = 5432
    protocol  = "tcp"
    security_groups = [aws_security_group.rds.id]
    description     = "Allow RDS Proxy to connect to RDS"
  }

  tags = {
    Name = "agenticpay-${var.environment}-rds-proxy-sg"
  }
}

resource "aws_db_proxy" "pgbouncer" {
  name                   = "agenticpay-${var.environment}-proxy"
  debug_logging          = var.environment != "prod"
  engine_family          = "POSTGRESQL"
  idle_client_timeout    = var.db_proxy_idle_timeout
  require_tls            = true
  role_arn               = aws_iam_role.rds_proxy.arn
  vpc_subnet_ids         = module.vpc.database_subnets
  vpc_security_group_ids = [aws_security_group.rds_proxy.id]

  auth {
    auth_scheme = "SECRETS"
    description = "RDS Proxy authentication via Secrets Manager"
    iam_auth    = "DISABLED"
    secret_arn  = aws_secretsmanager_secret.db_credentials.arn
  }

  connection_pool_config {
    connection_borrow_timeout    = var.db_proxy_borrow_timeout
    init_query                   = "SET application_name = 'agenticpay'"
    max_connections_percent      = var.db_proxy_max_connections_percent
    max_idle_connections_percent = var.db_proxy_max_idle_connections_percent
    session_pinning_filters      = ["EXCLUDE_VARIABLE_SETS"]
  }
}

resource "aws_db_proxy_default_target_group" "main" {
  db_proxy_name = aws_db_proxy.pgbouncer.name

  connection_pool_config {
    connection_borrow_timeout    = var.db_proxy_borrow_timeout
    init_query                   = "SET application_name = 'agenticpay'"
    max_connections_percent      = var.db_proxy_max_connections_percent
    max_idle_connections_percent = var.db_proxy_max_idle_connections_percent
    session_pinning_filters      = ["EXCLUDE_VARIABLE_SETS"]
  }
}

resource "aws_db_proxy_target" "main" {
  db_proxy_name = aws_db_proxy.pgbouncer.name
  target_group_name = aws_db_proxy_default_target_group.main.name
  db_instance_identifier = aws_db_instance.postgres.identifier
}

# Secrets Manager for database credentials
resource "aws_secretsmanager_secret" "db_credentials" {
  name = "agenticpay-${var.environment}-db-credentials"
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = var.db_password
    engine   = "postgres"
    host     = aws_db_proxy.pgbouncer.endpoint
    port     = 5432
    dbname   = "agenticpay"
    dbInstanceIdentifier = aws_db_instance.postgres.identifier
  })
}

resource "aws_iam_role" "rds_proxy" {
  name = "agenticpay-${var.environment}-rds-proxy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "rds.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "rds_proxy_secrets" {
  name = "agenticpay-${var.environment}-rds-proxy-secrets-policy"
  role = aws_iam_role.rds_proxy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = "secretsmanager:GetSecretValue"
        Effect   = "Allow"
        Resource = aws_secretsmanager_secret.db_credentials.arn
      }
    ]
  })
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
          NODE_ENV              = var.environment
          STELLAR_NETWORK       = var.stellar_network
          PGBOUNCER_ENABLED     = "true"
          DATABASE_URL          = "postgresql://${var.db_username}:${var.db_password}@${aws_db_proxy.pgbouncer.endpoint}:5432/agenticpay"
          DB_POOL_MAX           = var.db_proxy_pool_max
          DB_POOL_MIN           = var.db_proxy_pool_min
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

  # HTTP/2 is enabled by default on AWS Amplify (ALPN negotiation via CloudFront).
  # custom_headers propagates Link preload hints so CloudFront can issue
  # HTTP/2 PUSH_PROMISE frames for critical fonts and CSS before the HTML
  # has been parsed by the browser.
  custom_headers = <<-EOT
    customHeaders:
      - pattern: '**'
        headers:
          - key: 'X-Frame-Options'
            value: 'SAMEORIGIN'
          - key: 'Link'
            value: '</fonts/inter-var.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin=anonymous'
  EOT

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
