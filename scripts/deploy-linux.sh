#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT_DIR/deploy/linux"
ENV_FILE="$DEPLOY_DIR/.env.production"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  echo "Copy deploy/linux/.env.production.example to deploy/linux/.env.production first."
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo "Waiting for services..."
sleep 8

DEPLOY_CHECK_WEB_URL="$(grep '^NEXT_PUBLIC_API_BASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)" \
DEPLOY_CHECK_HEALTH_URL="$(grep '^NEXT_PUBLIC_API_BASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)/health" \
DEPLOY_CHECK_READINESS_URL="$(grep '^NEXT_PUBLIC_API_BASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)/health/readiness" \
node "$ROOT_DIR/scripts/deploy-check.mjs"

echo "Linux deployment finished."
