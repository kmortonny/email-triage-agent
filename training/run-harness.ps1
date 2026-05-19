#requires -Version 5.1
<#
.SYNOPSIS
  Run the triage test harness against your deployed Email Triage Agent.

.DESCRIPTION
  Loads training-template.csv, substitutes tokens from config.local.json,
  POSTs each row to the Apps Script web app's /triage endpoint, diffs the
  predicted category vs expected, prints a pass/fail scorecard.
#>

Set-ExecutionPolicy Bypass -Scope Process -Force
$ErrorActionPreference = 'Stop'

$Here       = Split-Path -Parent $PSCommandPath
$RepoRoot   = Split-Path -Parent $Here
$Csv        = Join-Path $Here    'training-template.csv'
$ConfigPath = Join-Path $RepoRoot 'config.local.json'

if (-not (Test-Path $ConfigPath)) {
  Write-Host "config.local.json missing - run installer/install.ps1 first." -ForegroundColor Red
  exit 1
}
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
if (-not $cfg.webapp_url) {
  Write-Host "config.local.json has no webapp_url - re-run the installer." -ForegroundColor Red
  exit 1
}

$ownerFirst = ($cfg.owner.name -split '\s+')[0]
$ownerEmail = $cfg.owner.email

$rows = Import-Csv -Path $Csv
$pass = 0
$fail = 0
$failures = @()

for ($i = 0; $i -lt $rows.Count; $i++) {
  $r = $rows[$i]
  $body = $r.body `
    -replace '\{\{OWNER_FIRST_NAME\}\}', $ownerFirst `
    -replace '\{\{OWNER_NAME\}\}',       $cfg.owner.name `
    -replace '\{\{OWNER_EMAIL\}\}',      $ownerEmail
  $payload = @{
    subject   = $r.subject
    from_name = $r.from_name
    from_email= $r.from_email
    body      = $body
  } | ConvertTo-Json -Compress
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$($cfg.webapp_url)?fn=triageTestOne" -Body $payload -ContentType 'application/json' -ErrorAction Stop
    $predicted = $resp.category
  } catch {
    $predicted = "ERROR: $($_.Exception.Message)"
  }
  $idx = '{0,2}/{1,-2}' -f ($i+1), $rows.Count
  $label = $r.subject.Substring(0, [Math]::Min(40, $r.subject.Length)).PadRight(40)
  if ($predicted -eq $r.expected_category) {
    $pass++
    Write-Host "[$idx] $label PASS  ($predicted)" -ForegroundColor Green
  } else {
    $fail++
    $failures += @{ subject = $r.subject; expected = $r.expected_category; got = $predicted }
    Write-Host "[$idx] $label FAIL  expected=$($r.expected_category) got=$predicted" -ForegroundColor Red
  }
}

$total = $pass + $fail
$pct   = if ($total) { [math]::Round(($pass / $total) * 100, 1) } else { 0 }
Write-Host ""
Write-Host "Total: $pass/$total passed ($pct%)" -ForegroundColor White
if ($fail) {
  Write-Host "Failures:" -ForegroundColor Yellow
  $failures | ForEach-Object { Write-Host "  $($_.subject) : expected $($_.expected), got $($_.got)" -ForegroundColor Yellow }
}
exit ($fail -gt 0 ? 1 : 0)
