# Troubleshooting

## Installer fails on prereqs

### "Node was not found" or "Node 18 or newer is required"
Install the LTS Node from https://nodejs.org/en/download.  Close and reopen the terminal so PATH refreshes, then re-run `install.bat`.

### "clasp install failed"
- Behind a corporate proxy?  Set `HTTPS_PROXY=http://your-proxy` and re-run.
- SSL cert error?  Run `npm config set strict-ssl false` (the installer does this automatically) then retry.
- Still failing?  Install manually: `npm install -g @google/clasp`

### "supabase CLI install failed"
The installer tries Scoop first, then a direct binary download.  If both fail:
- Install Scoop: `iwr -useb get.scoop.sh | iex`
- Then `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git`
- Then `scoop install supabase`
- Or download the latest release manually from https://github.com/supabase/cli/releases

### "gh CLI install failed" (winget unavailable)
Skip — gh is only needed if you want to use the GitHub Releases feature for updates.  The core install works without it.  To install manually later: https://cli.github.com

---

## Installer fails on cloud deploy

### `supabase login` opens a browser but nothing happens
- Make sure your browser is signed into the Google account / Supabase account you intend to use.
- The CLI sometimes prints the URL to the terminal — copy it and open manually.

### `supabase db push` fails with "permission denied"
Your service_role key was probably entered as the anon key.  Re-run the installer and paste the service_role secret (longer string, starts with `eyJ...`, marked "service_role" in the Supabase API settings page).

### `clasp login` opens a browser, says "redirect URI mismatch"
This means a previous Apps Script session is still active.  Run `clasp logout` then re-run the installer.

### `clasp create` fails with "Apps Script API has not been enabled"
Open https://script.google.com/home/usersettings and turn ON the "Google Apps Script API" toggle.  Then re-run the installer.

### `clasp run __installer_setConfig` fails
This is non-fatal.  The installer prints a fallback path: open the Apps Script editor, paste the function, and run it once manually.  Then close the editor — the installer cleans up after.

### n8n workflow import fails: "401 Unauthorized"
Your n8n API key is wrong or expired.  Regenerate in n8n Settings -> API.  Re-run the installer or import the JSON files manually from `n8n-workflows/`.

---

## Runtime issues

### Dashboard loads but inbox is empty
- Check `Settings -> Health` for connection errors.  If `supabase_reachable` is "error", the URL or key in Script Properties is wrong.
- The triage workflow needs to be active in n8n.  Open n8n -> Workflows -> activate `01-email-triage-*`.
- Inbox shows after the first poll cycle (~5 minutes after activation, or whenever your next unread email arrives).

### "Generate Draft" returns "Claude HTTP 401"
Your `ANTHROPIC_API_KEY` is wrong or has been revoked.  Rotate at console.anthropic.com and update Apps Script Properties.

### "Send" returns "Graph HTTP 401" (Outlook)
M365 OAuth token expired or scopes wrong.  Open the dashboard Settings -> Connect Outlook to re-authorize.

### "Learn My Voice" returns "No sent messages found"
- Gmail: make sure the script has the `gmail.readonly` scope.  Open Apps Script editor -> Project Settings -> OAuth scopes -> reauthorize.
- Outlook: same M365 re-authorization as above, but `Mail.Read` scope must be granted.

### Triage classifications are way off
Run the test harness: `cd training; .\run-harness.ps1`.  If the score is below 80%:
1. Open `apps-script/triage-prompt.txt`.
2. Verify the `{{COMPANY_INDUSTRY}}` and team-member tokens were substituted correctly (use Apps Script editor -> view the deployed script).
3. The prompt may need tuning for your industry.  Edit, `clasp push`, re-run harness.

---

## Data + state

### How do I see what's in Supabase?
Open Supabase Dashboard -> SQL Editor.  Useful queries:

```sql
-- Recent inbox
select received_at, from_email, subject, category, resolved
  from triage_emails
  order by received_at desc
  limit 50;

-- Current persona
select * from persona;

-- Due nudges
select * from nudge_state where paused = false and next_nudge_at <= now();
```

### How do I reset persona to generic default?
```sql
update persona
  set learned_from_sent_folder = false,
      voice_rules = '[]'::jsonb,
      signature_phrases = '[]'::jsonb
  where id = 1;
```
Then click "Learn My Voice" again, or just leave it as default.

### How do I uninstall everything?
1. Apps Script: `clasp open` -> File -> Move to Trash.
2. Supabase: project settings -> Delete project.
3. n8n: delete each imported workflow.
4. Local: `Remove-Item -Recurse -Force <repo-clone>` plus delete `~/.clasprc.json`.

---

## Still stuck?
File an issue at https://github.com/kmortonny/email-triage-agent/issues with:
- OS + PowerShell version (`$PSVersionTable`)
- The exact error message
- The output of `installer/install.ps1 -ErrorAction Continue` (re-run with verbose: `$VerbosePreference='Continue'`)

