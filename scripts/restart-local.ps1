[CmdletBinding()]
param(
  [SecureString]$DatabasePassword,
  [switch]$SyncDatabase,
  [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$serverRoot = Join-Path $repoRoot "apps\server"
$serverDist = Join-Path $serverRoot "dist"
$webRoot = Join-Path $repoRoot "apps\web"
$envFile = Join-Path $repoRoot ".env"
$logDirectory = Join-Path $repoRoot ".tmp\local"

function Import-LocalEnvFile {
  param(
    [Parameter(Mandatory)]
    [string]$Path,
    [string[]]$ExcludedKeys = @()
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Missing environment file: $Path"
  }

  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
      continue
    }

    $parts = $line -split "=", 2
    $key = $parts[0].Trim()
    if (-not $key -or $ExcludedKeys -contains $key) {
      continue
    }

    Set-Item -Path "Env:$key" -Value $parts[1]
  }
}

function Invoke-Pnpm {
  param([Parameter(Mandatory)][string[]]$Arguments)

  if ($script:pnpmExecutable) {
    & $script:pnpmExecutable @Arguments
  } else {
    & $script:npmExecutable "exec" "--yes" "--package=pnpm@10.0.0" "--" "pnpm" @Arguments
  }

  if ($LASTEXITCODE -ne 0) {
    throw "pnpm command failed with exit code $LASTEXITCODE."
  }
}

function Stop-LocalMusicRoomProcesses {
  $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 3000, 3001 }

  if (-not $listeners) {
    return
  }

  $processes = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $processIds = [System.Collections.Generic.HashSet[int]]::new()

  foreach ($listener in $listeners) {
    [void]$processIds.Add([int]$listener.OwningProcess)
    $parent = $processes | Where-Object { $_.ProcessId -eq $listener.OwningProcess } | Select-Object -First 1
    if ($parent -and $parent.ParentProcessId) {
      [void]$processIds.Add([int]$parent.ParentProcessId)
    }
  }

  Stop-Process -Id @($processIds) -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

function Wait-ForHttp {
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $Url
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return
      }
    } catch {
      # Keep waiting while the dev servers compile their first route.
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for $Url"
}

$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$npmCandidate = Join-Path (Split-Path $nodeExecutable -Parent) "npm.cmd"
$npmExecutable = if (Test-Path -LiteralPath $npmCandidate) {
  $npmCandidate
} else {
  (Get-Command npm.cmd -ErrorAction Stop).Source
}
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
$pnpmExecutable = if ($pnpmCommand) { $pnpmCommand.Source } else { $null }

if (-not $DatabasePassword) {
  $DatabasePassword = Read-Host "PostgreSQL password" -AsSecureString
}

$credential = [System.Management.Automation.PSCredential]::new("postgres", $DatabasePassword)
$plainPassword = $credential.GetNetworkCredential().Password
if ([string]::IsNullOrWhiteSpace($plainPassword)) {
  throw "A PostgreSQL password is required."
}

Import-LocalEnvFile -Path $envFile -ExcludedKeys @("DATABASE_URL")
$env:DATABASE_URL = "postgresql://postgres:$([uri]::EscapeDataString($plainPassword))@127.0.0.1:5432/music_room"

Stop-LocalMusicRoomProcesses
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

Push-Location $repoRoot
try {
  if (-not $SkipBuild) {
    Invoke-Pnpm -Arguments @("--filter", "@music-room/server", "build")
  }

  if ($SyncDatabase) {
    Push-Location $serverRoot
    try {
      & ".\node_modules\.bin\prisma.cmd" "db" "push" "--skip-generate"
      if ($LASTEXITCODE -ne 0) {
        throw "Prisma schema sync failed with exit code $LASTEXITCODE."
      }
    } finally {
      Pop-Location
    }
  }
} finally {
  Pop-Location
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$serverStdout = Join-Path $logDirectory "server-$timestamp.stdout.log"
$serverStderr = Join-Path $logDirectory "server-$timestamp.stderr.log"
$webStdout = Join-Path $logDirectory "web-$timestamp.stdout.log"
$webStderr = Join-Path $logDirectory "web-$timestamp.stderr.log"

$serverProcess = Start-Process -FilePath $nodeExecutable `
  -ArgumentList (Join-Path $serverDist "main.js") `
  -WorkingDirectory $serverDist `
  -RedirectStandardOutput $serverStdout `
  -RedirectStandardError $serverStderr `
  -WindowStyle Hidden `
  -PassThru

$webProcess = Start-Process -FilePath $nodeExecutable `
  -ArgumentList ".\node_modules\next\dist\bin\next dev --port 3000" `
  -WorkingDirectory $webRoot `
  -RedirectStandardOutput $webStdout `
  -RedirectStandardError $webStderr `
  -WindowStyle Hidden `
  -PassThru

Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Variable credential, plainPassword -ErrorAction SilentlyContinue

Wait-ForHttp -Url "http://localhost:3001/health" -TimeoutSeconds 45
Wait-ForHttp -Url "http://localhost:3000/auth" -TimeoutSeconds 60

Write-Host "Music Room is ready."
Write-Host "Web: http://localhost:3000"
Write-Host "API: http://localhost:3001/health"
Write-Host "Server process: $($serverProcess.Id)"
Write-Host "Web process: $($webProcess.Id)"
Write-Host "Logs: $logDirectory"
