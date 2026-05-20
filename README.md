# Email Triage Agent

An AI email assistant that triages your inbox, drafts replies in your own writing voice, and follows up on quotes and RFQs — without you having to babysit it.

Connects to Gmail or Outlook, learns your voice from your Sent folder, and runs on infrastructure you own (Google Apps Script + Supabase + n8n Cloud — all free tier eligible).

## What it does

- **Triages incoming mail** into 12 categories (action required, vendor reply, quote follow-up, new opportunity, FYI, spam, etc.)
- **Drafts replies in your voice** — learned from your own Sent folder, not a generic AI tone
- **Auto-nudges** customers who haven't replied to quotes and vendors who owe you RFQ responses
- **Extracts structured data** from vendor RFQ replies (part numbers, pricing, lead times)
- **Sanitizes emails** for safe forwarding (strips sender identity automatically)
- **Transcribes audio notes** you forward to yourself
- **Optional CRM module** — pipeline, deals, stages, Pipedrive import (off by default)

## Install

Windows:
```powershell
git clone https://github.com/kmortonny/email-triage-agent.git
cd email-triage-agent
.\install.bat
```

Mac / Linux:
```bash
git clone https://github.com/kmortonny/email-triage-agent.git
cd email-triage-agent
chmod +x install.sh && ./install.sh
```

The installer walks you through everything: account setup (Google or Microsoft, Supabase, n8n, Anthropic), credential capture, schema deploy, voice learning. Roughly 8-10 minutes start to finish.

Full step-by-step in [INSTALL.md](INSTALL.md). Configuration reference in [docs/CONFIGURATION.md](docs/CONFIGURATION.md). Troubleshooting in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Requirements

- **Mailbox:** Gmail (personal or Workspace) or Outlook / Microsoft 365
- **Accounts (all free tier):** Anthropic, Supabase, n8n Cloud, Google (for Apps Script)
- **Local prereqs:** Node 18+, the installer will fetch `clasp`, `gh`, and `supabase` CLIs if missing

## Architecture

```
Inbox (Gmail / Outlook)
       v
  n8n workflows  --calls-->  Apps Script web app  --reads/writes-->  Supabase
       ^                            |
       |                            v
       +------- Anthropic API (Claude) for triage + drafting
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full diagram and data flow.

## License

MIT. See [LICENSE](LICENSE).

## Credits

Built on top of [n8n](https://n8n.io), [Supabase](https://supabase.com), [Google Apps Script](https://script.google.com), and the [Anthropic Claude API](https://anthropic.com).

