###############################################################################
# PostgreSQL — BUILD_SPEC P2.5.
#
# "managed PostgreSQL 16, multi-AZ, private subnet, encrypted with the KMS DB
#  key, automated backups with 30-day point-in-time recovery, deletion
#  protection ON."
#
# GATE NOT DISCHARGED BY THIS FILE: P2.5 requires a failover test and a real
# PITR restore into a scratch instance, with the observed RTO recorded in
# docs/runbooks/dr.md. "An untested backup fails at exactly the wrong moment."
###############################################################################

terraform {
  required_version = "~> 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}

resource "aws_db_subnet_group" "this" {
  name       = "mir-${var.environment}"
  subnet_ids = var.private_subnet_ids
  tags       = merge(var.tags, { Name = "mir-${var.environment}" })
}

resource "aws_db_parameter_group" "this" {
  name   = "mir-${var.environment}-pg16"
  family = "postgres16"

  # Reject any connection that is not TLS. The application connects from
  # inside the VPC, but "inside the VPC" is not a trust boundary — a
  # compromised container in another subnet is still inside it.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Log every DDL statement. A dropped RLS policy must leave a trace even if
  # the application audit log does not see it (ADR-6, P4.4).
  parameter {
    name  = "log_statement"
    value = "ddl"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  # Connection budget: parallel test workers and app instances each hold
  # pools. The default is easily exhausted, and exhaustion surfaces as
  # "cannot connect" at the worst moment.
  parameter {
    name         = "max_connections"
    value        = "300"
    apply_method = "pending-reboot"
  }

  tags = var.tags
}

resource "aws_db_instance" "this" {
  identifier = "mir-${var.environment}"

  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"

  storage_encrypted = true
  kms_key_id        = var.kms_key_arn_database

  db_name  = "mir"
  username = "mir_migrator"
  # Password is managed by AWS and stored in Secrets Manager — never in state,
  # never in this repository (§6). Terraform state itself is encrypted, but a
  # password that is never in state cannot leak from it at all.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = var.kms_key_arn_secrets

  # P2.5: multi-AZ. The failover test is a separate, manual gate.
  multi_az = var.multi_az

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.database_security_group_id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.this.name

  # 30-day PITR (P2.5).
  backup_retention_period = 30
  backup_window           = "02:00-03:00"
  maintenance_window      = "sun:03:30-sun:04:30"
  copy_tags_to_snapshot   = true

  # Deletion protection ON. Combined with skip_final_snapshot = false, an
  # accidental destroy is refused rather than merely regretted.
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "mir-${var.environment}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = var.kms_key_arn_database
  performance_insights_retention_period = 7

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  auto_minor_version_upgrade = true
  apply_immediately          = false

  lifecycle {
    prevent_destroy = true
    # The snapshot identifier embeds a timestamp, which would otherwise show
    # as a diff on every plan.
    ignore_changes = [final_snapshot_identifier]
  }

  tags = merge(var.tags, {
    Name      = "mir-${var.environment}"
    DataClass = "patient-data"
  })
}
