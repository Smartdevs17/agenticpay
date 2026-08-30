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
# ENCRYPTION AT REST (customer-managed KMS key for sensitive data fields)
# ------------------------------------------------------------------------------

resource "aws_kms_key" "data_at_rest" {
  description             = "Customer-managed key for agenticpay-${var.environment} encryption at rest (RDS, Secrets Manager, backups)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "data_at_rest" {
  name          = "alias/agenticpay-${var.environment}-data-at-rest"
  target_key_id = aws_kms_key.data_at_rest.key_id
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
  kms_key_id            = aws_kms_key.data_at_rest.arn

  backup_retention_period = var.environment == "prod" ? 30 : 7
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"

  auto_minor_version_upgrade = true
  deletion_protection        = var.environment == "prod"
  skip_final_snapshot        = var.environment != "prod"
  copy_tags_to_snapshot      = true
  multi_az                   = var.environment == "prod"

  performance_insights_enabled          = var.environment == "prod"
  performance_insights_retention_period = var.environment == "prod" ? 7 : 0
  performance_insights_kms_key_id       = var.environment == "prod" ? aws_kms_key.data_at_rest.arn : null

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
  name       = "agenticpay-${var.environment}-db-credentials"
  kms_key_id = aws_kms_key.data_at_rest.arn
}

# Secrets Manager for application-level secrets (Stripe, OpenAI, VAPID keys, etc).
# Loaded at runtime by backend/src/config/environments/secrets-manager.ts when
# AWS_SECRETS_MANAGER_ENABLED=true. Not managed for dev — dev uses local env vars.
resource "aws_secretsmanager_secret" "app_secrets" {
  count = var.environment == "dev" ? 0 : 1

  name       = "agenticpay-${var.environment}-app-secrets"
  kms_key_id = aws_kms_key.data_at_rest.arn
}

resource "aws_iam_policy" "app_secrets_read" {
  count = var.environment == "dev" ? 0 : 1

  name = "agenticpay-${var.environment}-app-secrets-read-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action   = "secretsmanager:GetSecretValue"
        Effect   = "Allow"
        Resource = aws_secretsmanager_secret.app_secrets[0].arn
      }
    ]
  })
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
# AUTOMATED BACKUP & DISASTER RECOVERY (AWS Backup for PITR)
# ------------------------------------------------------------------------------

resource "aws_backup_vault" "db_backup_vault" {
  name        = "agenticpay-${var.environment}-db-backup-vault"
  kms_key_arn = aws_kms_key.data_at_rest.arn
}

resource "aws_backup_plan" "db_backup_plan" {
  name = "agenticpay-${var.environment}-db-backup-plan"

  rule {
    rule_name         = "agenticpay-continuous-backup-rule"
    target_vault_name = aws_backup_vault.db_backup_vault.name
    schedule          = "cron(0 12 * * ? *)" # Daily at 12:00 UTC

    enable_continuous_backup = true

    lifecycle {
      delete_after = var.environment == "prod" ? 35 : 7
    }
  }
}

resource "aws_backup_selection" "db_backup_selection" {
  iam_role_arn = aws_iam_role.backup_role.arn
  name         = "agenticpay-${var.environment}-db-backup-selection"
  plan_id      = aws_backup_plan.db_backup_plan.id

  resources = [
    aws_db_instance.postgres.arn
  ]
}

resource "aws_iam_role" "backup_role" {
  name = "agenticpay-${var.environment}-backup-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "backup.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "backup_policy" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
  role       = aws_iam_role.backup_role.name
}

resource "aws_iam_role_policy_attachment" "restore_policy" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
  role       = aws_iam_role.backup_role.name
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
# HTTP/3 (QUIC) CONFIGURATION
# ------------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "default" {
  name                              = "agenticpay-${var.environment}-oac"
  description                       = "OAC for AgenticPay ${var.environment}"
  origin_access_control_origin_type = "mediapackagev2"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "static_assets" {
  name    = "agenticpay-${var.environment}-static-assets-headers"
  comment = "Long-lived static asset caching and safe cross-origin loading"

  cors_config {
    access_control_allow_credentials = false

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }

    access_control_allow_origins {
      items = ["*"]
    }

    origin_override = true
  }

  custom_headers_config {
    items {
      header   = "X-CDN"
      value    = "cloudfront"
      override = true
    }
  }

  security_headers_config {
    content_type_options {
      override = true
    }
  }
}

# Frontend CloudFront distribution with HTTP/3 support
resource "aws_cloudfront_distribution" "frontend" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = var.enable_http3 ? "http3" : "http2"
  price_class     = "PriceClass_100"
  aliases         = var.domain_aliases

  origin {
    domain_name = aws_amplify_app.frontend.default_domain
    origin_id   = "amplify-frontend"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD", "OPTIONS"]
    target_origin_id = "amplify-frontend"
    compress         = true

    forwarded_values {
      query_string = true
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  ordered_cache_behavior {
    path_pattern               = "/_next/static/*"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    target_origin_id           = "amplify-frontend"
    compress                   = true
    viewer_protocol_policy     = "redirect-to-https"
    min_ttl                    = 86400
    default_ttl                = 31536000
    max_ttl                    = 31536000
    response_headers_policy_id = aws_cloudfront_response_headers_policy.static_assets.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/images/*"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    target_origin_id           = "amplify-frontend"
    compress                   = true
    viewer_protocol_policy     = "redirect-to-https"
    min_ttl                    = 3600
    default_ttl                = 604800
    max_ttl                    = 31536000
    response_headers_policy_id = aws_cloudfront_response_headers_policy.static_assets.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/fonts/*"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD", "OPTIONS"]
    target_origin_id           = "amplify-frontend"
    compress                   = true
    viewer_protocol_policy     = "redirect-to-https"
    min_ttl                    = 86400
    default_ttl                = 31536000
    max_ttl                    = 31536000
    response_headers_policy_id = aws_cloudfront_response_headers_policy.static_assets.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = {
    Name = "agenticpay-${var.environment}-frontend-cf"
  }
}

# Backend API CloudFront distribution with HTTP/3 support
resource "aws_cloudfront_distribution" "backend" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = var.enable_http3 ? "http3" : "http2"
  price_class     = "PriceClass_100"

  origin {
    domain_name = aws_apprunner_service.backend.service_url
    origin_id   = "apprunner-backend"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD", "OPTIONS"]
    target_origin_id = "apprunner-backend"
    compress         = true

    forwarded_values {
      query_string = true
      cookies {
        forward = "all"
      }
      headers = ["Authorization", "Content-Type", "X-API-Key", "X-HMAC-Signature"]
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 60
    max_ttl                = 3600
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = {
    Name = "agenticpay-${var.environment}-backend-cf"
  }
}

# ------------------------------------------------------------------------------
# FRONTEND RESOURCES (Next.js)
# ------------------------------------------------------------------------------
resource "aws_amplify_app" "frontend" {
  name       = "agenticpay-frontend-${var.environment}"
  repository = "https://github.com/Smartdevs17/agenticpay"

  custom_headers = <<-EOT
    customHeaders:
      - pattern: '**'
        headers:
          - key: 'X-Frame-Options'
            value: 'SAMEORIGIN'
          - key: 'Link'
            value: '</fonts/inter-var.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin=anonymous'
          - key: 'Alt-Svc'
            value: 'h3=":443"; ma=86400'
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
    NEXT_PUBLIC_API_URL = "https://${aws_cloudfront_distribution.backend.domain_name}/api/v1"
    NODE_ENV            = var.environment
  }
}

# ------------------------------------------------------------------------------
# GAS METRICS MONITORING
# ------------------------------------------------------------------------------

# CloudWatch Log Group for Gas Estimation Service
resource "aws_cloudwatch_log_group" "gas_metrics" {
  name              = "/aws/agenticpay/gas-metrics-${var.environment}"
  retention_in_days = var.environment == "prod" ? 30 : 7

  tags = {
    Name = "agenticpay-gas-metrics-${var.environment}"
  }
}

# CloudWatch Dashboard for Gas Metrics
resource "aws_cloudwatch_dashboard" "gas_metrics" {
  dashboard_name = "agenticpay-gas-metrics-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/AppRunner", "CPUUtilization", "ServiceName", aws_apprunner_service.backend.service_name],
            [".", "MemoryUtilization", ".", "."],
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Backend Resource Utilization"
          view   = "timeSeries"
        }
      },
      {
        type   = "log"
        x      = 0
        y      = 6
        width  = 24
        height = 6

        properties = {
          logGroupName  = aws_cloudwatch_log_group.gas_metrics.name
          query        = "fields @timestamp, @message | filter @message like /GAS_ESTIMATE/ | stats count() by @timestamp"
          region       = var.aws_region
          title        = "Gas Estimate Requests"
          view         = "table"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", aws_db_instance.postgres.identifier],
            [".", "DatabaseConnections", ".", "."],
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Database Performance"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiName", "agenticpay-backend-${var.environment}"],
            [".", "Latency", ".", "."],
            [".", "5XXError", ".", "."],
            [".", "4XXError", ".", "."],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "API Gateway Metrics"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 12
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", aws_cloudfront_distribution.backend.id],
            [".", "Latency", ".", "."],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "CloudFront Backend Metrics"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 18
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", aws_cloudfront_distribution.frontend.id, { stat: "Sum" }],
            [".", "TotalErrorRate", ".", ".", { stat: "Average" }],
          ]
          period = 300
          stat   = "Sum"
          region = var.aws_region
          title  = "Frontend CDN — Request Volume & Error Rate"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 18
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/CloudFront", "CacheHitRate", "DistributionId", aws_cloudfront_distribution.frontend.id, { stat: "Average" }],
            [".", "OriginLatency", ".", ".", { stat: "p95" }],
          ]
          period = 300
          stat   = "Average"
          region = var.aws_region
          title  = "Frontend CDN — Cache Hit Rate & Origin Latency (p95)"
          view   = "timeSeries"
        }
      },
    ]
  })
}

# CloudWatch Alarm for High Gas Estimation Error Rate
resource "aws_cloudwatch_metric_alarm" "gas_estimation_error_rate" {
  alarm_name          = "agenticpay-gas-estimation-error-rate-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "5XXError"
  namespace           = "AWS/AppRunner"
  period              = "300"
  statistic           = "Sum"
  threshold           = var.environment == "prod" ? "10" : "50"
  alarm_description   = "Alert when gas estimation error rate exceeds threshold"
  alarm_actions       = var.environment == "prod" ? [aws_sns_topic.alerts.arn] : []

  dimensions = {
    ServiceName = aws_apprunner_service.backend.service_name
  }
}

# CloudWatch Alarm for High Database Connection Usage
resource "aws_cloudwatch_metric_alarm" "db_connection_usage" {
  alarm_name          = "agenticpay-db-connection-usage-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = "300"
  statistic           = "Average"
  threshold           = var.db_proxy_max_connections_percent
  alarm_description   = "Alert when database connection usage exceeds threshold"
  alarm_actions       = var.environment == "prod" ? [aws_sns_topic.alerts.arn] : []

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }
}

# SNS Topic for Alerts
resource "aws_sns_topic" "alerts" {
  name = "agenticpay-alerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "email_alerts" {
  count     = var.environment == "prod" && var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
