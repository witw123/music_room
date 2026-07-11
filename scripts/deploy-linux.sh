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

APP_DOMAIN_VALUE="$(grep '^APP_DOMAIN=' "$ENV_FILE" | cut -d '=' -f2-)"
API_BASE_URL_VALUE="$(grep '^NEXT_PUBLIC_API_BASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)"
WS_BASE_URL_VALUE="$(grep '^NEXT_PUBLIC_WS_URL=' "$ENV_FILE" | cut -d '=' -f2-)"

if [ -z "$APP_DOMAIN_VALUE" ] || [ -z "$API_BASE_URL_VALUE" ] || [ -z "$WS_BASE_URL_VALUE" ]; then
  echo "APP_DOMAIN, NEXT_PUBLIC_API_BASE_URL and NEXT_PUBLIC_WS_URL must be set in $ENV_FILE"
  exit 1
fi

EXPECTED_API_BASE_URL="https://$APP_DOMAIN_VALUE"
EXPECTED_WS_BASE_URL="wss://$APP_DOMAIN_VALUE"

if [ "$API_BASE_URL_VALUE" != "$EXPECTED_API_BASE_URL" ]; then
  echo "NEXT_PUBLIC_API_BASE_URL must be $EXPECTED_API_BASE_URL for production deployments."
  echo "Current value: $API_BASE_URL_VALUE"
  exit 1
fi

if [ "$WS_BASE_URL_VALUE" != "$EXPECTED_WS_BASE_URL" ]; then
  echo "NEXT_PUBLIC_WS_URL must be $EXPECTED_WS_BASE_URL for production deployments."
  echo "Current value: $WS_BASE_URL_VALUE"
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

echo "Waiting for services..."
sleep 8

DEPLOY_CHECK_WEB_URL="$(grep '^NEXT_PUBLIC_API_BASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)" \
DEPLOY_CHECK_APP_URL="$(grep '^NEXT_PUBLIC_API_BASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)/app" \
DEPLOY_CHECK_HEALTH_URL="$(grep '^NEXT_PUBLIC_API_BASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)/health/" \
DEPLOY_CHECK_READINESS_URL="$(grep '^NEXT_PUBLIC_API_BASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)/health/readiness" \
node "$ROOT_DIR/scripts/deploy-check.mjs"

echo "Linux deployment finished."
