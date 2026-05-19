#requires -Version 5.1
<#
.SYNOPSIS
  Email Triage Agent - one-click installer wizard for Windows.

.DESCRIPTION
  Walks a new user through the full deploy:
    1. Prereq check + auto-install of Node CLIs (clasp, gh, supabase)
    2. Account links (Anthropic, Supabase, n8n) - opens signup tabs as needed
    3. Credential capture (masked input for secrets)
    4. Supabase schema push
    5. Apps Script project create + push + web-app deploy
    6. Script Properties populated via Apps Script setConfig()
    7. Optional: open dashboard in browser

  Safe to re-run.  Existing config is preserved unless explicitly overwritten.

.NOTES
  Author : Email Triage Agent contributors
  License: MIT
#>

Set-ExecutionPolicy Bypass -Scope Process -Force
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

# ============================================================================
# Editable variables
# ============================================================================
$RepoRoot      = Split-Path -Parent $PSScriptRoot
$AppsScriptDir = Join-Path $RepoRoot 'apps-script'
$SupabaseDir   = Join-Path $RepoRoot 'supabase'
$N8nDir        = Join-Path $RepoRoot 'n8n-workflows'
$ConfigLocal   = Join-Path $RepoRoot 'config.local.json'
$ScriptIdFile  = Join-Path $AppsScriptDir '.clasp.json'

# ============================================================================
# UI helpers (ASCII safe - PowerShell 5.1 mangles unicode in some consoles)
# ============================================================================
function Write-Banner($text) {
  Write-Host ""
  Write-Host ("=" * 72) -ForegroundColor Cyan
  Write-Host (" " + $text) -ForegroundColor Cyan
  Write-Host ("=" * 72) -ForegroundColor Cyan
  Write-Host ""
}
function Write-Step($n, $text)    { Write-Host ("[$n] " + $text) -ForegroundColor White }
function Write-OK($text)          { Write-Host ("  OK   " + $text) -ForegroundColor Green }
function Write-Warn($text)        { Write-Host ("  WARN " + $text) -ForegroundColor Yellow }
function Write-Err($text)         { Write-Host ("  ERR  " + $text) -ForegroundColor Red }
function Write-Info($text)        { Write-Host ("       " + $text) -ForegroundColor Gray }

function Read-Required($label, $default) {
  while ($true) {
    $prompt = if ($default) { "$label [$default]" } else { $label }
    $v = Read-Host $prompt
    if (-not $v -and $default) { return $default }
    if ($v) { return $v }
    Write-Host "  (required)" -ForegroundColor Yellow
  }
}
function Read-Secret($label) {
  $sec = Read-Host -AsSecureString $label
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
function Confirm-YesNo($label, $defaultYes = $true) {
  $suffix = if ($defaultYes) { '[Y/n]' } else { '[y/N]' }
  $v = (Read-Host "$label $suffix").Trim().ToLower()
  if (-not $v) { return $defaultYes }
  return ($v -eq 'y' -or $v -eq 'yes')
}
function Open-Url($url) {
  Write-Info "Opening $url"
  Start-Process $url | Out-Null
}

# ============================================================================
# Prereqs
# ============================================================================
function Test-Cmd($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  return [bool]$cmd
}
function Install-Prereq($name, $installer) {
  if (Test-Cmd $name) { Write-OK "$name found"; return }
  Write-Warn "$name not found - installing..."
  & $installer
  if (-not (Test-Cmd $name)) {
    throw "$name install failed.  Install manually then re-run this script."
  }
  Write-OK "$name installed"
}

function Ensure-Node {
  if (Test-Cmd 'node') {
    $ver = (& node --version) -replace '^v',''
    $major = [int]($ver.Split('.')[0])
    if ($major -lt 18) {
      throw "Node $ver detected.  Email Triage Agent requires Node 18 or newer.  Update Node and re-run."
    }
    Write-OK "Node $ver"
    return
  }
  Write-Err "Node.js was not found."
  Write-Info "Install Node 18 or newer from https://nodejs.org and re-run this installer."
  Open-Url 'https://nodejs.org/en/download'
  throw "Node.js missing"
}

function Ensure-Clasp {
  Install-Prereq 'clasp' { npm install -g @google/clasp --silent 2>&1 | Out-Null }
}

function Ensure-Gh {
  if (Test-Cmd 'gh') { Write-OK "gh found"; return }
  Write-Warn "gh CLI not found - installing via winget..."
  $w = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $w) {
    Write-Warn "winget unavailable.  Skipping gh install; you can install later from https://cli.github.com"
    return
  }
  winget install --id GitHub.cli --source winget -e --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
  if (Test-Cmd 'gh') { Write-OK "gh installed" } else { Write-Warn "gh install incomplete - install manually if you need GitHub features" }
}

function Ensure-Supabase {
  if (Test-Cmd 'supabase') { Write-OK "supabase found"; return }
  Write-Warn "supabase CLI not found - installing via Scoop..."
  if (-not (Test-Cmd 'scoop')) {
    Write-Info "Installing Scoop first..."
    Invoke-Expression (Invoke-RestMethod -Uri 'https://get.scoop.sh')
  }
  scoop bucket add supabase https://github.com/supabase/scoop-bucket.git 2>&1 | Out-Null
  scoop install supabase 2>&1 | Out-Null
  if (-not (Test-Cmd 'supabase')) {
    Write-Warn "supabase CLI install failed.  Falling back to direct binary download..."
    $url  = 'https://github.com/supabase/cli/releases/latest/download/supabase_windows_amd64.tar.gz'
    $tmp  = Join-Path $env:TEMP 'supabase.tar.gz'
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
    $dest = Join-Path $env:LOCALAPPDATA 'supabase'
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    tar -xzf $tmp -C $dest
    $env:PATH = "$dest;$env:PATH"
    if (-not (Test-Cmd 'supabase')) { throw 'supabase CLI install failed.  Install manually from https://supabase.com/docs/guides/cli' }
  }
  Write-OK "supabase CLI installed"
}

# ============================================================================
# Config capture
# ============================================================================
function Read-Config {
  $cfg = @{}
  if (Test-Path $ConfigLocal) {
    try { $cfg = Get-Content $ConfigLocal -Raw | ConvertFrom-Json -AsHashtable } catch { $cfg = @{} }
  }
  return $cfg
}
function Write-Config($cfg) {
  $json = $cfg | ConvertTo-Json -Depth 6
  Set-Content -LiteralPath $ConfigLocal -Value $json -Encoding utf8 -Force
}

function Capture-Owner($cfg) {
  Write-Banner "Step 1 of 6 - Owner info"
  Write-Info "These will appear in Claude prompts as 'who the agent writes for'."
  Write-Info "All stored locally + in your Supabase project only."
  Write-Host ""
  $cfg.owner = @{
    name  = Read-Required "Your name"                  ($cfg.owner.name)
    title = Read-Required "Your title (e.g. Founder)"  ($cfg.owner.title)
    email = Read-Required "Your email address"         ($cfg.owner.email)
  }
  $cfg.company = @{
    name     = Read-Required "Company name"            ($cfg.company.name)
    domain   = Read-Required "Company domain (e.g. acme.com)" ($cfg.company.domain)
    industry = Read-Required "What your company does (one line)" ($cfg.company.industry)
  }
  $cfg.company.internal_domains = @($cfg.company.domain)
  return $cfg
}

function Capture-Provider($cfg) {
  Write-Banner "Step 2 of 6 - Mailbox provider"
  Write-Info "Which email account does the agent run against?"
  Write-Info "  gmail    - Gmail (personal or Workspace) - simplest setup"
  Write-Info "  outlook  - Outlook / Microsoft 365 - requires Azure app registration"
  Write-Host ""
  $current = if ($cfg.mailbox.provider) { $cfg.mailbox.provider } else { 'gmail' }
  $v = Read-Required "Provider (gmail / outlook)" $current
  if ($v -ne 'gmail' -and $v -ne 'outlook') { throw "Provider must be 'gmail' or 'outlook'" }
  $cfg.mailbox = @{ provider = $v }
  return $cfg
}

function Capture-Anthropic($cfg) {
  Write-Banner "Step 3 of 6 - Anthropic API key"
  Write-Info "Used for triage classification + draft generation."
  Write-Info "Free credit on signup; pay-as-you-go after."
  if (-not (Confirm-YesNo "Do you already have an Anthropic API key?" $true)) {
    Open-Url 'https://console.anthropic.com/settings/keys'
    Write-Info "Sign in -> Settings -> API Keys -> Create Key."
    Read-Host "Press Enter when you have the key in your clipboard"
  }
  $cfg.credentials = $cfg.credentials  # noop if missing
  if (-not $cfg.credentials) { $cfg.credentials = @{} }
  $cfg.credentials.anthropic_api_key = Read-Secret "Paste your Anthropic API key"
  return $cfg
}

function Capture-Supabase($cfg) {
  Write-Banner "Step 4 of 6 - Supabase project"
  Write-Info "Stores triaged emails, persona, nudges, contacts."
  Write-Info "Free tier is plenty for a personal inbox."
  if (-not (Confirm-YesNo "Do you already have a Supabase project?" $false)) {
    Open-Url 'https://supabase.com/dashboard/new'
    Write-Info "Create a new project (any region near you, strong DB password)."
    Write-Info "Wait until the project status is 'Healthy' (~1-2 min)."
    Read-Host "Press Enter when the project is ready"
  }
  Open-Url 'https://supabase.com/dashboard/project/_/settings/api'
  Write-Info "From Settings -> API copy: Project URL, anon public key, service_role secret."
  $cfg.credentials.supabase_url               = Read-Required "Supabase Project URL"  ($cfg.credentials.supabase_url)
  $cfg.credentials.supabase_anon_key          = Read-Secret    "Supabase anon public key"
  $cfg.credentials.supabase_service_role_key  = Read-Secret    "Supabase service_role secret"

  # Extract project ref for supabase link
  if ($cfg.credentials.supabase_url -match 'https://([a-z0-9]+)\.supabase\.co') {
    $cfg.credentials.supabase_project_ref = $matches[1]
  } else {
    throw "Supabase URL must look like https://<projectref>.supabase.co"
  }
  return $cfg
}

function Capture-N8n($cfg) {
  Write-Banner "Step 5 of 6 - n8n Cloud (optional but recommended)"
  Write-Info "n8n hosts the inbound workflows (Gmail/Outlook trigger -> triage -> store)."
  Write-Info "Free tier supports the seven workflows shipped with this repo."
  if (-not (Confirm-YesNo "Do you already have n8n Cloud?" $false)) {
    Open-Url 'https://app.n8n.cloud/register'
    Write-Info "Sign up.  After signup, your URL will look like https://<workspace>.app.n8n.cloud"
    Read-Host "Press Enter when your workspace is ready"
  }
  $cfg.credentials.n8n_url     = Read-Required "Your n8n base URL (e.g. https://yourname.app.n8n.cloud)" ($cfg.credentials.n8n_url)
  Open-Url ($cfg.credentials.n8n_url.TrimEnd('/') + '/settings/api')
  Write-Info "In n8n -> Settings -> API -> Create an API key (admin role)."
  $cfg.credentials.n8n_api_key = Read-Secret "Paste your n8n API key"
  return $cfg
}

# ============================================================================
# Deploy
# ============================================================================
function Run-SupabaseMigration($cfg) {
  Write-Banner "Step 6 of 6 - Deploy"
  Write-Step 1 "Pushing schema to Supabase..."
  Push-Location $RepoRoot
  try {
    if (-not (Test-Path (Join-Path $SupabaseDir 'config.toml'))) {
      throw "supabase/config.toml missing - repo damaged?"
    }
    Write-Info "Logging in to Supabase (browser will open if needed)..."
    & supabase login 2>&1 | Write-Info
    Write-Info "Linking to project ref $($cfg.credentials.supabase_project_ref)..."
    & supabase link --project-ref $cfg.credentials.supabase_project_ref 2>&1 | Write-Info
    Write-Info "Pushing migrations..."
    & supabase db push 2>&1 | Write-Info
    if ($LASTEXITCODE -ne 0) { throw "supabase db push failed" }
    Write-OK "Schema pushed"
  } finally {
    Pop-Location
  }
}

function Run-AppsScriptDeploy($cfg) {
  Write-Step 2 "Logging in to Google Apps Script (browser will open)..."
  Push-Location $AppsScriptDir
  try {
    & clasp login 2>&1 | Write-Info
    if ($LASTEXITCODE -ne 0) { throw "clasp login failed" }

    if (-not (Test-Path $ScriptIdFile)) {
      Write-Info "Creating new Apps Script project..."
      & clasp create --type webapp --title "Email Triage Agent" 2>&1 | Write-Info
      if ($LASTEXITCODE -ne 0) { throw "clasp create failed" }
    } else {
      Write-Info "Existing Apps Script project detected, reusing."
    }

    Write-Step 3 "Pushing apps-script/ files..."
    & clasp push --force 2>&1 | Write-Info
    if ($LASTEXITCODE -ne 0) { throw "clasp push failed" }

    Write-Step 4 "Writing Script Properties (credentials)..."
    $propsScript = @"
function __installer_setConfig() {
  setConfig({
    SUPABASE_URL:        '$($cfg.credentials.supabase_url)',
    SUPABASE_SERVICE_KEY:'$($cfg.credentials.supabase_service_role_key)',
    ANTHROPIC_API_KEY:   '$($cfg.credentials.anthropic_api_key)',
    N8N_URL:             '$($cfg.credentials.n8n_url)',
    N8N_API_KEY:         '$($cfg.credentials.n8n_api_key)',
    EMAIL_PROVIDER:      '$($cfg.mailbox.provider)',
    OWNER_EMAIL:         '$($cfg.owner.email)'
  });
  var p = loadPersona();
  p.owner_name      = '$($cfg.owner.name)';
  p.owner_title     = '$($cfg.owner.title)';
  p.company_name    = '$($cfg.company.name)';
  p.company_industry= '$($cfg.company.industry)';
  savePersona(p);
}
"@
    $tmp = Join-Path $AppsScriptDir '_Installer.gs'
    Set-Content -LiteralPath $tmp -Value $propsScript -Encoding utf8 -Force
    & clasp push --force 2>&1 | Write-Info
    Write-Info "Running __installer_setConfig() in the cloud..."
    & clasp run __installer_setConfig 2>&1 | Write-Info
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "clasp run failed (often needs API enabled).  Falling back to manual instructions."
      Write-Info "Open the Apps Script editor and run __installer_setConfig() once manually."
      & clasp open
    }
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    & clasp push --force 2>&1 | Write-Info

    Write-Step 5 "Deploying web app..."
    & clasp deploy --description "v0.1.0 install" 2>&1 | Write-Info
    Write-Info "Fetching web app URL..."
    $deployments = & clasp deployments 2>&1 | Out-String
    $url = ($deployments -split "`n" | Where-Object { $_ -match 'https://script\.google\.com' } | Select-Object -Last 1) -replace '.*?(https://[^\s]+).*','$1'
    if ($url) {
      $cfg.webapp_url = $url.Trim()
      Write-OK "Web app deployed at $($cfg.webapp_url)"
    } else {
      Write-Warn "Could not parse web app URL.  Run 'clasp deployments' in $AppsScriptDir to find it."
    }
  } finally {
    Pop-Location
  }
  return $cfg
}

function Import-N8nWorkflows($cfg) {
  Write-Step 6 "Importing n8n workflows..."
  $files = Get-ChildItem -LiteralPath $N8nDir -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object Name
  if (-not $files) { Write-Warn "No n8n workflow files found in $N8nDir"; return }
  $base = $cfg.credentials.n8n_url.TrimEnd('/')
  $headers = @{
    'X-N8N-API-KEY' = $cfg.credentials.n8n_api_key
    'Accept'        = 'application/json'
    'Content-Type'  = 'application/json'
  }
  foreach ($f in $files) {
    Write-Info "  $($f.Name)..."
    try {
      $body = Get-Content -LiteralPath $f.FullName -Raw
      $resp = Invoke-RestMethod -Method Post -Uri "$base/api/v1/workflows" -Headers $headers -Body $body -ErrorAction Stop
      Write-Info "    imported as id $($resp.id)"
    } catch {
      Write-Warn "    import failed: $($_.Exception.Message).  Import manually from the n8n UI."
    }
  }
}

# ============================================================================
# Main
# ============================================================================
try {
  Write-Banner "Email Triage Agent - Installer"
  Write-Info "This will set up a private Email Triage Agent on your accounts."
  Write-Info "Estimated time: 8-10 minutes."
  Write-Host ""
  if (-not (Confirm-YesNo "Continue?" $true)) { exit 0 }

  Write-Banner "Prereqs"
  Ensure-Node
  Ensure-Clasp
  Ensure-Gh
  Ensure-Supabase

  $cfg = Read-Config
  $cfg = Capture-Owner     $cfg
  $cfg = Capture-Provider  $cfg
  $cfg = Capture-Anthropic $cfg
  $cfg = Capture-Supabase  $cfg
  $cfg = Capture-N8n       $cfg
  Write-Config $cfg

  Run-SupabaseMigration $cfg
  $cfg = Run-AppsScriptDeploy $cfg
  Import-N8nWorkflows $cfg
  Write-Config $cfg

  Write-Banner "Done"
  Write-OK "Email Triage Agent is installed."
  if ($cfg.webapp_url) {
    Write-Info "Dashboard: $($cfg.webapp_url)"
    if (Confirm-YesNo "Open the dashboard now?" $true) { Open-Url $cfg.webapp_url }
  }
  Write-Info "Local config saved to: $ConfigLocal"
  Write-Info "Re-run this installer any time to update credentials or push code changes."
  Write-Host ""
  Write-Host "Done: Email Triage Agent installed." -ForegroundColor Green
  exit 0
} catch {
  Write-Err $_.Exception.Message
  Write-Info "See docs/TROUBLESHOOTING.md for help.  Re-running the installer is safe."
  exit 1
}
