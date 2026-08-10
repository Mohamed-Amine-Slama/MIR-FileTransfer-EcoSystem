output "endpoint" { value = aws_db_instance.this.address }
output "port" { value = aws_db_instance.this.port }
output "master_secret_arn" {
  description = "Secrets Manager ARN holding the migrator password."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}
