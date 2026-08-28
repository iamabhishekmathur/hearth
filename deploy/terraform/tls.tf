# HTTPS origin for the ALB so CloudFront connects over TLS and the ALB reports
# X-Forwarded-Proto: https natively (the correct fix for the secure-cookie issue,
# replacing the X-Amz-Cf-Id shim). CloudFront can't present a cert for the ALB's
# *.elb.amazonaws.com name, so we serve a custom origin host: api.hearth-app.xyz.

data "aws_route53_zone" "main" {
  zone_id = "Z037182510AUEHUHNMAYX" # hearth-app.xyz
}

locals {
  api_origin_host = "api.${var.domain}" # api.hearth-app.xyz
}

# --- ACM cert for the origin host (DNS-validated via Route53) ---

resource "aws_acm_certificate" "api_origin" {
  domain_name       = local.api_origin_host
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "api_origin_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api_origin.domain_validation_options : dvo.domain_name => {
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

resource "aws_acm_certificate_validation" "api_origin" {
  certificate_arn         = aws_acm_certificate.api_origin.arn
  validation_record_fqdns = [for r in aws_route53_record.api_origin_validation : r.fqdn]
}

# --- Route53 alias: api.hearth-app.xyz -> ALB ---

resource "aws_route53_record" "api_origin" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = local.api_origin_host
  type    = "A"

  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = false
  }
}

# --- HTTPS listener on the ALB (443) -> same target group ---

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api_origin.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
