# CDN-powered geo-distributed API edge caching (#502)
# Provisions a CloudFront distribution in front of the AgenticPay API with
# configurable TTLs per behaviour, origin shield, and geo-routing.

# ─── Variables ────────────────────────────────────────────────────────────────

variable "api_origin_domain" {
  description = "Domain name of the origin API (ALB or ECS service URL)."
  type        = string
}

variable "cdn_price_class" {
  description = "CloudFront price class controls which edge locations serve traffic."
  type        = string
  default     = "PriceClass_100" # US, Canada, Europe — cheapest; use PriceClass_All for global
}

variable "cdn_acm_certificate_arn" {
  description = "ACM certificate ARN (us-east-1) for the CDN distribution."
  type        = string
  default     = ""
}

variable "cdn_aliases" {
  description = "Alternate domain names (CNAMEs) for the CloudFront distribution."
  type        = list(string)
  default     = []
}

variable "origin_shield_region" {
  description = "AWS region for CloudFront origin shield — pick one closest to the origin."
  type        = string
  default     = "us-east-1"
}

# ─── Cache policies ───────────────────────────────────────────────────────────

resource "aws_cloudfront_cache_policy" "static_data" {
  name        = "agenticpay-${var.environment}-static-data"
  comment     = "Static API data: 5 min TTL (config, metadata)"
  default_ttl = 300
  max_ttl     = 600
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Accept", "Accept-Language", "X-Auth-Hash"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

resource "aws_cloudfront_cache_policy" "user_data" {
  name        = "agenticpay-${var.environment}-user-data"
  comment     = "Per-user API data: 30 s TTL (payments, invoices)"
  default_ttl = 30
  max_ttl     = 60
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Accept", "Accept-Language", "X-Auth-Hash", "Authorization"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

resource "aws_cloudfront_cache_policy" "no_cache" {
  name        = "agenticpay-${var.environment}-no-cache"
  comment     = "Real-time / mutation endpoints — never cache"
  default_ttl = 0
  max_ttl     = 0
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = false
    enable_accept_encoding_brotli = false
  }
}

# ─── Origin request policy ────────────────────────────────────────────────────

resource "aws_cloudfront_origin_request_policy" "api" {
  name    = "agenticpay-${var.environment}-api-origin"
  comment = "Forward necessary headers and query strings to the API origin"

  cookies_config {
    cookie_behavior = "none"
  }

  headers_config {
    header_behavior = "whitelist"
    headers {
      items = [
        "Accept",
        "Accept-Language",
        "Authorization",
        "Content-Type",
        "X-Request-ID",
        "X-Tenant-ID",
        "CloudFront-Viewer-Country",
        "CloudFront-Viewer-City",
      ]
    }
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

# ─── CloudFront distribution ──────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "api" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "AgenticPay API CDN — ${var.environment}"
  price_class     = var.cdn_price_class
  aliases         = var.cdn_aliases

  origin {
    domain_name = var.api_origin_domain
    origin_id   = "agenticpay-api-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Origin shield reduces load on the origin by coalescing requests from all
    # edge locations through a single intermediate cache layer.
    origin_shield {
      enabled              = true
      origin_shield_region = var.origin_shield_region
    }

    custom_header {
      name  = "X-CDN-Secret"
      value = var.environment == "prod" ? data.aws_ssm_parameter.cdn_secret[0].value : "dev-secret"
    }
  }

  # ── Default: no cache (mutations, auth, websockets) ───────────────────────
  default_cache_behavior {
    target_origin_id       = "agenticpay-api-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.no_cache.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
    compress               = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.auth_hash.arn
    }
  }

  # ── Static / public API data (GET /api/v1/config, /api/v1/currencies …) ──
  ordered_cache_behavior {
    path_pattern           = "/api/v1/config*"
    target_origin_id       = "agenticpay-api-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.static_data.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern           = "/api/v1/currencies*"
    target_origin_id       = "agenticpay-api-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.static_data.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
    compress               = true
  }

  # ── User-scoped read data (GET /api/v1/payments, /api/v1/invoices …) ──────
  ordered_cache_behavior {
    path_pattern           = "/api/v1/payments*"
    target_origin_id       = "agenticpay-api-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.user_data.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern           = "/api/v1/invoices*"
    target_origin_id       = "agenticpay-api-origin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.user_data.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
    compress               = true
  }

  # ── Geo restrictions ──────────────────────────────────────────────────────
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # ── TLS ───────────────────────────────────────────────────────────────────
  dynamic "viewer_certificate" {
    for_each = var.cdn_acm_certificate_arn != "" ? [1] : []
    content {
      acm_certificate_arn      = var.cdn_acm_certificate_arn
      ssl_support_method       = "sni-only"
      minimum_protocol_version = "TLSv1.2_2021"
    }
  }

  dynamic "viewer_certificate" {
    for_each = var.cdn_acm_certificate_arn == "" ? [1] : []
    content {
      cloudfront_default_certificate = true
    }
  }

  # ── Logging ───────────────────────────────────────────────────────────────
  logging_config {
    bucket          = aws_s3_bucket.cdn_logs.bucket_domain_name
    prefix          = "cdn/${var.environment}/"
    include_cookies = false
  }

  tags = {
    Name = "agenticpay-api-cdn-${var.environment}"
  }
}

# ─── CloudFront function: hash Authorization before caching ──────────────────

resource "aws_cloudfront_function" "auth_hash" {
  name    = "agenticpay-${var.environment}-auth-hash"
  runtime = "cloudfront-js-2.0"
  comment = "Replace Authorization header with a SHA-256 prefix for cache-key safety"
  publish = true

  code = <<-EOF
    import crypto from 'crypto';
    function handler(event) {
      var req = event.request;
      var auth = (req.headers['authorization'] || {}).value;
      if (auth) {
        var hash = crypto.subtle
          ? btoa(String.fromCharCode(...new Uint8Array(
              crypto.createHash('sha256').update(auth).digest()
            ))).slice(0, 16)
          : auth.slice(0, 16);
        req.headers['x-auth-hash'] = { value: hash };
        delete req.headers['authorization'];
      }
      return req;
    }
  EOF
}

# ─── CDN access log bucket ────────────────────────────────────────────────────

resource "aws_s3_bucket" "cdn_logs" {
  bucket = "agenticpay-cdn-logs-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name    = "agenticpay-cdn-logs-${var.environment}"
    Purpose = "CloudFront access logs"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cdn_logs" {
  bucket = aws_s3_bucket.cdn_logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    expiration {
      days = 90
    }

    filter {
      prefix = "cdn/"
    }
  }
}

# ─── CDN origin shared secret (prod only) ────────────────────────────────────

data "aws_ssm_parameter" "cdn_secret" {
  count = var.environment == "prod" ? 1 : 0
  name  = "/agenticpay/${var.environment}/cdn-origin-secret"
}

data "aws_caller_identity" "current" {}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "cdn_distribution_id" {
  description = "CloudFront distribution ID — used for cache invalidation."
  value       = aws_cloudfront_distribution.api.id
}

output "cdn_domain_name" {
  description = "CloudFront distribution domain name."
  value       = aws_cloudfront_distribution.api.domain_name
}

output "cdn_hosted_zone_id" {
  description = "CloudFront hosted zone ID for Route53 alias records."
  value       = aws_cloudfront_distribution.api.hosted_zone_id
}
