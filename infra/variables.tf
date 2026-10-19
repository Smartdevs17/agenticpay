variable "aws_region" {
  description = "The AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "The deployment environment (dev, staging, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "stellar_network" {
  description = "Stellar network to connect to (testnet or public)"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
}

variable "private_subnets" {
  description = "List of private subnet CIDRs"
  type        = list(string)
}

variable "public_subnets" {
  description = "List of public subnet CIDRs"
  type        = list(string)
}

variable "database_subnets" {
  description = "List of database subnet CIDRs"
  type        = list(string)
  default     = []
}

# ── Database Variables ──────────────────────────────────────────────────────────

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

variable "db_username" {
  description = "RDS master username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

variable "db_allocated_storage" {
  description = "Allocated storage for RDS in GB"
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Maximum autoscaled storage for RDS in GB"
  type        = number
  default     = 100
}

# ── RDS Proxy (PgBouncer) Variables ────────────────────────────────────────────

variable "db_proxy_borrow_timeout" {
  description = "Max time in seconds to borrow a connection from the pool"
  type        = number
  default     = 30
}

variable "db_proxy_max_connections_percent" {
  description = "Max connections percentage for RDS Proxy"
  type        = number
  default     = 100
}

variable "db_proxy_max_idle_connections_percent" {
  description = "Max idle connections percentage for RDS Proxy"
  type        = number
  default     = 50
}

variable "db_proxy_idle_timeout" {
  description = "Idle client timeout in seconds for RDS Proxy"
  type        = number
  default     = 1800
}

variable "db_proxy_pool_max" {
  description = "Max pool connections for the application"
  type        = number
  default     = 25
}

variable "db_proxy_pool_min" {
  description = "Min pool connections for the application"
  type        = number
  default     = 2
}
