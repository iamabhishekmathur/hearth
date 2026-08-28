# app.hearth-app.xyz — the React SPA on its own CloudFront distribution, so the
# apex (hearth-app.xyz) can go back to the marketing landing. Same-origin API:
# /api/*, /ws/*, /socket.io/* are proxied to the ALB (https origin) from this
# distribution too, so session/CSRF cookies and Socket.io work with no CORS.

locals {
  app_host = "app.${var.domain}" # app.hearth-app.xyz
}

# ---- S3 bucket for the app build (private; served via CloudFront OAC) ----

resource "aws_s3_bucket" "app" {
  bucket = "${var.project}-app-xyz-app"
}

resource "aws_s3_bucket_public_access_block" "app" {
  bucket                  = aws_s3_bucket.app.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "app" {
  name                              = "${var.project}-app-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---- ACM viewer cert for app.hearth-app.xyz (CloudFront requires us-east-1) ----

resource "aws_acm_certificate" "app_viewer" {
  domain_name       = local.app_host
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "app_viewer_validation" {
  for_each = {
    for dvo in aws_acm_certificate.app_viewer.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "app_viewer" {
  certificate_arn         = aws_acm_certificate.app_viewer.arn
  validation_record_fqdns = [for r in aws_route53_record.app_viewer_validation : r.fqdn]
}

# ---- SPA routing: rewrite extension-less paths to /index.html (default
#      behavior only, so /api,/ws,/socket.io are untouched) ----

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.project}-app-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var req = event.request;
      if (req.uri.indexOf('.') === -1) { req.uri = '/index.html'; }
      return req;
    }
  EOT
}

# ---- CloudFront distribution ----

resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Hearth app (app.hearth-app.xyz)"
  default_root_object = "index.html"
  aliases             = [local.app_host]
  price_class         = "PriceClass_100"

  origin {
    origin_id                = "s3-app"
    domain_name              = aws_s3_bucket.app.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.app.id
  }

  origin {
    origin_id   = "alb-hearth-api"
    domain_name = local.api_origin_host # api.hearth-app.xyz (https via ACM)

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-app"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  # API + WebSocket paths -> ALB, uncached, forward everything.
  dynamic "ordered_cache_behavior" {
    for_each = ["/api/*", "/ws/*", "/socket.io/*"]
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = "alb-hearth-api"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
      origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewerExceptHostHeader
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.app_viewer.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ---- Bucket policy: allow only this distribution (OAC) to read ----

data "aws_iam_policy_document" "app_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.app.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.app.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "app" {
  bucket = aws_s3_bucket.app.id
  policy = data.aws_iam_policy_document.app_bucket.json
}

# ---- DNS: app.hearth-app.xyz -> this distribution ----

resource "aws_route53_record" "app" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = local.app_host
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

output "app_bucket" {
  value = aws_s3_bucket.app.bucket
}

output "app_distribution_id" {
  value = aws_cloudfront_distribution.app.id
}

output "app_host" {
  value = local.app_host
}
