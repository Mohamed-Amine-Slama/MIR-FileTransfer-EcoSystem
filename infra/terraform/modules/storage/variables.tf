variable "name_prefix" {
  description = "Prefix for bucket names, e.g. mir-prod."
  type        = string
}

variable "kms_key_arn_objects" {
  description = "Customer-managed KMS key for object storage (P2.3)."
  type        = string
}

variable "kms_key_arn_backups" {
  description = "Customer-managed KMS key for backups and audit archives (P2.3)."
  type        = string
}

variable "imaging_retention_days" {
  description = <<-EOT
    Object Lock retention for DICOM originals, in days.

    BLOCKING L5 — NOT ANSWERED. This is a legal question in both Libya and
    Tunisia. Compliance-mode retention CANNOT be shortened afterwards, by
    anyone, including AWS support. Do not deploy production with a guess.
  EOT
  type        = number

  validation {
    condition     = var.imaging_retention_days >= 1
    error_message = "Retention must be at least one day."
  }
}

variable "audit_retention_days" {
  description = "Object Lock retention for archived audit logs, in days (L5, L8)."
  type        = number
}

variable "derived_expiry_days" {
  description = "Lifecycle expiry for thumbnails. Safe: they regenerate from originals."
  type        = number
  default     = 90
}

variable "enable_replication" {
  description = "Cross-region replication of originals (P2.4, P15.2)."
  type        = bool
  default     = false
}

variable "replication_role_arn" {
  description = "IAM role S3 assumes to replicate."
  type        = string
  default     = ""
}

variable "replica_bucket_arn" {
  description = "Destination bucket ARN in the DR region."
  type        = string
  default     = ""
}

variable "replica_kms_key_arn" {
  description = "KMS key in the DR region for replica encryption."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
