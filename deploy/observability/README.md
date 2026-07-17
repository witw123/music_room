# Observability profile

Start the optional stack with environment substitution so secrets are not committed:

```bash
export METRICS_TOKEN=...
export ALERT_WEBHOOK_URL=https://alerts.example/webhook
./deploy/observability/render-config.sh deploy/linux/observability-rendered
docker compose --profile observability -f deploy/linux/docker-compose.prod.yml config
docker compose --profile observability -f deploy/linux/docker-compose.prod.yml up -d
```

Prometheus and Alertmanager stay on the internal Compose network. Grafana is configured for `/ops/grafana/` and requires `GRAFANA_ADMIN_PASSWORD`. The server rejects production `/metrics` requests unless `METRICS_TOKEN` is configured and matches the Bearer token.
