# Start Browserless OSS (ghcr.io/browserless/chromium) on :3000
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "load-env.ps1")

$token = if ($env:BROWSERLESS_TOKEN) { $env:BROWSERLESS_TOKEN } else { "local-dev-token" }
$concurrent = if ($env:BROWSERLESS_CONCURRENT) { $env:BROWSERLESS_CONCURRENT } else { "10" }
$queued = if ($env:BROWSERLESS_QUEUED) { $env:BROWSERLESS_QUEUED } else { "10" }
$timeoutMs = if ($env:BROWSERLESS_TIMEOUT_MS) { $env:BROWSERLESS_TIMEOUT_MS } else { "300000" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host @"

  Docker is not installed or not on PATH.
  Install Docker Desktop, then re-run this script, or start Browserless manually:

    docker run --rm -p 3000:3000 -e "TOKEN=$token" -e "CONCURRENT=$concurrent" `
      -e "QUEUED=$queued" -e "TIMEOUT=$timeoutMs" --shm-size=2g ghcr.io/browserless/chromium:v2.55.4

"@
  exit 1
}

$existing = docker ps --filter "publish=3000" --format "{{.Names}}" 2>$null
if ($existing) {
  Write-Host "Browserless already listening on port 3000 ($existing). Leave it running or stop it first."
  exit 0
}

Write-Host "Starting Browserless OSS on http://127.0.0.1:3000"
Write-Host "  TOKEN     = $token"
Write-Host "  Health    = GET http://127.0.0.1:3000/active"

docker run --rm `
  -p 3000:3000 `
  -e "TOKEN=$token" `
  -e "CONCURRENT=$concurrent" `
  -e "QUEUED=$queued" `
  -e "TIMEOUT=$timeoutMs" `
  --shm-size=2g `
  ghcr.io/browserless/chromium:v2.55.4
