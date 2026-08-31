# Start Snowflake SSO Python service on :8002 (browser login on this VDI)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "load-env.ps1")

$root = Join-Path $PSScriptRoot ".."
$venv = Join-Path $root ".venv"
$python = Join-Path $venv "Scripts\python.exe"
$uvicorn = Join-Path $venv "Scripts\uvicorn.exe"

if (-not (Test-Path $python)) {
  Write-Host "Creating Python venv..."
  Push-Location $root
  python -m venv .venv
  & $python -m pip install -r backend\snowflake-sso\requirements.txt
  Pop-Location
}

Write-Host "Starting Snowflake SSO on http://localhost:8002"
Write-Host "  Browser login will open on THIS machine (VDI)."

Push-Location $root
try {
  & $uvicorn backend.snowflake-sso.app:app --host 0.0.0.0 --port 8002
} finally {
  Pop-Location
}
