output "originals_bucket" {
  description = "Name of the immutable source-of-record bucket."
  value       = aws_s3_bucket.originals.id
}

output "derived_bucket" {
  value = aws_s3_bucket.derived.id
}

output "audit_bucket" {
  value = aws_s3_bucket.audit.id
}

output "originals_bucket_arn" {
  value = aws_s3_bucket.originals.arn
}
