variable "environment" { type = string }
variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
variable "availability_zones" { type = list(string) }
variable "app_port" {
  type    = number
  default = 3000
}
variable "flow_log_bucket_arn" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
