# Install guide

## Before you start

You will need accounts on (all free tier is fine):
1. **Anthropic** — for the Claude API.  https://console.anthropic.com
2. **Supabase** — for the database.  https://supabase.com
3. **n8n Cloud** — for the inbox workflows.  https://app.n8n.cloud
4. **Google** — for Apps Script (also gives you Gmail integration for free).  https://accounts.google.com
5. **Microsoft 365** (optional) — only if you use Outlook instead of Gmail.

The installer opens signup tabs for accounts you do not already have.

You also need on your machine:
- **Node.js 18 or newer**: https://nodejs.org
- **PowerShell 5.1+** (Windows — ships with Windows 10/11) or **bash** (macOS / Linux — ships with the OS)
- **Git** (to clone the repo): https://git-scm.com

## Install — Windows

```powershell
git clone https://github.com/kmortonny/email-triage-agent.git
cd email-triage-agent\installer
.\install.bat
```

Or double-click `install.bat` from File Explorer.

## Install — macOS / Linux

```bash
git clone https://github.com/kmortonny/email-triage-agent.git
cd email-triage-agent/installer
chmod +x install.sh
./install.sh
```

## What the installer does (step by step)

1. **Prereq check** — verifies Node 18+, installs `clasp`, `gh`, and `supabase` CLIs if missing.
2. **Step 1 of 6 — Owner info**: name, title, email, company name, domain, what your company does.
3. **Step 2 of 6 — Provider**: Gmail or Outlook.
4. **Step 3 of 6 — Anthropic API key**: opens the API keys tab if you do not have one.
5. **Step 4 of 6 — Supabase project**: opens the new-project tab if you do not have one, then asks for the URL + anon key + service_role key.
6. **Step 5 of 6 — n8n Cloud**: opens signup if you do not have an account, asks for the workspace URL + admin API key.
7. **Step 6 of 6 — Deploy**:
   - `supabase db push` — applies the schema to your Supabase project
   - `clasp create` + `clasp push` + `clasp deploy` — creates a private Apps Script project on your Google account and deploys it as a web app
   - Writes credentials into Script Properties via a one-shot `__installer_setConfig` call
   - Imports the n8n workflows via the n8n REST API
8. Prints the dashboard URL.  Click to open.

Total runtime: 8-10 minutes for a fresh install, 2-3 minutes for an update re-run.

## First-run checklist (after install completes)

- [ ] Open the dashboard URL.  You should see "Email Triage Agent" + an empty inbox.
- [ ] Click Settings.  All Health rows should be green.  If any are red, see [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
- [ ] (Optional but recommended) Click "Learn My Voice".  Wait ~30 seconds.  Future drafts will be in your voice.
- [ ] In n8n, activate the imported workflows (they import as inactive by default for safety).  Open `01-email-triage-*` and toggle Active.
- [ ] Wait for your next unread email, or send yourself a test email.  Within ~5 minutes it should appear in the dashboard.

## If something goes wrong

The installer is idempotent — safe to re-run.  Press Enter to keep previously-entered values; only re-enter what you want to change.

For specific errors, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Updating to a new version

```powershell
cd email-triage-agent
git pull
.\installer\install.bat
```

The installer detects existing state, only re-applies changes.

