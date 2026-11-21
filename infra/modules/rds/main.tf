// Issue #841: RDS Database Module
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_db_subnet_group" "db_subnet_group" {
  name       = "${var.db_identifier}-subnet-group"
  subnet_ids = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.db_identifier}-subnet-group"
  })
}

resource "aws_security_group" "db_security_group" {
  name        = "${var.db_identifier}-sg"
  description = "Security group for ${var.db_identifier}"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = var.db_port
    to_port     = var.db_port
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.db_identifier}-sg"
  })
}

resource "aws_rds_cluster" "db_cluster" {
  cluster_identifier      = var.db_identifier
  engine                  = var.db_engine
  engine_version          = var.db_engine_version
  database_name           = var.database_name
  master_username         = var.master_username
  master_password         = var.master_password
  db_subnet_group_name    = aws_db_subnet_group.db_subnet_group.name
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.cluster_params.name

  vpc_security_group_ids = [aws_security_group.db_security_group.id]

  backup_retention_period      = var.backup_retention_days
  preferred_backup_window      = "03:00-04:00"
  preferred_maintenance_window = "sun:04:00-sun:05:00"

  enabled_cloudwatch_logs_exports = var.enabled_log_types
  storage_encrypted               = true
  kms_key_id                      = var.kms_key_id

  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.db_identifier}-final-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}" : null

  enable_http_endpoint = true
  copy_tags_to_snapshot = true

  tags = merge(var.tags, {
    Name = var.db_identifier
  })
}

resource "aws_rds_cluster_parameter_group" "cluster_params" {
  family      = var.db_parameter_family
  name        = "${var.db_identifier}-cluster-params"
  description = "Cluster parameter group for ${var.db_identifier}"

  dynamic "parameter" {
    for_each = var.cluster_parameters
    content {
      name  = parameter.key
      value = parameter.value
      apply_method = "immediate"
    }
  }

  tags = merge(var.tags, {
    Name = "${var.db_identifier}-params"
  })
}

resource "aws_rds_cluster_instance" "db_instances" {
  count              = var.instance_count
  identifier         = "${var.db_identifier}-instance-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.db_cluster.id
  instance_class     = var.instance_class
  engine             = var.db_engine
  engine_version     = var.db_engine_version

  performance_insights_enabled          = var.enable_performance_insights
  performance_insights_retention_period = 7
  monitoring_interval                   = var.monitoring_interval
  monitoring_role_arn                   = aws_iam_role.rds_monitoring.arn

  tags = merge(var.tags, {
    Name = "${var.db_identifier}-instance-${count.index + 1}"
  })
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${var.db_identifier}-monitoring-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
