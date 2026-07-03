# 🍕 Pizzería Online — Backend (Grupo 2)

Backend de una pizzería online: **3 microservicios NestJS** que se comunican por
**NATS**, persisten en **DynamoDB** y se despliegan en **AWS ECS Fargate**.

El flujo imita una cocina real: entra un pedido, la cocina verifica que haya
ingredientes, lo prepara y, una vez listo, se asigna un repartidor que lo entrega.
Si falta un ítem, el pedido se rechaza antes de cocinarse.

> La **infraestructura** (Terraform: VPC, ECS, ALB, DynamoDB, IAM, ECR) vive en
> **otro repositorio**. Este repo es **solo el backend**, que se adapta a los
> contratos de esa infra (nombres de tablas, env vars, IAM roles).

---

## 📑 Tabla de contenidos

1. [Arquitectura](#-arquitectura)
2. [Los 3 microservicios](#-los-3-microservicios)
3. [Modelo de datos (DynamoDB)](#-modelo-de-datos-dynamodb)
4. [Mensajería NATS (eventos y mensajes)](#-mensajería-nats-eventos-y-mensajes)
5. [Endpoints HTTP (orders)](#-endpoints-http-orders)
6. [El flujo completo de un pedido](#-el-flujo-completo-de-un-pedido)
7. [Estructura del proyecto](#-estructura-del-proyecto)
8. [Correr en local](#-correr-en-local)
9. [Desplegar en AWS](#-desplegar-en-aws)
10. [Seguridad y decisiones de diseño](#-seguridad-y-decisiones-de-diseño)

---

## 🏗 Arquitectura

```
                         ┌─────────────────────────────────────────┐
   Frontend  ───HTTP────▶│  orders  (única puerta HTTP, :3000)      │  ← detrás del ALB
   (React)               │  patrón "gateway": recibe todo y reparte │
                         └──────────────────┬──────────────────────┘
                                            │  NATS (nats://nats.app.internal:4222)
                              ┌─────────────┴──────────────┐
                              ▼                            ▼
                       ┌────────────┐               ┌────────────┐
                       │  kitchen   │               │  delivery  │
                       │ worker     │               │ worker     │
                       │ NATS puro  │               │ NATS puro  │
                       └─────┬──────┘               └─────┬──────┘
                             │                            │
                   ┌─────────┴─────────┐                  │
                   ▼                   ▼                  ▼
            pizzeria-productos  pizzeria-ingredientes  pizzeria-repartidores
                          (DynamoDB)                       (DynamoDB)

   orders  ──▶  pizzeria-pedidos (DynamoDB, su tabla propia)
```

- **NATS** es el bus de mensajería: los servicios no se conocen entre sí, solo
  conocen al broker. Hay dos patrones: **eventos** (fire-and-forget) y **mensajes**
  (request/response).
- **DynamoDB** es la base: 4 tablas, una por entidad, **un único dueño por tabla**.
- Todo corre en **ECS Fargate**; solo `orders` está expuesto, detrás de un **ALB**.

---

## 🧩 Los 3 microservicios

| Servicio | HTTP | Tabla(s) que toca | Responsabilidad |
|----------|------|-------------------|-----------------|
| **orders** | ✅ :3000 (gateway) | `pizzeria-pedidos` | Única puerta HTTP. CRUD de pedidos, calcula el total, orquesta por NATS, persiste estados. |
| **kitchen** | ❌ worker NATS | `pizzeria-productos`, `pizzeria-ingredientes` | Menú, recetas y stock. Valida ingredientes, simula la preparación. |
| **delivery** | ❌ worker NATS | `pizzeria-repartidores` | Repartidores. Asigna uno disponible (con cola de espera) y simula el viaje. |

`kitchen` y `delivery` **no exponen HTTP**: son workers puros que solo escuchan NATS.

---

## 🗃 Modelo de datos (DynamoDB)

4 tablas, **solo partition key** (sin sort key), schema-less salvo la PK.

### `pizzeria-pedidos` — dueño: **orders**
```jsonc
{
  "pedidoId": "uuid",                 // PK
  "cliente": { "nombre": "Ana", "correo": "ana@mail.com" },
  "direccion": "Calle Falsa 123",
  "estado": "pending",                // máquina de estados (ver flujo)
  "lineas": [
    { "productoId": "prod-jalapeno", "cantidad": 1, "extras": ["ing-queso"], "subtotal": 105 }
  ],
  "total": 105,
  "repartidor": null,                 // repartidorId asignado por delivery
  "createdAt": "...", "updatedAt": "..."
}
```

### `pizzeria-productos` — dueño: **kitchen** (menú + receta)
```jsonc
{
  "productoId": "prod-jalapeno",      // PK (slug)
  "nombre": "Pizza Jalapeño",
  "precioBase": 100,
  "receta": [ { "ingredienteId": "ing-queso", "cantidad": 5 } ]
}
```

### `pizzeria-ingredientes` — dueño: **kitchen** (stock)
```jsonc
{ "ingredienteId": "ing-queso", "nombre": "Queso", "cantidadDisponible": 100 } // PK: ingredienteId
```

### `pizzeria-repartidores` — dueño: **delivery**
```jsonc
{ "repartidorId": "uuid", "nombre": "Juan", "correo": "juan@piz.com", "estado": "disponible", "pedido": null } // PK: repartidorId
```

> **Database-per-service estricto:** cada servicio solo toca SUS tablas. Para datos
> de otro dominio, se piden por NATS (ej: orders nunca lee productos; le pregunta a
> kitchen). Esto lo **fuerza IAM** (acceso a otra tabla → `AccessDenied`).

---

## 📨 Mensajería NATS (eventos y mensajes)

### Eventos (`emit` / `@EventPattern`) — fire-and-forget
Son la cadena asíncrona de un pedido. El emisor no espera respuesta.

| Evento | Emite | Escucha | Payload |
|--------|-------|---------|---------|
| `order.created` | orders | kitchen | `{ pedidoId, lineas }` |
| `order.verifying` | kitchen | orders | `{ pedidoId, estado, startedAt }` |
| `order.preparing` | kitchen | orders | `{ pedidoId, estado, startedAt }` |
| `order.ready` | kitchen | orders, delivery | `{ pedidoId, estado, preparedAt }` |
| `order.rejected` | kitchen | orders | `{ pedidoId, estado, reason }` |
| `order.searching_delivery` | delivery | orders | `{ pedidoId, estado, since }` |
| `order.on_the_way` | delivery | orders | `{ pedidoId, estado, repartidor, startedAt }` |
| `order.delivered` | delivery | orders | `{ pedidoId, estado, repartidor, deliveredAt }` |

### Mensajes (`send` / `@MessagePattern`) — request/response
orders pregunta y **espera respuesta** (consigue datos sin tocar tablas ajenas).

| Mensaje | De → a | Request → Response |
|---------|--------|--------------------|
| `products.list` | orders → kitchen | `{}` → `Producto[]` |
| `products.get` | orders → kitchen | `{ productoId }` → `{ producto, disponible }` |
| `ingredients.list` | orders → kitchen | `{}` → `Ingrediente[]` |
| `products.create` | orders → kitchen | `{ productoId, nombre, precioBase, receta }` → `Producto` |
| `ingredients.create` | orders → kitchen | `{ ingredienteId, nombre, cantidadDisponible }` → `Ingrediente` |
| `repartidores.create` | orders → delivery | `{ nombre, correo }` → `Repartidor` |

> Los nombres y tipos viven en `libs/contracts` (librería compartida): un único
> lugar para los subjects y los payloads, así un typo no compila.

---

## 🌐 Endpoints HTTP (orders)

Todo lo del frontend pasa por `orders`. Lo que es de comida/repartidores se
**reenvía por NATS** a su dueño; lo de pedidos lo maneja `orders` en su tabla.

| Método | Endpoint | Qué hace |
|--------|----------|----------|
| `GET` | `/health` | Liveness simple (200). |
| `GET` | `/orders/status/healthcheck` | Health check del ALB (200). |
| `GET` | `/products` | Lista el menú → NATS `products.list` (kitchen). |
| `GET` | `/products/:id` | Un producto + flag `disponible` → NATS `products.get`. |
| `GET` | `/ingredients` | Lista ingredientes (extras) → NATS `ingredients.list`. |
| `POST` | `/products` | Alta de pizza → NATS `products.create` (kitchen). |
| `POST` | `/ingredients` | Alta de ingrediente → NATS `ingredients.create` (kitchen). |
| `POST` | `/repartidores` | Alta de repartidor → NATS `repartidores.create` (delivery). |
| `POST` | `/orders` | Crea el pedido: pide precios a kitchen, calcula el total, guarda `pending`, emite `order.created`. |
| `GET` | `/orders/:id` | Lee el pedido (para el polling del frontend). |

### Ejemplo: crear un pedido
```bash
curl -X POST http://<alb_dns_name>/orders \
  -H "Content-Type: application/json" \
  -d '{
    "cliente": { "nombre": "Gabriel", "correo": "gabriel@example.com" },
    "direccion": "Av. Principal 123",
    "lineas": [{ "productoId": "prod-jalapeno", "cantidad": 1, "extras": ["ing-queso"] }]
  }'
```

> Hay una **colección de Postman** lista para importar en
> [`docs/pizzeria.postman_collection.json`](docs/pizzeria.postman_collection.json).

### Cálculo del precio (lo hace orders, nunca el frontend)
```
subtotal de línea = (precioBase + nº_extras × 5) × cantidad
total = Σ subtotales
```
El frontend manda solo IDs y cantidades. orders pide los `precioBase` a kitchen y
calcula: **nunca se confía en precios del navegador**.

---

## 🔄 El flujo completo de un pedido

### Máquina de estados
```
pending → verifying → preparing → ready → (searching_delivery) → on_the_way → delivered
                    ↘ rejected (si falta stock)
```

### Quién hace qué
1. `POST /orders` → **orders** pide precios a kitchen, calcula el total, guarda
   `pending` y emite `order.created`.
2. **kitchen** escucha `order.created`: emite `verifying`, valida la receta ×
   cantidad + extras contra el stock.
   - Si **falta** algo → `order.rejected` (no descuenta nada).
   - Si **alcanza** → `order.preparing`, descuenta stock, simula la cocina, `order.ready`.
3. **delivery** escucha `order.ready`: busca un repartidor disponible.
   - Si **hay** → `order.on_the_way`, simula el viaje, libera al repartidor, `order.delivered`.
   - Si **no hay** → `order.searching_delivery` y el pedido espera en una **cola
     en memoria**; cuando un repartidor se libera, atiende al primero de la cola.
4. **orders** escucha todos esos eventos y **persiste cada estado** en
   `pizzeria-pedidos` (es el único escritor de esa tabla).
5. El **frontend** hace polling `GET /orders/:id` cada 2s y ve la progresión.

### Tiempos (para que el polling vea cada estado)
- **Mínimo 4s** entre estados "instantáneos".
- **~10s** los estados que simulan trabajo: `preparing` y `on_the_way`.

Timeline típico: `pending(0s) → verifying(4s) → preparing(8s) → ready(18s) → on_the_way(22s) → delivered(32s)`.

> "Simular" = un `sleep` artificial con logs. No cocina ni maneja nada real.

---

## 📁 Estructura del proyecto

```
apps/
  orders/    ← HTTP gateway + dueño de pedidos (DynamoDB) + escucha eventos
  kitchen/   ← worker NATS: productos + ingredientes, validación de stock
  delivery/  ← worker NATS: repartidores, asignación + cola de espera
libs/
  contracts/ ← tipos + nombres de eventos/mensajes compartidos (@app/contracts)
scripts/
  seed-local.mjs  ← crea tablas + siembra datos en DynamoDB Local
  seed-cloud.mjs  ← siembra por la API (ALB), para la nube
docs/
  CICD-SETUP.md                    ← tutorial del pipeline (IAM + secrets)
  pizzeria.postman_collection.json ← endpoints para Postman
.github/workflows/deploy.yml       ← pipeline CI/CD (build → push ECR → redeploy)
deploy.sh / Makefile               ← deploy manual del backend
docker-compose.yml                 ← infra LOCAL (NATS + DynamoDB Local + UI)
```

Cada servicio tiene su `Dockerfile` (build `--platform linux/amd64`, tag `latest`).

---

## 💻 Correr en local

Requisitos: **Node 20+**, **Docker Desktop**.

```bash
# 1. Instalar dependencias
npm install

# 2. Levantar la infra local (NATS + DynamoDB Local + UI en :8001)
docker compose up -d

# 3. Crear las 4 tablas y sembrar datos de prueba
npm run seed:local

# 4. Configurar las variables de entorno
cp .env.example .env

# 5. Arrancar los 3 servicios (en 3 terminales separadas)
npm run start:kitchen
npm run start:delivery
npm run start:orders
```

Probar:
```bash
curl http://localhost:3000/products
curl -X POST http://localhost:3000/orders -H "Content-Type: application/json" \
  -d '{"cliente":{"nombre":"Ana","correo":"a@a.com"},"direccion":"Calle 1","lineas":[{"productoId":"prod-margarita","cantidad":2,"extras":["ing-queso"]}]}'
# luego: curl http://localhost:3000/orders/<pedidoId>  (cada 2s)
```

- **DynamoDB Admin UI** (ver las tablas): http://localhost:8001
- **NATS monitoring**: http://localhost:8222

> Cómo funciona local sin AWS: si está la env var `DYNAMO_ENDPOINT`, el código
> apunta a DynamoDB Local con credenciales truchas. En AWS esa var no existe, así
> que usa el DynamoDB real con las credenciales del IAM role.

---

## ☁️ Desplegar en AWS

El despliegue son **dos cosas separadas**:

1. **Infra (Terraform, en el otro repo):** `terraform apply` crea VPC, ECS, ALB,
   ECR (repos vacíos), DynamoDB (4 tablas), IAM roles. Se hace una vez.
2. **App (este repo):** `build → push a ECR → ecs update-service --force-new-deployment`.
   Mete tu código en la infra. Se hace en cada cambio.

### Opción manual
```bash
AWS_ACCOUNT_ID=... ECS_CLUSTER=pizzeria-cluster ./deploy.sh
```

### Opción CI/CD (recomendada)
El workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) corre
en cada push a `main`, en 3 stages: **ci → build-push (×3) → deploy**. Necesita 4
secrets en GitHub (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
`ECS_CLUSTER`). El paso a paso completo (crear el IAM de permiso mínimo + cargar
los secrets) está en [`docs/CICD-SETUP.md`](docs/CICD-SETUP.md).

### Poblar la nube y observar
```bash
# Sembrar por la API (orders → NATS → kitchen/delivery)
node scripts/seed-cloud.mjs http://<alb_dns_name>

# Ver el "baile" de mensajes NATS en los logs de los 3 servicios:
aws logs tail /ecs/pizzeria/orders   --follow --region us-east-1
aws logs tail /ecs/pizzeria/kitchen  --follow --region us-east-1
aws logs tail /ecs/pizzeria/delivery --follow --region us-east-1
```

> Tras cada `terraform apply` las tablas DynamoDB y los repos ECR arrancan vacíos:
> hay que volver a pushear imágenes (pipeline) y sembrar (`seed-cloud`).

---

## 🔐 Seguridad y decisiones de diseño

- **Sin credenciales en el código.** En Fargate, el IAM task role inyecta las
  credenciales; el SDK las toma solo (`new DynamoDBClient({ region })`).
- **Database-per-service estricto, forzado por IAM.** Cada servicio solo puede
  tocar sus tablas; tocar una ajena → `AccessDenied`. La encapsulación no depende
  de "portarse bien", la garantiza la infra.
- **Un solo escritor por tabla.** delivery no escribe en pedidos: emite eventos y
  orders persiste. Mínimo privilegio impecable.
- **El precio lo calcula el backend**, nunca el frontend.
- **Cola de espera en memoria (delivery).** Si hay más pedidos que repartidores,
  esperan en cola. Es en memoria: si el contenedor reinicia, se pierde (aceptable
  en demo; en prod sería SQS / NATS JetStream).
- **3 capas de credenciales distintas:** (1) tus creds admin para `terraform apply`,
  (2) las del CI/CD para push a ECR + redeploy, (3) los task roles de los
  contenedores para DynamoDB. Ninguna ve a la otra.
