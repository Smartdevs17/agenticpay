variable "db_identifier" {
  description = "RDS cluster identifier"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "db_engine" {
  description = "Database engine (aurora-mysql, aurora-postgresql)"
  type        = string
  default     = "aurora-postgresql"
}

variable "db_engine_version" {
  description = "Database engine version"
  type        = string
  default     = "15.2"
}

variable "database_name" {
  description = "Initial database name"
  type        = string
}

variable "master_username" {
  description = "Master database username"
  type        = string
  sensitive   = true
}

variable "master_password" {
  description = "Master database password"
  type        = string
  sensitive   = true
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs for RDS"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access database"
  type        = list(string)
}

variable "db_port" {
  description = "Database port"
  type        = number
  default     = 5432
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "instance_count" {
  description = "Number of RDS instances in cluster"
  type        = number
  default     = 1
}

variable "backup_retention_days" {
  description = "Number of days to retain backups"
  type        = number
  default     = 7
}

variable "db_parameter_family" {
  description = "DB parameter family"
  type        = string
  default     = "aurora-postgresql15"
}

variable "cluster_parameters" {
  description = "Cluster parameters to set"
  type        = map(string)
  default     = {}
}

variable "kms_key_id" {
  description = "KMS key ID for encryption"
  type        = string
  default     = ""
}

variable "enable_performance_insights" {
  description = "Enable Performance Insights"
  type        = bool
  default     = true
}

variable "monitoring_interval" {
  description = "Enhanced monitoring interval in seconds"
  type        = number
  default     = 60
}

variable "enabled_log_types" {
  description = "List of log types to enable"
  type        = list(string)
  default     = ["postgresql"]
}

variable "tags" {
  description = "Additional tags to apply"
  type        = map(string)
  default     = {}
}
