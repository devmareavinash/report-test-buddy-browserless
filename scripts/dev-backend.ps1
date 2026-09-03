# Start Deno backend (edge functions gateway on :8000)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "load-env.ps1")

# Bayer VDI: Skyhigh intercepts HTTPS. Deno's Mozilla CA store then fails with
# UnknownIssuer → playwright-runtime returns {"error":"fetch failed"}.
# Docker already passes --unsafely-ignore-certificate-errors when a proxy is set.
# Set DENO_STRICT_TLS=true to keep default cert checks (e.g. off-VDI).
if (-not $env:HTTP_PROXY) { $env:HTTP_PROXY = "http://10.185.190.10:8080" }
if (-not $env:HTTPS_PROXY) { $env:HTTPS_PROXY = "http://10.185.190.10:8080" }
if (-not $env:http_proxy) { $env:http_proxy = $env:HTTP_PROXY }
if (-not $env:https_proxy) { $env:https_proxy = $env:HTTPS_PROXY }

# Local Docker Desktop OSS Browserless. Codespace github.dev :3000 returns 404 from this VDI
# even when the port is Public. Prefer localhost unless BROWSERLESS_USE_CODESPACE=true.
if ($env:BROWSERLESS_USE_CODESPACE -ne "true") {
  $env:BROWSERLESS_HOST = "http://127.0.0.1:3000"
  $env:BROWSERLESS_OSS = "true"
}

$tlsFlags = @()
if ($env:DENO_STRICT_TLS -ne "true") {
  $tlsFlags += "--unsafely-ignore-certificate-errors"
}

$backendDir = Join-Path $PSScriptRoot "..\backend"
Write-Host "Starting Deno backend on http://localhost:8000"
Write-Host "  SNOWFLAKE_SSO_URL   = $env:SNOWFLAKE_SSO_URL"
Write-Host "  LOCAL_FUNCTIONS_URL = $env:LOCAL_FUNCTIONS_URL"
Write-Host "  BROWSERLESS_HOST    = $env:BROWSERLESS_HOST"
Write-Host "  BROWSERLESS_TOKEN   = $(if ($env:BROWSERLESS_TOKEN) { '(set)' } else { '(not set)' })"
Write-Host "  HTTP_PROXY          = $env:HTTP_PROXY"
Write-Host "  NO_PROXY            = $env:NO_PROXY"
Write-Host "  TLS                 = $(if ($tlsFlags.Count) { $tlsFlags -join ' ' } else { 'strict' })"

Push-Location $backendDir
try {
  deno run @tlsFlags --allow-net --allow-env --allow-read server.ts
} finally {
  Pop-Location
}
