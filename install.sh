#!/usr/bin/env bash
# Email Triage Agent - macOS / Linux installer.
# Mirror of install.ps1 - guided wizard, account links, schema push, Apps Script deploy.

set -euo pipefail

REPO_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APPS_SCRIPT_DIR="$REPO_ROOT/apps-script"
SUPABASE_DIR="$REPO_ROOT/supabase"
N8N_DIR="$REPO_ROOT/n8n-workflows"
CONFIG_LOCAL="$REPO_ROOT/config.local.json"

C_RESET='\033[0m'; C_CYAN='\033[1;36m'; C_GREEN='\033[1;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[1;31m'; C_DIM='\033[0;90m'

banner()    { printf "\n${C_CYAN}========================================================================${C_RESET}\n ${C_CYAN}%s${C_RESET}\n${C_CYAN}========================================================================${C_RESET}\n\n" "$1"; }
ok()        { printf "  ${C_GREEN}OK${C_RESET}   %s\n" "$1"; }
warn()      { printf "  ${C_YELLOW}WARN${C_RESET} %s\n" "$1"; }
err()       { printf "  ${C_RED}ERR${C_RESET}  %s\n" "$1"; }
info()      { printf "       ${C_DIM}%s${C_RESET}\n" "$1"; }
step()      { printf "${C_RESET}[%s] %s\n" "$1" "$2"; }

ask()       { local label="$1"; local default="${2:-}"; local v; if [ -n "$default" ]; then read -r -p "$label [$default]: " v; v="${v:-$default}"; else read -r -p "$label: " v; while [ -z "$v" ]; do echo "  (required)"; read -r -p "$label: " v; done; fi; printf '%s' "$v"; }
ask_secret(){ local label="$1"; local v; read -r -s -p "$label: " v; echo ""; printf '%s' "$v"; }
confirm()   { local label="$1"; local def_yes="${2:-1}"; local suffix; if [ "$def_yes" -eq 1 ]; then suffix='[Y/n]'; else suffix='[y/N]'; fi; read -r -p "$label $suffix: " v; v="${v:-}"; if [ -z "$v" ]; then [ "$def_yes" -eq 1 ] && return 0 || return 1; fi; case "${v,,}" in y|yes) return 0;; *) return 1;; esac; }
open_url()  { info "Opening $1"; case "$(uname -s)" in Darwin) open "$1" >/dev/null 2>&1 || true;; Linux)  xdg-open "$1" >/dev/null 2>&1 || true;; esac; }
have()      { command -v "$1" >/dev/null 2>&1; }

ensure_node() {
  if ! have node; then err "Node.js not found.  Install from https://nodejs.org and re-run."; open_url "https://nodejs.org/en/download"; exit 1; fi
  local v; v="$(node --version | sed 's/^v//')"; local major="${v%%.*}"
  if [ "$major" -lt 18 ]; then err "Node $v detected.  Require Node 18+."; exit 1; fi
  ok "Node $v"
}
ensure_npm_global() {
  local pkg="$1"; local bin="$2"
  if have "$bin"; then ok "$bin found"; return; fi
  warn "$bin not found, installing $pkg..."
  npm install -g "$pkg" --silent >/dev/null 2>&1 || { err "npm install -g $pkg failed"; exit 1; }
  have "$bin" && ok "$bin installed" || { err "$bin still missing after install"; exit 1; }
}
ensure_gh() {
  if have gh; then ok "gh found"; return; fi
  warn "gh not found"
  case "$(uname -s)" in
    Darwin) have brew && brew install gh || warn "Install Homebrew, then 'brew install gh'.";;
    Linux)  warn "Install gh from https://github.com/cli/cli/blob/trunk/docs/install_linux.md";;
  esac
}
ensure_supabase() {
  if have supabase; then ok "supabase found"; return; fi
  warn "supabase CLI not found"
  case "$(uname -s)" in
    Darwin) have brew && brew install supabase/tap/supabase || warn "Install Homebrew, then 'brew install supabase/tap/supabase'.";;
    Linux)  warn "Install supabase CLI: see https://supabase.com/docs/guides/cli";;
  esac
  have supabase || { err "supabase CLI still missing"; exit 1; }
}

read_config() {
  if [ -f "$CONFIG_LOCAL" ]; then cat "$CONFIG_LOCAL"; else echo '{}'; fi
}
write_config() { printf '%s' "$1" > "$CONFIG_LOCAL"; }

main() {
  banner "Email Triage Agent - Installer"
  info "This will set up a private Email Triage Agent on your accounts."
  info "Estimated time: 8-10 minutes."
  confirm "Continue?" 1 || exit 0

  banner "Prereqs"
  ensure_node
  ensure_npm_global "@google/clasp" clasp
  ensure_gh
  ensure_supabase

  banner "Step 1 of 6 - Owner info"
  OWNER_NAME=$(ask "Your name")
  OWNER_TITLE=$(ask "Your title (e.g. Founder)")
  OWNER_EMAIL=$(ask "Your email address")
  COMPANY_NAME=$(ask "Company name")
  COMPANY_DOMAIN=$(ask "Company domain (e.g. acme.com)")
  COMPANY_INDUSTRY=$(ask "What your company does (one line)")

  banner "Step 2 of 6 - Mailbox provider"
  PROVIDER=$(ask "Provider (gmail / outlook)" gmail)

  banner "Step 3 of 6 - Anthropic API key"
  if ! confirm "Do you already have an Anthropic API key?" 1; then
    open_url 'https://console.anthropic.com/settings/keys'
    info "Sign in -> Settings -> API Keys -> Create Key.  Press Enter when ready."
    read -r
  fi
  ANTHROPIC_KEY=$(ask_secret "Paste your Anthropic API key")

  banner "Step 4 of 6 - Supabase project"
  if ! confirm "Do you already have a Supabase project?" 0; then
    open_url 'https://supabase.com/dashboard/new'
    info "Create a new project.  Wait until status is Healthy (1-2 min)."
    read -r -p "Press Enter when ready: "
  fi
  open_url 'https://supabase.com/dashboard/project/_/settings/api'
  SUPA_URL=$(ask "Supabase Project URL")
  SUPA_ANON=$(ask_secret "Supabase anon public key")
  SUPA_SVC=$(ask_secret "Supabase service_role secret")
  SUPA_REF="$(printf '%s' "$SUPA_URL" | sed -nE 's#https://([a-z0-9]+)\.supabase\.co.*#\1#p')"
  [ -n "$SUPA_REF" ] || { err "Supabase URL must look like https://<projectref>.supabase.co"; exit 1; }

  banner "Step 5 of 6 - n8n Cloud (optional but recommended)"
  if ! confirm "Do you already have n8n Cloud?" 0; then
    open_url 'https://app.n8n.cloud/register'
    info "Sign up.  Workspace URL will be https://<workspace>.app.n8n.cloud"
    read -r -p "Press Enter when ready: "
  fi
  N8N_URL=$(ask "Your n8n base URL")
  open_url "${N8N_URL%/}/settings/api"
  info "In n8n -> Settings -> API -> Create an admin API key."
  N8N_KEY=$(ask_secret "Paste your n8n API key")

  banner "Step 6 of 6 - Deploy"
  step 1 "Pushing schema to Supabase..."
  ( cd "$REPO_ROOT"
    supabase login
    supabase link --project-ref "$SUPA_REF"
    supabase db push )

  step 2 "Logging in to Apps Script..."
  ( cd "$APPS_SCRIPT_DIR"
    clasp login
    [ -f .clasp.json ] || clasp create --type webapp --title "Email Triage Agent"
    clasp push --force )

  step 3 "Writing Script Properties..."
  cat > "$APPS_SCRIPT_DIR/_Installer.gs" <<EOF
function __installer_setConfig() {
  setConfig({
    SUPABASE_URL:        '$SUPA_URL',
    SUPABASE_SERVICE_KEY:'$SUPA_SVC',
    ANTHROPIC_API_KEY:   '$ANTHROPIC_KEY',
    N8N_URL:             '$N8N_URL',
    N8N_API_KEY:         '$N8N_KEY',
    EMAIL_PROVIDER:      '$PROVIDER',
    OWNER_EMAIL:         '$OWNER_EMAIL'
  });
  var p = loadPersona();
  p.owner_name='$OWNER_NAME'; p.owner_title='$OWNER_TITLE';
  p.company_name='$COMPANY_NAME'; p.company_industry='$COMPANY_INDUSTRY';
  savePersona(p);
}
EOF
  ( cd "$APPS_SCRIPT_DIR"
    clasp push --force
    clasp run __installer_setConfig || warn "clasp run failed; open the Apps Script editor and run __installer_setConfig() manually."
    rm -f _Installer.gs
    clasp push --force
    clasp deploy --description "v0.1.0 install" )

  step 4 "Importing n8n workflows..."
  for f in "$N8N_DIR"/*.json; do
    [ -f "$f" ] || continue
    info "  $(basename "$f")"
    curl -sS -X POST "${N8N_URL%/}/api/v1/workflows" \
      -H "X-N8N-API-KEY: $N8N_KEY" \
      -H 'Content-Type: application/json' \
      --data-binary "@$f" >/dev/null || warn "import failed for $(basename "$f")"
  done

  banner "Done"
  ok "Email Triage Agent is installed."
  info "Local config saved to: $CONFIG_LOCAL"
}

main "$@"
