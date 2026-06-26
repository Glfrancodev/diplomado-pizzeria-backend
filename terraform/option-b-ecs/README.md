# Opción B — ECS Fargate + ALB + ECR + Cloud Map + ElastiCache

Despliegue de los 2 microservicios, broker NATS y caché Redis en **AWS Fargate + ElastiCache** usando Terraform.

## Arquitectura desplegada

```
                            Internet
                                │
                                ▼
                  ┌──────────────────────────┐
                  │  Application Load        │  ← público (puerto 80)
                  │  Balancer (ALB)          │
                  └────────────┬─────────────┘
                               │ :3000
                               ▼
   ┌─────────────────────────────────────────────────────────┐
   │                  VPC 10.0.0.0/16                        │
   │                                                         │
   │  Subnet pública AZ-a            Subnet pública AZ-b     │
   │  ┌──────────────┐               ┌──────────────┐        │
   │  │ orders task  │               │ orders task  │        │
   │  │ (Fargate)    │               │ (Fargate)    │        │
   │  └──┬───────┬───┘               └──┬───────┬───┘        │
   │     │       │                      │       │            │
   │     │       └─────────┬────────────┘       │            │
   │     │                 ▼                    │            │
   │     │       ┌───────────────────┐          │            │
   │     │       │ ElastiCache Redis │ ◄────────┘            │
   │     │       │ (cache.t3.micro)  │   persistencia órdenes│
   │     │       └───────────────────┘                       │
   │     │                                                   │
   │     └────────────┐                                      │
   │                  ▼                                      │
   │       ┌───────────────┐                                 │
   │       │   NATS task   │   ← descubierta vía             │
   │       │   (Fargate)   │     nats.app.internal           │
   │       └───────▲───────┘                                 │
   │               │                                         │
   │       ┌───────┴────────┐                                │
   │       │ notifications  │                                │
   │       │   (Fargate)    │                                │
   │       └────────────────┘                                │
   └─────────────────────────────────────────────────────────┘
                            │
                            └──► CloudWatch Logs
                            └──► ECR (orders, notifications)
                            └──► Cloud Map (DNS interno)
```

## Recursos creados (por archivo)

| Archivo | Recursos AWS |
|---|---|
| `providers.tf`        | Provider AWS (~> 5.60), tags por defecto (`Project`, `ManagedBy`, `Course`) |
| `variables.tf`        | 13 variables (región, CIDRs, AZs, `task_cpu`, `task_memory`, `redis_node_type`, `image_tag`, etc.) |
| `network.tf`          | VPC `10.0.0.0/16`, 2 subnets públicas (`10.0.1.0/24`, `10.0.2.0/24`), IGW, route table |
| `security_groups.tf`  | 5 SGs encadenados (ALB → orders → nats/redis ← notifications) |
| `ecr.tf`              | 2 repositorios ECR (`test-nest/orders`, `test-nest/notifications`) + lifecycle policy (máx 10 imágenes) |
| `iam.tf`              | Rol de ejecución de tareas (`AmazonECSTaskExecutionRolePolicy`) |
| `service_discovery.tf`| Namespace privado `app.internal` + 3 servicios Cloud Map (nats / orders / notifications) |
| `alb.tf`              | ALB, target group `ip:3000`, listener HTTP:80, health check `/orders/status/healthcheck` (matcher `200-404`) |
| `elasticache.tf`      | Subnet group + nodo ElastiCache Redis 7.1 (`cache.t3.micro`) |
| `logs.tf`             | 3 log groups CloudWatch (`/ecs/test-nest/{nats,orders,notifications}`, retención 7 días) |
| `ecs.tf`              | Cluster `test-nest-cluster`, 3 task definitions (Fargate 0.25 vCPU / 0.5 GB), 3 services |
| `outputs.tf`          | DNS del ALB, URLs de ECR, comando de login a ECR, nombre del cluster, namespace de Cloud Map, endpoint Redis |

## Prerrequisitos

- **Terraform ≥ 1.6**
- **AWS CLI** configurada (`aws configure`) con permisos suficientes
- **Docker** local para construir y empujar imágenes
- Cuenta AWS con límites Fargate disponibles en la región elegida

> Si querés evitar el flujo manual, desde la raíz del repo podés correr `./deploy.sh` (o `make deploy`), que orquesta los pasos 1 a 3 automáticamente.

## Flujo de despliegue (paso a paso)

### 1. Crear la infraestructura

```bash
cd terraform/option-b-ecs
terraform init
terraform plan
terraform apply
```

Al terminar verás los **7 outputs** definidos en `outputs.tf`:

```
alb_dns_name                       = "test-nest-alb-123456.us-east-1.elb.amazonaws.com"
cluster_name                       = "test-nest-cluster"
ecr_orders_repository_url          = "123456789012.dkr.ecr.us-east-1.amazonaws.com/test-nest/orders"
ecr_notifications_repository_url   = "123456789012.dkr.ecr.us-east-1.amazonaws.com/test-nest/notifications"
ecr_login_command                  = "aws ecr get-login-password --region us-east-1 | docker login ..."
service_discovery_namespace        = "app.internal"
redis_endpoint                     = "test-nest-redis.abc123.0001.use1.cache.amazonaws.com:6379"
```

> En este punto los servicios `orders` y `notifications` arrancan pero **fallan**, porque todavía no hay imágenes en ECR. Es esperable.
>
> ElastiCache puede tardar **5-10 minutos** en estar disponible. Terraform espera; tené paciencia con el primer apply.

### 2. Construir y subir las imágenes

Desde la raíz del repo. **`--platform linux/amd64` es obligatorio** si construís desde un Mac M1/M2 o un Windows ARM: Fargate corre x86_64.

```bash
# Login a ECR (copiá el comando del output `ecr_login_command`)
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build + tag + push de orders
docker build --platform linux/amd64 -f apps/orders/Dockerfile \
  -t <ecr_orders_repository_url>:latest .
docker push <ecr_orders_repository_url>:latest

# Build + tag + push de notifications
docker build --platform linux/amd64 -f apps/notifications/Dockerfile \
  -t <ecr_notifications_repository_url>:latest .
docker push <ecr_notifications_repository_url>:latest
```

### 3. Forzar redeploy de los servicios ECS

```bash
aws ecs update-service --cluster test-nest-cluster --service orders        --force-new-deployment
aws ecs update-service --cluster test-nest-cluster --service notifications --force-new-deployment
```

### 4. Probar end-to-end

```bash
# Crear una orden: orders la guarda en Redis y publica order.created en NATS
curl -X POST http://<alb_dns_name>/orders \
  -H "Content-Type: application/json" \
  -d '{"customer":"ana","total":120}'
# → respuesta incluye orderId

# Leer la orden desde Redis
curl http://<alb_dns_name>/orders/<orderId>

# Consultar estado de notificaciones (request/response a notifications)
curl http://<alb_dns_name>/orders/status/ana
```

### 5. Ver logs

```bash
aws logs tail /ecs/test-nest/orders        --follow
aws logs tail /ecs/test-nest/notifications --follow
aws logs tail /ecs/test-nest/nats          --follow
```

## Limpieza

```bash
terraform destroy
```

> ⚠️ ECR no elimina repos con imágenes. Si `destroy` falla en los repositorios, agregale `force_delete = true` en `ecr.tf` o vaciá las imágenes antes.
>
> ElastiCache también tarda algunos minutos en destruirse.

## Estimación de costo (us-east-1, ~24/7)

| Recurso              | Cantidad | Costo aprox. mensual |
|----------------------|----------|----------------------|
| Fargate (0.25 vCPU + 0.5 GB) | 3 tareas (nats + orders + notifications) | ~$22 |
| ALB                  | 1        | ~$17 |
| ElastiCache (cache.t3.micro) | 1 nodo | ~$12 |
| Almacenamiento ECR   | <1 GB    | ~$0.10 |
| CloudWatch Logs      | bajo volumen (retención 7 días) | ~$0.50 |
| **Total**            |          | **~$52/mes** |

Para una clase: levantar antes de la demo y `terraform destroy` al terminar = unos centavos.

## Conceptos clave a discutir en clase

1. **`awsvpc` network mode**: cada tarea Fargate recibe su propia ENI con IP. Por eso los target groups del ALB son `type = "ip"`, no `instance`.
2. **Cloud Map vs ALB interno**: para tráfico este-oeste entre microservicios usamos DNS (más barato). El ALB es solo para tráfico norte-sur (internet → orders).
3. **Servicios administrados vs auto-gestionados**: NATS lo corremos en Fargate (nos lo administramos nosotros). Redis lo usamos vía ElastiCache (lo administra AWS: parches, backups, monitoring). Mostrar el trade-off costo/responsabilidad.
4. **Encadenamiento de SGs**: en vez de listas de CIDRs, las reglas referencian otros SGs (`referenced_security_group_id`). Si las IPs cambian, la regla se sigue cumpliendo.
5. **Roles separados**: `task_execution_role` (lo usa la plataforma ECS) vs `task_role` (lo usa la app dentro del container). Acá solo necesitamos el primero.
6. **Trade-off costo/seguridad**: pusimos tareas en subnets públicas para evitar el costo de NAT Gateway. ElastiCache no recibe IP pública aunque la subnet sea pública, así que queda solo accesible desde dentro de la VPC.
7. **State remoto**: el `backend "s3"` está comentado en `providers.tf`. Discutir por qué es crítico en equipos (locking, no perder el state, no commitear secretos).
8. **Health check pragmático**: la ruta `/orders/status/healthcheck` no existe explícitamente en `orders.controller.ts`, pero cae dentro de `@Get('status/:customer')`, que responde 200. El matcher `200-404` también tolera la versión "no existe". Comparar con un endpoint dedicado `/healthz` que devuelva el estado de las dependencias (Redis, NATS).
9. **Imagen para Fargate**: Fargate corre x86_64, por eso los `docker build` usan `--platform linux/amd64`. Sin esa flag, en Apple Silicon la imagen sale ARM y la tarea falla con `exec format error`.
