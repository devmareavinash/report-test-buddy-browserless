# Start FE + BE + Snowflake SSO for local development
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."

Write-Host @"

  Report Test Buddy — local dev
  ----------------------------
  FE (Vite)         http://localhost:8080
  BE (Deno)         http://localhost:8000
  Snowflake SSO     http://localhost:8002
  Browserless OSS   http://localhost:3000  (scripts/dev-browserless.ps1 — requires Docker)

  Opening 3 terminals. Start Browserless separately if you need script runs.
  Then: Settings -> Warehouses -> SSO -> Test connection

"@

Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $PSScriptRoot "dev-sso.ps1")
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-File", (Join-Path $PSScriptRoot "dev-backend.ps1")
Start-Sleep -Seconds 2

Push-Location $root
try {
  if (-not (Test-Path "node_modules")) {
    Write-Host "Installing npm dependencies..."
    npm install
  }
  Write-Host "Starting Vite frontend on http://localhost:8080"
  npm run dev
} finally {
  Pop-Location
}
