# App secrets stored as SSM SecureString parameters and injected into the
# Fargate task as container `secrets` (never baked into the image or logs).

resource "aws_ssm_parameter" "database_url" {
  name  = "/${var.project}/prod/DATABASE_URL"
  type  = "SecureString"
  value = local.database_url
}

resource "aws_ssm_parameter" "redis_url" {
  name  = "/${var.project}/prod/REDIS_URL"
  type  = "SecureString"
  value = local.redis_url
}

resource "aws_ssm_parameter" "session_secret" {
  name  = "/${var.project}/prod/SESSION_SECRET"
  type  = "SecureString"
  value = var.session_secret
}

resource "aws_ssm_parameter" "encryption_key" {
  name  = "/${var.project}/prod/ENCRYPTION_KEY"
  type  = "SecureString"
  value = var.encryption_key
}

# LLM keys — created only when provided; the app treats them as optional.
resource "aws_ssm_parameter" "anthropic_api_key" {
  count = var.anthropic_api_key == "" ? 0 : 1
  name  = "/${var.project}/prod/ANTHROPIC_API_KEY"
  type  = "SecureString"
  value = var.anthropic_api_key
}

resource "aws_ssm_parameter" "openai_api_key" {
  count = var.openai_api_key == "" ? 0 : 1
  name  = "/${var.project}/prod/OPENAI_API_KEY"
  type  = "SecureString"
  value = var.openai_api_key
}

locals {
  # Secrets common to api + worker containers.
  container_secrets = concat(
    [
      { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.database_url.arn },
      { name = "REDIS_URL", valueFrom = aws_ssm_parameter.redis_url.arn },
      { name = "SESSION_SECRET", valueFrom = aws_ssm_parameter.session_secret.arn },
      { name = "ENCRYPTION_KEY", valueFrom = aws_ssm_parameter.encryption_key.arn },
    ],
    var.anthropic_api_key == "" ? [] : [
      { name = "ANTHROPIC_API_KEY", valueFrom = aws_ssm_parameter.anthropic_api_key[0].arn }
    ],
    var.openai_api_key == "" ? [] : [
      { name = "OPENAI_API_KEY", valueFrom = aws_ssm_parameter.openai_api_key[0].arn }
    ],
  )
}
