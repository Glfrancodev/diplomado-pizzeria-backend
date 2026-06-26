#!/usr/bin/env bash
#
# deploy.sh — Despliegue end-to-end de test_nest a AWS.
#
# Flujo:
#   1. Pre-flight checks (CLIs, Docker)
#   2. terraform init + apply (auto-aprobado) — usa creds de terraform.tfvars o aws configure
#   3. Extrae outputs de Terraform
#   4. Login a ECR
#   5. Build + push de imágenes (orders, notifications)
#   6. force-new-deployment en ECS
#
# Uso:
#   chmod +x deploy.sh
#   ./deploy.sh

set -euo pipefail

# -------- Estilo de logs --------
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
  C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"
  C_RED="$(tput setaf 1)"
  C_BLUE="$(tput setaf 4)"
  C_RESET="$(tput sgr0)"
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_RESET=""
fi

step() { printf "\n${C_BLUE}[%s]${C_RESET} %s\n" "$1" "$2"; }
ok()   { printf "${C_GREEN}✔${C_RESET} %s\n" "$1"; }
warn() { printf "${C_YELLOW}⚠${C_RESET} %s\n" "$1"; }
die()  { printf "${C_RED}✘ %s${C_RESET}\n" "$1" >&2; exit 1; }

# -------- Rutas --------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$PROJECT_ROOT/terraform/option-b-ecs"

# =========================================================
# Paso 1 — Pre-flight checks
# =========================================================
step "1/6" "Pre-flight checks"

for bin in terraform aws docker; do
  command -v "$bin" >/dev/null 2>&1 || die "Falta '$bin' en el PATH. Instalalo antes de continuar."
done
ok "CLIs disponibles: terraform, aws, docker"

docker info >/dev/null 2>&1 || die "Docker no está corriendo. Iniciá Docker Desktop y reintentá."
ok "Docker daemon activo"

[[ -d "$TF_DIR" ]] || die "No encuentro el directorio Terraform: $TF_DIR"

if [[ ! -f "$TF_DIR/terraform.tfvars" ]] && [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  warn "No hay terraform.tfvars ni AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY. Se usará el perfil de 'aws configure'."
fi

# =========================================================
# Paso 2 — Terraform init + apply
# =========================================================
step "2/6" "Terraform init + apply (auto-aprobado)"

pushd "$TF_DIR" >/dev/null
terraform init -input=false
terraform apply -auto-approve -input=false
popd >/dev/null
ok "Infraestructura AWS aprovisionada"

# =========================================================
# Paso 3 — Outputs de Terraform
# =========================================================
step "3/6" "Extrayendo outputs de Terraform"

pushd "$TF_DIR" >/dev/null
ECR_ORDERS_URL="$(terraform output -raw ecr_orders_repository_url)"
ECR_NOTIFICATIONS_URL="$(terraform output -raw ecr_notifications_repository_url)"
ALB_DNS_NAME="$(terraform output -raw alb_dns_name)"
CLUSTER_NAME="$(terraform output -raw cluster_name)"
popd >/dev/null

ECR_REGISTRY="${ECR_ORDERS_URL%/*}"
AWS_REGION="$(echo "$ECR_REGISTRY" | awk -F'.' '{print $4}')"
[[ -n "$AWS_REGION" ]] || AWS_REGION="$(aws configure get region || echo us-east-1)"

ok "ALB DNS:        $ALB_DNS_NAME"
ok "Cluster:        $CLUSTER_NAME"
ok "ECR registry:   $ECR_REGISTRY"
ok "Región:         $AWS_REGION"

# =========================================================
# Paso 4 — Login a ECR
# =========================================================
step "4/6" "Login a ECR"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null
ok "Docker autenticado contra $ECR_REGISTRY"

# =========================================================
# Paso 5 — Build + push de imágenes
# =========================================================
step "5/6" "Build y push de imágenes Docker"

cd "$PROJECT_ROOT"

echo "→ Building orders..."
docker build --platform linux/amd64 -f apps/orders/Dockerfile -t "$ECR_ORDERS_URL:latest" .
echo "→ Pushing orders..."
docker push "$ECR_ORDERS_URL:latest"
ok "orders → $ECR_ORDERS_URL:latest"

echo "→ Building notifications..."
docker build --platform linux/amd64 -f apps/notifications/Dockerfile -t "$ECR_NOTIFICATIONS_URL:latest" .
echo "→ Pushing notifications..."
docker push "$ECR_NOTIFICATIONS_URL:latest"
ok "notifications → $ECR_NOTIFICATIONS_URL:latest"

# =========================================================
# Paso 6 — Force new deployment en ECS
# =========================================================
step "6/6" "Forzando redeploy de los servicios ECS"

aws ecs update-service \
  --cluster "$CLUSTER_NAME" \
  --service orders \
  --force-new-deployment \
  --region "$AWS_REGION" >/dev/null
ok "orders: force-new-deployment lanzado"

aws ecs update-service \
  --cluster "$CLUSTER_NAME" \
  --service notifications \
  --force-new-deployment \
  --region "$AWS_REGION" >/dev/null
ok "notifications: force-new-deployment lanzado"

echo
echo "Esperando a que los servicios queden estables (puede tardar 2-5 min)..."
if aws ecs wait services-stable \
    --cluster "$CLUSTER_NAME" \
    --services orders notifications \
    --region "$AWS_REGION"; then
  ok "Servicios estables"
else
  warn "Timeout esperando services-stable — revisá la consola ECS si persiste."
fi

# =========================================================
# Resumen
# =========================================================
cat <<EOF

${C_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}
${C_GREEN} Despliegue completado${C_RESET}
${C_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}

URL pública:
  http://${ALB_DNS_NAME}

Probar la API:
  curl -X POST http://${ALB_DNS_NAME}/orders \\
    -H "Content-Type: application/json" \\
    -d '{"customer":"ana","total":120}'

  curl http://${ALB_DNS_NAME}/orders/status/ana

Ver logs en vivo:
  aws logs tail /ecs/test-nest/orders --follow --region ${AWS_REGION}
  aws logs tail /ecs/test-nest/notifications --follow --region ${AWS_REGION}
  aws logs tail /ecs/test-nest/nats --follow --region ${AWS_REGION}

Para destruir toda la infraestructura:
  cd "${TF_DIR}" && terraform destroy -auto-approve

EOF
