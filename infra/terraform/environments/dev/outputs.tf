output "originals_bucket" { value = module.storage.originals_bucket }
output "derived_bucket" { value = module.storage.derived_bucket }
output "audit_bucket" { value = module.storage.audit_bucket }
output "vpc_id" { value = module.network.vpc_id }
output "kms_key_arns" { value = module.kms.key_arns }
