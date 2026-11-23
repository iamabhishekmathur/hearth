terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Reuses the pre-existing state bucket created for Hearth Cloud.
  backend "s3" {
    bucket  = "hearth-cloud-tfstate-633065023981"
    key     = "backend/terraform.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "hearth"
      Env       = "prod"
      ManagedBy = "opentofu"
    }
  }
}
