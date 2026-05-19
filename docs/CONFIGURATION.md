# Configuration reference

Everything the agent needs is either captured by `installer/install.ps1` (or `install.sh`) or set later from the dashboard Settings panel.  This reference exists for anyone who wants to set things by hand or audit what is stored where.

## Where things live

| Setting | Storage | Set by |
|---|---|---|
| Owner name, title, company, industry | Supabase `persona` row + `app_config` | Installer step 1 |
| Email provider (gmail/outlook) | Apps Script Script Property `EMAIL_PROVIDER` | Installer step 2 |
| `ANTHROPIC_API_KEY` | Apps Script Script Properties + n8n Credentials | Installer step 3 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Apps Script Script Properties | Installer step 4 |
| `N8N_URL` / `N8N_API_KEY` | Apps Script Script Properties | Installer step 5 |
| `M365_CLIENT_ID` / `M365_CLIENT_SECRET` | Apps Script Script Properties (Outlook only) | Manual — see below |
| Voice profile | Supabase `persona` table | Learn-My-Voice button |
| Feature flags (modules) | Supabase `app_config.modules` | Defaults; toggle in dashboard Settings |
| Spam rules, known contacts, training | Supabase tables | Dashboard / n8n triage learning workflow |

## Re-running the installer

Safe.  Existing Script Properties are overwritten only when you supply a non-empty value; press Enter to keep the prior value.

```powershell
cd installer
.\install.ps1
```

## Setting Script Properties by hand

Open the Apps Script editor (`clasp open` from `apps-script/`), go to Project Settings -> Script Properties.

Required keys:
- `SUPABASE_URL` — `https://<projectref>.supabase.co`
- `SUPABASE_SERVICE_KEY` — the service_role secret (NOT the anon key)
- `ANTHROPIC_API_KEY` — `sk-ant-...`
- `EMAIL_PROVIDER` — `gmail` or `outlook`
- `OWNER_EMAIL` — your email

Optional:
- `N8N_URL`, `N8N_API_KEY` — if you skipped n8n during install
- `M365_CLIENT_ID`, `M365_CLIENT_SECRET` — Outlook provider only

## Setting up Outlook / M365 (advanced)

The Gmail provider uses Apps Script's built-in `GmailApp` and needs no extra setup.  Outlook needs an Entra ID (Azure AD) app registration:

1. Go to https://portal.azure.com -> Microsoft Entra ID -> App registrations -> New.
2. Name: `Email Triage Agent`.  Supported accounts: choose what fits your account type.
3. Redirect URI: `https://script.google.com/macros/d/<your-script-id>/usercallback`
4. After creation, copy **Application (client) ID** -> Apps Script Properties as `M365_CLIENT_ID`.
5. Certificates & Secrets -> New client secret -> copy the Value (not the ID) into `M365_CLIENT_SECRET`.
6. API Permissions -> Add `Mail.Send`, `Mail.Read`, `offline_access` (delegated).  Grant admin consent if your tenant requires it.
7. In the dashboard, open Settings -> Connect Outlook.  You will be redirected to Microsoft to authorize.  After consent, you can use Outlook send + voice learning.

## Feature flags

Stored in Supabase `app_config` under key `modules` as JSON:

```json
{
  "email_core":    true,
  "crm":           false,
  "audio_notes":   true,
  "meeting_notes": true
}
```

Toggle these from the dashboard Settings panel.  The CRM module enables pipeline/deals/stages UI and the `refreshDealHintsOnUnactioned` job.

## Rotating secrets

If a key is exposed, rotate immediately:

1. **Anthropic** — console.anthropic.com -> API keys -> revoke + create new -> paste into Script Properties.
2. **Supabase service_role** — Supabase Dashboard -> Settings -> API -> Rotate service_role key -> paste new key into Script Properties.
3. **n8n API key** — n8n Settings -> API -> revoke + create new.

The dashboard will keep working through a rotation as long as Script Properties are updated within ~1 minute (Apps Script does not cache them long).

## Where the data lives (and what to delete to nuke it all)

- **Triaged emails + persona + nudges** — your Supabase project.  Delete the project to nuke everything.
- **Web app + UI + credentials** — your Apps Script project.  Delete the project to remove the dashboard.
- **n8n workflows** — your n8n Cloud workspace.  Delete or deactivate from the n8n UI.
- **Local config** — `config.local.json` in the repo root.  Delete it after install if you want to discard the local copy of credentials.
