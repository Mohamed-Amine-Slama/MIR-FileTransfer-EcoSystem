###############################################################################
# KMS — BUILD_SPEC P2.3.
#
# FOUR SEPARATE customer-managed keys: objects, database, secrets, backups.
#
# Why not one key: a key is a blast radius. If the same key encrypts patient
# imaging and application secrets, then anyone or anything that can decrypt a
# config value can also decrypt a scan. Separate keys mean a compromised
# service role reaches exactly one class of data, and key rotation or
# revocation can be done per class rather than all at once.
#
# Rotation is enabled on all four (the P2.3 gate checks exactly this).
###############################################################################

terraform {
  required_version = "~> 1.9"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}

locals {
  keys = {
    objects  = "DICOM originals, derived images, and audit archives"
    database = "RDS PostgreSQL storage and snapshots"
    secrets  = "AWS Secrets Manager entries"
    backups  = "Backup vaults and archived audit logs"
  }
}

resource "aws_kms_key" "this" {
  for_each = local.keys

  description = "MIR ${var.environment} — ${each.value}"

  # P2.3 gate: `aws kms describe-key` must show rotation enabled on all four.
  enable_key_rotation     = true
  rotation_period_in_days = 365

  # Deleting a key destroys every object encrypted with it, irreversibly.
  # 30 days is the maximum window and the only responsible choice when the
  # ciphertext is patient imaging.
  deletion_window_in_days = 30

  multi_region = each.key == "objects" ? true : false
  # Objects key is multi-region so cross-region replication (P2.4) can decrypt
  # in the DR region without a second, separately-managed key.

  policy = data.aws_iam_policy_document.key_policy[each.key].json

  tags = merge(var.tags, {
    Name    = "mir-${var.environment}-${each.key}"
    Purpose = each.key
  })
}

resource "aws_kms_alias" "this" {
  for_each      = local.keys
  name          = "alias/mir-${var.environment}-${each.key}"
  target_key_id = aws_kms_key.this[each.key].key_id
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "key_policy" {
  # checkov:skip=CKV_AWS_109:A KMS KEY POLICY's resource is the key it is attached to. "*" here means "this key", not "every key" -- there is no narrower form to write.
  # checkov:skip=CKV_AWS_111:Same. Key administration is scoped to the account root by the statement below, which is the documented way to keep a key manageable.
  # checkov:skip=CKV_AWS_356:Same -- "*" is self-referential within a key policy.
  for_each = local.keys

  # Root retains administrative control; without this the key can become
  # unmanageable, which for a compliance-mode-locked bucket is unrecoverable.
  statement {
    sid       = "EnableRootAccountManagement"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  # Least privilege for the application: encrypt and decrypt, never manage.
  # Notably absent: kms:ScheduleKeyDeletion, kms:DisableKey, kms:PutKeyPolicy.
  dynamic "statement" {
    for_each = length(var.application_role_arns) > 0 ? [1] : []
    content {
      sid    = "AllowApplicationUse"
      effect = "Allow"
      actions = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = var.application_role_arns
      }
    }
  }
}
