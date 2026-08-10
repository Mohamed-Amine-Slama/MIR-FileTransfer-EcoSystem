variable "environment" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "database_security_group_id" { type = string }
variable "kms_key_arn_database" { type = string }
variable "kms_key_arn_secrets" { type = string }
variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}
variable "allocated_storage" {
  type    = number
  default = 100
}
variable "max_allocated_storage" {
  type    = number
  default = 1000
}
variable "multi_az" {
  type    = bool
  default = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
