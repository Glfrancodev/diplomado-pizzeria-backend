variable "aws_region" {
  description = "Región de AWS donde se desplegará todo."
  type        = string
  default     = "us-east-1"
}

# Definir en terraform.tfvars (no commitear) o usar `aws configure` / env vars.
variable "access_key" {
  description = "AWS access key."
  type        = string
  sensitive   = true
  default     = null
}

variable "secret_key" {
  description = "AWS secret key."
  type        = string
  sensitive   = true
  default     = null
}

variable "project_name" {
  description = "Prefijo para nombrar todos los recursos."
  type        = string
  default     = "test-nest"
}

variable "vpc_cidr" {
  description = "Bloque CIDR de la VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDRs de las subnets públicas (una por AZ)."
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "azs" {
  description = "Availability Zones a usar."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "orders_desired_count" {
  description = "Número de tareas Fargate para orders."
  type        = number
  default     = 1
}

variable "notifications_desired_count" {
  description = "Número de tareas Fargate para notifications."
  type        = number
  default     = 1
}

variable "task_cpu" {
  description = "CPU por tarea Fargate (256 = 0.25 vCPU)."
  type        = string
  default     = "256"
}

variable "task_memory" {
  description = "Memoria por tarea Fargate en MB."
  type        = string
  default     = "512"
}

variable "image_tag" {
  description = "Tag de las imágenes en ECR."
  type        = string
  default     = "latest"
}

variable "redis_node_type" {
  description = "Tipo de nodo ElastiCache para Redis."
  type        = string
  default     = "cache.t3.micro"
}
