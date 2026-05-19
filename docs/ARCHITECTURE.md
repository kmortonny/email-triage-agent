# Architecture

## High-level

```
   +-----------------------+        +----------------------+
   | Gmail or Outlook /M365|        |       Browser        |
   |  (the user's inbox)   |        |    (dashboard UI)    |
   +----------+------------+        +----------+-----------+
              |                                |
              |  poll / OAuth                  |  google.script.run
              v                                v
   +------------------------+      +--------------------------+
   |       n8n Cloud        |      |    Google Apps Script    |
   |  (triage workflows)    |<---->|       web app (UI)       |
   +----------+-------------+      +-------------+------------+
              |                                  |
              |  Anthropic API                   |  REST
              v                                  v
   +------------------------+        +--------------------------+
   |   Anthropic Claude     |        |    Supabase Postgres     |
   |   (triage + drafting)  |        |    (data + persona)      |
   +------------------------+        +--------------------------+
```

## Components

### Apps Script web app (`apps-script/`)
The dashboard UI plus the server-side logic.  Files:

| File | Role |
|---|---|
| `Code.gs` | `doGet()` entry point, `healthCheck()` |
| `Config.gs` | Script-Properties-backed config + `app_config` accessors |
| `Supa.gs` | Thin Supabase REST client built on `UrlFetchApp` |
| `Claude.gs` | Single Anthropic API entry point used by every Claude caller |
| `Persona.gs` | Load/save persona, build system-prompt context |
| `Voice.gs` | Extract voice profile from user's Sent folder (Gmail or Outlook) |
| `Mail.gs` | Provider-agnostic email send (Gmail + Outlook) |
| `Triage.gs` | Parse, draft, sanitize, deal-hint refresh |
| `Nudges.gs` | Generate nudge + intake drafts; due-nudge query |
| `Extract.gs` | BOM, deal, meeting-notes extraction |
| `N8n.gs` | n8n REST + webhook proxy |
| `CRM.gs` | Optional CRM module (pipeline / tasks / stages) |
| `UiBridge.gs` | UI-only convenience wrappers for `google.script.run` |
| `Index.html` | Single-page dashboard (inbox + detail + settings modal) |

Deployed via `clasp`.  The web app URL is the dashboard the user opens.

### Supabase (`supabase/`)
Postgres database holding:
- `triage_emails` — every triaged email, with classification, draft, resolution state
- `persona` — voice profile (generic default or learned from Sent folder)
- `nudge_state` — auto-nudge cadence per customer/vendor/deal
- `spam_rules`, `contacts`, `triage_learning` — supporting data
- `tasks`, `archived_tasks`, `deleted_tasks`, `stages` — optional CRM module
- `app_config` — feature flags + runtime settings

Each user runs their own Supabase project.  RLS is enabled on every table; the Apps Script uses the service-role key (server side) which bypasses RLS.

Migrations live under `supabase/migrations/` and are applied with `supabase db push`.

### n8n Cloud (`n8n-workflows/`)
Hosts the workflows that touch the mailbox:
- **Triage** — polls inbox -> Claude classify -> writes to Supabase
- **Send Email** — webhook receiver, calls Apps Script `sendEmail`
- **Auto-Nudge** — scheduled, queries due nudges, generates drafts
- **Mark Triaged** — webhook, marks the source mail read in Outlook/Gmail
- **Test Harness / Training Runner** — for prompt tuning

Each is shipped as a tokenized JSON.  Installer substitutes tokens and POSTs to `/api/v1/workflows`.

### Anthropic Claude
Default model `claude-sonnet-4-6`.  Every Claude call goes through `Claude.gs::claudeCall()` so the model is one-line swappable.

## Data flow: inbound email

1. n8n's Outlook/Gmail trigger fires when a new unread message arrives.
2. n8n calls Apps Script `/exec?fn=loadTriagePromptContext` to fetch the current owner/company/persona tokens from `app_config`.
3. n8n calls Claude with the prompt + token context + email body.
4. Claude returns structured JSON (category, summary, draft_reply, etc.).
5. n8n POSTs the result to Apps Script `/exec?fn=saveTriageEmail`.
6. `saveTriageEmail` upserts a row in `triage_emails`.
7. Dashboard polls / refreshes; user sees the email + the AI draft.
8. User edits + clicks Send -> dashboard calls `sendEmail` -> goes out via Gmail or Outlook.
9. Dashboard marks the row `resolved = true` in Supabase.

## Data flow: voice learning

1. User clicks "Learn My Voice" in the dashboard.
2. `Voice.gs::extractVoiceFromSent` pulls the last 100-300 sent messages (GmailApp.search or Graph `/me/mailFolders/sentitems/messages`).
3. Strips quoted replies and signatures (heuristic).
4. Sends the corpus to Claude with a voice-extraction prompt.
5. Claude returns a structured voice profile (rules, signoffs, taboo phrases, etc.).
6. `Voice.gs` merges with the existing persona row and writes to Supabase.
7. All future drafts now use the learned profile in their system prompt.

## Data flow: auto-nudge

1. n8n schedule trigger fires (default: Mon-Fri 09:00).
2. n8n calls Apps Script `listDueNudges` which queries `nudge_state` for `next_nudge_at <= now()`.
3. For each due nudge, calls `generateNudgeEmail` with deal context.
4. The generated draft is upserted into `triage_emails` with category `QUOTE_FOLLOW_UP`.
5. User sees it in the inbox, approves or edits, sends.
6. On send, `recordNudgeSent` bumps `last_nudged_at` and computes `next_nudge_at = now() + cadence_days`.

## Why this stack

| Concern | Choice | Why |
|---|---|---|
| Backend runtime | Google Apps Script | Free, runs inside Google's mail security domain, no server to host |
| Database | Supabase | Free-tier Postgres, SQL is easier than RTDB, RLS for defense-in-depth |
| Workflow orchestration | n8n | Visual + extensible, free tier supports the seven workflows |
| LLM | Anthropic Claude | High-quality structured output, persona adherence |
| UI | Vanilla HTML/JS | No build step, ships with the script, mobile-friendly |
| Distribution | GitHub | Anyone can clone + install, version-controlled config |
