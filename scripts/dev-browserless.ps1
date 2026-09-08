# Start Browserless OSS (ghcr.io/browserless/chromium) on :3000
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "load-env.ps1")

$token = if ($env:BROWSERLESS_TOKEN) { $env:BROWSERLESS_TOKEN } else { "local-dev-token" }
$concurrent = if ($env:BROWSERLESS_CONCURRENT) { $env:BROWSERLESS_CONCURRENT } else { "10" }
$queued = if ($env:BROWSERLESS_QUEUED) { $env:BROWSERLESS_QUEUED } else { "10" }
$timeoutMs = if ($env:BROWSERLESS_TIMEOUT_MS) { $env:BROWSERLESS_TIMEOUT_MS } else { "420000" }

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

$launchArgs = if ($env:BROWSERLESS_LAUNCH_ARGS) {
  $env:BROWSERLESS_LAUNCH_ARGS
} else {
  '["--ignore-certificate-errors","--ignore-certificate-errors-spki-list","--window-size=1920,1080","--force-device-scale-factor=1"]'
}

# Bayer corporate DNS NXDOMAINs mstr-*.bayer.com; public DNS + extra_hosts match compose.
docker run --rm `
  -p 3000:3000 `
  -e "TOKEN=$token" `
  -e "CONCURRENT=$concurrent" `
  -e "QUEUED=$queued" `
  -e "TIMEOUT=$timeoutMs" `
  -e "DEFAULT_LAUNCH_ARGS=$launchArgs" `
  --dns 8.8.8.8 `
  --dns 1.1.1.1 `
  --add-host=host.docker.internal:host-gateway `
  --add-host=mstr-prod.bayer.com:54.84.130.141 `
  --add-host=mstr-qa.bayer.com:54.84.103.229 `
  --shm-size=2g `
  ghcr.io/browserless/chromium:v2.55.4
