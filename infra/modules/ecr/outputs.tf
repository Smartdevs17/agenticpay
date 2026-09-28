output "repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.repo.repository_url
}

output "repository_arn" {
  description = "ECR repository ARN"
  value       = aws_ecr_repository.repo.arn
}

output "repository_name" {
  description = "ECR repository name"
  value       = aws_ecr_repository.repo.name
}

output "registry_id" {
  description = "AWS Account ID (registry ID)"
  value       = aws_ecr_repository.repo.registry_id
}
