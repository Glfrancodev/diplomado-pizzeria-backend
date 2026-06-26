# Makefile — atajos para test_nest (dev local, prod local, ECS en AWS).
# Uso: `make` muestra la ayuda. Cada target encapsula un paso del README/deploy.sh.

# Cada recipe corre como un solo shell → puedo usar variables entre líneas.
.ONESHELL:

# Detección de OS: en Windows usamos Git Bash (ruta corta 8.3 para evitar
# el espacio de "Program Files" que rompe SHELL en GNU Make).
ifeq ($(OS),Windows_NT)
    SHELL := C:/PROGRA~1/Git/bin/bash.exe
else
    SHELL := /bin/bash
endif
.SHELLFLAGS := -euo pipefail -c

TF_DIR     := terraform/option-b-ecs
AWS_REGION ?= us-east-1
IMAGE_TAG  ?= latest

.PHONY: help \
        up down prod-up prod-down \
        init plan apply outputs login \
        build build-orders build-notifications \
        push push-orders push-notifications \
        redeploy redeploy-orders redeploy-notifications \
        deploy verify \
        services logs-orders logs-notifications logs-nats \
        destroy nuke clean

help:  ## Lista los targets disponibles
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ----- Nivel 1: dev local (apps en host, infra dockerizada) -----

up:  ## Levanta NATS + Redis en Docker (apps corren en host con npm)
	docker compose up -d

down:  ## Baja NATS + Redis
	docker compose down

# ----- Nivel 2: prod local (todo dockerizado) -----

prod-up:  ## Stack completo dockerizado (orders + notifications + NATS + Redis)
	docker compose -f docker-compose.prod.yml up --build

prod-down:  ## Baja el stack de docker-compose.prod.yml
	docker compose -f docker-compose.prod.yml down

# ----- Nivel 3: ECS en AWS -----

init:  ## terraform init en el módulo ECS
	cd $(TF_DIR) && terraform init

plan:  ## terraform plan (revisar sin aplicar)
	cd $(TF_DIR) && terraform plan

apply:  ## terraform apply (crea VPC + ECS Cluster + ECR + ALB + servicios)
	cd $(TF_DIR) && terraform apply

outputs:  ## Imprime los outputs de Terraform
	cd $(TF_DIR) && terraform output

login:  ## Login de Docker contra ECR
	cd $(TF_DIR)
	ECR_URL=$$(terraform output -raw ecr_orders_repository_url)
	ECR_REGISTRY=$${ECR_URL%/*}
	aws ecr get-login-password --region $(AWS_REGION) \
	  | docker login --username AWS --password-stdin "$$ECR_REGISTRY"

build-orders:  ## Build de la imagen orders (linux/amd64)
	cd $(TF_DIR)
	ECR_URL=$$(terraform output -raw ecr_orders_repository_url)
	cd $(CURDIR)
	docker build --platform linux/amd64 -f apps/orders/Dockerfile \
	  -t "$$ECR_URL:$(IMAGE_TAG)" .

build-notifications:  ## Build de la imagen notifications (linux/amd64)
	cd $(TF_DIR)
	ECR_URL=$$(terraform output -raw ecr_notifications_repository_url)
	cd $(CURDIR)
	docker build --platform linux/amd64 -f apps/notifications/Dockerfile \
	  -t "$$ECR_URL:$(IMAGE_TAG)" .

build: build-orders build-notifications  ## Build de ambas imágenes

push-orders: login  ## Push de la imagen orders a ECR
	cd $(TF_DIR)
	ECR_URL=$$(terraform output -raw ecr_orders_repository_url)
	docker push "$$ECR_URL:$(IMAGE_TAG)"

push-notifications: login  ## Push de la imagen notifications a ECR
	cd $(TF_DIR)
	ECR_URL=$$(terraform output -raw ecr_notifications_repository_url)
	docker push "$$ECR_URL:$(IMAGE_TAG)"

push: build push-orders push-notifications  ## Build + push de ambas imágenes

redeploy-orders:  ## force-new-deployment del servicio orders en ECS
	cd $(TF_DIR)
	CLUSTER=$$(terraform output -raw cluster_name)
	aws ecs update-service \
	  --cluster "$$CLUSTER" --service orders \
	  --force-new-deployment \
	  --region $(AWS_REGION) >/dev/null
	echo "orders: redeploy lanzado"

redeploy-notifications:  ## force-new-deployment del servicio notifications en ECS
	cd $(TF_DIR)
	CLUSTER=$$(terraform output -raw cluster_name)
	aws ecs update-service \
	  --cluster "$$CLUSTER" --service notifications \
	  --force-new-deployment \
	  --region $(AWS_REGION) >/dev/null
	echo "notifications: redeploy lanzado"

redeploy: redeploy-orders redeploy-notifications  ## Redeploy de ambos servicios

deploy:  ## Pipeline completo: corre deploy.sh (apply + push + redeploy)
	bash ./deploy.sh

verify:  ## Obtiene el DNS del ALB y hace curl a la API
	cd $(TF_DIR)
	ALB_DNS=$$(terraform output -raw alb_dns_name)
	echo "POST http://$$ALB_DNS/orders"
	curl -sS -X POST "http://$$ALB_DNS/orders" \
	  -H "Content-Type: application/json" \
	  -d '{"customer":"ana","total":120}' && echo

# ----- Inspección -----

services:  ## Estado de los servicios ECS (running/desired count)
	cd $(TF_DIR)
	CLUSTER=$$(terraform output -raw cluster_name)
	aws ecs describe-services \
	  --cluster "$$CLUSTER" --services orders notifications \
	  --region $(AWS_REGION) \
	  --query 'services[].{name:serviceName,running:runningCount,desired:desiredCount,status:status}' \
	  --output table

logs-orders:  ## Logs en vivo de orders
	aws logs tail /ecs/test-nest/orders --follow --region $(AWS_REGION)

logs-notifications:  ## Logs en vivo de notifications
	aws logs tail /ecs/test-nest/notifications --follow --region $(AWS_REGION)

logs-nats:  ## Logs en vivo de NATS
	aws logs tail /ecs/test-nest/nats --follow --region $(AWS_REGION)

# ----- Destruir -----

destroy:  ## Vacía ECR + terraform destroy (pide confirmación)
	bash ./destroy.sh

nuke:  ## Idem destroy, sin confirmación (CI / demos)
	bash ./destroy.sh --yes

clean:  ## Borra imágenes Docker locales del proyecto
	-docker rmi $$(docker images --filter=reference='*orders*' -q) 2>/dev/null || true
	-docker rmi $$(docker images --filter=reference='*notifications*' -q) 2>/dev/null || true

.DEFAULT_GOAL := help
