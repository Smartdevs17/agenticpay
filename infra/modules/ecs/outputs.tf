output "cluster_id" {
  description = "ECS cluster ID"
  value       = aws_ecs_cluster.cluster.id
}

output "cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.cluster.arn
}

output "service_id" {
  description = "ECS service ID"
  value       = aws_ecs_service.service.id
}

output "service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.service.name
}

output "task_definition_arn" {
  description = "ECS task definition ARN"
  value       = aws_ecs_task_definition.task.arn
}

output "task_execution_role_arn" {
  description = "Task execution IAM role ARN"
  value       = aws_iam_role.task_execution_role.arn
}

output "task_role_arn" {
  description = "Task IAM role ARN"
  value       = aws_iam_role.task_role.arn
}

output "log_group_name" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.ecs_logs.name
}

output "security_group_id" {
  description = "ECS security group ID"
  value       = aws_security_group.ecs_sg.id
}
