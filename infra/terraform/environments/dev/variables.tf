variable "primary_region" {
  description = "DECISION D5: Milan. Fall back to eu-west-3 if coverage is insufficient."
  type        = string
  default     = "eu-south-1"
}

variable "dr_region" {
  description = "Second EU region for replication and backup copies."
  type        = string
  default     = "eu-west-3"
}

variable "availability_zones" {
  type    = list(string)
  default = ["eu-south-1a", "eu-south-1b", "eu-south-1c"]
}

variable "flow_log_bucket_arn" {
  description = "Existing bucket for VPC flow logs."
  type        = string
}

variable "imaging_retention_days" {
  description = "BLOCKING L5 — placeholder until counsel answers. Irreversible once applied."
  type        = number
  default     = 3650
}

variable "audit_retention_days" {
  type    = number
  default = 3650
}
