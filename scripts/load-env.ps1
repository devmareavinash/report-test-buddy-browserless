# Load .env into the current PowerShell session
param(
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env")
)

if (-not (Test-Path $EnvFile)) {
  Write-Error "Missing $EnvFile - copy .env.example to .env and fill in values."
  exit 1
}

Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $eq = $line.IndexOf("=")
  if ($eq -lt 1) { return }
  $name = $line.Substring(0, $eq).Trim()
  $value = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
  if ($name) {
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

# Keep local SSO sidecar calls off the corporate proxy (Bayer Skyhigh blocks localhost).
$localNoProxy = "127.0.0.1,localhost"
if ($env:NO_PROXY) {
  if ($env:NO_PROXY -notlike "*127.0.0.1*") {
    $localNoProxy = "$env:NO_PROXY,$localNoProxy"
  } else {
    $localNoProxy = $env:NO_PROXY
  }
}
[Environment]::SetEnvironmentVariable("NO_PROXY", $localNoProxy, "Process")
[Environment]::SetEnvironmentVariable("no_proxy", $localNoProxy, "Process")
