# Rebuild rtb-web for AWS (Sync fix). Run from project root in PowerShell.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "Checking Docker..."
docker version --format "{{.Server.Version}}"
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: Docker is not running. Start Docker Desktop, wait until it is Ready, then run this script again."
  exit 1
}

. .\scripts\load-env.ps1
if (-not $env:VITE_SUPABASE_URL) {
  Write-Host "ERROR: .env missing VITE_SUPABASE_URL"
  exit 1
}

Write-Host "Building rtb-web:latest (this can take several minutes)..."
docker build `
  --build-arg "VITE_SUPABASE_URL=$env:VITE_SUPABASE_URL" `
  --build-arg "VITE_SUPABASE_PUBLISHABLE_KEY=$env:VITE_SUPABASE_PUBLISHABLE_KEY" `
  --build-arg "VITE_SUPABASE_PROJECT_ID=$env:VITE_SUPABASE_PROJECT_ID" `
  --build-arg "VITE_USE_LOCAL_BACKEND=true" `
  --build-arg "NGINX_CONF=nginx.aws.conf" `
  -t rtb-web:latest `
  .

if ($LASTEXITCODE -ne 0) {
  Write-Host "BUILD FAILED"
  exit $LASTEXITCODE
}

Write-Host "SUCCESS: rtb-web:latest is ready"
docker images rtb-web:latest --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}"
