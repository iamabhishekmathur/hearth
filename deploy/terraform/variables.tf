variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "hearth"
}

variable "domain" {
  type    = string
  default = "hearth-app.xyz"
}

variable "vpc_id" {
  type    = string
  default = "vpc-06c3e35f9540ed310" # default VPC
}

# Default-VPC public subnets across AZs a/b/c/d (avoiding us-east-1e/f).
variable "subnet_ids" {
  type = list(string)
  default = [
    "subnet-0362de6e47f9431a8", # us-east-1a
    "subnet-07dbbf055bf44c8e5", # us-east-1b
    "subnet-0fc4849a01b83b33d", # us-east-1c
    "subnet-0187aad58a4e55aa3", # us-east-1d
  ]
}

# CIDR allowed to reach RDS directly. Migrations run from inside the VPC via a
# one-off ECS task, so laptop access is not required; kept as a single /32.
variable "admin_ip_cidr" {
  type    = string
  default = "45.8.19.67/32"
}

variable "image_tag" {
  type    = string
  default = "latest"
}

# --- Secrets (supplied via terraform.tfvars, which is gitignored) ---

variable "db_password" {
  type      = string
  sensitive = true
}

variable "session_secret" {
  type      = string
  sensitive = true
}

variable "encryption_key" {
  type      = string
  sensitive = true
}

variable "anthropic_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "openai_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

# Fargate task sizing
variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "worker_cpu" {
  type    = number
  default = 512
}

variable "worker_memory" {
  type    = number
  default = 1024
}
