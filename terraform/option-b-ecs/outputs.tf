output "alb_dns_name" {
  description = "URL pública del ALB."
  value       = aws_lb.main.dns_name
}

output "ecr_orders_repository_url" {
  description = "URL del repo ECR para orders."
  value       = aws_ecr_repository.orders.repository_url
}

output "ecr_notifications_repository_url" {
  description = "URL del repo ECR para notifications."
  value       = aws_ecr_repository.notifications.repository_url
}

output "ecr_login_command" {
  description = "Comando para autenticar Docker contra ECR."
  value       = "aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${local.ecr_registry}"
}

output "cluster_name" {
  description = "Nombre del cluster ECS."
  value       = aws_ecs_cluster.main.name
}

output "service_discovery_namespace" {
  description = "Namespace DNS interno."
  value       = aws_service_discovery_private_dns_namespace.main.name
}

output "redis_endpoint" {
  description = "Host:puerto del nodo ElastiCache Redis."
  value       = "${aws_elasticache_cluster.redis.cache_nodes[0].address}:${aws_elasticache_cluster.redis.cache_nodes[0].port}"
}
