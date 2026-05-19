# Training data + test harness

## What's in here

- `training-template.csv` — 15 synthetic emails, one per major triage category, with expected classification. Use this to validate the triage prompt accuracy after editing.
- `run-harness.ps1` — Windows runner. Reads the CSV, posts each row through the triage agent (via the Apps Script web app), diffs predicted vs expected, prints a scorecard.
- `run-harness.sh` — macOS / Linux equivalent.

## Why synthetic, not real emails

Real email training corpora leak. They contain sender identities, deal names, internal team references, and confidential pricing. The synthetic set was hand-crafted to exercise every category and edge case without ever shipping anyone's mail.

If you want to tune the prompt on your own real mail, run `apps-script/Voice.gs::extractVoiceFromSent()` first (the Learn-My-Voice button in the dashboard) — that learns voice without leaving any data on disk. The training CSV here is for category-classification tuning, which is a separate concern from voice.

## Categories covered

The 15 rows cover:
- `ACTION_REQUIRED_DRAFT` (1) — known sender, draftable
- `ACTION_REQUIRED_KEITH` (2) — internal asking pricing decision; self-forward with audio
- `CUSTOMER_QUOTE_RESPONSE` (2) — follow-up + stale-quote check-in
- `VENDOR_RFQ_RESPONSE` (1) — pricing reply with line items
- `NEW_OPPORTUNITY` (1) — inbound inquiry missing detail
- `LOW_VALUE_ROUTINE` (2) — order confirmation + newsletter
- `FYI_NO_ACTION` (2) — meeting recap + lunch invite
- `NO_ACTION` (1) — delivery notification
- `COLD_OUTREACH` (1) — lead-gen pitch
- `SPAM` (1) — obvious scam
- Audio-note route (1) — self-forward with attachment

## Running the harness

```powershell
cd training
.\run-harness.ps1
```

```bash
cd training
./run-harness.sh
```

Output looks like:
```
[ 1/15] Quick question about the proposal     PASS  (predicted CUSTOMER_QUOTE_RESPONSE)
[ 2/15] RFQ Reply - Project Aurora            PASS  (predicted VENDOR_RFQ_RESPONSE)
[ 3/15] New project inquiry - hospitality     PASS  (predicted NEW_OPPORTUNITY)
...
Total: 14/15 passed (93.3%)
Failures:
  Newsletter - Industry trends Q2 : expected LOW_VALUE_ROUTINE, got FYI_NO_ACTION
```

Aim for 90%+ before deploying a prompt change to production. Below 80% means the prompt regressed and should be rolled back.

## Adding your own scenarios

Append rows to `training-template.csv` with the same columns. Keep the body realistic but anonymous — avoid real names, real companies, real deal amounts. Use placeholder tokens `{{OWNER_FIRST_NAME}}`, `{{OWNER_EMAIL}}`, etc; the harness substitutes them at runtime from your `config.local.json`.
