#!/usr/bin/env sh
set -eu
: "${METRICS_TOKEN:?METRICS_TOKEN is required}"
: "${ALERT_WEBHOOK_URL:?ALERT_WEBHOOK_URL is required}"
out="${1:-.tmp/observability}"
mkdir -p "$out"
sed "s|\${METRICS_TOKEN}|$METRICS_TOKEN|g; s|\${ALERT_WEBHOOK_URL}|$ALERT_WEBHOOK_URL|g" "$(dirname "$0")/prometheus.yml" > "$out/prometheus.yml"
sed "s|\${ALERT_WEBHOOK_URL}|$ALERT_WEBHOOK_URL|g" "$(dirname "$0")/alertmanager.yml" > "$out/alertmanager.yml"
