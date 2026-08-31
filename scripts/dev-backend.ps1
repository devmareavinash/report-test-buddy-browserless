# Start Deno backend (edge functions gateway on :8000)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "load-env.ps1")

$backendDir = Join-Path $PSScriptRoot "..\backend"
Write-Host "Starting Deno backend on http://localhost:8000"
Write-Host "  SNOWFLAKE_SSO_URL   = $env:SNOWFLAKE_SSO_URL"
Write-Host "  LOCAL_FUNCTIONS_URL = $env:LOCAL_FUNCTIONS_URL"
Write-Host "  BROWSERLESS_HOST    = $env:BROWSERLESS_HOST"
Write-Host "  BROWSERLESS_TOKEN   = $(if ($env:BROWSERLESS_TOKEN) { '(set)' } else { '(not set)' })"
Write-Host "  NO_PROXY            = $env:NO_PROXY"

Push-Location $backendDir
try {
  deno run --allow-net --allow-env --allow-read server.ts
} finally {
  Pop-Location
}
