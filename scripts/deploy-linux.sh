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
GHCR_OWNER_VALUE="$(grep '^GHCR_OWNER=' "$ENV_FILE" | cut -d '=' -f2-)"
RELEASE_TAG_VALUE="$(grep '^RELEASE_TAG=' "$ENV_FILE" | cut -d '=' -f2-)"
JWT_SECRET_VALUE="$(grep '^JWT_SECRET=' "$ENV_FILE" | cut -d '=' -f2-)"
AUDIT_HASH_SECRET_VALUE="$(grep '^AUDIT_HASH_SECRET=' "$ENV_FILE" | cut -d '=' -f2-)"
METRICS_TOKEN_VALUE="$(grep '^METRICS_TOKEN=' "$ENV_FILE" | cut -d '=' -f2-)"
DATABASE_URL_VALUE="$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d '=' -f2-)"
POSTGRES_PASSWORD_VALUE="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d '=' -f2-)"
REDIS_PASSWORD_VALUE="$(grep '^REDIS_PASSWORD=' "$ENV_FILE" | cut -d '=' -f2-)"
TURN_SHARED_SECRET_VALUE="$(grep '^TURN_SHARED_SECRET=' "$ENV_FILE" | cut -d '=' -f2-)"
TURN_EXTERNAL_IP_VALUE="$(grep '^TURN_EXTERNAL_IP=' "$ENV_FILE" | cut -d '=' -f2-)"

if [ -z "$APP_DOMAIN_VALUE" ] || [ -z "$API_BASE_URL_VALUE" ] || [ -z "$WS_BASE_URL_VALUE" ] || [ -z "$GHCR_OWNER_VALUE" ] || [ -z "$RELEASE_TAG_VALUE" ]; then
  echo "APP_DOMAIN, NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_WS_URL, GHCR_OWNER and RELEASE_TAG must be set in $ENV_FILE"
  exit 1
fi

case "$(printf '%s' "$APP_DOMAIN_VALUE" | tr '[:upper:]' '[:lower:]')" in
  example.com|example.test|localhost|127.0.0.1)
    echo "APP_DOMAIN must be replaced with the deployment host before production deployment."
    exit 1
    ;;
esac

require_secret() {
  name="$1"
  value="$2"
  normalized="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    ""|*replace*|*changeme*|*your-*|postgres|password|secret|sha-replace*)
      echo "$name must be replaced with a generated secret before production deployment."
      exit 1
      ;;
  esac
}

require_secret JWT_SECRET "$JWT_SECRET_VALUE"
require_secret AUDIT_HASH_SECRET "$AUDIT_HASH_SECRET_VALUE"
require_secret METRICS_TOKEN "$METRICS_TOKEN_VALUE"
require_secret DATABASE_URL "$DATABASE_URL_VALUE"
require_secret POSTGRES_PASSWORD "$POSTGRES_PASSWORD_VALUE"
require_secret REDIS_PASSWORD "$REDIS_PASSWORD_VALUE"
require_secret TURN_SHARED_SECRET "$TURN_SHARED_SECRET_VALUE"
require_secret TURN_EXTERNAL_IP "$TURN_EXTERNAL_IP_VALUE"

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

if ! printf '%s' "$RELEASE_TAG_VALUE" | grep -Eq '^sha-[0-9a-f]{40}$'; then
  echo "RELEASE_TAG must be an immutable sha-<full-commit-sha> tag produced by CI."
  echo "Current value: $RELEASE_TAG_VALUE"
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
