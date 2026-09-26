variable "domain_name" {
  type        = string
  description = "Root domain name for DNS configuration"
}

variable "environment" {
  type        = string
  description = "Environment name (production, staging, etc.)"
  default     = "production"
}

variable "primary_endpoint" {
  type        = string
  description = "Primary endpoint FQDN or IP address"
}

variable "secondary_endpoint" {
  type        = string
  description = "Secondary endpoint FQDN or IP address for failover"
}

variable "primary_zone_id" {
  type        = string
  description = "AWS Route53 zone ID for primary region"
}

variable "secondary_zone_id" {
  type        = string
  description = "AWS Route53 zone ID for secondary region"
}

variable "alarm_actions" {
  type        = list(string)
  description = "SNS topic ARNs for alarm notifications"
  default     = []
}

variable "health_check_interval" {
  type        = number
  description = "Health check interval in seconds"
  default     = 30
}

variable "health_check_failure_threshold" {
  type        = number
  description = "Number of consecutive failures before marking unhealthy"
  default     = 3
}

variable "health_check_timeout" {
  type        = number
  description = "Health check timeout in seconds"
  default     = 4
}
