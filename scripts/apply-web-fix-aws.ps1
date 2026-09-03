# Rebuild rtb-web for Fargate (sync + warehouse-save fixes) and save a tar for CloudShell.
# Requires: Docker Desktop running, ~3 GB free on C:.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$env:HTTP_PROXY = "http://10.185.190.10:8080"
$env:HTTPS_PROXY = "http://10.185.190.10:8080"

Get-Content .env | ForEach-Object {
  if ($_ -match '^(VITE_SUPABASE_URL|VITE_SUPABASE_PUBLISHABLE_KEY|VITE_SUPABASE_PROJECT_ID)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim().Trim('"'), "Process")
  }
}

Write-Host "Building rtb-web:latest with nginx.aws.conf..."
docker build `
  --build-arg NGINX_CONF=nginx.aws.conf `
  --build-arg VITE_USE_LOCAL_BACKEND=true `
  --build-arg VITE_SUPABASE_URL=$env:VITE_SUPABASE_URL `
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=$env:VITE_SUPABASE_PUBLISHABLE_KEY `
  --build-arg VITE_SUPABASE_PROJECT_ID=$env:VITE_SUPABASE_PROJECT_ID `
  --build-arg HTTP_PROXY=$env:HTTP_PROXY `
  --build-arg HTTPS_PROXY=$env:HTTPS_PROXY `
  --build-arg http_proxy=$env:HTTP_PROXY `
  --build-arg https_proxy=$env:HTTPS_PROXY `
  -t rtb-web:latest .

$out = Join-Path $env:USERPROFILE "Downloads\rtb-web-latest.tar"
if (Test-Path $out) { Remove-Item $out -Force }
Write-Host "Saving $out ..."
docker save -o $out rtb-web:latest
Write-Host "Done: $out  ($([math]::Round((Get-Item $out).Length/1MB,1)) MB)"
Write-Host "Upload this file to CloudShell and run the push commands from the chat."
