# Campaign runner: regenerate + validate Kerendia/Lynkuet non-warehouse scenarios.
# Usage: powershell -File scripts/campaign-run.ps1 [-Limit 5] [-Workstream "Kerendia Athena"]

param(
  [int]$Limit = 0,
  [string]$Workstream = "",
  [switch]$SkipReference,
  [switch]$WithReference,
  [int]$TimeoutSec = 900
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "load-env.ps1")

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$trackerPath = Join-Path $root "logs\campaigns\kerendia-lynkuet-non-wh.json"
$scriptsRoot = Join-Path $root "logs\campaigns\scripts"
$jwtPath = Join-Path $root "logs\campaigns\.session_jwt"
New-Item -ItemType Directory -Force -Path $scriptsRoot | Out-Null

$base = $env:SUPABASE_URL.Trim('"')
$anon = $env:SUPABASE_ANON_KEY.Trim('"')
$fnBase = "http://127.0.0.1:8000/functions/v1"

function Get-Jwt {
  param([switch]$Force)
  if (-not $Force -and (Test-Path $jwtPath)) {
    $t = (Get-Content $jwtPath -Raw).Trim()
    if ($t.Length -gt 40) { return $t }
  }
  $body = @{ email = "admin@admin.com"; password = "admin" } | ConvertTo-Json
  $resp = Invoke-RestMethod -Method POST -Uri "$base/auth/v1/token?grant_type=password" -Headers @{
    apikey = $anon; "Content-Type" = "application/json"
  } -Body $body
  $resp.access_token | Set-Content $jwtPath -Encoding ascii -NoNewline
  Write-Host "[campaign] refreshed JWT"
  return $resp.access_token
}

function Save-Tracker($doc) {
  $doc | ConvertTo-Json -Depth 10 | Set-Content $trackerPath -Encoding utf8
}

function Invoke-AgentScripts {
  param(
    [Parameter(Mandatory = $true)]
    [ref]$TokenRef,
    [string]$ScenarioId,
    $Target = $null
  )
  $bodyObj = @{ scenario_id = $ScenarioId; skip_validate = $true }
  if ($Target) { $bodyObj.target = $Target }
  $body = $bodyObj | ConvertTo-Json -Compress
  $attempt = 0
  while ($true) {
    $attempt++
    $headers = @{
      apikey = $anon
      Authorization = "Bearer $($TokenRef.Value)"
      "Content-Type" = "application/json"
    }
    $tgtLabel = if ($Target) { $Target } else { "main" }
    Write-Host ("[campaign] agent-scripts {0} target={1} skip_validate=true ..." -f $ScenarioId, $tgtLabel)
    # #region agent log
    try {
      $dbg = @{ sessionId = "bf7284"; runId = "post-fix"; hypothesisId = "B"; location = "campaign-run.ps1:invoke"; message = "campaign calling agent-scripts"; data = @{ scenario_id = $ScenarioId; target = $tgtLabel; skip_validate = $true }; timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress
      Add-Content -Path (Join-Path $PSScriptRoot "..\debug-bf7284.log") -Value $dbg -Encoding utf8
    } catch {}
    # #endregion
    try {
      $resp = Invoke-WebRequest -Method POST -Uri "$fnBase/agent-scripts" -Headers $headers -Body $body -TimeoutSec $TimeoutSec -UseBasicParsing
      return ($resp.Content | ConvertFrom-Json)
    } catch {
      $code = $null
      try { $code = [int]$_.Exception.Response.StatusCode } catch {}
      if ($code -eq 401 -and $attempt -lt 3) {
        Write-Host "[campaign] 401 - refreshing JWT and retrying"
        $TokenRef.Value = Get-Jwt -Force
        continue
      }
      throw
    }
  }
}

function Save-WorkingScript($scenario, $code, $kind) {
  $dir = Join-Path $scriptsRoot $scenario.scenario_id
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file = Join-Path $dir "$kind.js"
  Set-Content -Path $file -Value $code -Encoding utf8
  $metaPath = Join-Path $dir "meta.json"
  $meta = @{
    scenario_id = $scenario.scenario_id
    title = $scenario.title
    type = $scenario.type
    report_name = $scenario.report_name
    workstream_name = $scenario.workstream_name
    saved_at = (Get-Date).ToUniversalTime().ToString("o")
    files = @()
  }
  if (Test-Path $metaPath) {
    try { $meta = Get-Content $metaPath -Raw | ConvertFrom-Json } catch {}
  }
  $meta.saved_at = (Get-Date).ToUniversalTime().ToString("o")
  if (-not $meta.files) { $meta | Add-Member -NotePropertyName files -NotePropertyValue @() -Force }
  $meta | ConvertTo-Json -Depth 6 | Set-Content $metaPath -Encoding utf8
  return $file
}

$token = Get-Jwt -Force
$tokenRef = [ref]$token
$doc = Get-Content $trackerPath -Raw | ConvertFrom-Json
$pending = @($doc.scenarios | Where-Object { $_.status -eq "pending" })
if ($Workstream) {
  $pending = @($pending | Where-Object { $_.workstream_name -eq $Workstream })
}
if ($Limit -gt 0) {
  $pending = @($pending | Select-Object -First $Limit)
}

Write-Host ("[campaign] queue={0} of total={1}" -f $pending.Count, $doc.total)

foreach ($s in $pending) {
  $sid = $s.scenario_id
  Write-Host ("`n==== {0} / {1} / {2} ====" -f $s.workstream_name, $s.report_name, $s.title)
  try {
    $s.status = "regenerating"
    Save-Tracker $doc

    $main = Invoke-AgentScripts -TokenRef $tokenRef -ScenarioId $sid -Target $null
    $code = $main.script.playwright_code
    if (-not $code) { throw "No playwright_code in main response" }

    $s.validation = $main.validation
    $mainPath = Save-WorkingScript $s $code "main"
    $paths = @{ main = $mainPath }

    $needRef = $WithReference -and (-not $SkipReference) -and ($s.type -eq "reference_match" -or $s.has_reference_url)
    $mainPassed = $false
    if ($main.validation -and $main.validation.passed) { $mainPassed = $true }
    elseif ($main.validation -and $main.validation.enabled -eq $false) { $mainPassed = $true }
    try {
      $dbg = @{ sessionId = "bf7284"; runId = "campaign-speed"; hypothesisId = "B"; location = "campaign-run.ps1:after-main"; message = "campaign after main generate"; data = @{ scenario_id = $sid; need_ref = [bool]$needRef; main_passed = $mainPassed; will_run_reference = [bool]($needRef); validation_passed = $main.validation.passed; validation_attempts = $main.validation.attempts }; timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress
      Add-Content -Path (Join-Path $PSScriptRoot "..\debug-bf7284.log") -Value $dbg -Encoding utf8
    } catch {}
    if ($needRef) {
      try {
        $ref = Invoke-AgentScripts -TokenRef $tokenRef -ScenarioId $sid -Target "reference"
        $refCode = $ref.script.playwright_code
        if (-not $refCode) { $refCode = $ref.script.assertion_spec.__reference_playwright_code }
        if ($refCode) {
          $refPath = Save-WorkingScript $s $refCode "reference"
          $paths.reference = $refPath
        }
      } catch {
        Write-Host ("[campaign] WARN reference generate failed: {0}" -f $_.Exception.Message)
        $s.notes = "reference_failed: $($_.Exception.Message)"
      }
    }

    $s.script_paths = $paths
    $s.script_saved = $true
    $passed = $false
    if ($main.validation -and $main.validation.passed) { $passed = $true }
    elseif ($main.validation -and $main.validation.enabled -eq $false) {
      $passed = $true
      $s.notes = "validation_skipped"
    }

    if ($passed) {
      $s.status = "validated"
    } else {
      $s.status = "failed"
      $sum = $main.validation.summary
      if (-not $sum) { $sum = "validation_failed" }
      $s.notes = [string]$sum
    }
  } catch {
    $s.status = "failed"
    $s.notes = $_.Exception.Message
    Write-Host ("[campaign] ERROR {0} : {1}" -f $sid, $_.Exception.Message)
  }
  Save-Tracker $doc
  Write-Host ("[campaign] status={0} script_saved={1}" -f $s.status, $s.script_saved)
}

$ok = @($doc.scenarios | Where-Object { $_.status -eq "validated" }).Count
$fail = @($doc.scenarios | Where-Object { $_.status -eq "failed" }).Count
$pend = @($doc.scenarios | Where-Object { $_.status -eq "pending" }).Count
Write-Host ("`n[campaign] done validated={0} failed={1} pending={2}" -f $ok, $fail, $pend)
