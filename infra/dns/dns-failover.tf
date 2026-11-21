resource "aws_route53_zone" "main" {
  name = var.domain_name

  tags = {
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

resource "aws_route53_health_check" "primary_endpoint" {
  type              = "HTTP"
  resource_path     = "/health"
  fqdn              = var.primary_endpoint
  port              = 443
  protocol          = "HTTPS"
  request_interval  = 30
  failure_threshold = 3
  enable_sni        = true

  tags = {
    Name = "primary-endpoint-health-check"
  }
}

resource "aws_route53_health_check" "secondary_endpoint" {
  type              = "HTTP"
  resource_path     = "/health"
  fqdn              = var.secondary_endpoint
  port              = 443
  protocol          = "HTTPS"
  request_interval  = 30
  failure_threshold = 3
  enable_sni        = true

  tags = {
    Name = "secondary-endpoint-health-check"
  }
}

resource "aws_route53_record" "api_primary" {
  zone_id            = aws_route53_zone.main.zone_id
  name               = "api.${var.domain_name}"
  type               = "A"
  set_identifier     = "primary"
  failover_routing_policy {
    type = "PRIMARY"
  }
  alias {
    name                   = var.primary_endpoint
    zone_id                = var.primary_zone_id
    evaluate_target_health = true
  }
  health_check_id = aws_route53_health_check.primary_endpoint.id
}

resource "aws_route53_record" "api_secondary" {
  zone_id            = aws_route53_zone.main.zone_id
  name               = "api.${var.domain_name}"
  type               = "A"
  set_identifier     = "secondary"
  failover_routing_policy {
    type = "SECONDARY"
  }
  alias {
    name                   = var.secondary_endpoint
    zone_id                = var.secondary_zone_id
    evaluate_target_health = true
  }
  health_check_id = aws_route53_health_check.secondary_endpoint.id
}

resource "aws_route53_record" "app_primary" {
  zone_id            = aws_route53_zone.main.zone_id
  name               = "app.${var.domain_name}"
  type               = "A"
  set_identifier     = "primary"
  failover_routing_policy {
    type = "PRIMARY"
  }
  alias {
    name                   = var.primary_endpoint
    zone_id                = var.primary_zone_id
    evaluate_target_health = true
  }
  health_check_id = aws_route53_health_check.primary_endpoint.id
}

resource "aws_route53_record" "app_secondary" {
  zone_id            = aws_route53_zone.main.zone_id
  name               = "app.${var.domain_name}"
  type               = "A"
  set_identifier     = "secondary"
  failover_routing_policy {
    type = "SECONDARY"
  }
  alias {
    name                   = var.secondary_endpoint
    zone_id                = var.secondary_zone_id
    evaluate_target_health = true
  }
  health_check_id = aws_route53_health_check.secondary_endpoint.id
}

resource "aws_cloudwatch_metric_alarm" "primary_endpoint_failure" {
  alarm_name          = "route53-primary-endpoint-failure"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = "60"
  statistic           = "Minimum"
  threshold           = "1"
  alarm_description   = "Alert when primary endpoint health check fails"
  alarm_actions       = var.alarm_actions

  dimensions = {
    HealthCheckId = aws_route53_health_check.primary_endpoint.id
  }
}

output "zone_id" {
  value       = aws_route53_zone.main.zone_id
  description = "Route53 zone ID"
}

output "nameservers" {
  value       = aws_route53_zone.main.name_servers
  description = "Route53 nameservers for DNS delegation"
}
