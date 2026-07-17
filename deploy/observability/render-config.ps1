param([string]$OutputDir = ".tmp/observability")
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $OutputDir | Out-Null
if (-not $env:METRICS_TOKEN) { throw "METRICS_TOKEN is required" }
if (-not $env:ALERT_WEBHOOK_URL) { throw "ALERT_WEBHOOK_URL is required" }
$prometheus = Get-Content "$PSScriptRoot/prometheus.yml" -Raw
$alertmanager = Get-Content "$PSScriptRoot/alertmanager.yml" -Raw
$prometheus = $prometheus.Replace("`${METRICS_TOKEN}", $env:METRICS_TOKEN)
$alertmanager = $alertmanager.Replace("`${ALERT_WEBHOOK_URL}", $env:ALERT_WEBHOOK_URL)
Set-Content "$OutputDir/prometheus.yml" $prometheus -NoNewline
Set-Content "$OutputDir/alertmanager.yml" $alertmanager -NoNewline
Write-Host "Rendered observability configs to $OutputDir"
