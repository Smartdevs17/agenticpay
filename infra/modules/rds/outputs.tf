output "cluster_endpoint" {
  description = "RDS cluster endpoint"
  value       = aws_rds_cluster.db_cluster.endpoint
}

output "cluster_reader_endpoint" {
  description = "RDS cluster reader endpoint"
  value       = aws_rds_cluster.db_cluster.reader_endpoint
}

output "cluster_identifier" {
  description = "RDS cluster identifier"
  value       = aws_rds_cluster.db_cluster.cluster_identifier
}

output "cluster_resource_id" {
  description = "RDS cluster resource ID"
  value       = aws_rds_cluster.db_cluster.cluster_resource_id
}

output "instance_endpoints" {
  description = "RDS instance endpoints"
  value       = aws_rds_cluster_instance.db_instances[*].endpoint
}

output "security_group_id" {
  description = "Security group ID for database"
  value       = aws_security_group.db_security_group.id
}

output "database_name" {
  description = "Database name"
  value       = aws_rds_cluster.db_cluster.database_name
}
