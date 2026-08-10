variable "environment" {
  type = string
}

variable "application_role_arns" {
  description = "Roles permitted to encrypt/decrypt — never to manage keys."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
