# ---- RDS Postgres (pgvector) ----

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier     = "${var.project}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "hearth"
  username = "hearth"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = true # SG-locked to ECS + admin IP; enables laptop migrations

  multi_az                = false
  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true

  # pgvector ships with RDS PG16; extension is created by the init migration.
}

# ---- ElastiCache Redis ----

resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project}-redis"
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${var.project}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
}

locals {
  database_url = "postgresql://hearth:${var.db_password}@${aws_db_instance.postgres.address}:5432/hearth"
  redis_url    = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
}
