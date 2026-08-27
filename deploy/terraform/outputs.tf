output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "rds_address" {
  value = aws_db_instance.postgres.address
}

output "redis_address" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "database_url" {
  value     = local.database_url
  sensitive = true
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}
