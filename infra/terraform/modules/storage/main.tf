###############################################################################
# Object storage — BUILD_SPEC P2.4. ⚠️ THE MOST IMPORTANT INFRASTRUCTURE GATE.
#
# "A deletable original is a lost scan is a lawsuit."
#
# Three buckets with genuinely different guarantees. The originals bucket is
# the source of record (ADR-4): once an object lands there it must survive a
# compromised administrator, a buggy deploy, and a malicious insider.
#
# NOT APPLIED. There is no AWS account attached to this repository, so the
# P2.4 gate — upload an object, attempt `aws s3 rm`, confirm it is REJECTED —
# has not been executed. Reading this file is not the same as passing that
# gate, and the pre-launch checklist keeps it open until someone runs it.
###############################################################################

terraform {
  required_version = "~> 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

locals {
  originals_name = "${var.name_prefix}-dicom-originals"
  derived_name   = "${var.name_prefix}-derived"
  audit_name     = "${var.name_prefix}-audit-logs"
}

###############################################################################
# 1. ORIGINALS — immutable source of record
###############################################################################

resource "aws_s3_bucket" "originals" {
  bucket = local.originals_name

  # Object Lock CANNOT be enabled on an existing bucket. It must be set at
  # creation, which is why this is not something that can be "added later" —
  # retrofitting means creating a new bucket and copying every object.
  object_lock_enabled = true

  # A bucket holding the only copy of patients' imaging must never be
  # destroyed by a `terraform destroy` in the wrong directory.
  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Name        = local.originals_name
    DataClass   = "patient-imaging"
    SourceOfRecord = "true"
  })
}

# Versioning is a prerequisite for Object Lock, and independently protects
# against an overwrite that would otherwise silently replace a scan.
resource "aws_s3_bucket_versioning" "originals" {
  bucket = aws_s3_bucket.originals.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "originals" {
  bucket = aws_s3_bucket.originals.id

  rule {
    default_retention {
      # COMPLIANCE mode, not GOVERNANCE. Under governance, a principal with
      # s3:BypassGovernanceRetention can delete anyway — which includes the
      # account root and anyone who can grant themselves that permission.
      # Compliance mode cannot be bypassed by ANY user, including root, for
      # the duration of the retention period.
      #
      # This is deliberately the strictest option, and it is irreversible:
      # retention cannot be shortened once set. That is the point.
      mode = "COMPLIANCE"

      # BLOCKING L5: the correct retention period is a legal question for both
      # Libya and Tunisia and has NOT been answered. The value below is a
      # placeholder that must be replaced before production data is written.
      #
      # Guess too low and records are destroyed before the law allows.
      # Guess too high and they cannot be deleted when a patient exercises a
      # right to erasure — under compliance mode, not even by AWS support.
      days = var.imaging_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.originals]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "originals" {
  bucket = aws_s3_bucket.originals.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn_objects
    }
    # Cuts KMS request costs and rate-limit pressure on a 120-file study
    # upload, without weakening the encryption.
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "originals" {
  bucket                  = aws_s3_bucket.originals.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Cross-region replication (P2.4, P15.2). The DR drill requires originals to
# be readable from the replica region.
resource "aws_s3_bucket_replication_configuration" "originals" {
  count = var.enable_replication ? 1 : 0

  bucket = aws_s3_bucket.originals.id
  role   = var.replication_role_arn

  rule {
    id     = "replicate-all-originals"
    status = "Enabled"

    filter {}

    delete_marker_replication {
      # Delete markers are NOT replicated. If someone manages to place one in
      # the primary, the replica must still hold the object.
      status = "Disabled"
    }

    destination {
      bucket        = var.replica_bucket_arn
      storage_class = "STANDARD_IA"

      encryption_configuration {
        replica_kms_key_id = var.replica_kms_key_arn
      }

      # Alert if replication falls behind: a replica that is hours stale is
      # not a disaster-recovery position (P13 alerts).
      replication_time {
        status = "Enabled"
        time { minutes = 15 }
      }
      metrics {
        status = "Enabled"
        event_threshold { minutes = 15 }
      }
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }
  }

  depends_on = [aws_s3_bucket_versioning.originals]
}

# Deny any request that is not TLS, and any attempt to write unencrypted.
resource "aws_s3_bucket_policy" "originals" {
  bucket = aws_s3_bucket.originals.id
  policy = data.aws_iam_policy_document.originals.json
}

data "aws_iam_policy_document" "originals" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.originals.arn,
      "${aws_s3_bucket.originals.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyUnencryptedObjectUploads"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.originals.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  # There is deliberately NO statement permitting DeleteObject to anyone.
  # Object Lock already refuses, but an explicit absence documents intent.
}

###############################################################################
# 2. DERIVED — thumbnails and previews. Regenerable, so expiry is fine.
###############################################################################

resource "aws_s3_bucket" "derived" {
  bucket = local.derived_name
  tags = merge(var.tags, {
    Name      = local.derived_name
    DataClass = "patient-imaging-derived"
  })
}

resource "aws_s3_bucket_versioning" "derived" {
  bucket = aws_s3_bucket.derived.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "derived" {
  bucket = aws_s3_bucket.derived.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn_objects
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "derived" {
  bucket                  = aws_s3_bucket.derived.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "derived" {
  bucket = aws_s3_bucket.derived.id

  rule {
    id     = "expire-derived"
    status = "Enabled"
    filter {}

    # Safe to expire: every thumbnail can be regenerated from the original.
    # This is the ONLY bucket where expiry is acceptable.
    expiration { days = var.derived_expiry_days }

    noncurrent_version_expiration { noncurrent_days = 30 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

###############################################################################
# 3. AUDIT LOGS — append-only history that survives a database compromise
###############################################################################

resource "aws_s3_bucket" "audit" {
  bucket              = local.audit_name
  object_lock_enabled = true

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Name      = local.audit_name
    DataClass = "audit"
  })
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    default_retention {
      # P4.4: "Ship audit rows to the *-audit-logs object-lock bucket on a
      # schedule so a database compromise cannot erase history." That property
      # only holds if the archived copy is itself undeletable.
      mode = "COMPLIANCE"
      days = var.audit_retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.audit]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn_backups
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
