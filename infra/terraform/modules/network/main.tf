###############################################################################
# Network — BUILD_SPEC P2.2.
#
# "VPC with public subnets (load balancer only) and private subnets (app,
#  database, Orthanc). NAT gateway for egress. No database or Orthanc port
#  reachable from the internet. Security groups deny by default."
#
# THE GATE IS BEHAVIOURAL, NOT CONFIGURATIONAL: "from outside the VPC, attempt
# to reach the DB port — must time out ... verified by an actual connection
# attempt, not by reading the config." Nothing in this file discharges that.
###############################################################################

terraform {
  required_version = "~> 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = merge(var.tags, { Name = "mir-${var.environment}" })
}

# The default security group AWS creates with every VPC allows unrestricted
# traffic between anything that lands in it. Nothing here is placed in it
# deliberately, but a resource created without an explicit security_group_ids
# silently gets it — and would then be reachable from every other such
# resource. Adopting it with NO rules makes that mistake fail closed.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "mir-${var.environment}-default-DO-NOT-USE" })
  # No ingress, no egress blocks: everything denied.
}

# --- public subnets: LOAD BALANCER ONLY --------------------------------------
resource "aws_subnet" "public" {
  for_each = { for idx, az in var.availability_zones : az => idx }

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, each.value)
  map_public_ip_on_launch = false # nothing here should need a public IP but the ALB

  tags = merge(var.tags, {
    Name = "mir-${var.environment}-public-${each.key}"
    Tier = "public"
  })
}

# --- private subnets: app, database, Orthanc ---------------------------------
resource "aws_subnet" "private" {
  for_each = { for idx, az in var.availability_zones : az => idx }

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, each.value + 8)

  tags = merge(var.tags, {
    Name = "mir-${var.environment}-private-${each.key}"
    Tier = "private"
  })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(var.tags, { Name = "mir-${var.environment}" })
}

resource "aws_eip" "nat" {
  for_each = aws_subnet.public
  domain   = "vpc"
  tags     = merge(var.tags, { Name = "mir-${var.environment}-nat-${each.key}" })
}

# One NAT per AZ: a single NAT is a single point of failure for every outbound
# call, including Stripe and SMS delivery.
resource "aws_nat_gateway" "this" {
  for_each      = aws_subnet.public
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = each.value.id
  tags          = merge(var.tags, { Name = "mir-${var.environment}-${each.key}" })
  depends_on    = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = merge(var.tags, { Name = "mir-${var.environment}-public" })
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  for_each = aws_subnet.private
  vpc_id   = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[each.key].id
  }

  tags = merge(var.tags, { Name = "mir-${var.environment}-private-${each.key}" })
}

resource "aws_route_table_association" "private" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

###############################################################################
# Security groups — deny by default.
#
# Terraform's aws_security_group creates a permissive default egress rule if
# none is specified. Every group below therefore states its egress explicitly.
###############################################################################

# The ONLY group with ingress from the internet, and only on 443.
resource "aws_security_group" "alb" {
  # checkov:skip=CKV2_AWS_5:Consumed by the compute stack, which does not exist yet -- P2.6 (deploy pipeline) is blocked on there being an AWS account at all. This module exports their ids for that purpose.
  name        = "mir-${var.environment}-alb"
  description = "Public load balancer. 443 only."
  vpc_id      = aws_vpc.this.id
  tags        = merge(var.tags, { Name = "mir-${var.environment}-alb" })
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from the internet (TLS 1.3 enforced at the listener)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

# NOTE: there is deliberately NO port 80 ingress rule. HTTP-to-HTTPS
# redirection is handled at the edge (Cloudflare, P14.3) so the origin never
# accepts plaintext at all.

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the application only"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "app" {
  # checkov:skip=CKV2_AWS_5:Consumed by the compute stack, which does not exist yet -- P2.6 (deploy pipeline) is blocked on there being an AWS account at all. This module exports their ids for that purpose.
  name        = "mir-${var.environment}-app"
  description = "API. Private subnets only."
  vpc_id      = aws_vpc.this.id
  tags        = merge(var.tags, { Name = "mir-${var.environment}-app" })
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "From the load balancer only"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.app_port
  to_port                      = var.app_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_https_out" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound HTTPS: S3, KMS, Secrets Manager, Stripe, SMS"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = aws_security_group.app.id
  description                  = "PostgreSQL to the database security group only"
  referenced_security_group_id = aws_security_group.database.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_to_orthanc" {
  security_group_id            = aws_security_group.app.id
  description                  = "DICOMweb to the Orthanc security group only (P8.1)"
  referenced_security_group_id = aws_security_group.orthanc.id
  from_port                    = 8042
  to_port                      = 8042
  ip_protocol                  = "tcp"
}

# --- database: reachable ONLY from the app -----------------------------------
resource "aws_security_group" "database" {
  # checkov:skip=CKV2_AWS_5:Consumed by the compute stack, which does not exist yet -- P2.6 (deploy pipeline) is blocked on there being an AWS account at all. This module exports their ids for that purpose.
  name        = "mir-${var.environment}-db"
  description = "PostgreSQL. No internet route, no public ingress."
  vpc_id      = aws_vpc.this.id
  tags        = merge(var.tags, { Name = "mir-${var.environment}-db" })
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from the application only"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}
# No egress rule at all: the database initiates nothing.

# --- Orthanc: reachable ONLY from the app (P8.1) -----------------------------
resource "aws_security_group" "orthanc" {
  # checkov:skip=CKV2_AWS_5:Consumed by the compute stack, which does not exist yet -- P2.6 (deploy pipeline) is blocked on there being an AWS account at all. This module exports their ids for that purpose.
  name        = "mir-${var.environment}-orthanc"
  description = "Orthanc DICOM server. Reachable only from the API."
  vpc_id      = aws_vpc.this.id
  tags        = merge(var.tags, { Name = "mir-${var.environment}-orthanc" })
}

resource "aws_vpc_security_group_ingress_rule" "orthanc_from_app" {
  security_group_id            = aws_security_group.orthanc.id
  description                  = "DICOMweb from the API only — never from a browser"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 8042
  to_port                      = 8042
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "orthanc_https_out" {
  security_group_id = aws_security_group.orthanc.id
  description       = "S3 object-storage plugin"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

###############################################################################
# VPC flow logs — who tried to reach what (P13, P14.4 incident evidence).
###############################################################################
resource "aws_flow_log" "this" {
  vpc_id               = aws_vpc.this.id
  traffic_type         = "ALL"
  log_destination_type = "s3"
  log_destination      = var.flow_log_bucket_arn
  tags                 = merge(var.tags, { Name = "mir-${var.environment}" })
}
