# Makefile — atajos del BACKEND de la Pizzería (dev local + deploy a ECS).
# La infra (Terraform/AWS) vive en OTRO repo: acá NO hay targets de terraform.
# Uso: `make` (o `make help`) muestra la lista.

.ONESHELL:

# En Windows usamos Git Bash (ruta corta 8.3 para evitar el espacio de "Program Files").
ifeq ($(OS),Windows_NT)
    SHELL := C:/PROGRA~1/Git/bin/bash.exe
else
    SHELL := /bin/bash
endif
.SHELLFLAGS := -euo pipefail -c

AWS_REGION ?= us-east-1
IMAGE_TAG  ?= latest

# El "puente" con la infra (exportá estas vars o usá un .deploy.env). Ver deploy.sh.
AWS_ACCOUNT_ID ?=
ECS_CLUSTER    ?=

.PHONY: help \
        up down prod-up prod-down \
        deploy \
        services logs-orders logs-kitchen logs-delivery \
        clean

help:  ## Lista los targets disponibles
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ----- Dev local (infra dockerizada: NATS + DynamoDB local) -----

up:  ## Levanta la infra local (docker compose up -d)
	docker compose up -d

down:  ## Baja la infra local
	docker compose down

prod-up:  ## Stack completo dockerizado (3 servicios + NATS + DynamoDB local)
	docker compose -f docker-compose.prod.yml up --build

prod-down:  ## Baja el stack de docker-compose.prod.yml
	docker compose -f docker-compose.prod.yml down

# ----- Deploy a AWS (ECR + ECS). La infra ya existe (otro repo). -----

deploy:  ## Pipeline completo: build + push a ECR + force-new-deployment (corre deploy.sh)
	bash ./deploy.sh

# ----- Inspección -----

services:  ## Estado de los servicios ECS (running/desired count)
	aws ecs describe-services \
	  --cluster "$(ECS_CLUSTER)" --services orders kitchen delivery \
	  --region $(AWS_REGION) \
	  --query 'services[].{name:serviceName,running:runningCount,desired:desiredCount,status:status}' \
	  --output table

logs-orders:  ## Logs en vivo de orders
	aws logs tail /ecs/pizzeria/orders --follow --region $(AWS_REGION)

logs-kitchen:  ## Logs en vivo de kitchen
	aws logs tail /ecs/pizzeria/kitchen --follow --region $(AWS_REGION)

logs-delivery:  ## Logs en vivo de delivery
	aws logs tail /ecs/pizzeria/delivery --follow --region $(AWS_REGION)

clean:  ## Borra imágenes Docker locales del proyecto
	-docker rmi $$(docker images --filter=reference='*pizzeria/*' -q) 2>/dev/null || true

.DEFAULT_GOAL := help
