# Microservicios con NestJS + NATS + Redis — curso de IaC

Ejemplo didáctico de **2 microservicios NestJS** que se comunican vía un **broker NATS**, persisten en **Redis**, se contenedorizan con **Docker** y se despliegan en **AWS** con **Terraform**.

El proyecto está pensado como hilo conductor del curso, recorriendo 3 niveles:

| Nivel | Qué demuestra | Herramienta |
|---|---|---|
| **1. Local — desarrollo** | Patrones de mensajería (pub/sub y req/res) + persistencia en Redis. | `docker-compose.yml` (NATS + Redis) + `npm run start:*` |
| **2. Local — producción** | Empaquetado en imágenes Docker, todo el stack corriendo en contenedores. | `docker-compose.prod.yml` (NATS + Redis + apps) |
| **3. AWS — producción** | Infraestructura declarativa: VPC, ECS Fargate, ALB, ECR, Cloud Map, ElastiCache. | `terraform/option-b-ecs/` |

---

## 1. Arquitectura de la aplicación

```
                       ┌─────────────────────┐
   POST /orders        │                     │   1. write order:<id>      ┌──────────┐
   ───────────────────►│   orders (HTTP)     │ ─────────────────────────► │  Redis   │
                       │                     │   2. emit order.created    └──────────┘
   GET /orders/:id     │                     │ ───┐ (pub/sub via NATS)         ▲
   ◄──────────────────►│                     │    │                            │ read
                       │                     │    │                            │
   GET /orders/status  │                     │    │                            │
   ───────────────────►│                     │◄──┐│                            │
                       └─────────┬───────────┘   ││                            │
                                 │               ││                            │
                                 ▼               ││                            │
                       ┌─────────────────────┐   ││                            │
                       │    NATS broker      │ ──┘│                            │
                       └─────────┬───────────┘    │                            │
                                 │                │ send notifications.status   │
                                 ▼                │ (req/res via NATS)         │
                       ┌─────────────────────┐    │                            │
                       │  notifications      │ ───┘                            │
                       │  - @EventPattern    │                                 │
                       │  - @MessagePattern  │                                 │
                       └─────────────────────┘                                 │
                                                                               │
                                          orders.findOrder(id) ────────────────┘
```

| Microservicio       | Responsabilidad                                                                                  | Expone     |
| ------------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| `orders`            | API HTTP. Crea órdenes (escribe en Redis + publica evento). Lee órdenes desde Redis. Consulta estado de notificaciones. | HTTP :3000 |
| `notifications`     | Escucha eventos de órdenes y responde requests sobre cuántas notificaciones envió a un cliente.  | NATS only  |

Conceptos clave:

- **Broker (NATS)**: pieza compartida. Los servicios no se conocen entre sí, solo conocen al broker.
- **Caché/almacén (Redis)**: persistencia de las órdenes para poder consultarlas más tarde sin consultar otros sistemas.
- **IaC**: tanto los servicios locales (`docker-compose.yml`) como toda la infra de AWS (`terraform/`) están descritos como código, versionables y reproducibles.
- **Event Pattern (`emit` / `@EventPattern`)**: publish/subscribe, _fire & forget_.
- **Message Pattern (`send` / `@MessagePattern`)**: request/response sobre NATS.
- **Dual write**: en `createOrder` escribimos primero en Redis (fuente de verdad) y luego publicamos el evento. Es un patrón simplificado; en producción se discute _transactional outbox_ para garantizar consistencia.

---

## 2. Estructura del proyecto

```
test_nest/
├── docker-compose.yml          ← Nivel 1: NATS + Redis para dev
├── docker-compose.prod.yml     ← Nivel 2: stack completo dockerizado
├── nest-cli.json               ← Monorepo (2 apps + 1 lib)
├── Makefile                    ← atajos `make up`, `make deploy`, `make logs-orders`, …
├── deploy.sh                   ← pipeline end-to-end Nivel 3 (apply + push + redeploy)
│
├── apps/
│   ├── orders/                 ← Microservicio 1 (HTTP + NATS + Redis)
│   │   ├── Dockerfile          ← multi-stage Node 20-alpine
│   │   └── src/
│   │       ├── main.ts
│   │       ├── orders.module.ts
│   │       ├── orders.controller.ts
│   │       ├── orders.service.ts
│   │       └── redis/
│   │           └── redis.module.ts
│   └── notifications/          ← Microservicio 2 (microservicio NATS puro)
│       ├── Dockerfile          ← multi-stage Node 20-alpine
│       └── src/
│           ├── main.ts
│           ├── notifications.module.ts
│           ├── notifications.controller.ts
│           └── notifications.service.ts
│
├── libs/
│   └── contracts/              ← Eventos y tipos compartidos (@app/contracts)
│       └── src/
│           ├── index.ts
│           ├── nats.constants.ts
│           ├── orders.contracts.ts
│           └── notifications.contracts.ts
│
└── terraform/
    └── option-b-ecs/           ← Nivel 3: despliegue en AWS Fargate
        ├── providers.tf
        ├── variables.tf
        ├── network.tf
        ├── security_groups.tf
        ├── ecr.tf
        ├── iam.tf
        ├── service_discovery.tf
        ├── alb.tf
        ├── elasticache.tf
        ├── logs.tf
        ├── ecs.tf
        ├── outputs.tf
        ├── terraform.tfvars.example
        └── README.md           ← guía detallada del despliegue AWS
```

La librería `@app/contracts` es importante: define **un único lugar** donde viven los nombres de los eventos (`order.created`) y los tipos del payload. Así ambos servicios hablan el mismo idioma sin duplicar strings.

---

## 3. Nivel 1 — Desarrollo local (Node + NATS/Redis en Docker)

Modo más rápido para iterar sobre el código: solo el broker y Redis corren en Docker, las apps corren en Node con hot-reload.

```bash
npm install
npm run infra:up                # arranca NATS + Redis

# en dos terminales separadas:
npm run start:notifications
npm run start:orders
```

Probar:

```bash
# 1. Crear una orden: orders la guarda en Redis y publica order.created
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"customer":"ana","total":120}'
# → {"orderId":"<uuid>","customer":"ana","total":120,"createdAt":"..."}

# 2. Leerla de Redis
curl http://localhost:3000/orders/<uuid>

# 3. Consultar estado de notificaciones (Message Pattern)
curl http://localhost:3000/orders/status/ana
```

En la terminal de `orders` verás:

```
LOG [OrdersService] 💾 Guardado en Redis → <uuid>
LOG [OrdersService] 📤 Publicado order.created → <uuid>
```

Y en la terminal de `notifications` verás `✉️  Enviando notificación a ana...` sin que nadie haya llamado HTTP — esa es la magia de pub/sub.

Inspeccionar Redis directamente:

```bash
docker exec -it redis redis-cli
> KEYS order:*
> GET order:<uuid>
```

Bajar la infra:

```bash
npm run infra:down
```

---

## 4. Nivel 2 — Stack completo dockerizado (local)

Construye las imágenes de `orders` y `notifications` y corre los 4 contenedores juntos (NATS + Redis + 2 apps). Sirve para validar los Dockerfiles antes de pushear a ECR.

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

El flujo de prueba es el mismo (mismas URLs, mismos curls). Diferencias respecto al Nivel 1:

- Las apps corren dentro de contenedores, no en tu Node host.
- Resolución de DNS por nombre de servicio (`nats://nats:4222`, `redis://redis:6379`), no `localhost`.
- Se valida que los Dockerfiles producen imágenes ejecutables.

Bajar:

```bash
docker compose -f docker-compose.prod.yml down
```

---

## 5. Nivel 3 — Despliegue en AWS

Todo el despliegue (infra + build + push + redeploy) está automatizado con el script [`deploy.sh`](./deploy.sh) en la raíz del proyecto. La guía detallada de cada recurso AWS vive en [`terraform/option-b-ecs/README.md`](./terraform/option-b-ecs/README.md).

### 5.1. Prerrequisitos

| Herramienta | Para qué |
|---|---|
| **Docker Desktop** | Construir y pushear las imágenes. **Debe estar corriendo** antes del script. |
| **AWS CLI v2** | Login a ECR, force-new-deployment en ECS. |
| **Terraform** ≥ 1.6 | Aprovisionar VPC, ECS, ALB, ElastiCache, etc. |
| **Bash** | Ejecutar `deploy.sh` (Git Bash en Windows, nativo en macOS/Linux). |
| **Cuenta AWS** | Con permisos de admin o equivalentes para ECS/ECR/VPC/ElastiCache/IAM. |

Instalación rápida en Windows (PowerShell como admin):

```powershell
winget install Docker.DockerDesktop
winget install Amazon.AWSCLI
winget install HashiCorp.Terraform
winget install Git.Git
```

En macOS (Homebrew):

```bash
brew install --cask docker
brew install awscli terraform
```

### 5.2. Configurar credenciales AWS (una sola vez)

Elegí una de las dos opciones:

**Opción A — `aws configure`** (recomendada, las credenciales no quedan en el repo):

```bash
aws configure
# AWS Access Key ID: ...
# AWS Secret Access Key: ...
# Default region name: us-east-1
# Default output format: json
```

**Opción B — `terraform.tfvars`**:

```bash
cp terraform/option-b-ecs/terraform.tfvars.example terraform/option-b-ecs/terraform.tfvars
# editar terraform.tfvars y completar access_key / secret_key
```

> `terraform.tfvars` está en `.gitignore` para que las credenciales no se commiteen por error.

### 5.3. Desplegar con un solo comando

**Linux / macOS / WSL:**

```bash
./deploy.sh
```

**Windows (Git Bash):**

```bash
cd /d/Projects/web_development/test_nest
./deploy.sh
```

**Windows (PowerShell, llamando a bash):**

```powershell
cd D:\Projects\web_development\test_nest
bash ./deploy.sh
```

El script ejecuta automáticamente:

1. Pre-flight checks (CLIs instaladas, Docker corriendo, credenciales AWS válidas).
2. `terraform init` + `terraform apply -auto-approve`.
3. Login a ECR con las credenciales temporales.
4. `docker build` + `docker push` de `orders` y `notifications` (con `--platform linux/amd64` para Fargate).
5. `aws ecs update-service --force-new-deployment` en ambos servicios.
6. Espera a que las tareas queden estables y **imprime la URL pública del ALB**.

Tarda **~10-15 min** en la primera ejecución (ElastiCache es lo más lento). Reejecuciones son más rápidas (~3-5 min) porque Terraform ya tiene el state y solo cambia la imagen.

### 5.4. Probar el despliegue

Copiá la URL del ALB que imprime el script al final y reemplazá `<alb_dns_name>`:

```bash
# Crear orden
curl -X POST http://<alb_dns_name>/orders \
  -H "Content-Type: application/json" \
  -d '{"customer":"ana","total":120}'

# Leer orden
curl http://<alb_dns_name>/orders/<orderId>

# Estado de notificaciones (request/response vía NATS)
curl http://<alb_dns_name>/orders/status/ana
```

Ver logs en vivo en CloudWatch:

```bash
aws logs tail /ecs/test-nest/orders --follow
aws logs tail /ecs/test-nest/notifications --follow
```

### 5.5. Notas específicas de Windows

- **Docker Desktop debe estar corriendo** (icono de ballena azul en la bandeja del sistema). Si no, el script falla en el pre-flight check.
- **No ejecutar desde CMD ni PowerShell directamente** (no entienden `#!/usr/bin/env bash`). Usá Git Bash, WSL o invocá `bash ./deploy.sh` desde PowerShell.
- **CRLF line endings**: si Git clonó el repo con final de línea Windows, Git Bash puede quejarse del shebang. Solución única:

  ```bash
  sed -i 's/\r$//' deploy.sh
  ```

### 5.6. Destruir la infraestructura

Cuando termines la clase / demo (importante para no seguir pagando ~$52/mes):

```bash
cd terraform/option-b-ecs
terraform destroy -auto-approve
```

### 5.7. ¿Qué crea el script en AWS?

- **VPC** propia (`10.0.0.0/16`) con 2 subnets públicas en 2 AZs (`us-east-1a` / `us-east-1b`).
- **ECR** (2 repos: `test-nest/orders`, `test-nest/notifications`) con lifecycle policy (máx 10 imágenes).
- **ECS Cluster** `test-nest-cluster` con 3 services Fargate (`nats`, `orders`, `notifications`) — 0.25 vCPU / 0.5 GB por tarea.
- **ElastiCache Redis** 7.1 (`cache.t3.micro`, 1 nodo standalone) — administrado por AWS.
- **ALB** público en puerto 80 apuntando a `orders:3000` con health check en `/orders/status/healthcheck` (matcher `200-404`).
- **Cloud Map** (`app.internal`) para que los servicios se encuentren por DNS interno (`nats.app.internal:4222`).
- **Security Groups** encadenados (least privilege): ALB → orders → {nats, redis}; notifications → nats.
- **IAM Role** de ejecución para Fargate (descarga de ECR + escritura en CloudWatch).
- **CloudWatch Log Groups** por servicio (retención de 7 días).

Costo estimado: **~$52/mes 24/7**. Para una clase: levantar antes de la demo y `terraform destroy` al terminar = unos centavos.

### 5.8. Flujo manual (referencia educativa)

`deploy.sh` es solo un wrapper sobre estos 4 pasos. Vale la pena ejecutarlos a mano una vez para entender qué hace cada uno:

1. `cd terraform/option-b-ecs && terraform init && terraform apply` → crea toda la infra.
2. `docker build` + `docker push` a las URLs de ECR que devuelve el output.
3. `aws ecs update-service --cluster test-nest-cluster --service orders --force-new-deployment` (idem para `notifications`).
4. `curl http://<alb_dns_name>/orders ...` desde internet.

---

## 6. Puntos didácticos para discutir en clase

1. **Acoplamiento bajo gracias al broker**: agregar un tercer microservicio (`analytics`) que también reaccione a `order.created` no requiere tocar `orders`. Solo se suscribe al evento.
2. **El mismo principio en 3 escalas**: `docker-compose` (2 servicios), `docker-compose.prod.yml` (4 contenedores), `terraform` (decenas de recursos en AWS). Cambia la herramienta, no la idea: _describir la infra como código_.
3. **Contratos compartidos**: usar una lib (`@app/contracts`) en vez de strings sueltos evita el bug clásico `"order.created"` vs `"order.Created"`.
4. **Service Discovery**: en local lo hace Docker (DNS por nombre de servicio); en AWS lo hace Cloud Map. Mismo concepto, distinta implementación.
5. **Managed vs self-hosted**: corremos NATS nosotros (en Fargate) pero Redis lo usamos vía ElastiCache. Discutir el trade-off: costo (más caro) vs responsabilidad (patcheo, backups, monitoring los hace AWS).
6. **Dual write y consistencia**: `createOrder` hace dos escrituras (Redis + NATS). Si la segunda falla, queda inconsistencia. Introducir el patrón _transactional outbox_ como solución de producción.
7. **NAT vs subnets públicas**: en el Terraform pusimos las tareas Fargate en subnets públicas con IP pública para evitar el costo de NAT Gateway (~$32/mes). Discutir cuándo vale la pena pagar NAT (producción real, compliance).
8. **State remoto**: el bloque `backend "s3"` en `providers.tf` está comentado. Discutir por qué es crítico en equipos: locking, history y no perder el state.
9. **Health checks pragmáticos**: el ALB chequea `GET /orders/status/healthcheck` con matcher `200-404`. La ruta cae dentro de `@Get('status/:customer')`, así que devuelve 200 con `sent: 0` y la tarea pasa el health check sin código extra. Discutir cuándo conviene un endpoint dedicado (`/healthz`) vs reutilizar uno existente.
10. **Estado en memoria**: `notifications` guarda los contadores `sentByCustomer` en un `Map` dentro del proceso. Al reiniciar la tarea se pierde. Buen disparador para hablar de stateless services y por qué el estado debería vivir en Redis/DynamoDB, no en el contenedor.

---

## 7. Comandos útiles

### 7.1. npm / docker / terraform / aws

| Comando                                                      | Descripción                                            |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| `npm run infra:up` / `infra:down`                            | Nivel 1 — NATS + Redis con docker-compose              |
| `npm run start:orders` / `start:notifications`               | Nivel 1 — arranca cada microservicio en watch          |
| `npm run build:orders` / `build:notifications`               | Compila los servicios con `nest build`                 |
| `npm run lint` / `npm run format`                            | ESLint (con fix) y Prettier                            |
| `npm test`                                                   | Suite de Jest                                          |
| `docker exec -it redis redis-cli`                            | Inspeccionar las órdenes guardadas en Redis            |
| `docker compose -f docker-compose.prod.yml up -d --build`    | Nivel 2 — stack completo en Docker                     |
| `./deploy.sh`                                                | Nivel 3 — despliegue completo end-to-end en AWS        |
| `cd terraform/option-b-ecs && terraform apply`               | Nivel 3 — solo aprovisionar infraestructura            |
| `cd terraform/option-b-ecs && terraform destroy`             | Nivel 3 — destruir la infra de AWS                     |
| `aws logs tail /ecs/test-nest/orders --follow`               | Logs del servicio orders en producción                 |

### 7.2. Makefile (atajos equivalentes)

Todos los flujos están encapsulados en el [`Makefile`](./Makefile). Ejecutá `make` (o `make help`) para ver la lista. Los más usados:

| Target               | Equivalente a                                                     |
| -------------------- | ----------------------------------------------------------------- |
| `make up` / `down`   | `docker compose up -d` / `down` (Nivel 1)                         |
| `make prod-up`       | `docker compose -f docker-compose.prod.yml up --build` (Nivel 2)  |
| `make init` / `plan` / `apply` | `terraform init` / `plan` / `apply` en `terraform/option-b-ecs` |
| `make outputs`       | `terraform output` (DNS del ALB, URLs de ECR, endpoint Redis)     |
| `make login`         | `aws ecr get-login-password | docker login`                       |
| `make build` / `push`| Build + push de ambas imágenes (`linux/amd64`) a ECR              |
| `make redeploy`      | `aws ecs update-service --force-new-deployment` para los 2 services |
| `make deploy`        | Pipeline completo (corre `./deploy.sh`)                           |
| `make verify`        | `curl -X POST http://<alb_dns>/orders` con un payload de prueba   |
| `make services`      | Tabla con `runningCount` / `desiredCount` de ECS                  |
| `make logs-orders` / `logs-notifications` / `logs-nats` | `aws logs tail` en vivo |
| `make destroy`       | `terraform destroy`                                               |
| `make clean`         | Borra imágenes Docker locales de orders/notifications             |

> En Windows, el `Makefile` usa Git Bash (`C:/PROGRA~1/Git/bin/bash.exe`) automáticamente. Si tu Git no está en `C:\Program Files\Git`, ajustá la variable `SHELL` al principio del archivo.
