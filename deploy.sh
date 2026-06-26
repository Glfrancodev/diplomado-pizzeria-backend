#!/usr/bin/env bash
#
# deploy.sh — Despliegue del BACKEND de la Pizzería a AWS (ECR + ECS).
#
# La infraestructura (VPC, ECS, ALB, DynamoDB, IAM...) vive en OTRO repo y ya
# está desplegada. Este script NO corre Terraform: solo construye las imágenes
# Docker, las sube a ECR y fuerza un redeploy de los servicios ECS.
#
# El "puente" con la infra son estos datos, que llegan por variable de entorno
# (los da el repo de infra; podés exportarlos o crear un archivo .deploy.env):
#   AWS_REGION       (default: us-east-1)
#   AWS_ACCOUNT_ID   (si no se pasa, se deduce con `aws sts get-caller-identity`)
#   ECS_CLUSTER      (nombre del cluster ECS donde corren los servicios)
#
# Uso:
#   chmod +x deploy.sh
#   AWS_ACCOUNT_ID=123456789012 ECS_CLUSTER=pizzeria-cluster ./deploy.sh
#   # o exportá las vars antes / poné un .deploy.env (ver más abajo)

set -euo pipefail

# -------- Estilo de logs --------
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ $(tput colors 2>/dev/null || echo 0) -ge 8 ]]; then
  C_GREEN="$(tput setaf 2)"; C_YELLOW="$(tput setaf 3)"; C_RED="$(tput setaf 1)"; C_BLUE="$(tput setaf 4)"; C_RESET="$(tput sgr0)"
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_RESET=""
fi
step() { printf "\n${C_BLUE}[%s]${C_RESET} %s\n" "$1" "$2"; }
ok()   { printf "${C_GREEN}✔${C_RESET} %s\n" "$1"; }
warn() { printf "${C_YELLOW}⚠${C_RESET} %s\n" "$1"; }
die()  { printf "${C_RED}✘ %s${C_RESET}\n" "$1" >&2; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Los 3 servicios del backend y su repositorio ECR (los nombres ECR los fija la infra).
#   servicio : repo-ecr : ruta-del-Dockerfile
SERVICES=(
  "orders:pizzeria/orders:apps/orders/Dockerfile"
  "kitchen:pizzeria/kitchen:apps/kitchen/Dockerfile"
  "delivery:pizzeria/delivery:apps/delivery/Dockerfile"
)

# =========================================================
# Paso 1 — Cargar config y pre-flight checks
# =========================================================
step "1/4" "Config y pre-flight checks"

# Permite definir las variables en un archivo .deploy.env (ignorado por git).
if [[ -f "$PROJECT_ROOT/.deploy.env" ]]; then
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.deploy.env"
  ok "Cargado .deploy.env"
fi

for bin in aws docker; do
  command -v "$bin" >/dev/null 2>&1 || die "Falta '$bin' en el PATH."
done
docker info >/dev/null 2>&1 || die "Docker no está corriendo. Iniciá Docker Desktop y reintentá."

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)}"
[[ -n "$AWS_ACCOUNT_ID" ]] || die "No pude obtener AWS_ACCOUNT_ID. Exportalo o configurá 'aws configure'."
[[ -n "${ECS_CLUSTER:-}" ]] || die "Falta ECS_CLUSTER (nombre del cluster ECS que da el repo de infra)."

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ok "Región:       $AWS_REGION"
ok "Cuenta:       $AWS_ACCOUNT_ID"
ok "Cluster ECS:  $ECS_CLUSTER"
ok "ECR registry: $ECR_REGISTRY"

# =========================================================
# Paso 2 — Login a ECR
# =========================================================
step "2/4" "Login a ECR"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null
ok "Docker autenticado contra $ECR_REGISTRY"

# =========================================================
# Paso 3 — Build + push de cada servicio
# =========================================================
step "3/4" "Build y push de imágenes Docker (linux/amd64)"
cd "$PROJECT_ROOT"
for entry in "${SERVICES[@]}"; do
  IFS=':' read -r svc repo dockerfile <<< "$entry"
  image="${ECR_REGISTRY}/${repo}:latest"
  echo "→ Building $svc..."
  docker build --platform linux/amd64 -f "$dockerfile" -t "$image" .
  echo "→ Pushing $svc..."
  docker push "$image"
  ok "$svc → $image"
done

# =========================================================
# Paso 4 — Force new deployment en ECS
# =========================================================
step "4/4" "Forzando redeploy de los servicios ECS"
for entry in "${SERVICES[@]}"; do
  IFS=':' read -r svc _ _ <<< "$entry"
  aws ecs update-service \
    --cluster "$ECS_CLUSTER" --service "$svc" \
    --force-new-deployment --region "$AWS_REGION" >/dev/null
  ok "$svc: force-new-deployment lanzado"
done

echo
echo "Esperando a que los servicios queden estables (puede tardar 2-5 min)..."
if aws ecs wait services-stable \
    --cluster "$ECS_CLUSTER" --services orders kitchen delivery \
    --region "$AWS_REGION"; then
  ok "Servicios estables"
else
  warn "Timeout esperando services-stable — revisá la consola ECS si persiste."
fi

cat <<EOF

${C_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}
${C_GREEN} Despliegue del backend completado${C_RESET}
${C_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}

La URL pública (DNS del ALB) la da el repo de infra (terraform output alb_dns_name).

Ver logs en vivo (ajustá el log group al que defina la infra):
  aws logs tail /ecs/pizzeria/orders   --follow --region ${AWS_REGION}
  aws logs tail /ecs/pizzeria/kitchen  --follow --region ${AWS_REGION}
  aws logs tail /ecs/pizzeria/delivery --follow --region ${AWS_REGION}

EOF
