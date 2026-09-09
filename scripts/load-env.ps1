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

# Keep local SSO sidecar + Magentic off the corporate proxy.
# Python hello reaches chat.int.bayer.com directly; Skyhigh was aborting large Deno repair POSTs.
$requiredNoProxy = @("127.0.0.1", "localhost", "chat.int.bayer.com")
$parts = @()
if ($env:NO_PROXY) {
  $parts = @($env:NO_PROXY.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
foreach ($hostName in $requiredNoProxy) {
  $already = $false
  foreach ($p in $parts) {
    if ($p -ieq $hostName) { $already = $true; break }
  }
  if (-not $already) { $parts += $hostName }
}
$localNoProxy = ($parts -join ",")
[Environment]::SetEnvironmentVariable("NO_PROXY", $localNoProxy, "Process")
[Environment]::SetEnvironmentVariable("no_proxy", $localNoProxy, "Process")
